import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  TESTNET_CONFIG,
  AccountBalances,
  randomKeypair,
  keypairFromSecret,
  fetchAccountBalances,
  activateAccountWithFaucet,
  openVaultOnChain,
  topUpVaultOnChain,
  closeVaultOnChain,
  fetchVaultFromRelayer,
  parseTusdcToStroops,
  formatStroops,
} from '../lib/stellar';
import {
  saveKeys,
  getKeys,
  saveVault,
  getVault,
  deleteVault,
  saveClientVoucher,
  getClientVouchers,
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
  Unlock,
  Clock,
  History,
  Copy,
  Check,
  ExternalLink,
  PlusCircle,
} from 'lucide-react';

interface StatusAlert {
  type: 'ok' | 'error' | 'info' | 'warning';
  text: string;
  txHash?: string;
}

export default function ClienteScreen() {
  const [keyRecord, setKeyRecord] = useState<KeyRecord | null>(null);
  const [vaultRecord, setVaultRecord] = useState<VaultRecord | null>(null);
  const [balances, setBalances] = useState<AccountBalances | null>(null);
  const [step, setStep] = useState<'cuenta' | 'boveda' | 'confirm_pay' | 'show_qrb'>('cuenta');

  // Vault open form
  const [vaultAmount, setVaultAmount] = useState<string>('50');
  const [vaultDurationSec, setVaultDurationSec] = useState<string>('259200'); // 3 days default
  const [maxPerVoucher, setMaxPerVoucher] = useState<string>('15');

  // Top-up form
  const [showTopUp, setShowTopUp] = useState<boolean>(false);
  const [topUpAmount, setTopUpAmount] = useState<string>('20');

  // Payment flow
  const [scanningQRA, setScanningQRA] = useState<boolean>(false);
  const [scannedQRA, setScannedQRA] = useState<QRAPayload | null>(null);
  const [generatedQRB, setGeneratedQRB] = useState<string>('');
  const [lastPaidAmount, setLastPaidAmount] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [statusMsg, setStatusMsg] = useState<StatusAlert | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [history, setHistory] = useState<VoucherRecord[]>([]);
  const [nowSec, setNowSec] = useState<number>(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    loadLocalState();
  }, []);

  // Tick every second when a vault exists so expiration / close_vault unlocks live
  useEffect(() => {
    if (!vaultRecord) return;
    const timer = setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [vaultRecord]);

  async function loadLocalState() {
    try {
      const savedKey = await getKeys('client');
      if (savedKey) {
        setKeyRecord(savedKey);
        setStep('boveda');
        const savedVault = await getVault('client_vault');
        if (savedVault) {
          setVaultRecord(savedVault);
        }
        // Best-effort online sync on startup
        if (typeof navigator === 'undefined' || navigator.onLine) {
          syncFromChain(savedKey.publicKey, true);
        }
      }
      const allVouchers = await getClientVouchers();
      setHistory(allVouchers.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) {
      console.error('Error loading client state', e);
    }
  }

  async function syncFromChain(pubKey: string, silent = false) {
    if (!silent) setBusyAction('sync');
    try {
      const remote = await fetchVaultFromRelayer(pubKey);
      setBalances(remote.balances);
      if (remote.exists && remote.vault) {
        const localVault = await getVault('client_vault');
        // Keep the lower of on-chain balance vs local offline balance if same vault
        // so unredeemed offline vouchers aren't accidentally double-counted before settlement
        let effectiveBalance = BigInt(remote.vault.balance);
        if (localVault && localVault.expiresAt === remote.vault.expiresAt) {
          const localBal = BigInt(localVault.balance);
          if (localBal < effectiveBalance) {
            effectiveBalance = localBal;
          }
        }
        const merged: VaultRecord = {
          signer: pubKey,
          owner: remote.vault.owner,
          balance: effectiveBalance.toString(),
          expiresAt: remote.vault.expiresAt,
          maxPerVoucher: remote.vault.maxPerVoucher,
          openTxHash: localVault?.openTxHash,
          lastSyncedAt: remote.syncedAt,
        };
        await saveVault('client_vault', merged);
        setVaultRecord(merged);
      } else {
        // Vault does not exist on-chain (closed or not yet opened)
        const localVault = await getVault('client_vault');
        if (localVault) {
          await deleteVault('client_vault');
          setVaultRecord(null);
        }
      }
      if (!silent) {
        setStatusMsg({ type: 'ok', text: 'Estado sincronizado con Stellar Testnet.' });
      }
    } catch (err: any) {
      // Fallback: try Horizon balances directly if relayer unavailable
      try {
        const bal = await fetchAccountBalances(pubKey);
        setBalances(bal);
      } catch {}
      if (!silent) {
        setStatusMsg({
          type: 'warning',
          text: err?.message || 'Sin conexión a Stellar Testnet. Usando datos locales.',
        });
      }
    } finally {
      if (!silent) setBusyAction(null);
    }
  }

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setStatusMsg({ type: 'info', text: 'Copia manualmente el código mostrado.' });
    }
  };

  const handleCrearCuenta = async () => {
    const kp = randomKeypair();
    const record: KeyRecord = {
      publicKey: kp.publicKey(),
      secretKey: kp.secret(),
    };
    await saveKeys('client', record);
    setKeyRecord(record);
    setBalances({ exists: false, xlm: '0', tUsdc: '0', hasTrustline: false });
    setStep('boveda');
    setStatusMsg({
      type: 'ok',
      text: 'Cuenta creada en este celular. Ahora actívala en línea para recibir 100 tUSDC de prueba.',
    });
  };

  const handleActivarYFaucet = async () => {
    if (!keyRecord) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatusMsg({ type: 'error', text: 'Necesitas conexión a internet para recargar en Stellar Testnet.' });
      return;
    }

    setBusyAction('faucet');
    setStatusMsg({
      type: 'info',
      text: 'Activando cuenta en Stellar Testnet (Friendbot + trustline tUSDC + 100 tUSDC de prueba)...',
    });

    try {
      const kp = keypairFromSecret(keyRecord.secretKey);
      const result = await activateAccountWithFaucet(kp, true);
      setBalances(result.balances);
      setStatusMsg({
        type: 'ok',
        text: result.message,
        txHash: result.txHash,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err?.message || 'Error al activar la cuenta en Stellar Testnet.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAbrirBoveda = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyRecord) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatusMsg({ type: 'error', text: 'Necesitas conexión a internet para abrir tu bóveda en Soroban.' });
      return;
    }

    const units = parseTusdcToStroops(vaultAmount);
    const maxUnits = parseTusdcToStroops(maxPerVoucher);
    if (!units) {
      setStatusMsg({ type: 'error', text: 'Ingresa un monto válido en tUSDC para la bóveda.' });
      return;
    }
    if (!maxUnits || maxUnits > units) {
      setStatusMsg({
        type: 'error',
        text: 'El tope por compra debe ser mayor a 0 y no superar el monto total apartado.',
      });
      return;
    }

    const duration = parseInt(vaultDurationSec, 10);
    const expiresAt = Math.floor(Date.now() / 1000) + duration;

    setBusyAction('open_vault');
    setStatusMsg({
      type: 'info',
      text: `Apartando ${formatStroops(units)} tUSDC en el contrato Soroban (confirmando en Stellar Testnet)...`,
    });

    try {
      const kp = keypairFromSecret(keyRecord.secretKey);
      const txHash = await openVaultOnChain(kp, units, expiresAt, maxUnits);

      const vRecord: VaultRecord = {
        signer: keyRecord.publicKey,
        owner: keyRecord.publicKey,
        balance: units.toString(),
        expiresAt,
        maxPerVoucher: maxUnits.toString(),
        openTxHash: txHash,
        lastSyncedAt: Date.now(),
      };
      await saveVault('client_vault', vRecord);
      setVaultRecord(vRecord);

      const freshBal = await fetchAccountBalances(keyRecord.publicKey);
      setBalances(freshBal);

      setStatusMsg({
        type: 'ok',
        text: `¡Bóveda abierta en Soroban con ${formatStroops(units)} tUSDC! Ya puedes activar el Modo Avión y pagar sin señal.`,
        txHash,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err?.message || 'No se pudo abrir la bóveda en Stellar Testnet.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyRecord || !vaultRecord) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatusMsg({ type: 'error', text: 'Necesitas internet para recargar tu bóveda en Soroban.' });
      return;
    }
    const units = parseTusdcToStroops(topUpAmount);
    if (!units) {
      setStatusMsg({ type: 'error', text: 'Ingresa un monto válido para recargar.' });
      return;
    }

    setBusyAction('top_up');
    setStatusMsg({ type: 'info', text: `Agregando ${formatStroops(units)} tUSDC a tu bóveda en Soroban...` });
    try {
      const kp = keypairFromSecret(keyRecord.secretKey);
      const txHash = await topUpVaultOnChain(kp, units);
      const updatedBalance = BigInt(vaultRecord.balance) + units;
      const updatedVault: VaultRecord = {
        ...vaultRecord,
        balance: updatedBalance.toString(),
        lastSyncedAt: Date.now(),
      };
      await saveVault('client_vault', updatedVault);
      setVaultRecord(updatedVault);
      setShowTopUp(false);
      const freshBal = await fetchAccountBalances(keyRecord.publicKey);
      setBalances(freshBal);
      setStatusMsg({
        type: 'ok',
        text: `¡Bóveda recargada con +${formatStroops(units)} tUSDC!`,
        txHash,
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'No se pudo recargar la bóveda.' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCloseVault = async () => {
    if (!keyRecord || !vaultRecord) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setStatusMsg({ type: 'error', text: 'Necesitas internet para cerrar la bóveda en Soroban.' });
      return;
    }
    setBusyAction('close_vault');
    setStatusMsg({
      type: 'info',
      text: 'Cerrando bóveda en Soroban y devolviendo el saldo restante a tu cuenta...',
    });

    try {
      const kp = keypairFromSecret(keyRecord.secretKey);
      const txHash = await closeVaultOnChain(kp);
      await deleteVault('client_vault');
      setVaultRecord(null);
      const freshBal = await fetchAccountBalances(keyRecord.publicKey);
      setBalances(freshBal);
      setStatusMsg({
        type: 'ok',
        text: '¡Bóveda cerrada! Todo tu saldo no gastado fue devuelto a tu wallet en Stellar Testnet.',
        txHash,
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err?.message || 'No se pudo cerrar la bóveda todavía.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleScanQRAResult = (scannedText: string) => {
    setScanningQRA(false);
    const payload = decodeQRA(scannedText);
    if (!payload) {
      setStatusMsg({ type: 'error', text: 'QR-A inválido o no reconocido como cobro de PagoAsegurao.' });
      return;
    }

    if (!vaultRecord) {
      setStatusMsg({ type: 'error', text: 'Primero debes abrir una bóveda con fondos apartados.' });
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now >= vaultRecord.expiresAt) {
      setStatusMsg({
        type: 'error',
        text: 'Tu bóveda ya venció. Ciérrala en línea para recuperar tu saldo y abrir una nueva.',
      });
      return;
    }

    const currentBalance = BigInt(vaultRecord.balance);
    const maxAllowed = BigInt(vaultRecord.maxPerVoucher);

    if (payload.amount <= 0n) {
      setStatusMsg({ type: 'error', text: 'El monto del cobro debe ser mayor a cero.' });
      return;
    }

    if (payload.amount > currentBalance) {
      setStatusMsg({
        type: 'error',
        text: `Saldo insuficiente en tu bóveda. Disponible: ${formatStroops(currentBalance)} tUSDC; cobro: ${formatStroops(payload.amount)} tUSDC.`,
      });
      return;
    }

    if (payload.amount > maxAllowed) {
      setStatusMsg({
        type: 'error',
        text: `El cobro (${formatStroops(payload.amount)} tUSDC) supera tu tope de ${formatStroops(maxAllowed)} tUSDC por vale.`,
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
        TESTNET_CONFIG.contractId,
        kp,
        scannedQRA.merchantAddress,
        scannedQRA.amount,
        expiry
      );

      // Deduct balance locally immediately so offline spending stays within vault limit
      const currentBalance = BigInt(vaultRecord.balance);
      const newBalance = currentBalance - scannedQRA.amount;
      const updatedVault: VaultRecord = { ...vaultRecord, balance: newBalance.toString() };
      await saveVault('client_vault', updatedVault);
      setVaultRecord(updatedVault);

      const vRecord: VoucherRecord = {
        id: `client-voucher-${voucher.nonce}`,
        signer: voucher.signer,
        merchant: voucher.merchant,
        amount: voucher.amount,
        nonce: voucher.nonce,
        expiry: voucher.expiry,
        signature: voucher.signature,
        qrString,
        status: 'pendiente',
        createdAt: Date.now(),
      };
      await saveClientVoucher(vRecord);
      setHistory((prev) => [vRecord, ...prev]);

      setGeneratedQRB(qrString);
      setLastPaidAmount(formatStroops(scannedQRA.amount));
      setScannedQRA(null);
      setStep('show_qrb');
      setStatusMsg({
        type: 'ok',
        text: 'Vale firmado offline con Ed25519. Muéstraselo al comercio para que lo escanee.',
      });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: `Error al firmar vale: ${err.message}` });
    }
  };

  const isVaultExpired = vaultRecord ? nowSec >= vaultRecord.expiresAt : false;
  const secondsUntilExpiry = vaultRecord ? Math.max(0, vaultRecord.expiresAt - nowSec) : 0;
  const walletTusdcNum = balances ? parseFloat(balances.tUsdc) : 0;

  return (
    <div className="cliente-container">
      {/* Status alert banner */}
      {statusMsg && (
        <div className={`alert alert-${statusMsg.type}`}>
          <div className="alert-body">
            {statusMsg.type === 'ok' && <CheckCircle size={18} className="inline-icon" />}
            {statusMsg.type === 'error' && <AlertCircle size={18} className="inline-icon" />}
            {statusMsg.type === 'warning' && <AlertCircle size={18} className="inline-icon" />}
            {statusMsg.type === 'info' && <RefreshCw size={18} className="inline-icon spin" />}
            <span>{statusMsg.text}</span>
          </div>
          {statusMsg.txHash && (
            <a
              href={`${TESTNET_CONFIG.explorerBase}/tx/${statusMsg.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="link-explorer alert-link"
            >
              <ExternalLink size={13} /> Ver en stellar.expert
            </a>
          )}
        </div>
      )}

      {/* Screen 1: Create local device account */}
      {!keyRecord && (
        <div className="card">
          <div className="card-header">
            <Wallet className="icon-main" />
            <h2>Bienvenido a PagoAsegurao</h2>
            <p>
              Aparta fondos en tu bóveda Soroban antes de salir y paga en ferias, mercados o buses incluso en Modo Avión.
              Tu pago queda <strong>asegurado hasta el monto apartado</strong>.
            </p>
          </div>
          <button className="btn btn-primary btn-block" onClick={handleCrearCuenta}>
            Crear cuenta en este celular
          </button>
          <p className="disclaimer-note">
            Solo Stellar Testnet · Clave de prueba guardada en IndexedDB de este navegador.
          </p>
        </div>
      )}

      {/* Active client dashboard */}
      {keyRecord && (
        <>
          {/* Wallet & Testnet Account Card */}
          <div className="card account-bar-card">
            <div className="vault-header">
              <span className="badge">
                <Wallet size={14} /> Cuenta Cliente
              </span>
              <div className="address-actions">
                <button
                  type="button"
                  className="btn-chip"
                  onClick={() => handleCopy(keyRecord.publicKey, 'client-addr')}
                  title={keyRecord.publicKey}
                >
                  {keyRecord.publicKey.slice(0, 6)}...{keyRecord.publicKey.slice(-4)}
                  {copiedId === 'client-addr' ? <Check size={12} /> : <Copy size={12} />}
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

            <div className="wallet-balance-row">
              <div>
                <span className="stat-label">Saldo libre en wallet (tUSDC):</span>
                <span className="wallet-balance-val">
                  {balances ? Number(balances.tUsdc).toFixed(2) : '—'} <small>tUSDC</small>
                </span>
              </div>
              <div className="wallet-btn-col">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleActivarYFaucet}
                  disabled={busyAction !== null}
                >
                  <RefreshCw size={14} className={busyAction === 'faucet' ? 'spin' : ''} />
                  {balances?.hasTrustline ? '+100 tUSDC' : 'Activar y pedir 100 tUSDC'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => syncFromChain(keyRecord.publicKey)}
                  disabled={busyAction !== null}
                  title="Sincronizar saldo y bóveda desde Stellar Testnet"
                >
                  <RefreshCw size={13} className={busyAction === 'sync' ? 'spin' : ''} /> Sincronizar
                </button>
              </div>
            </div>

            {balances && !balances.hasTrustline && (
              <p className="subtext helper-warn">
                Paso 1: Presiona <strong>"Activar y pedir 100 tUSDC"</strong> con internet para fondear tu cuenta y recibir fondos de prueba.
              </p>
            )}
          </div>

          {/* Active Vault Card */}
          <div className="card vault-summary-card">
            <div className="vault-header">
              <span className="badge">
                <ShieldCheck size={14} /> Bóveda Soroban
              </span>
              {vaultRecord && (
                <span className={`status-badge ${isVaultExpired ? 'status-rechazado' : 'status-liquidado'}`}>
                  {isVaultExpired ? 'Vencida · lista para cerrar' : 'Activa · lista sin señal'}
                </span>
              )}
            </div>

            <div className="vault-balance-display">
              <span className="label">Saldo disponible para pagar offline:</span>
              <span className="balance-amount">
                {vaultRecord ? formatStroops(vaultRecord.balance) : '0.00'} <small>tUSDC</small>
              </span>
              {vaultRecord ? (
                <>
                  <span className="vault-limits">
                    <Clock size={14} /> Vence: {new Date(vaultRecord.expiresAt * 1000).toLocaleString()} · Tope/vale:{' '}
                    {formatStroops(vaultRecord.maxPerVoucher)} tUSDC
                  </span>
                  {!isVaultExpired && secondsUntilExpiry <= 300 && (
                    <span className="vault-countdown">
                      Vence en {Math.floor(secondsUntilExpiry / 60)}m {secondsUntilExpiry % 60}s
                    </span>
                  )}
                </>
              ) : (
                <span className="vault-limits">
                  Aún no tienes una bóveda activa. Aparta tUSDC abajo mientras tengas conexión.
                </span>
              )}
            </div>

            <div className="action-buttons-grid">
              <button
                className="btn btn-action-pay"
                disabled={!vaultRecord || isVaultExpired || BigInt(vaultRecord.balance) <= 0n}
                onClick={() => setScanningQRA(true)}
              >
                <QrCode size={20} />
                <span>Pagar con Vale (Sin Señal)</span>
              </button>

              {vaultRecord && !isVaultExpired && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowTopUp((prev) => !prev)}
                  disabled={busyAction !== null}
                >
                  <PlusCircle size={16} /> Recargar bóveda (top_up)
                </button>
              )}

              {vaultRecord && (
                <button
                  type="button"
                  className={`btn ${isVaultExpired ? 'btn-primary' : 'btn-secondary'}`}
                  disabled={!isVaultExpired || busyAction !== null}
                  onClick={handleCloseVault}
                >
                  <Unlock size={16} />
                  {busyAction === 'close_vault'
                    ? 'Cerrando bóveda en Soroban...'
                    : isVaultExpired
                    ? 'Cerrar bóveda y recuperar saldo restante'
                    : 'Cerrar bóveda (disponible al vencer)'}
                </button>
              )}
            </div>

            {/* Inline Top-Up Form */}
            {vaultRecord && showTopUp && !isVaultExpired && (
              <form onSubmit={handleTopUp} className="inline-topup-form">
                <input
                  type="text"
                  inputMode="decimal"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  placeholder="Monto tUSDC"
                  className="input-text"
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={busyAction !== null}>
                  {busyAction === 'top_up' ? 'Enviando...' : 'Agregar'}
                </button>
              </form>
            )}
          </div>

          {/* Open Vault Form (shown only when no active vault exists on-chain) */}
          {!vaultRecord && (
            <div className="card">
              <div className="card-header">
                <Lock size={20} className="inline-icon" />
                <h3>Apartar Fondos en Bóveda (`open_vault`)</h3>
                <p>
                  Bloquea tus tUSDC en el contrato Soroban antes de quedarte sin señal. El pago queda asegurado hasta el
                  monto apartado.
                </p>
              </div>

              <form onSubmit={handleAbrirBoveda} className="form-vertical">
                <div className="form-group">
                  <label>Monto total a apartar (tUSDC):</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={vaultAmount}
                    onChange={(e) => setVaultAmount(e.target.value)}
                    className="input-text"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Tope máximo por compra (tUSDC):</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={maxPerVoucher}
                    onChange={(e) => setMaxPerVoucher(e.target.value)}
                    className="input-text"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Vigencia de la bóveda:</label>
                  <select
                    value={vaultDurationSec}
                    onChange={(e) => setVaultDurationSec(e.target.value)}
                    className="input-text"
                  >
                    <option value="120">2 minutos (prueba rápida de cierre)</option>
                    <option value="3600">1 hora</option>
                    <option value="86400">1 día</option>
                    <option value="259200">3 días (Recomendado para ferias)</option>
                    <option value="604800">7 días</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-block"
                  disabled={busyAction !== null || walletTusdcNum <= 0}
                >
                  <ShieldCheck size={18} />
                  {busyAction === 'open_vault'
                    ? 'Confirmando en Stellar Testnet...'
                    : 'Asegurar Bóveda en Stellar'}
                </button>
              </form>
            </div>
          )}

          {/* Confirm Payment Modal */}
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
                    <h2>{formatStroops(scannedQRA.amount)} tUSDC</h2>
                  </div>
                  <p className="subtext">
                    Este vale se firmará localmente con Ed25519 (sin internet) y se pagará desde tus fondos apartados.
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

          {/* Show Signed QR-B Card */}
          {step === 'show_qrb' && generatedQRB && (
            <div className="card qrb-card">
              <div className="card-header">
                <CheckCircle size={28} className="icon-success" />
                <h3>¡Vale Firmado sin Señal!</h3>
                <p>Muestra este código QR-B al comercio para completar tu compra:</p>
              </div>

              <div className="qr-wrapper">
                <QRCodeSVG value={generatedQRB} size={240} level="M" />
              </div>

              <div className="qrb-details">
                <p>
                  <strong>Monto:</strong> {lastPaidAmount} tUSDC
                </p>
                <p className="voucher-code" title={generatedQRB}>
                  {generatedQRB.slice(0, 32)}...
                </p>
              </div>

              <div className="btn-group mt-10">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleCopy(generatedQRB, 'qrb-code')}
                >
                  {copiedId === 'qrb-code' ? <Check size={16} /> : <Copy size={16} />}
                  {copiedId === 'qrb-code' ? 'Copiado' : 'Copiar código QR-B'}
                </button>
                <button className="btn btn-primary" onClick={() => setStep('boveda')}>
                  Listo
                </button>
              </div>
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

          {/* Client Voucher History */}
          {history.length > 0 && (
            <div className="card history-card">
              <div className="history-header">
                <History size={18} />
                <h4>Vales Emitidos ({history.length})</h4>
              </div>
              <ul className="history-list">
                {history.map((v) => (
                  <li key={v.id} className="history-item">
                    <div className="item-info">
                      <span className="item-merchant">
                        Para: {v.merchant.slice(0, 6)}...{v.merchant.slice(-4)}
                      </span>
                      <span className="item-date">
                        {new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="history-right">
                      <span className="item-amount">- {formatStroops(v.amount)} tUSDC</span>
                      {v.qrString && (
                        <button
                          type="button"
                          className="btn-chip"
                          onClick={() => {
                            setGeneratedQRB(v.qrString!);
                            setLastPaidAmount(formatStroops(v.amount));
                            setStep('show_qrb');
                          }}
                        >
                          <QrCode size={12} /> Ver QR
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="disclaimer-note">
            tUSDC es un activo de prueba sin valor económico en Stellar Testnet. Las claves residen en este navegador solo
            para la demo.
          </p>
        </>
      )}
    </div>
  );
}
