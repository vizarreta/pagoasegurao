import { Keypair } from '@stellar/stellar-sdk';
import {
  buildCanonicalMessage,
  signMessage,
  verifySignature,
  publicKeyToStrKey,
  strKeyToPublicKey,
  formatSoles,
} from './stellar';
import { base64urlEncode, base64urlDecode, generateNonce, generateRequestId } from './qr';

export interface QRAPayload {
  merchantPubKey: Uint8Array;
  merchantAddress: string;
  amount: bigint;
  requestId: Uint8Array;
}

export interface QRBPayload {
  signer: Uint8Array;
  signerAddress: string;
  merchantPubKey: Uint8Array;
  merchantAddress: string;
  amount: bigint;
  nonce: bigint;
  expiry: bigint;
  signature: Uint8Array;
}

export interface VoucherData {
  signer: string;
  merchant: string;
  amount: string;
  nonce: string;
  expiry: string;
  signature: string;
}

function writeBigInt64BE(target: Uint8Array, offset: number, value: bigint) {
  let v = BigInt.asUintN(64, value);
  for (let i = 7; i >= 0; i--) {
    target[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function readBigInt64BE(source: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v = (v << 8n) | BigInt(source[offset + i]);
  }
  return v;
}

// QR-A: SSC1. + base64url( merchant_pubkey[32] | amount_i64[8] | request_id[8] ) = 48 bytes
export function encodeQRA(merchantAddress: string, amount: bigint, requestId?: Uint8Array): string {
  const merchantPub = strKeyToPublicKey(merchantAddress);
  const reqId = requestId || generateRequestId();

  const payload = new Uint8Array(48);
  payload.set(merchantPub, 0);
  writeBigInt64BE(payload, 32, amount);
  payload.set(reqId, 40);

  return `SSC1.${base64urlEncode(payload)}`;
}

export function decodeQRA(qrString: string): QRAPayload | null {
  const trimmed = qrString.trim();
  if (!trimmed.startsWith('SSC1.')) return null;
  try {
    const raw = base64urlDecode(trimmed.slice(5));
    if (raw.length < 48) return null;

    const merchantPubKey = raw.slice(0, 32);
    const merchantAddress = publicKeyToStrKey(merchantPubKey);
    const amount = readBigInt64BE(raw, 32);
    const requestId = raw.slice(40, 48);

    return {
      merchantPubKey,
      merchantAddress,
      amount,
      requestId,
    };
  } catch {
    return null;
  }
}

// QR-B: SSV1. + base64url( signer[32] | merchant[32] | amount_i64[8] | nonce_u64[8] | expiry_u64[8] | sig[64] ) = 152 bytes
export function encodeQRB(
  contractAddress: string,
  signerKeypair: Keypair,
  merchantAddress: string,
  amount: bigint,
  expiry: bigint,
  nonce?: bigint
): { qrString: string; voucher: VoucherData; payload: QRBPayload } {
  const actualNonce = nonce !== undefined ? nonce : generateNonce();
  const signerPub = strKeyToPublicKey(signerKeypair.publicKey());
  const merchantPub = strKeyToPublicKey(merchantAddress);

  const canonicalMsg = buildCanonicalMessage(
    contractAddress,
    signerPub,
    merchantAddress,
    amount,
    actualNonce,
    expiry
  );

  const signature = signMessage(signerKeypair, canonicalMsg);

  const binary = new Uint8Array(152);
  binary.set(signerPub, 0);
  binary.set(merchantPub, 32);
  writeBigInt64BE(binary, 64, amount);
  writeBigInt64BE(binary, 72, actualNonce);
  writeBigInt64BE(binary, 80, expiry);
  binary.set(signature, 88);

  const qrString = `SSV1.${base64urlEncode(binary)}`;

  const hexSig = Array.from(signature)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const voucher: VoucherData = {
    signer: publicKeyToStrKey(signerPub),
    merchant: merchantAddress,
    amount: amount.toString(),
    nonce: actualNonce.toString(),
    expiry: expiry.toString(),
    signature: hexSig,
  };

  const payload: QRBPayload = {
    signer: signerPub,
    signerAddress: voucher.signer,
    merchantPubKey: merchantPub,
    merchantAddress,
    amount,
    nonce: actualNonce,
    expiry,
    signature: new Uint8Array(signature),
  };

  return { qrString, voucher, payload };
}

export function decodeQRB(qrString: string): QRBPayload | null {
  const trimmed = qrString.trim();
  if (!trimmed.startsWith('SSV1.')) return null;
  try {
    const raw = base64urlDecode(trimmed.slice(5));
    if (raw.length < 152) return null;

    const signer = raw.slice(0, 32);
    const merchantPubKey = raw.slice(32, 64);
    const amount = readBigInt64BE(raw, 64);
    const nonce = readBigInt64BE(raw, 72);
    const expiry = readBigInt64BE(raw, 80);
    const signature = raw.slice(88, 152);

    return {
      signer,
      signerAddress: publicKeyToStrKey(signer),
      merchantPubKey,
      merchantAddress: publicKeyToStrKey(merchantPubKey),
      amount,
      nonce,
      expiry,
      signature,
    };
  } catch {
    return null;
  }
}

export function validateVoucherVaultExpiry(
  voucherExpiry: bigint,
  vaultExpiresAt?: bigint
): { valid: boolean; error?: string } {
  if (vaultExpiresAt !== undefined && voucherExpiry > vaultExpiresAt) {
    return {
      valid: false,
      error: 'El vencimiento del vale supera la fecha límite de la bóveda',
    };
  }
  return { valid: true };
}

export function evaluateClientExposure(
  signerAddress: string,
  newVoucherAmount: bigint,
  existingQueue: Array<{ signer: string; amount: string; status: string }>,
  cachedVault?: { balance: string; expiresAt: number } | null,
  isLiveFetch = false,
  nowSeconds = Math.floor(Date.now() / 1000)
): { priorPendingStroops: bigint; projectedTotalStroops: bigint; exceedingWarning?: string } {
  const priorPendingStroops = existingQueue
    .filter((v) => v.signer === signerAddress && v.status === 'pendiente')
    .reduce((acc, v) => acc + BigInt(v.amount), 0n);
  const projectedTotalStroops = priorPendingStroops + newVoucherAmount;

  if (cachedVault && (isLiveFetch || cachedVault.expiresAt >= nowSeconds)) {
    const knownBalance = BigInt(cachedVault.balance);
    if (projectedTotalStroops > knownBalance) {
      const exceedingWarning =
        priorPendingStroops > 0n
          ? `Advertencia: este cliente acumula ${formatSoles(priorPendingStroops)} pendiente en tu cola; con este cobro suma ${formatSoles(projectedTotalStroops)} y supera el saldo conocido de su bóveda (${formatSoles(knownBalance)}).`
          : `Advertencia: según la última sincronización, la bóveda tenía ${formatSoles(knownBalance)} (menor al vale de ${formatSoles(newVoucherAmount)}).`;
      return { priorPendingStroops, projectedTotalStroops, exceedingWarning };
    }
  }

  return { priorPendingStroops, projectedTotalStroops };
}

export function getVoucherUrgency(
  expirySeconds: number | string | bigint,
  nowSeconds = Math.floor(Date.now() / 1000)
): { remainingSec: number; level: 'ok' | 'warn' | 'critical' | 'expired'; label: string } {
  const remainingSec = Number(expirySeconds) - nowSeconds;
  if (remainingSec <= 0) {
    return { remainingSec: 0, level: 'expired', label: 'Vencido' };
  }
  const days = Math.floor(remainingSec / 86400);
  const hours = Math.floor((remainingSec % 86400) / 3600);
  const mins = Math.floor((remainingSec % 3600) / 60);
  const secs = remainingSec % 60;

  let timeText: string;
  if (days > 0) {
    timeText = `${days}d ${hours}h`;
  } else if (hours > 0) {
    timeText = `${hours}h ${mins}m`;
  } else if (mins > 0) {
    timeText = `${mins}m ${secs}s`;
  } else {
    timeText = `${secs}s`;
  }

  if (remainingSec <= 300) {
    return { remainingSec, level: 'critical', label: `Vence en ${timeText}` };
  }
  if (remainingSec < 7200) {
    return { remainingSec, level: 'warn', label: `Vence en ${timeText}` };
  }
  return { remainingSec, level: 'ok', label: `Vigente · ${timeText}` };
}

export function verifyVoucherLocally(
  contractAddress: string,
  payload: QRBPayload,
  expectedMerchantAddress: string,
  expectedAmount?: bigint,
  vaultExpiresAt?: bigint
): { valid: boolean; error?: string } {
  if (payload.merchantAddress !== expectedMerchantAddress) {
    return { valid: false, error: 'El comercio receptor no coincide con tu cuenta' };
  }

  if (expectedAmount !== undefined && payload.amount !== expectedAmount) {
    return {
      valid: false,
      error: `El monto del vale (${formatSoles(payload.amount)}) no coincide con el cobro (${formatSoles(expectedAmount)})`,
    };
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (nowSeconds > payload.expiry) {
    return { valid: false, error: 'El vale está vencido' };
  }

  const vaultExpiryCheck = validateVoucherVaultExpiry(payload.expiry, vaultExpiresAt);
  if (!vaultExpiryCheck.valid) {
    return vaultExpiryCheck;
  }

  const msg = buildCanonicalMessage(
    contractAddress,
    payload.signer,
    payload.merchantAddress,
    payload.amount,
    payload.nonce,
    payload.expiry
  );

  const sigOk = verifySignature(payload.signer, msg, payload.signature);
  if (!sigOk) {
    return { valid: false, error: 'Firma criptográfica inválida' };
  }

  return { valid: true };
}
