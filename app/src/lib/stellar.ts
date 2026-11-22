import { Keypair, Address, StrKey, Networks, TransactionBuilder, xdr, scval, nativeToScVal } from '@stellar/stellar-sdk';

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

export function addressToScVal(address: string): xdr.ScVal {
  return scval.address(Address.fromString(address));
}

export function addressToXdrHex(address: string): string {
  const scval = addressToScVal(address);
  const xdrBytes = scval.toXDR();
  return Buffer.from(xdrBytes).toString('hex');
}

export function i128ToBeBytes(amount: bigint): Buffer {
  const neg = amount < 0n;
  const mag = neg ? -amount : amount;
  const bytes = Buffer.alloc(16);
  let temp = mag;
  for (let i = 15; i >= 0; i--) {
    bytes[i] = Number(temp & 255n);
    temp >>= 8n;
  }
  if (neg) {
    for (let i = 0; i < 16; i++) bytes[i] = ~bytes[i] & 0xff;
    let carry = 1;
    for (let i = 15; i >= 0 && carry; i--) {
      const v = bytes[i] + carry;
      bytes[i] = v & 0xff;
      carry = v >> 8;
    }
  }
  return bytes;
}

export function u64ToBeBytes(value: number | bigint): Buffer {
  const v = BigInt(value);
  const bytes = Buffer.alloc(8);
  let temp = v;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(temp & 255n);
    temp >>= 8n;
  }
  return bytes;
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
  parts.push(Buffer.from(addressToXdrHex(contractAddress), 'hex'));
  parts.push(Buffer.from(signerPublicKey));
  parts.push(Buffer.from(addressToXdrHex(merchantAddress), 'hex'));
  parts.push(i128ToBeBytes(amount));
  parts.push(u64ToBeBytes(nonce));
  parts.push(u64ToBeBytes(expiry));
  return Buffer.concat(parts);
}

export function signMessage(keypair: Keypair, message: Buffer): Buffer {
  return Buffer.from(keypair.sign(message));
}

export function verifySignature(
  publicKey: Uint8Array,
  message: Buffer,
  signature: Buffer
): boolean {
  try {
    return Keypair.fromPublicKey(Buffer.from(publicKey)).verify(message, signature);
  } catch {
    return false;
  }
}
