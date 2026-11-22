import { buildCanonicalMessage, signMessage, addressToScVal, publicKeyToStrKey } from './stellar';

export interface VoucherData {
  signer: string;
  merchant: string;
  amount: string;
  nonce: string;
  expiry: string;
  signature: string;
}

export function createVoucherPayload(
  contractAddress: string,
  signerKeypair: { publicKey: Uint8Array; sign: (msg: Buffer) => Buffer },
  merchantPublicKey: Uint8Array,
  amount: bigint,
  nonce: number | bigint,
  expiry: number | bigint
): { message: Buffer; signature: Buffer; voucher: VoucherData } {
  const message = buildCanonicalMessage(
    contractAddress,
    signerKeypair.publicKey,
    publicKeyToStrKey(merchantPublicKey),
    amount,
    nonce,
    expiry
  );
  const signature = signMessage(signerKeypair, message);

  const voucher: VoucherData = {
    signer: publicKeyToStrKey(signerKeypair.publicKey),
    merchant: publicKeyToStrKey(merchantPublicKey),
    amount: amount.toString(),
    nonce: String(nonce),
    expiry: String(expiry),
    signature: Buffer.from(signature).toString('hex'),
  };
  return { message, signature, voucher };
}

export function voucherToQRB(voucher: VoucherData, signerBytes: Uint8Array, merchantBytes: Uint8Array, signatureBytes: Uint8Array): string {
  const parts: Buffer[] = [];
  parts.push(Buffer.from(signerBytes));
  parts.push(Buffer.from(merchantBytes));
  parts.push(Buffer.from(BigInt(voucher.amount).toString(), 'utf8')); // placeholder: use i64 BE in production
  parts.push(Buffer.from(BigInt(voucher.nonce).toString(), 'utf8'));
  parts.push(Buffer.from(BigInt(voucher.expiry).toString(), 'utf8'));
  parts.push(Buffer.from(signatureBytes));
  return `SSV1.${Buffer.concat(parts).toString('base64url')}`;
}

export function parseQRB(payload: string): { prefix: string; data: Buffer } | null {
  if (!payload.startsWith('SSV1.')) return null;
  return { prefix: 'SSV1.', data: Buffer.from(payload.slice(5), 'base64url') };
}

export function parseQRA(payload: string): { prefix: string; data: Buffer } | null {
  if (!payload.startsWith('SSC1.')) return null;
  return { prefix: 'SSC1.', data: Buffer.from(payload.slice(5), 'base64url') };
}
