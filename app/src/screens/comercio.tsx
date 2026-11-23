import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { randomKeypair } from '../lib/stellar';
import {
  saveKeys,
  getKeys,
  saveVoucher,
  getVouchers,
  updateVoucherStatus,
  KeyRecord,
  VoucherRecord,
} from '../lib/storage';
import {
  encodeQRA,
  decodeQRB,
  verifyVoucherLocally,
} from '../lib/voucher';
import { QRScanner } from '../components/QRScanner';
import {
  Store,
  QrCode,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Clock,
  ExternalLink,
  Camera,
  Coins,
} from 'lucide-react';

const DEFAULT_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export default function ComercioScreen() {
  const [keyRecord, setKeyRecord] = useState<KeyRecord | null>(null);
  const [contractId, setContractId] = useState<string>(DEFAULT_CONTRACT);
  const [amountInput, setAmountInput] = useState<string>('5.00');
  const [generatedQRA, setGeneratedQRA] = useState<string | null>(null);
  const [expectedChargeUnits, setExpectedChargeUnits] = useState<bigint | null>(null);

  // Scanner state
  const [scanningQRB, setScanningQRB] = useState<boolean>(false);
  const [lastReceivedVoucher, setLastReceivedVoucher] = useState<{ amount: string; signer: string } | null>(null);

  // Queue & status
  const [queue, setQueue] = useState<VoucherRecord[]>([]);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    loadComercio();
  }, []);

  // Auto-sync when coming online
  useEffect(() => {
    const handleOnline = () => {
      syncPendingVouchers();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [queue, contractId]);

  async function loadComercio() {
    try {
      try {
        const res = await fetch('/deployments/testnet.json');
        if (res.ok) {
          const dep = await res.json();
          if (dep.contractId) setContractId(dep.contractId);
        }
      } catch {}

      let savedKey = await getKeys('merchant');
      if (!savedKey) {
        const kp = randomKeypair();
        savedKey = {
          publicKey: kp.publicKey(),
          secretKey: kp.secret(),
        };
        await saveKeys('merchant', savedKey);
      }
      setKeyRecord(savedKey);

      const allVouchers = await getVouchers();
      setQueue(allVouchers.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e: any) {
      console.error('Error loading comercio', e);
    }
  }

  const handleGenerarCobro = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyRecord) return;

    const val = parseFloat(amountInput);
    if (isNaN(val) || val <= 0) {
      setStatusMsg({ type: 'error', text: 'Ingresa un monto válido a cobrar' });
      return;
    }

    const units = BigInt(Math.round(val * 10_000_000));
    setExpectedChargeUnits(units);
    const qra = encodeQRA(keyRecord.publicKey, units);
    setGeneratedQRA(qra);
    setStatusMsg({ type: 'info', text: 'QR de cobro generado. Muéstralo al cliente.' });
  };

  const handleScanQRBResult = async (scannedText: string) => {
    setScanningQRB(false);
    if (!keyRecord) return;

    const payload = decodeQRB(scannedText);
    if (!payload) {
      setStatusMsg({ type: 'error', text: 'El código escaneado no es un vale válido de PagoAsegurao (SSV1)' });
      return;
    }

    // Verify locally offline
    const verification = verifyVoucherLocally(
      contractId,
      payload,
      keyRecord.publicKey,
      expectedChargeUnits || undefined
    );

    if (!verification.valid) {
      setStatusMsg({
        type: 'error',
        text: `Vale rechazado: ${verification.error}`,
      });
      return;
    }

    // Save to queue as pending
    const hexSig = Array.from(payload.signature)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const newVoucher: VoucherRecord = {
      id: `val-${payload.nonce}-${Date.now()}`,
      signer: payload.signerAddress,
      merchant: keyRecord.publicKey,
      amount: payload.amount.toString(),
      nonce: payload.nonce.toString(),
      expiry: payload.expiry.toString(),
      signature: hexSig,
      status: 'pendiente',
      createdAt: Date.now(),
    };

    await saveVoucher(newVoucher);
    setQueue((prev) => [newVoucher, ...prev]);

    setLastReceivedVoucher({
      amount: (Number(payload.amount) / 10_000_000).toFixed(2),
      signer: payload.signerAddress,
    });

    setGeneratedQRA(null); // clear current charge
    setStatusMsg({
      type: 'ok',
      text: `¡Pago de ${(Number(payload.amount) / 10_000_000).toFixed(2)} USDC recibido y verificado sin internet!`,
    });

    // If online, attempt automatic sync
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      syncPendingVouchers();
    }
  };

  const syncPendingVouchers = async () => {
    const pendings = queue.filter((v) => v.status === 'pendiente');
    if (pendings.length === 0) return;

    setSyncing(true);
    setStatusMsg({ type: 'info', text: `Sincronizando ${pendings.length} vale(s) con Stellar testnet...` });

    for (const v of pendings) {
      try {
        const res = await fetch('/api/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voucher: {
              signer: v.signer,
              merchant: v.merchant,
              amount: v.amount,
              nonce: v.nonce,
              expiry: v.expiry,
            },
            signature: v.signature,
          }),
        });

        const data = await res.json();
        if (data.ok && data.hash) {
          await updateVoucherStatus(v.id, 'liquidado', data.hash);
          setQueue((prev) =>
            prev.map((item) => (item.id === v.id ? { ...item, status: 'liquidado', txHash: data.hash } : item))
          );
        } else {
          // If simulation or contract reported error
          await updateVoucherStatus(v.id, 'rechazado', undefined, data.error || 'Error al liquidar');
          setQueue((prev) =>
            prev.map((item) =>
              item.id === v.id ? { ...item, status: 'rechazado', error: data.error } : item
            )
          );
        }
      } catch (err: any) {
        console.warn('Sync network error', err);
      }
    }

    setSyncing(false);
    setStatusMsg({ type: 'ok', text: 'Sincronización completada' });
  };

  const formatUSDC = (stroops: string) => {
    return (Number(stroops) / 10_000_000).toFixed(2);
  };

  const totalPendiente = queue
    .filter((v) => v.status === 'pendiente')
    .reduce((acc, v) => acc + BigInt(v.amount), 0n);

  return (
    <div className="comercio-container">
      {/* Status banner */}
      {statusMsg && (
        <div className={`alert alert-${statusMsg.type}`}>
          {statusMsg.type === 'ok' && <CheckCircle size={18} className="inline-icon" />}
          {statusMsg.type === 'error' && <AlertCircle size={18} className="inline-icon" />}
          {statusMsg.type === 'info' && <RefreshCw size={18} className="inline-icon" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {keyRecord && (
        <>
          {/* Header Card */}
          <div className="card merchant-header-card">
            <div className="vault-header">
              <span className="badge badge-merchant">
                <Store size={14} /> Modo Comercio
              </span>
              <span className="vault-address" title={keyRecord.publicKey}>
                {keyRecord.publicKey.slice(0, 6)}...{keyRecord.publicKey.slice(-4)}
              </span>
            </div>

            <div className="queue-stat-box">
              <div className="stat-item">
                <span className="stat-label">Pendiente por liquidar:</span>
                <span className="stat-value">{formatUSDC(totalPendiente.toString())} USDC</span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={syncPendingVouchers}
                disabled={syncing || totalPendiente === 0n}
              >
                <RefreshCw size={14} className={syncing ? 'spin' : ''} />
                {syncing ? 'Liquidando...' : 'Sincronizar'}
              </button>
            </div>
          </div>

          {/* Último vale recibido */}
          {lastReceivedVoucher && (
            <div className="card alert-ok">
              <div className="card-header">
                <h3>
                  <CheckCircle size={20} className="inline-icon" /> ¡Pago Recibido!
                </h3>
                <p>
                  Cobraste {lastReceivedVoucher.amount} USDC de {lastReceivedVoucher.signer.slice(0, 6)}...
                </p>
              </div>
            </div>
          )}

          {/* Formulario de cobro */}
          <div className="card">
            <div className="card-header">
              <Coins size={20} className="inline-icon" />
              <h3>Nuevo Cobro</h3>
            </div>

            <form onSubmit={handleGenerarCobro} className="form-vertical">
              <div className="form-group">
                <label>Monto a cobrar (USDC):</label>
                <div className="input-with-symbol">
                  <span className="symbol">$</span>
                  <input
                    type="number"
                    step="0.10"
                    min="0.10"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="input-text input-large"
                    required
                  />
                </div>
              </div>

              <div className="btn-group">
                <button type="submit" className="btn btn-primary btn-block">
                  <QrCode size={18} /> Generar QR-A (Cobrar)
                </button>
                <button
                  type="button"
                  className="btn btn-action-pay"
                  onClick={() => setScanningQRB(true)}
                >
                  <Camera size={18} /> Escanear Vale (QR-B)
                </button>
              </div>
            </form>
          </div>

          {/* QR-A Display */}
          {generatedQRA && (
            <div className="card qra-card">
              <div className="card-header">
                <h3>QR de Cobro</h3>
                <p>Pide al cliente que escanee este código con su app:</p>
                <h2 className="charge-amount">{amountInput} USDC</h2>
              </div>

              <div className="qr-wrapper">
                <QRCodeSVG value={generatedQRA} size={220} level="M" />
              </div>

              <button
                className="btn btn-primary btn-block"
                onClick={() => setScanningQRB(true)}
              >
                <Camera size={18} /> Escanear el Vale del Cliente
              </button>
            </div>
          )}

          {/* Scanner Modal for QR-B */}
          {scanningQRB && (
            <QRScanner
              title="Escanear Vale del Cliente (QR-B)"
              expectedPrefix="SSV1."
              onScan={handleScanQRBResult}
              onClose={() => setScanningQRB(false)}
            />
          )}

          {/* Queue of vouchers */}
          <div className="card">
            <div className="history-header">
              <Clock size={18} />
              <h4>Cola de Vales ({queue.length})</h4>
            </div>

            {queue.length === 0 ? (
              <p className="subtext text-center">Aún no has recibido vales.</p>
            ) : (
              <ul className="queue-list">
                {queue.map((v) => (
                  <li key={v.id} className="queue-item">
                    <div className="queue-item-info">
                      <span className="item-amount">+{formatUSDC(v.amount)} USDC</span>
                      <span className="item-client">
                        De: {v.signer.slice(0, 6)}...{v.signer.slice(-4)}
                      </span>
                      <span className="item-date">
                        {new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="queue-item-status">
                      <span className={`status-badge status-${v.status}`}>
                        {v.status === 'pendiente' && 'Pendiente de liquidar'}
                        {v.status === 'liquidado' && 'Liquidado en Stellar'}
                        {v.status === 'rechazado' && 'Rechazado'}
                      </span>
                      {v.txHash && (
                        <a
                          href={`https://stellar.expert/explorer/testnet/tx/${v.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="link-explorer"
                          title="Ver en stellar.expert"
                        >
                          <ExternalLink size={14} /> Ver tx
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
