import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { signer } = req.query as { signer?: string };
  if (!signer) return res.status(400).json({ error: 'signer requerido' });

  // Devuelve estado de la bóveda para consulta del comercio cuando está en línea.
  return res.json({ signer, exists: false, note: 'Consultar estado de bóveda desde Horizon/RPC' });
}
