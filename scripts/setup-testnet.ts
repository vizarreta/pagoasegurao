import { Keypair, Address, Networks, StrKey, TransactionBuilder, xdr, scval, nativeToScVal } from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const OUT_FILE = path.join(DEPLOYMENTS_DIR, 'testnet.json');

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });

  const issuerSecret = process.env.ISSUER_SECRET;
  if (!issuerSecret) {
    throw new Error('Falta ISSUER_SECRET en .env');
  }
  const issuer = Keypair.fromSecret(issuerSecret);

  // TODO: cliente Horizon/RPC para crear cuentas, fundar con friendbot, desplegar SAC y contrato.
  const deployment = {
    network: 'testnet',
    rpcUrl: RPC_URL,
    issuer: issuer.publicKey(),
    usdcContractId: '',
    contractId: '',
    clientAccount: '',
    merchantAccount: '',
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(deployment, null, 2));
  console.log(`Despliegue de prueba escrito en ${OUT_FILE}`);
  console.log(deployment);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
