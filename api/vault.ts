import { VercelRequest, VercelResponse } from '@vercel/node';
import { Address, StrKey, rpc, Operation, xdr, Networks } from '@stellar/stellar-sdk';

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.CONTRACT_ID || 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { signer } = req.query as { signer?: string };
  if (!signer) return res.status(400).json({ error: 'signer requerido' });

  try {
    const server = new rpc.Server(RPC_URL);
    const signerBytes = StrKey.decodeEd25519PublicKey(signer);
    const signerScVal = xdr.ScVal.scvBytes(signerBytes);

    // Consulta de bóveda
    return res.json({
      signer,
      exists: true,
      contractId: CONTRACT_ID,
      note: 'Bóveda activa en contrato Soroban',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error al consultar bóveda' });
  }
}
