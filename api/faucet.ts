import { VercelRequest, VercelResponse } from '@vercel/node';
import { Keypair, Asset, TransactionBuilder, Operation, rpc, StrKey } from '@stellar/stellar-sdk';
import { getConfig, fetchHorizonBalances, waitForTransaction } from './_config.js';

// Known limitation: in Vercel serverless (stateless per-invocation containers),
// this Map only enforces rate-limiting within a warm container instance and resets
// on cold starts. Acceptable for zero-value testnet tokens (Friendbot also enforces
// upstream limits); production would use Redis/Vercel KV.
const rateLimitMap = new Map<string, number>();
const COOLDOWN_MS = 10_000;
const IP_BURST_COOLDOWN_MS = 2_000;
const FAUCET_AMOUNT = '200.0000000'; // S/ 200.00 (200 tPEN de prueba)

function recordRateLimit(key: string, now: number) {
  if (rateLimitMap.size > 500) {
    for (const [k, ts] of rateLimitMap.entries()) {
      if (now - ts > COOLDOWN_MS) rateLimitMap.delete(k);
    }
  }
  rateLimitMap.set(key, now);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const { account, mintToken = true } = (req.body || {}) as { account?: string; mintToken?: boolean };
  if (!account || !StrKey.isValidEd25519PublicKey(account)) {
    return res.status(400).json({ ok: false, error: 'Dirección Stellar (G...) inválida o faltante.' });
  }

  const config = getConfig();

  try {
    // 1. Ensure account exists on Stellar Testnet via Friendbot
    let balances = await fetchHorizonBalances(account, config.tokenIssuer, config.horizonUrl, config.assetCode);
    let fundedXlm = false;

    if (!balances.exists) {
      const fbRes = await fetch(`https://friendbot.stellar.org?addr=${account}`);
      if (!fbRes.ok && fbRes.status !== 400) {
        return res.status(502).json({
          ok: false,
          error: 'Friendbot de Stellar Testnet no respondió. Intenta en unos segundos.',
        });
      }
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        balances = await fetchHorizonBalances(account, config.tokenIssuer, config.horizonUrl, config.assetCode);
        if (balances.exists) break;
      }
      if (!balances.exists) {
        return res.status(504).json({
          ok: false,
          error: 'La cuenta se solicitó a Friendbot pero aún no aparece en Horizon. Reintenta en unos segundos.',
        });
      }
      fundedXlm = true;
    }

    if (!mintToken) {
      return res.status(200).json({
        ok: true,
        account,
        fundedXlm,
        hasTrustline: balances.hasTrustline,
        xlm: balances.xlm,
        balance: balances.balance,
        assetCode: config.assetCode,
        issuer: config.tokenIssuer,
        message: 'Cuenta financiada con XLM en Stellar Testnet.',
      });
    }

    // 2. Require tPEN trustline before issuer can send test Soles
    if (!balances.hasTrustline) {
      return res.status(200).json({
        ok: true,
        account,
        fundedXlm,
        hasTrustline: false,
        needsTrustline: true,
        xlm: balances.xlm,
        balance: '0',
        assetCode: config.assetCode,
        issuer: config.tokenIssuer,
        message: `Cuenta lista con XLM. Falta activar la línea de confianza (trustline) para Soles de prueba (${config.assetCode}).`,
      });
    }

    // 3. Rate-limit test Soles faucet minting (per-account + burst check on real IP)
    const now = Date.now();
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const clientIp = rawIp ? rawIp.split(',')[0].trim() : '';
    const accountKey = `acct:${account}`;
    const ipKey = clientIp ? `ip:${clientIp}` : '';
    const lastTsAccount = rateLimitMap.get(accountKey) || 0;
    const lastTsIp = ipKey ? rateLimitMap.get(ipKey) || 0 : 0;
    if (now - lastTsAccount < COOLDOWN_MS || (ipKey && now - lastTsIp < IP_BURST_COOLDOWN_MS)) {
      return res.status(429).json({
        ok: false,
        error: 'Espera unos segundos antes de solicitar más Soles de prueba (tPEN).',
      });
    }

    if (!config.issuerSecret) {
      return res.status(500).json({
        ok: false,
        error: 'Falta configurar ISSUER_SECRET en el servidor para emitir Soles de prueba (tPEN).',
      });
    }

    const issuer = Keypair.fromSecret(config.issuerSecret);
    const tokenAsset = new Asset(config.assetCode, issuer.publicKey());
    const server = new rpc.Server(config.rpcUrl);
    const issuerAccount = await server.getAccount(issuer.publicKey());

    const tx = new TransactionBuilder(issuerAccount, {
      fee: '10000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: account,
          asset: tokenAsset,
          amount: FAUCET_AMOUNT,
        })
      )
      .setTimeout(60)
      .build();

    tx.sign(issuer);
    const sendRes = await server.sendTransaction(tx);
    if (sendRes.status === 'ERROR') {
      return res.status(502).json({
        ok: false,
        error: 'No se pudo enviar Soles de prueba (tPEN) desde la cuenta emisora.',
        details: sendRes.errorResult?.toXDR('base64'),
      });
    }

    const finalTx = await waitForTransaction(server, sendRes.hash);
    if (finalTx.status !== 'SUCCESS') {
      return res.status(502).json({
        ok: false,
        hash: sendRes.hash,
        error: 'La transferencia de Soles de prueba (tPEN) falló en testnet.',
      });
    }

    const mintedAt = Date.now();
    recordRateLimit(accountKey, mintedAt);
    if (ipKey) recordRateLimit(ipKey, mintedAt);
    const updated = await fetchHorizonBalances(account, config.tokenIssuer, config.horizonUrl, config.assetCode);

    return res.status(200).json({
      ok: true,
      account,
      fundedXlm,
      hasTrustline: true,
      fundedToken: true,
      amount: '200',
      xlm: updated.xlm,
      balance: updated.balance,
      hash: sendRes.hash,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${sendRes.hash}`,
      message: '¡S/ 200.00 (200 tPEN de prueba, sin valor económico) acreditados en Stellar Testnet!',
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Error en el faucet de Stellar Testnet.',
    });
  }
}
