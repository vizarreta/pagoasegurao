import { Keypair, Address, StrKey, Networks } from '@stellar/stellar-sdk';

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = 'https://soroban-testnet.stellar.org';

export function keypairFromSecret(secret: string): Keypair {
  return Keypair.fromSecret(secret);
}

export function randomKeypair(): Keypair {
  return Keypair.random();
}

export function publicKeyToStrKey(publicKey: Buffer | Uint8Array): string {
  return StrKey.encodeEd25519PublicKey(Buffer.from(publicKey));
}

export function strKeyToPublicKey(strKey: string): Uint8Array {
  return StrKey.decodeEd25519PublicKey(strKey);
}

export function addressToXdr(address: string): Buffer {
  const addr = Address.fromString(address);
  return Buffer.from(addr.toScVal().toXDR());
}

export function i128ToBeBytes(amount: bigint): Buffer {
  const buf = Buffer.alloc(16);
  let v = BigInt.asIntN(128, amount);
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(BigInt.asUintN(8, v & 0xffn));
    v >>= 8n;
  }
  return buf;
}

export function u64ToBeBytes(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  let v = BigInt.asUintN(64, BigInt(value));
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

export function buildCanonicalMessage(
  contractAddress: string,
  signerPublicKey: Uint8Array,
  merchantAddress: string,
  amount: bigint,
  nonce: number | bigint,
  expiry: number | bigint
): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from('PAGOASEGURAO1', 'ascii'));
  parts.push(addressToXdr(contractAddress));
  parts.push(Buffer.from(signerPublicKey));
  parts.push(addressToXdr(merchantAddress));
  parts.push(i128ToBeBytes(amount));
  parts.push(u64ToBeBytes(nonce));
  parts.push(u64ToBeBytes(expiry));
  return Buffer.concat(parts);
}

export function signMessage(keypair: Keypair, message: Buffer | Uint8Array): Buffer {
  return Buffer.from(keypair.sign(Buffer.from(message)));
}

export function verifySignature(
  publicKey: Uint8Array,
  message: Buffer | Uint8Array,
  signature: Buffer | Uint8Array
): boolean {
  try {
    const strKey = StrKey.encodeEd25519PublicKey(Buffer.from(publicKey));
    const kp = Keypair.fromPublicKey(strKey);
    return kp.verify(Buffer.from(message), Buffer.from(signature));
  } catch {
    return false;
  }
}
