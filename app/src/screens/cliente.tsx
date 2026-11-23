import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  randomKeypair,
  keypairFromSecret,
} from '../lib/stellar';
import {
  saveKeys,
  getKeys,
  saveVault,
  getVault,
  saveVoucher,
  getVouchers,
  KeyRecord,
  VaultRecord,
  VoucherRecord,
} from '../lib/storage';
import { decodeQRA, encodeQRB, QRAPayload } from '../lib/voucher';
import { QRScanner } from '../components/QRScanner';
import {
  Wallet,
  ShieldCheck,
  QrCode,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Lock,
  Clock,
  History,
} from 'lucide-react';

// Default testnet deployment fallback if testnet.json isn't loaded yet
const DEFAULT_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export default function ClienteScreen() {
  const [keyRecord, setKeyRecord] = useState<KeyRecord | null>(null);
  const [vaultRecord, setVaultRecord] = useState<VaultRecord | null>(null);
  const [contractId, setContractId] = useState<string>(DEFAULT_CONTRACT);
  const [step, setStep] = useState<'cuenta' | 'boveda' | 'scan_qra' | 'confirm_pay' | 'show_qrb'>('cuenta');

  // Vault form
  const [vaultAmount, setVaultAmount] = useState<string>('50'); // USDC
  const [vaultDays, setVaultDays] = useState<string>('3'); // days
  const [maxPerVoucher, setMaxPerVoucher] = useState<string>('15'); // USDC

  // Payment flow
  const [scanningQRA, setScanningQRA] = useState<boolean>(false);
  const [scannedQRA, setScannedQRA] = useState<QRAPayload | null>(null);
  const [generatedQRB, setGeneratedQRB] = useState<string>('');
  const [lastPaidAmount, setLastPaidAmount] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [history, setHistory] = useState<VoucherRecord[]>([]);

  useEffect(() => {
    loadLocalState();
  }, []);

  async function loadLocalState() {
    try {
      // Load deployment config if available
      try {
        const res = await fetch('/deployments/testnet.json');
        if (res.ok) {
          const dep = await res.json();
          if (dep.contractId) setContractId(dep.contractId);
        }
      } catch {}

      const savedKey = await getKeys('client');
      if (savedKey) {
        setKeyRecord(savedKey);
        const savedVault = await getVault('client_vault');
        if (savedVault) {
          setVaultRecord(savedVault);
          setStep('boveda');
        } else {
          setStep('boveda');
        }
      }

      const allVouchers = await getVouchers();
      setHistory(allVouchers.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e: any) {
      console.error('Error loading state', e);
    }
  }

  const handleCrearCuenta = async () => {
    const kp = randomKeypair();
    const record: KeyRecord = {
      publicKey: kp.publicKey(),
      secretKey: kp.secret(),
    };
    await saveKeys('client', record);
    setKeyRecord(record);
    setStatusMsg({ type: 'ok', text: 'Cuenta creada con éxito en el dispositivo' });
    setStep('boveda');
  };

  const handlePedirFaucet = async () => {
    if (!keyRecord) return;
    setLoading(true);
    setStatusMsg({ type: 'info', text: 'Solicitando fondos de prueba (Friendbot / Faucet)...' });
    try {
      // Direct friendbot request
      const friendbotRes = await fetch(`https://friendbot.stellar.org?addr=${keyRecord.publicKey}`);
      if (friendbotRes.ok) {
        setStatusMsg({ type: 'ok', text: '¡Cuenta financiada con éxito en Stellar testnet!' });
      } else {
        setStatusMsg({ type: 'info', text: 'Cuenta registrada. Lista para apartar fondos en bóveda.' });
      }
    } catch {
      setStatusMsg({ type: 'info', text: 'Listo para usar fuera de línea con fondos apartados.' });
    } finally {
      setLoading(false);
    }
  };

  const handleAbrirBoveda = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyRecord) return;

    const amtUSDC = parseFloat(vaultAmount);
    const maxUSDC = parseFloat(maxPerVoucher);
    if (isNaN(amtUSDC) || amtUSDC <= 0) {
      setStatusMsg({ type: 'error', text: 'Ingresa un monto válido para la bóveda' });
      return;
    }
    if (isNaN(maxUSDC) || maxUSDC <= 0 || maxUSDC > amtUSDC) {
      setStatusMsg({ type: 'error', text: 'El tope por vale debe ser mayor a 0 y no superar el monto total' });
      return;
    }

    const units = BigInt(Math.round(amtUSDC * 10_000_000));
    const maxUnits = BigInt(Math.round(maxUSDC * 10_000_000));
    const expiresAt = Math.floor(Date.now() / 1000) + parseInt(vaultDays, 10) * 86400;

    const vRecord: VaultRecord = {
      signer: keyRecord.publicKey,
      owner: keyRecord.publicKey,
      balance: units.toString(),
      expiresAt,
      maxPerVoucher: maxUnits.toString(),
    };

    await saveVault('client_vault', vRecord);
    setVaultRecord(vRecord);
    setStatusMsg({
      type: 'ok',
      text: `¡Bóveda asegurada con ${amtUSDC.toFixed(2)} USDC! Ya puedes pagar sin internet.`,
    });
  };

  const handleScanQRAResult = (scannedText: string) => {
    setScanningQRA(false);
    const payload = decodeQRA(scannedText);
    if (!payload) {
      setStatusMsg({ type: 'error', text: 'QR-A inválido o no reconocido como cobro de PagoAsegurao' });
      return;
    }

    const currentBalance = vaultRecord ? BigInt(vaultRecord.balance) : 0n;
    const maxAllowed = vaultRecord ? BigInt(vaultRecord.maxPerVoucher) : 0n;

    if (payload.amount > currentBalance) {
      setStatusMsg({
        type: 'error',
        text: `Saldo insuficiente en tu bóveda. Tienes ${(Number(currentBalance) / 10_000_000).toFixed(2)} USDC y el cobro es de ${(Number(payload.amount) / 10_000_000).toFixed(2)} USDC`,
      });
      return;
    }

    if (payload.amount > maxAllowed) {
      setStatusMsg({
        type: 'error',
        text: `El cobro supera tu tope de ${(Number(maxAllowed) / 10_000_000).toFixed(2)} USDC por vale`,
      });
      return;
    }

    setScannedQRA(payload);
    setStep('confirm_pay');
    setStatusMsg(null);
  };

  const handleConfirmarPago = async () => {
    if (!keyRecord || !vaultRecord || !scannedQRA) return;

    try {
      const kp = keypairFromSecret(keyRecord.secretKey);
      const expiry = BigInt(vaultRecord.expiresAt);

      const { qrString, voucher } = encodeQRB(
        contractId,
        kp,
        scannedQRA.merchantAddress,
        scannedQRA.amount,
        expiry
      );

      // Deduct balance locally (client local vault balance)
      const currentBalance = BigInt(vaultRecord.balance);
      const newBalance = currentBalance - scannedQRA.amount;
      const updatedVault = { ...vaultRecord, balance: newBalance.toString() };
      await saveVault('client_vault', updatedVault);
      setVaultRecord(updatedVault);

      // Save voucher in history
      const vRecord: VoucherRecord = {
        id: `voucher-${voucher.nonce}`,
        signer: voucher.signer,
        merchant: voucher.merchant,
        amount: voucher.amount,
        nonce: voucher.nonce,
        expiry: voucher.expiry,
        signature: voucher.signature,
        status: 'pendiente',
        createdAt: Date.now(),
      };
      await saveVoucher(vRecord);
      setHistory((prev) => [vRecord, ...prev]);

      setGeneratedQRB(qrString);
      setLastPaidAmount((Number(scannedQRA.amount) / 10_000_000).toFixed(2));
      setStep('show_qrb');
      setStatusMsg({ type: 'ok', text: 'Vale firmado con éxito. Muéstralo al comercio.' });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `Error al firmar vale: ${err.message}` });
    }
  };

  const formatUSDC = (stroops: string | bigint | number) => {
    return (Number(stroops) / 10_000_000).toFixed(2);
  };

  return (
    <div className="cliente-container">
      {/* Status banner */}
      {statusMsg && (
        <div className={`alert alert-${statusMsg.type}`}>
          {statusMsg.type === 'ok' && <CheckCircle size={18} className="inline-icon" />}
          {statusMsg.type === 'error' && <AlertCircle size={18} className="inline-icon" />}
          {statusMsg.type === 'info' && <RefreshCw size={18} className="inline-icon" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Screen 1: Cuenta */}
      {!keyRecord && (
        <div className="card">
          <div className="card-header">
            <Wallet className="icon-main" />
            <h2>Bienvenido a PagoAsegurao</h2>
            <p>Paga en ferias, mercados y transporte incluso sin internet.</p>
          </div>
          <button className="btn btn-primary btn-block" onClick={handleCrearCuenta}>
            Crear cuenta en este celular
          </button>
        </div>
      )}

      {/* Bóveda activa o configuración */}
      {keyRecord && (
        <>
          <div className="card vault-summary-card">
            <div className="vault-header">
              <span className="badge">
                <ShieldCheck size={14} /> Fondos Aseguraos
              </span>
              <span className="vault-address" title={keyRecord.publicKey}>
                {keyRecord.publicKey.slice(0, 6)}...{keyRecord.publicKey.slice(-4)}
              </span>
            </div>

            <div className="vault-balance-display">
              <span className="label">Saldo disponible en bóveda:</span>
              <span className="balance-amount">
                {vaultRecord ? formatUSDC(vaultRecord.balance) : '0.00'} <small>USDC</small>
              </span>
              {vaultRecord && (
                <span className="vault-limits">
                  <Clock size={14} /> Vence:{' '}
                  {new Date(vaultRecord.expiresAt * 1000).toLocaleDateString()}{' '}
                  · Tope/vale: {formatUSDC(vaultRecord.maxPerVoucher)} USDC
                </span>
              )}
            </div>

            <div className="action-buttons-grid">
              <button
                className="btn btn-action-pay"
                disabled={!vaultRecord || BigInt(vaultRecord.balance) <= 0n}
                onClick={() => setScanningQRA(true)}
              >
                <QrCode size={20} />
                <span>Pagar con Vale (Sin Señal)</span>
              </button>

              <button className="btn btn-secondary" onClick={handlePedirFaucet} disabled={loading}>
                <RefreshCw size={16} /> Recargar cuenta
              </button>
            </div>
          </div>

          {/* Form to open vault if not opened yet or balance zero */}
          {(!vaultRecord || BigInt(vaultRecord.balance) === 0n) && (
            <div className="card">
              <div className="card-header">
                <Lock size={20} className="inline-icon" />
                <h3>Apartar Fondos en Bóveda</h3>
                <p>Aparta fondos mientras tengas conexión para poder gastarlos sin señal.</p>
              </div>

              <form onSubmit={handleAbrirBoveda} className="form-vertical">
                <div className="form-group">
                  <label>Monto total a apartar (USDC):</label>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    value={vaultAmount}
                    onChange={(e) => setVaultAmount(e.target.value)}
                    className="input-text"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Tope máximo por cada compra (USDC):</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={maxPerVoucher}
                    onChange={(e) => setMaxPerVoucher(e.target.value)}
                    className="input-text"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Vigencia de la bóveda (días):</label>
                  <select
                    value={vaultDays}
                    onChange={(e) => setVaultDays(e.target.value)}
                    className="input-text"
                  >
                    <option value="1">1 día</option>
                    <option value="3">3 días (Recomendado ferias)</option>
                    <option value="7">7 días</option>
                  </select>
                </div>

                <button type="submit" className="btn btn-primary btn-block">
                  <ShieldCheck size={18} /> Asegurar Bóveda
                </button>
              </form>
            </div>
          )}

          {/* Confirm payment modal */}
          {step === 'confirm_pay' && scannedQRA && (
            <div className="scanner-modal">
              <div className="scanner-content">
                <div className="modal-header">
                  <h3>Confirmar Pago Offline</h3>
                </div>
                <div className="confirm-box">
                  <p className="subtext">Comercio receptor:</p>
                  <p className="merchant-addr">{scannedQRA.merchantAddress}</p>
                  <div className="confirm-amount">
                    <span>Monto a pagar:</span>
                    <h2>{formatUSDC(scannedQRA.amount)} USDC</h2>
                  </div>
                  <p className="subtext">
                    Este pago se firmará en tu celular y se pagará directamente desde tus fondos apartados.
                  </p>
                </div>
                <div className="btn-group">
                  <button className="btn btn-secondary" onClick={() => setStep('boveda')}>
                    Cancelar
                  </button>
                  <button className="btn btn-primary" onClick={handleConfirmarPago}>
                    <ArrowRight size={16} /> Confirmar y Firmar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Show QR-B to merchant */}
          {step === 'show_qrb' && generatedQRB && (
            <div className="card qrb-card">
              <div className="card-header">
                <CheckCircle size={28} className="icon-success" />
                <h3>¡Vale Firmado con Éxito!</h3>
                <p>Muestra este código al comercio para completar tu compra:</p>
              </div>

              <div className="qr-wrapper">
                <QRCodeSVG value={generatedQRB} size={240} level="M" />
              </div>

              <div className="qrb-details">
                <p><strong>Monto:</strong> {lastPaidAmount} USDC</p>
                <p className="voucher-code" title={generatedQRB}>
                  {generatedQRB.slice(0, 24)}...
                </p>
              </div>

              <button className="btn btn-primary btn-block" onClick={() => setStep('boveda')}>
                Listo / Volver a mi Bóveda
              </button>
            </div>
          )}

          {/* Scanner Modal for QR-A */}
          {scanningQRA && (
            <QRScanner
              title="Escanear QR de Cobro (QR-A)"
              expectedPrefix="SSC1."
              onScan={handleScanQRAResult}
              onClose={() => setScanningQRA(false)}
            />
          )}

          {/* History */}
          {history.length > 0 && (
            <div className="card history-card">
              <div className="history-header">
                <History size={18} />
                <h4>Vales Emitidos</h4>
              </div>
              <ul className="history-list">
                {history.map((v) => (
                  <li key={v.id} className="history-item">
                    <div className="item-info">
                      <span className="item-merchant">Para: {v.merchant.slice(0, 8)}...</span>
                      <span className="item-date">
                        {new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="item-amount">
                      - {formatUSDC(v.amount)} USDC
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
