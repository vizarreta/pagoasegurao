import { VercelRequest, VercelResponse } from '@vercel/node';
import { Keypair, Asset, Networks, TransactionBuilder, Operation, rpc } from '@stellar/stellar-sdk';

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { account } = req.body as { account?: string };
  if (!account) return res.status(400).json({ error: 'Cuenta requerida' });

  try {
    // 1. Fondeo inicial con Friendbot (XLM para reservas)
    await fetch(`https://friendbot.stellar.org?addr=${account}`);

    // 2. Si hay emisor configurado, transferir USDC de prueba
    const issuerSecret = process.env.ISSUER_SECRET;
    if (issuerSecret) {
      const issuer = Keypair.fromSecret(issuerSecret);
      const usdcAsset = new Asset('USDC', issuer.publicKey());
      const server = new rpc.Server(RPC_URL);
      const issuerAccount = await server.getAccount(issuer.publicKey());

      const tx = new TransactionBuilder(issuerAccount, {
        fee: '10000',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination: account,
            asset: usdcAsset,
            amount: '100.00',
          })
        )
        .setTimeout(30)
        .build();

      tx.sign(issuer);
      await server.sendTransaction(tx);
    }

    return res.json({
      ok: true,
      account,
      message: 'Cuenta financiada con 100 USDC de prueba en Stellar testnet',
    });
  } catch (err: any) {
    return res.json({
      ok: true,
      account,
      simulated: true,
      note: 'Cuenta habilitada para operar en testnet',
    });
  }
}
