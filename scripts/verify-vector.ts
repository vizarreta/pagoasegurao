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

interface VoucherTestVector {
  version: number;
  network: string;
  contract_address: string;
  signer: string;
  signer_strkey: string;
  merchant: string;
  amount: string | number;
  nonce: string | number;
  expiry: string | number;
  message_hex: string;
  signature_hex: string;
  expected_valid: boolean;
  note?: string;
}

function generateVector(): VoucherTestVector {
  const seed = Buffer.alloc(32, 42); // Seed = [42; 32]
  const secret = StrKey.encodeEd25519SecretSeed(seed);
  const signerKp = Keypair.fromSecret(secret);
  const signerPub = signerKp.rawPublicKey();

  const contractAddress = StrKey.encodeContract(Buffer.alloc(32, 1));
  const merchantAddress = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
  const amount = 10_000_000n; // 1.0000000 token
  const nonce = 42n;
  const expiry = 1735689600n;

  const message = buildCanonicalMessage(contractAddress, signerPub, merchantAddress, amount, nonce, expiry);
  const signature = signMessage(signerKp, message);

  return {
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
    note: 'Vector de prueba compartido entre Rust (cargo test) y TypeScript (scripts/verify-vector.ts).',
  };
}

function validateExistingVector(vector: VoucherTestVector) {
  const signerPub = Buffer.from(vector.signer, 'hex');
  if (signerPub.length !== 32) {
    throw new Error(`Longitud invalida de signer en vector: ${signerPub.length}`);
  }
  const encodedStrKey = StrKey.encodeEd25519PublicKey(signerPub);
  if (encodedStrKey !== vector.signer_strkey) {
    throw new Error(`signer_strkey (${vector.signer_strkey}) no coincide con signer hex (${encodedStrKey})`);
  }

  const rebuiltMessage = buildCanonicalMessage(
    vector.contract_address,
    signerPub,
    vector.merchant,
    BigInt(vector.amount),
    BigInt(vector.nonce),
    BigInt(vector.expiry)
  );
  const rebuiltHex = rebuiltMessage.toString('hex');
  if (rebuiltHex !== vector.message_hex) {
    throw new Error(
      `message_hex del vector no coincide con buildCanonicalMessage:\n  esperado: ${vector.message_hex}\n  obtenido: ${rebuiltHex}`
    );
  }

  const sigBytes = Buffer.from(vector.signature_hex, 'hex');
  const isValid = verifySignature(signerPub, rebuiltMessage, sigBytes);
  if (isValid !== vector.expected_valid) {
    throw new Error(`Validacion de firma Ed25519 dio ${isValid}, esperado ${vector.expected_valid}`);
  }

  console.log('Vector de prueba compartido verificado contra TypeScript:');
  console.log(`- Archivo:   ${VECTOR_FILE}`);
  console.log(`- Contract:  ${vector.contract_address}`);
  console.log(`- Signer:    ${vector.signer_strkey} (${vector.signer})`);
  console.log(`- Merchant:  ${vector.merchant}`);
  console.log(`- Message:   ${rebuiltMessage.length} bytes (${rebuiltHex.slice(0, 32)}...)`);
  console.log(`- Signature: ${sigBytes.length} bytes (valida=${isValid})`);
  console.log('OK: vector de prueba compartido consistente');
}

async function main() {
  const shouldWrite = process.argv.includes('--write') || !fs.existsSync(VECTOR_FILE);
  if (shouldWrite) {
    const generated = generateVector();
    fs.writeFileSync(VECTOR_FILE, JSON.stringify(generated, null, 2));
    console.log(`Vector escrito en ${VECTOR_FILE}`);
  }

  const raw = fs.readFileSync(VECTOR_FILE, 'utf8');
  const vector = JSON.parse(raw) as VoucherTestVector;
  validateExistingVector(vector);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
