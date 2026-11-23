import { VercelRequest, VercelResponse } from '@vercel/node';
import { Keypair, Asset, TransactionBuilder, Operation, rpc, StrKey } from '@stellar/stellar-sdk';
import { getConfig, fetchHorizonBalances, waitForTransaction, ASSET_CODE } from './_config.js';

const rateLimitMap = new Map<string, number>();
const COOLDOWN_MS = 10_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const { account, mintTusdc = true } = (req.body || {}) as { account?: string; mintTusdc?: boolean };
  if (!account || !StrKey.isValidEd25519PublicKey(account)) {
    return res.status(400).json({ ok: false, error: 'Dirección Stellar (G...) inválida o faltante.' });
  }

  const config = getConfig();

  try {
    // 1. Ensure account exists on Stellar Testnet via Friendbot
    let balances = await fetchHorizonBalances(account, config.tUsdcIssuer, config.horizonUrl);
    let fundedXlm = false;

    if (!balances.exists) {
      const fbRes = await fetch(`https://friendbot.stellar.org?addr=${account}`);
      if (!fbRes.ok && fbRes.status !== 400) {
        return res.status(502).json({
          ok: false,
          error: 'Friendbot de Stellar Testnet no respondió. Intenta en unos segundos.',
        });
      }
      // Wait for account visibility in Horizon
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        balances = await fetchHorizonBalances(account, config.tUsdcIssuer, config.horizonUrl);
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

    // If caller only wanted Friendbot XLM funding (e.g. merchant onboarding step 1)
    if (!mintTusdc) {
      return res.status(200).json({
        ok: true,
        account,
        fundedXlm,
        hasTrustline: balances.hasTrustline,
        xlm: balances.xlm,
        tUsdc: balances.tUsdc,
        assetCode: ASSET_CODE,
        issuer: config.tUsdcIssuer,
        message: 'Cuenta financiada con XLM en Stellar Testnet.',
      });
    }

    // 2. Require tUSDC trustline before issuer can send tUSDC
    if (!balances.hasTrustline) {
      return res.status(200).json({
        ok: true,
        account,
        fundedXlm,
        hasTrustline: false,
        needsTrustline: true,
        xlm: balances.xlm,
        tUsdc: '0',
        assetCode: ASSET_CODE,
        issuer: config.tUsdcIssuer,
        message: 'Cuenta lista con XLM. Falta activar la línea de confianza (trustline) para tUSDC.',
      });
    }

    // 3. Rate-limit tUSDC faucet minting
    const now = Date.now();
    const lastTs = rateLimitMap.get(account) || 0;
    if (now - lastTs < COOLDOWN_MS) {
      return res.status(429).json({
        ok: false,
        error: 'Espera unos segundos antes de solicitar más tUSDC de prueba.',
      });
    }

    if (!config.issuerSecret) {
      return res.status(500).json({
        ok: false,
        error: 'Falta configurar ISSUER_SECRET en el servidor para emitir tUSDC de prueba.',
      });
    }

    const issuer = Keypair.fromSecret(config.issuerSecret);
    const tUsdcAsset = new Asset(ASSET_CODE, issuer.publicKey());
    const server = new rpc.Server(config.rpcUrl);
    const issuerAccount = await server.getAccount(issuer.publicKey());

    const tx = new TransactionBuilder(issuerAccount, {
      fee: '10000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        Operation.payment({
          destination: account,
          asset: tUsdcAsset,
          amount: '100.0000000',
        })
      )
      .setTimeout(60)
      .build();

    tx.sign(issuer);
    const sendRes = await server.sendTransaction(tx);
    if (sendRes.status === 'ERROR') {
      return res.status(502).json({
        ok: false,
        error: 'No se pudo enviar tUSDC de prueba desde la cuenta emisora.',
        details: sendRes.errorResult?.toXDR('base64'),
      });
    }

    const finalTx = await waitForTransaction(server, sendRes.hash);
    if (finalTx.status !== 'SUCCESS') {
      return res.status(502).json({
        ok: false,
        hash: sendRes.hash,
        error: 'La transferencia de tUSDC de prueba falló en testnet.',
      });
    }

    rateLimitMap.set(account, Date.now());
    const updated = await fetchHorizonBalances(account, config.tUsdcIssuer, config.horizonUrl);

    return res.status(200).json({
      ok: true,
      account,
      fundedXlm,
      hasTrustline: true,
      fundedTusdc: true,
      amount: '100',
      xlm: updated.xlm,
      tUsdc: updated.tUsdc,
      hash: sendRes.hash,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${sendRes.hash}`,
      message: '¡100 tUSDC de prueba (sin valor económico) acreditados en Stellar Testnet!',
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Error en el faucet de Stellar Testnet.',
    });
  }
}
