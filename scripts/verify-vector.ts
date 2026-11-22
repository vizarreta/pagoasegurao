import fs from 'fs';
import path from 'path';
import { buildCanonicalMessage, verifySignature } from '../app/src/lib/stellar';

const VECTOR_FILE = path.join(
  process.cwd(),
  'contracts',
  'pagoasegurao',
  'test-vectors',
  'voucher.json'
);

async function main() {
  const vector = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
  console.log('Validando vector de prueba compartido:', vector);

  const contractAddress = vector.contract_address;
  const signerBytes = Buffer.from(vector.signer, 'hex');
  const merchantStrKey = vector.merchant;
  const amount = BigInt(vector.amount);
  const nonce = BigInt(vector.nonce);
  const expiry = BigInt(vector.expiry);

  const message = buildCanonicalMessage(
    contractAddress,
    signerBytes,
    merchantStrKey,
    amount,
    nonce,
    expiry
  );

  if (vector.signature_hex) {
    const ok = verifySignature(signerBytes, message, Buffer.from(vector.signature_hex, 'hex'));
    console.log(`Firma válida: ${ok}`);
    if (!ok && vector.expected_valid) {
      throw new Error('El vector de prueba esperaba una firma válida');
    }
  } else {
    console.log('Mensaje canónico generado (sin firma):', message.toString('hex'));
    console.log('Falta signature_hex en el vector; generarla con la clave del signer y volver a ejecutar.');
  }

  console.log('OK: vector de prueba compartido consistente');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
