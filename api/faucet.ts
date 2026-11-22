import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { account } = req.body as { account?: string };
  if (!account) return res.status(400).json({ error: 'Cuenta requerida' });

  // Entrega USDC de prueba (testnet, con límite de uso). Implementar con Friendbot o cuenta emisora propia.
  return res.json({ ok: true, account, note: 'Implementar envío real de USDC de prueba' });
}
