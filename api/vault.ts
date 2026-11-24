import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  Account,
  StrKey,
  rpc,
  Operation,
  TransactionBuilder,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import { getConfig, fetchHorizonBalances, DEFAULT_RELAYER_PUBLIC } from './_config.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido' });

  const { signer } = req.query as { signer?: string };
  if (!signer || !StrKey.isValidEd25519PublicKey(signer)) {
    return res.status(400).json({ ok: false, error: 'Parámetro signer (clave G...) inválido o faltante.' });
  }

  try {
    const config = getConfig();
    const server = new rpc.Server(config.rpcUrl);
    const signerBytes = StrKey.decodeEd25519PublicKey(signer);

    // Pure read simulation against Soroban get_vault(signer)
    const dummySource = new Account(DEFAULT_RELAYER_PUBLIC, '0');
    const tx = new TransactionBuilder(dummySource, {
      fee: '100',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: config.contractId,
          function: 'get_vault',
          args: [xdr.ScVal.scvBytes(signerBytes)],
        })
      )
      .setTimeout(30)
      .build();

    const [simRes, balances] = await Promise.all([
      server.simulateTransaction(tx),
      fetchHorizonBalances(signer, config.tokenIssuer, config.horizonUrl, config.assetCode),
    ]);

    if (rpc.Api.isSimulationError(simRes) || !simRes.result) {
      return res.status(502).json({
        ok: false,
        error: 'No se pudo consultar el estado de la bóveda en Soroban.',
        details: rpc.Api.isSimulationError(simRes) ? simRes.error : undefined,
      });
    }

    const decoded = scValToNative(simRes.result.retval);
    const isNone =
      !decoded ||
      (typeof decoded === 'object' && ('none' in decoded || 'None' in decoded)) ||
      !decoded.owner;

    if (isNone) {
      return res.status(200).json({
        ok: true,
        signer,
        contractId: config.contractId,
        exists: false,
        vault: null,
        balances,
        syncedAt: Date.now(),
      });
    }

    return res.status(200).json({
      ok: true,
      signer,
      contractId: config.contractId,
      exists: true,
      vault: {
        owner: String(decoded.owner),
        balance: BigInt(decoded.balance).toString(),
        expiresAt: Number(decoded.expires_at),
        maxPerVoucher: BigInt(decoded.max_per_voucher).toString(),
      },
      balances,
      syncedAt: Date.now(),
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Error al consultar la bóveda en Stellar Testnet.',
    });
  }
}
