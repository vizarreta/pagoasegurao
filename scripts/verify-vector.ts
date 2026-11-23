import fs from 'fs';
import path from 'path';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { buildCanonicalMessage, verifySignature, signMessage } from '../app/src/lib/stellar';

const VECTOR_FILE = path.join(
  process.cwd(),
  'contracts',
  'pagoasegurao',
  'test-vectors',
  'voucher.json'
);

async function main() {
  const seed = Buffer.alloc(32, 42); // Seed = [42; 32]
  const secret = StrKey.encodeEd25519SecretSeed(seed);
  const signerKp = Keypair.fromSecret(secret);
  const signerPub = signerKp.rawPublicKey();

  const contractAddress = StrKey.encodeContract(Buffer.alloc(32, 1));
  const merchantAddress = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
  const amount = 10_000_000n; // 1 USDC
  const nonce = 42n;
  const expiry = 1735689600n;

  const message = buildCanonicalMessage(
    contractAddress,
    signerPub,
    merchantAddress,
    amount,
    nonce,
    expiry
  );

  const signature = signMessage(signerKp, message);
  const isValid = verifySignature(signerPub, message, signature);

  const vector = {
    version: 1,
    network: 'Test SDF Network ; September 2015',
    contract_address: contractAddress,
    signer: Buffer.from(signerPub).toString('hex'),
    signer_strkey: signerKp.publicKey(),
    merchant: merchantAddress,
    amount: Number(amount),
    nonce: Number(nonce),
    expiry: Number(expiry),
    message_hex: message.toString('hex'),
    signature_hex: Buffer.from(signature).toString('hex'),
    expected_valid: true,
    note: 'Vector de prueba compartido entre Rust (cargo test) y TypeScript (scripts/verify-vector.ts).'
  };

  fs.writeFileSync(VECTOR_FILE, JSON.stringify(vector, null, 2));
  console.log('Vector de prueba compartido generado y verificado:');
  console.log(`- Contract: ${contractAddress}`);
  console.log(`- Signer: ${vector.signer_strkey} (${vector.signer})`);
  console.log(`- Merchant: ${merchantAddress}`);
  console.log(`- Message hex (${message.length} bytes): ${vector.message_hex}`);
  console.log(`- Signature hex (${signature.length} bytes): ${vector.signature_hex}`);
  console.log(`- Signature valid: ${isValid}`);

  if (!isValid) {
    throw new Error('Fallo la verificacion de la firma en TypeScript');
  }

  console.log('OK: vector de prueba compartido consistente');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
