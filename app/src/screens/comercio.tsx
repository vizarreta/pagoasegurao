import React, { useEffect, useState, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  TESTNET_CONFIG,
  AccountBalances,
  randomKeypair,
  keypairFromSecret,
  fetchAccountBalances,
  activateAccountWithFaucet,
  fetchVaultFromRelayer,
  parseAmountToStroops,
  formatStroops,
  formatSoles,
  checkVoucherRedeemedOnChain,
} from '../lib/stellar';
import {
  saveKeys,
  getKeys,
  saveMerchantVoucher,
  getMerchantVouchers,
  hasMerchantVoucher,
  updateMerchantVoucherStatus,
  saveVaultCache,
  getVaultCache,
  KeyRecord,
  VoucherRecord,
  CachedVaultRecord,
} from '../lib/storage';
import {
  encodeQRA,
  decodeQRB,
  verifyVoucherLocally,
  validateVoucherVaultExpiry,
  evaluateClientExposure,
  getVoucherUrgency,
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
  Copy,
  Check,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';

interface StatusAlert {
  type: 'ok' | 'error' | 'info' | 'warning';
  text: string;
}

const PRESET_AMOUNTS = ['2.00', '5.00', '10.00', '20.00'];
const ACTIVE_QRA_STORAGE_KEY = 'pagoasegurao_active_qra';

function sortMerchantQueue(items: VoucherRecord[]): VoucherRecord[] {
  return [...items].sort((a, b) => {
    const aPending = a.status === 'pendiente' ? 0 : 1;
    const bPending = b.status === 'pendiente' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    if (aPending === 0) {
      const expDiff = Number(a.expiry) - Number(b.expiry);
      if (expDiff !== 0) return expDiff;
    }
    return b.createdAt - a.createdAt;
  });
}

export default function ComercioScreen() {
  const [keyRecord, setKeyRecord] = useState<KeyRecord | null>(null);
  const keyRecordRef = useRef<KeyRecord | null>(null);
  const syncingRef = useRef<boolean>(false);
  const [balances, setBalances] = useState<AccountBalances | null>(null);
  const [activating, setActivating] = useState<boolean>(false);

  const [amountInput, setAmountInput] = useState<string>('5.00');
  const [generatedQRA, setGeneratedQRA] = useState<string | null>(null);
  const [expectedChargeUnits, setExpectedChargeUnits] = useState<bigint | null>(null);

  // Scanner & last received
  const [scanningQRB, setScanningQRB] = useState<boolean>(false);
  const [lastReceived, setLastReceived] = useState<{
    amount: string;
    signer: string;
    vaultInfo?: CachedVaultRecord | null;
    highRiskWarning?: string;
  } | null>(null);

  // Queue & sync
  const [queue, setQueue] = useState<VoucherRecord[]>([]);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<StatusAlert | null>(null);
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));

  const refreshMerchantBalances = useCallback(async (pubKey: string) => {
    try {
      const bal = await fetchAccountBalances(pubKey);
      setBalances(bal);
    } catch {
      // Offline — keep last known balances
    }
  }, []);

  const syncPendingVouchers = useCallback(
    async (merchantPubKey?: string) => {
      if (syncingRef.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setStatusMsg({ type: 'warning', text: 'Sin conexión. Los vales se liquidarán al recuperar señal.' });
        return;
      }

      const freshQueue = sortMerchantQueue(await getMerchantVouchers());
      const pendings = freshQueue.filter((v) => v.status === 'pendiente');
      if (pendings.length === 0) return;

      syncingRef.current = true;
      setSyncing(true);
      setStatusMsg({
        type: 'info',
        text: `Liquidando ${pendings.length} vale(s) en Stellar Testnet (comisión patrocinada por relayer)...`,
      });

      let settledCount = 0;
      let pendingConfirmCount = 0;
      let rejectedCount = 0;
      let networkFailCount = 0;

      try {
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
            if (res.ok && data.ok && data.hash) {
              if (data.status === 'PENDING' || res.status === 202) {
                await updateMerchantVoucherStatus(v.id, 'pendiente', data.hash, undefined);
                // Give ledger ~2.5s to confirm from browser without risking Vercel timeout
                await new Promise((r) => setTimeout(r, 2500));
                const confirmed = await checkVoucherRedeemedOnChain(v.signer, v.nonce);
                if (confirmed === true) {
                  await updateMerchantVoucherStatus(v.id, 'liquidado', data.hash, undefined);
                  settledCount++;
                } else {
                  pendingConfirmCount++;
                }
              } else {
                await updateMerchantVoucherStatus(v.id, 'liquidado', data.hash, undefined);
                settledCount++;
              }
            } else if (data.alreadyRedeemed && v.txHash) {
              // Previously sent via 202 PENDING and now confirmed on-chain
              await updateMerchantVoucherStatus(v.id, 'liquidado', v.txHash, undefined);
              settledCount++;
            } else {
              const errText = data.error || 'El contrato rechazó el vale.';
              if (res.status >= 500) {
                networkFailCount++;
              } else {
                await updateMerchantVoucherStatus(v.id, 'rechazado', undefined, errText);
                rejectedCount++;
              }
            }
          } catch {
            networkFailCount++;
          }
        }

        const updatedQueue = sortMerchantQueue(await getMerchantVouchers());
        setQueue(updatedQueue);

        const pub = merchantPubKey || keyRecordRef.current?.publicKey;
        if (pub) {
          await refreshMerchantBalances(pub);
        }

        if (settledCount > 0 && rejectedCount === 0 && networkFailCount === 0 && pendingConfirmCount === 0) {
          setStatusMsg({
            type: 'ok',
            text: `¡${settledCount} vale(s) liquidado(s) en Stellar Testnet! Revisa tu saldo en Soles y el enlace al explorador.`,
          });
        } else if (pendingConfirmCount > 0) {
          setStatusMsg({
            type: 'info',
            text: `${settledCount} liquidado(s) y ${pendingConfirmCount} enviado(s) esperando confirmación final en Stellar Testnet.`,
          });
        } else if (rejectedCount > 0) {
          setStatusMsg({
            type: 'warning',
            text: `Sincronización terminada: ${settledCount} liquidado(s), ${rejectedCount} rechazado(s). Revisa el motivo en la cola.`,
          });
        } else if (networkFailCount > 0) {
          setStatusMsg({
            type: 'warning',
            text: 'No se pudo conectar con el relayer. Tus vales siguen seguros en la cola local.',
          });
        }
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [refreshMerchantBalances]
  );

  useEffect(() => {
    async function loadComercio() {
      try {
        let savedKey = await getKeys('merchant');
        if (!savedKey) {
          const kp = randomKeypair();
          savedKey = {
            publicKey: kp.publicKey(),
            secretKey: kp.secret(),
          };
          await saveKeys('merchant', savedKey);
        }
        keyRecordRef.current = savedKey;
        setKeyRecord(savedKey);

        try {
          const savedActive = sessionStorage.getItem(ACTIVE_QRA_STORAGE_KEY);
          if (savedActive) {
            const parsed = JSON.parse(savedActive) as { merchant?: string; qrA?: string; expectedUnits?: string };
            if (parsed.merchant === savedKey.publicKey && parsed.qrA && parsed.expectedUnits) {
              setGeneratedQRA(parsed.qrA);
              setExpectedChargeUnits(BigInt(parsed.expectedUnits));
            }
          }
        } catch {
          // Ignore invalid sessionStorage entry
        }

        const allVouchers = sortMerchantQueue(await getMerchantVouchers());
        setQueue(allVouchers);

        if (typeof navigator === 'undefined' || navigator.onLine) {
          await refreshMerchantBalances(savedKey.publicKey);
          if (allVouchers.some((v) => v.status === 'pendiente')) {
            await syncPendingVouchers(savedKey.publicKey);
          }
        }
      } catch (e) {
        console.error('Error loading merchant', e);
      }
    }
    loadComercio();
  }, [refreshMerchantBalances, syncPendingVouchers]);

  useEffect(() => {
    if (!queue.some((v) => v.status === 'pendiente')) return;
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [queue]);

  useEffect(() => {
    const handleOnline = () => {
      if (keyRecord) {
        refreshMerchantBalances(keyRecord.publicKey);
        syncPendingVouchers(keyRecord.publicKey);
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [keyRecord, refreshMerchantBalances, syncPendingVouchers]);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setStatusMsg({ type: 'info', text: 'Copia manualmente el código mostrado.' });
    }
  };

  const handleActivarComercio = async () => {
    if (!keyRecord) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatusMsg({ type: 'error', text: 'Necesitas internet una sola vez para activar tu cuenta de comercio.' });
      return;
    }

    setActivating(true);
    setStatusMsg({
      type: 'info',
      text: 'Activando cuenta de comercio en Stellar Testnet (Friendbot + trustline tPEN)...',
    });

    try {
      const kp = keypairFromSecret(keyRecord.secretKey);
      const result = await activateAccountWithFaucet(kp, false);
      setBalances(result.balances);
      setStatusMsg({
        type: 'ok',
        text: '¡Cuenta de comercio activa con línea de confianza para Soles (tPEN)! Ya puedes cobrar incluso en Modo Avión.',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err?.message || 'Error al activar la cuenta de comercio en testnet.',
      });
    } finally {
      setActivating(false);
    }
  };

  const handleGenerarCobro = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyRecord) return;

    const units = parseAmountToStroops(amountInput);
    if (!units) {
      setStatusMsg({ type: 'error', text: 'Ingresa un monto válido en Soles (S/).' });
      return;
    }

    setExpectedChargeUnits(units);
    const qra = encodeQRA(keyRecord.publicKey, units);
    setGeneratedQRA(qra);
    try {
      sessionStorage.setItem(
        ACTIVE_QRA_STORAGE_KEY,
        JSON.stringify({ merchant: keyRecord.publicKey, qrA: qra, expectedUnits: units.toString() })
      );
    } catch {}
    setStatusMsg({
      type: 'info',
      text: `QR-A listo por ${formatSoles(units)}. Muéstralo al cliente para que firme el vale.`,
    });
  };

  const handleScanQRBResult = async (scannedText: string) => {
    setScanningQRB(false);
    if (!keyRecord) return;

    const payload = decodeQRB(scannedText);
    if (!payload) {
      setStatusMsg({ type: 'error', text: 'El código escaneado no es un vale válido de PagoAsegurao (SSV1).' });
      return;
    }

    const duplicate = await hasMerchantVoucher(payload.signerAddress, payload.nonce.toString());
    if (duplicate) {
      setStatusMsg({
        type: 'error',
        text: 'Vale rechazado: este vale ya fue escaneado y guardado en tu cola (doble cobro evitado).',
      });
      return;
    }

    const verification = verifyVoucherLocally(
      TESTNET_CONFIG.contractId,
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

    let vaultInfo: CachedVaultRecord | null = (await getVaultCache(payload.signerAddress)) || null;
    let fetchedLiveVault = false;
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const remote = await fetchVaultFromRelayer(payload.signerAddress);
        if (remote.exists && remote.vault) {
          vaultInfo = {
            signer: payload.signerAddress,
            exists: true,
            balance: remote.vault.balance,
            expiresAt: remote.vault.expiresAt,
            maxPerVoucher: remote.vault.maxPerVoucher,
            syncedAt: remote.syncedAt,
          };
          fetchedLiveVault = true;
          await saveVaultCache(vaultInfo);
        }
      } catch {
        // Offline or RPC slow
      }
    }

    // Only enforce cached expiry if live or still active (an expired cache could predate a new vault offline)
    const currentNowSec = Math.floor(Date.now() / 1000);
    const enforceableVaultExpiry =
      vaultInfo && (fetchedLiveVault || vaultInfo.expiresAt >= currentNowSec)
        ? BigInt(vaultInfo.expiresAt)
        : undefined;
    const vaultExpiryCheck = validateVoucherVaultExpiry(payload.expiry, enforceableVaultExpiry);
    if (!vaultExpiryCheck.valid) {
      setStatusMsg({
        type: 'error',
        text: `Vale rechazado: ${vaultExpiryCheck.error}`,
      });
      return;
    }

    const existingQueue = await getMerchantVouchers();
    const { exceedingWarning: highRiskWarning } = evaluateClientExposure(
      payload.signerAddress,
      payload.amount,
      existingQueue,
      vaultInfo,
      fetchedLiveVault,
      currentNowSec
    );

    const hexSig = Array.from(payload.signature)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const newVoucher: VoucherRecord = {
      id: `merchant-val-${payload.signerAddress.slice(-6)}-${payload.nonce}`,
      signer: payload.signerAddress,
      merchant: keyRecord.publicKey,
      amount: payload.amount.toString(),
      nonce: payload.nonce.toString(),
      expiry: payload.expiry.toString(),
      signature: hexSig,
      status: 'pendiente',
      createdAt: Date.now(),
    };

    await saveMerchantVoucher(newVoucher);
    const updatedQueue = sortMerchantQueue(await getMerchantVouchers());
    setQueue(updatedQueue);

    setLastReceived({
      amount: formatSoles(payload.amount),
      signer: payload.signerAddress,
      vaultInfo,
      highRiskWarning,
    });

    setGeneratedQRA(null);
    setExpectedChargeUnits(null);
    try {
      sessionStorage.removeItem(ACTIVE_QRA_STORAGE_KEY);
    } catch {}
    setStatusMsg({
      type: 'ok',
      text: `¡Pago recibido (${formatSoles(payload.amount)}), verificado localmente y pendiente de liquidar!`,
    });

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      await syncPendingVouchers(keyRecord.publicKey);
    }
  };

  const handleRetryVoucher = async (id: string) => {
    await updateMerchantVoucherStatus(id, 'pendiente', undefined, undefined);
    const updated = sortMerchantQueue(await getMerchantVouchers());
    setQueue(updated);
    if (keyRecord) {
      await syncPendingVouchers(keyRecord.publicKey);
    }
  };

  const pendingQueue = queue.filter((v) => v.status === 'pendiente');
  const totalPendiente = pendingQueue.reduce((acc, v) => acc + BigInt(v.amount), 0n);
  const nextPendingUrgency = pendingQueue.length > 0 ? getVoucherUrgency(pendingQueue[0].expiry, nowSec) : null;

  return (
    <div className="comercio-container">
      {/* Status alert banner */}
      {statusMsg && (
        <div className={`alert alert-${statusMsg.type}`}>
          <div className="alert-top-row">
            <div className="alert-body">
              {statusMsg.type === 'ok' && <CheckCircle size={18} className="inline-icon" />}
              {statusMsg.type === 'error' && <AlertCircle size={18} className="inline-icon" />}
              {statusMsg.type === 'warning' && <AlertCircle size={18} className="inline-icon" />}
              {statusMsg.type === 'info' && <RefreshCw size={18} className="inline-icon spin" />}
              <span>{statusMsg.text}</span>
            </div>
            <button
              type="button"
              className="alert-close"
              aria-label="Cerrar aviso"
              onClick={() => setStatusMsg(null)}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {keyRecord && (
        <>
          {/* Merchant Account Activation Warning */}
          {balances && !balances.hasTrustline && (
            <div className="card activation-card">
              <div className="card-header">
                <h3>
                  <Sparkles size={18} className="inline-icon" /> Activa tu cuenta de comercio
                </h3>
                <p>
                  Antes de recibir tu primera liquidación en Soles de prueba (tPEN) en Stellar Testnet, activa tu cuenta
                  (Friendbot + trustline). Solo se hace una vez con internet.
                </p>
              </div>
              <button
                className="btn btn-primary btn-block"
                onClick={handleActivarComercio}
                disabled={activating}
              >
                <RefreshCw size={16} className={activating ? 'spin' : ''} />
                {activating ? 'Activando en Stellar Testnet...' : 'Activar cuenta de comercio en Testnet'}
              </button>
            </div>
          )}

          {/* Header Card */}
          <div className="card merchant-header-card">
            <div className="vault-header">
              <span className="badge badge-merchant">
                <Store size={14} /> Modo Comercio
              </span>
              <div className="address-actions">
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() => handleCopy(keyRecord.publicKey, 'merchant-addr')}
                  title={keyRecord.publicKey}
                >
                  {keyRecord.publicKey.slice(0, 6)}...{keyRecord.publicKey.slice(-4)}
                  {copiedId === 'merchant-addr' ? <Check size={12} /> : <Copy size={12} />}
                </button>
                <a
                  href={`${TESTNET_CONFIG.explorerBase}/account/${keyRecord.publicKey}`}
                  target="_blank"
                  rel="noreferrer"
                  className="link-explorer"
                  title="Ver cuenta en stellar.expert"
                >
                  <ExternalLink size={13} />
                </a>
              </div>
            </div>

            <div className="merchant-stats-grid">
              <div className="stat-card">
                <span className="stat-label">Saldo en Stellar:</span>
                <span className="stat-value-sm">
                  {balances ? formatSoles(parseAmountToStroops(balances.balance) ?? 0n) : '—'} <small>tPEN</small>
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Pendiente por liquidar:</span>
                <span className="stat-value-sm pending-val">
                  S/ {formatStroops(totalPendiente)} <small>tPEN</small>
                </span>
              </div>
            </div>

            <div className="btn-group mt-10">
              <button
                className="btn btn-primary btn-block"
                onClick={() => syncPendingVouchers(keyRecord.publicKey)}
                disabled={syncing || totalPendiente === 0n}
              >
                <RefreshCw size={15} className={syncing ? 'spin' : ''} />
                {syncing ? 'Liquidando en Stellar...' : 'Sincronizar y Liquidar'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => refreshMerchantBalances(keyRecord.publicKey)}
                title="Actualizar saldo de Stellar Testnet"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          {/* Last received voucher feedback */}
          {lastReceived && (
            <div className={`card ${lastReceived.highRiskWarning ? 'alert-warning-card' : 'alert-ok-card'}`}>
              <div className="card-header mb-0">
                <h3>
                  <CheckCircle size={18} className="inline-icon" /> Pago recibido (firma Ed25519 válida)
                </h3>
                <p>
                  <strong>{lastReceived.amount}</strong> de {lastReceived.signer.slice(0, 6)}...
                  {lastReceived.signer.slice(-4)}
                </p>
                {lastReceived.vaultInfo && (
                  <p className="subtext mt-6">
                    Saldo de bóveda según última sincronización:{' '}
                    <strong>{formatSoles(lastReceived.vaultInfo.balance)}</strong>
                  </p>
                )}
                {lastReceived.highRiskWarning && (
                  <p className="warn-line mt-6">
                    <ShieldAlert size={14} className="inline-icon" /> {lastReceived.highRiskWarning}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* QR-A Display (shown above form so it fits immediately on screen) */}
          {generatedQRA && (
            <div className="card qra-card">
              <div className="card-header">
                <h3>QR de Cobro (QR-A)</h3>
                <p>Pide al cliente que escanee este código (funciona sin internet):</p>
                <h2 className="charge-amount">
                  {expectedChargeUnits ? formatSoles(expectedChargeUnits) : `S/ ${amountInput}`}
                </h2>
              </div>

              <div className="qr-wrapper">
                <QRCodeSVG value={generatedQRA} size={220} level="L" marginSize={2} />
              </div>

              <div className="qra-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={() => setScanningQRB(true)}
                >
                  <Camera size={18} /> Escanear Vale del Cliente (QR-B)
                </button>
                <div className="btn-group">
                  <button
                    type="button"
                    className="btn btn-secondary btn-block"
                    onClick={() => handleCopy(generatedQRA, 'qra-code')}
                  >
                    {copiedId === 'qra-code' ? <Check size={16} /> : <Copy size={16} />}
                    {copiedId === 'qra-code' ? 'Copiado' : 'Copiar QR-A'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setGeneratedQRA(null);
                      setExpectedChargeUnits(null);
                      try {
                        sessionStorage.removeItem(ACTIVE_QRA_STORAGE_KEY);
                      } catch {}
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Charge Form */}
          <div className="card">
            <div className="card-header">
              <Coins size={20} className="inline-icon" />
              <h3>Nuevo Cobro</h3>
            </div>

            <form onSubmit={handleGenerarCobro} className="form-vertical">
              <div className="form-group">
                <label>Monto a cobrar (Soles · tPEN):</label>
                <div className="input-with-symbol">
                  <span className="symbol">S/</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="input-text input-large"
                    required
                  />
                </div>
                <div className="preset-chips">
                  {PRESET_AMOUNTS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`preset-chip ${amountInput === preset ? 'active' : ''}`}
                      onClick={() => setAmountInput(preset)}
                    >
                      S/ {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="btn-group">
                <button type="submit" className="btn btn-primary btn-block">
                  <QrCode size={18} /> Generar QR-A
                </button>
                <button
                  type="button"
                  className="btn btn-action-pay"
                  onClick={() => setScanningQRB(true)}
                >
                  <Camera size={18} /> Leer QR-B
                </button>
              </div>
            </form>
          </div>

          {/* Scanner Modal for QR-B */}
          {scanningQRB && (
            <QRScanner
              title="Escanear Vale del Cliente (QR-B)"
              expectedPrefix="SSV1."
              onScan={handleScanQRBResult}
              onClose={() => setScanningQRB(false)}
            />
          )}

          {/* Voucher Queue */}
          <div className="card">
            <div className="history-header">
              <Clock size={18} />
              <h4>Cola de Vales ({queue.length})</h4>
            </div>

            {pendingQueue.length > 0 && nextPendingUrgency && (
              <div className="urgency-banner">
                {pendingQueue.length} vale(s) por liquidar · el más próximo:{' '}
                <strong>{nextPendingUrgency.label}</strong>
              </div>
            )}

            {queue.length === 0 ? (
              <p className="subtext text-center">Aún no has recibido vales.</p>
            ) : (
              <ul className="queue-list">
                {queue.map((v) => {
                  const urgency = v.status === 'pendiente' ? getVoucherUrgency(v.expiry, nowSec) : null;
                  return (
                    <li key={v.id} className="queue-item queue-item-col">
                      <div className="queue-item-top">
                        <div className="queue-item-info">
                          <span className="item-amount">+ {formatSoles(v.amount)}</span>
                          <span className="item-client">
                            De: {v.signer.slice(0, 6)}...{v.signer.slice(-4)} ·{' '}
                            {new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {urgency && (
                            <span className={`urgency-badge urgency-${urgency.level}`}>{urgency.label}</span>
                          )}
                        </div>

                        <div className="queue-item-status">
                          <span className={`status-badge status-${v.status}`}>
                            {v.status === 'pendiente' &&
                              (v.txHash ? 'Confirmando en Stellar' : 'Pendiente de liquidar')}
                            {v.status === 'liquidado' && 'Liquidado en Stellar'}
                            {v.status === 'rechazado' && 'Rechazado'}
                          </span>
                          {v.txHash && (
                            <a
                              href={`${TESTNET_CONFIG.explorerBase}/tx/${v.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="link-explorer"
                              title="Ver transacción en stellar.expert"
                            >
                              <ExternalLink size={13} /> Ver tx
                            </a>
                          )}
                        </div>
                      </div>

                      {v.status === 'rechazado' && v.error && (
                        <div className="voucher-error-row">
                          <span className="voucher-error-text">{v.error}</span>
                          <button
                            type="button"
                            className="btn-chip"
                            onClick={() => handleRetryVoucher(v.id)}
                            disabled={syncing}
                          >
                            Reintentar
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="disclaimer-note">
            El relayer patrocina las comisiones de red al liquidar (fee sponsorship). Activo de prueba tPEN (S/) en
            Stellar Testnet sin valor económico. Asegurado hasta el monto apartado.
          </p>
        </>
      )}
    </div>
  );
}
