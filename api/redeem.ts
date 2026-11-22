import { VercelRequest, VercelResponse } from '@vercel/node';
import { Keypair, Address, TransactionBuilder, Networks, xdr } from '@stellar/stellar-sdk';
import { buildCanonicalMessage } from '../../app/src/lib/stellar';

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const RELAYER_SECRET = process.env.RELAYER_SECRET!;
const CONTRACT_ID = process.env.CONTRACT_ID!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { voucher, signature } = req.body as {
      voucher: { signer: string; merchant: string; amount: string; nonce: string; expiry: string };
      signature: string;
    };

    if (!voucher || !signature) {
      return res.status(400).json({ error: 'Faltan vale o firma' });
    }

    const relayer = Keypair.fromSecret(RELAYER_SECRET);
    const message = buildCanonicalMessage(
      CONTRACT_ID,
      Buffer.from(voucher.signer, 'hex'), // placeholder: signer public key bytes
      voucher.merchant,
      BigInt(voucher.amount),
      BigInt(voucher.nonce),
      BigInt(voucher.expiry)
    );

    // Simulación y envío con el relayer como origen de comisiones (fee sponsorship).
    // Implementación concreta depende de la versión de @stellar/stellar-sdk.

    return res.json({ ok: true, hash: 'placeholder', note: 'Implementar simulación y envío real con stellar-sdk' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error interno' });
  }
}
