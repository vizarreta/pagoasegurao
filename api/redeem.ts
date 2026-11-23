import { VercelRequest, VercelResponse } from '@vercel/node';
import {
  Keypair,
  Address,
  TransactionBuilder,
  Operation,
  rpc,
  xdr,
  StrKey,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import {
  getConfig,
  parseContractError,
  fetchHorizonBalances,
  waitForTransaction,
  checkIsRedeemedOnChain,
} from './_config.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  try {
    const config = getConfig();
    if (!config.relayerSecret) {
      return res.status(500).json({
        ok: false,
        error: 'El relayer no tiene configurada la variable RELAYER_SECRET en el servidor.',
      });
    }

    const { voucher, signature } = (req.body || {}) as {
      voucher?: {
        signer: string;
        merchant: string;
        amount: string;
        nonce: string;
        expiry: string;
      };
      signature?: string;
    };

    if (!voucher || !signature) {
      return res.status(400).json({ ok: false, error: 'Faltan los datos del vale o la firma criptográfica.' });
    }

    if (!StrKey.isValidEd25519PublicKey(voucher.signer)) {
      return res.status(400).json({ ok: false, error: 'Clave pública del cliente inválida.' });
    }
    if (!StrKey.isValidEd25519PublicKey(voucher.merchant)) {
      return res.status(400).json({ ok: false, error: 'Dirección del comercio inválida.' });
    }
    if (!/^[0-9a-fA-F]{128}$/.test(signature)) {
      return res.status(400).json({ ok: false, error: 'Formato de firma Ed25519 inválido (se esperan 64 bytes hex).' });
    }

    let amountBig: bigint;
    let nonceBig: bigint;
    let expiryBig: bigint;
    try {
      amountBig = BigInt(voucher.amount);
      nonceBig = BigInt(voucher.nonce);
      expiryBig = BigInt(voucher.expiry);
    } catch {
      return res.status(400).json({ ok: false, error: 'Monto, nonce o fecha de vencimiento inválidos.' });
    }

    if (amountBig <= 0n) {
      return res.status(400).json({ ok: false, error: 'El monto del vale debe ser mayor a cero.' });
    }

    const relayerKp = Keypair.fromSecret(config.relayerSecret);
    const server = new rpc.Server(config.rpcUrl);

    // Idempotency check: inspect if already redeemed on-chain
    const alreadyRedeemed = await checkIsRedeemedOnChain(
      server,
      config.contractId,
      voucher.signer,
      nonceBig,
      relayerKp.publicKey()
    );
    if (alreadyRedeemed) {
      return res.status(409).json({
        ok: false,
        code: 1,
        alreadyRedeemed: true,
        error: 'Este vale ya fue liquidado anteriormente en Stellar (doble canje evitado).',
      });
    }

    // Verify merchant account exists and has tUSDC trustline before submitting
    const merchantInfo = await fetchHorizonBalances(voucher.merchant, config.tUsdcIssuer, config.horizonUrl);
    if (!merchantInfo.exists) {
      return res.status(400).json({
        ok: false,
        error: 'La cuenta del comercio todavía no existe en Stellar Testnet. Actívala en el botón "Activar cuenta de comercio".',
      });
    }
    if (!merchantInfo.hasTrustline) {
      return res.status(400).json({
        ok: false,
        error: 'La cuenta del comercio aún no activó tUSDC (trustline). Actívala en el Modo Comercio y vuelve a sincronizar.',
      });
    }

    // Build Soroban Voucher struct ScVal (alphabetical keys required by Soroban)
    const signerBytes = StrKey.decodeEd25519PublicKey(voucher.signer);
    const voucherScVal = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('amount'),
        val: nativeToScVal(amountBig, { type: 'i128' }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('expiry'),
        val: nativeToScVal(expiryBig, { type: 'u64' }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('merchant'),
        val: Address.fromString(voucher.merchant).toScVal(),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('nonce'),
        val: nativeToScVal(nonceBig, { type: 'u64' }),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('signer'),
        val: xdr.ScVal.scvBytes(signerBytes),
      }),
    ]);

    const sigBytes = Buffer.from(signature, 'hex');
    const redeemOp = Operation.invokeContractFunction({
      contract: config.contractId,
      function: 'redeem',
      args: [voucherScVal, xdr.ScVal.scvBytes(sigBytes)],
    });

    const relayerAccount = await server.getAccount(relayerKp.publicKey());
    const tx = new TransactionBuilder(relayerAccount, {
      fee: '100000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(redeemOp)
      .setTimeout(60)
      .build();

    const simRes = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simRes)) {
      const parsed = parseContractError(simRes.error || '');
      const status = parsed.code === 1 ? 409 : 400;
      return res.status(status).json({
        ok: false,
        code: parsed.code,
        alreadyRedeemed: parsed.code === 1,
        error: parsed.message,
        details: simRes.error,
      });
    }

    const prepared = await server.prepareTransaction(tx);
    prepared.sign(relayerKp);
    const sendRes = await server.sendTransaction(prepared);
    if (sendRes.status === 'ERROR') {
      return res.status(502).json({
        ok: false,
        error: 'Stellar Testnet rechazó el envío de la transacción. Intenta nuevamente.',
        details: sendRes.errorResult?.toXDR('base64'),
      });
    }

    const finalTx = await waitForTransaction(server, sendRes.hash);
    if (finalTx.status !== 'SUCCESS') {
      return res.status(400).json({
        ok: false,
        hash: sendRes.hash,
        error: 'La transacción falló al ejecutarse en Stellar Testnet.',
      });
    }

    return res.status(200).json({
      ok: true,
      hash: sendRes.hash,
      status: 'SUCCESS',
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${sendRes.hash}`,
      sponsoredBy: relayerKp.publicKey(),
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Error interno en el relayer de Stellar Testnet.',
    });
  }
}
