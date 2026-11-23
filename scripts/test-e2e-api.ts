import fs from 'fs';
import path from 'path';
import { Keypair } from '@stellar/stellar-sdk';
import faucetHandler from '../api/faucet';
import redeemHandler from '../api/redeem';
import vaultHandler from '../api/vault';
import {
  TESTNET_CONFIG,
  ensureTrustlineOnChain,
  openVaultOnChain,
  topUpVaultOnChain,
  closeVaultOnChain,
  fetchAccountBalances,
} from '../app/src/lib/stellar';
import { encodeQRA, decodeQRA, encodeQRB, decodeQRB, verifyVoucherLocally } from '../app/src/lib/voucher';

// Load local gitignored .env into process.env
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('Falta archivo .env local. Ejecuta "pnpm setup:testnet" primero.');
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq > 0) {
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

interface MockResponse {
  statusCode: number;
  body: any;
}

async function invokeHandler(
  handler: any,
  opts: { method: string; body?: any; query?: Record<string, string> }
): Promise<MockResponse> {
  let statusCode = 200;
  let body: any = null;
  const req: any = {
    method: opts.method,
    body: opts.body || {},
    query: opts.query || {},
    headers: {},
  };
  const res: any = {
    setHeader: () => {},
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: any) => {
      body = data;
      return res;
    },
    end: (data?: any) => {
      if (data && !body) body = data;
      return res;
    },
  };
  await handler(req, res);
  return { statusCode, body };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function main() {
  loadEnv();
  console.log('=== PAGOASEGURAO: Prueba E2E completa (API Relayer + PWA Lib + Soroban Testnet) ===');
  console.log(`Contract ID: ${TESTNET_CONFIG.contractId}\n`);

  const clientKp = Keypair.random();
  const merchantKp = Keypair.random();
  console.log(`Cliente E2E:  ${clientKp.publicKey()}`);
  console.log(`Comercio E2E: ${merchantKp.publicKey()}\n`);

  // 1. Client onboarding via /api/faucet + trustline + /api/faucet mint
  console.log('1. Onboarding Cliente (/api/faucet -> trustline tUSDC -> /api/faucet 100 tUSDC)...');
  const f1 = await invokeHandler(faucetHandler, {
    method: 'POST',
    body: { account: clientKp.publicKey(), mintTusdc: true },
  });
  assert(f1.statusCode === 200 && f1.body.ok && f1.body.needsTrustline, `faucet step 1 failed: ${JSON.stringify(f1)}`);
  await ensureTrustlineOnChain(clientKp);
  const f2 = await invokeHandler(faucetHandler, {
    method: 'POST',
    body: { account: clientKp.publicKey(), mintTusdc: true },
  });
  assert(f2.statusCode === 200 && f2.body.ok && f2.body.fundedTusdc, `faucet step 2 failed: ${JSON.stringify(f2)}`);
  console.log(`   ✓ Cliente fondeado con ${f2.body.tUsdc} tUSDC (tx: ${f2.body.hash})`);

  // 2. Merchant onboarding via /api/faucet (XLM only) + trustline
  console.log('2. Onboarding Comercio (/api/faucet XLM -> trustline tUSDC)...');
  const m1 = await invokeHandler(faucetHandler, {
    method: 'POST',
    body: { account: merchantKp.publicKey(), mintTusdc: false },
  });
  assert(m1.statusCode === 200 && m1.body.ok, `merchant faucet failed: ${JSON.stringify(m1)}`);
  await ensureTrustlineOnChain(merchantKp);
  const mBal0 = await fetchAccountBalances(merchantKp.publicKey());
  assert(mBal0.hasTrustline && Number(mBal0.tUsdc) === 0, `merchant trustline check failed: ${JSON.stringify(mBal0)}`);
  console.log('   ✓ Comercio activo con trustline tUSDC (saldo inicial: 0 tUSDC)');

  // 3. Client opens vault on-chain (30 tUSDC, max 10 tUSDC/vale, expires in 60s)
  console.log('3. Cliente abre bóveda on-chain (30 tUSDC, tope 10 tUSDC, vigencia 60s)...');
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const openTx = await openVaultOnChain(clientKp, 300_000_000n, expiresAt, 100_000_000n);
  console.log(`   ✓ open_vault confirmado: https://stellar.expert/explorer/testnet/tx/${openTx}`);

  // 4. Query /api/vault/:signer
  console.log('4. Consultando bóveda real vía GET /api/vault/:signer...');
  const vRes = await invokeHandler(vaultHandler, {
    method: 'GET',
    query: { signer: clientKp.publicKey() },
  });
  assert(vRes.statusCode === 200 && vRes.body.exists && vRes.body.vault.balance === '300000000', `vault query failed: ${JSON.stringify(vRes)}`);
  console.log(`   ✓ /api/vault confirmó saldo: ${Number(vRes.body.vault.balance) / 1e7} tUSDC, tope: ${Number(vRes.body.vault.maxPerVoucher) / 1e7} tUSDC`);

  // 5. Offline QR-A -> QR-B -> Local Ed25519 verification
  console.log('5. Simulando Fase Offline (QR-A -> QR-B -> verificación Ed25519 local sin red)...');
  const chargeStroops = 50_000_000n; // 5 tUSDC
  const qra = encodeQRA(merchantKp.publicKey(), chargeStroops);
  const decodedQRA = decodeQRA(qra);
  assert(decodedQRA && decodedQRA.amount === chargeStroops && decodedQRA.merchantAddress === merchantKp.publicKey(), 'QR-A decode mismatch');

  const { qrString: qrb, voucher } = encodeQRB(
    TESTNET_CONFIG.contractId,
    clientKp,
    decodedQRA!.merchantAddress,
    decodedQRA!.amount,
    BigInt(expiresAt)
  );
  assert(qra.length < 100 && qrb.length < 250, `QR lengths too large: QRA=${qra.length}, QRB=${qrb.length}`);
  const decodedQRB = decodeQRB(qrb);
  assert(decodedQRB !== null, 'QR-B decode failed');
  const localCheck = verifyVoucherLocally(TESTNET_CONFIG.contractId, decodedQRB!, merchantKp.publicKey(), chargeStroops);
  assert(localCheck.valid, `Local offline verification failed: ${localCheck.error}`);
  console.log(`   ✓ QR-A (${qra.length} chars) y QR-B (${qrb.length} chars) verificados localmente sin señal.`);

  // 6. Online settlement via POST /api/redeem (fee-sponsored by Relayer)
  console.log('6. Liquidación online vía POST /api/redeem (patrocinado por relayer)...');
  const r1 = await invokeHandler(redeemHandler, {
    method: 'POST',
    body: {
      voucher: {
        signer: voucher.signer,
        merchant: voucher.merchant,
        amount: voucher.amount,
        nonce: voucher.nonce,
        expiry: voucher.expiry,
      },
      signature: voucher.signature,
    },
  });
  assert(r1.statusCode === 200 && r1.body.ok && r1.body.hash, `redeem failed: ${JSON.stringify(r1)}`);
  const mBal1 = await fetchAccountBalances(merchantKp.publicKey());
  assert(Number(mBal1.tUsdc) === 5, `merchant balance expected 5, got ${mBal1.tUsdc}`);
  console.log(`   ✓ Liquidado en Stellar Testnet: ${r1.body.explorerUrl}`);
  console.log(`   ✓ Saldo comercio en Horizon: 0 -> ${mBal1.tUsdc} tUSDC`);

  // 7. Error case: Double redeem (idempotency & Spanish message)
  console.log('7. Probando caso de error: Doble canje del mismo vale...');
  const rDup = await invokeHandler(redeemHandler, {
    method: 'POST',
    body: {
      voucher: {
        signer: voucher.signer,
        merchant: voucher.merchant,
        amount: voucher.amount,
        nonce: voucher.nonce,
        expiry: voucher.expiry,
      },
      signature: voucher.signature,
    },
  });
  assert(rDup.statusCode === 409 && rDup.body.alreadyRedeemed === true && rDup.body.code === 1, `double redeem unexpected: ${JSON.stringify(rDup)}`);
  console.log(`   ✓ Doble canje rechazado (HTTP 409): "${rDup.body.error}"`);

  // 8. Error case: Amount above max_per_voucher (12 tUSDC > 10 tUSDC)
  console.log('8. Probando caso de error: Monto mayor al tope por vale (12 > 10 tUSDC)...');
  const overCap = encodeQRB(TESTNET_CONFIG.contractId, clientKp, merchantKp.publicKey(), 120_000_000n, BigInt(expiresAt));
  const rCap = await invokeHandler(redeemHandler, {
    method: 'POST',
    body: { voucher: overCap.voucher, signature: overCap.voucher.signature },
  });
  assert(rCap.statusCode === 400 && rCap.body.code === 3, `over cap unexpected: ${JSON.stringify(rCap)}`);
  console.log(`   ✓ Tope respetado (HTTP 400): "${rCap.body.error}"`);

  // 9. Error case: Expired voucher
  console.log('9. Probando caso de error: Vale vencido...');
  const pastExp = BigInt(Math.floor(Date.now() / 1000) - 60);
  const expiredV = encodeQRB(TESTNET_CONFIG.contractId, clientKp, merchantKp.publicKey(), 20_000_000n, pastExp);
  const rExp = await invokeHandler(redeemHandler, {
    method: 'POST',
    body: { voucher: expiredV.voucher, signature: expiredV.voucher.signature },
  });
  assert(rExp.statusCode === 400 && rExp.body.code === 2, `expired unexpected: ${JSON.stringify(rExp)}`);
  console.log(`   ✓ Vale vencido rechazado (HTTP 400): "${rExp.body.error}"`);

  // 10. Error case: Tampered signature
  console.log('10. Probando caso de error: Firma alterada...');
  const validV = encodeQRB(TESTNET_CONFIG.contractId, clientKp, merchantKp.publicKey(), 20_000_000n, BigInt(expiresAt));
  const tamperedSig = (validV.voucher.signature.startsWith('00') ? 'ff' : '00') + validV.voucher.signature.slice(2);
  const rSig = await invokeHandler(redeemHandler, {
    method: 'POST',
    body: { voucher: validV.voucher, signature: tamperedSig },
  });
  assert(rSig.statusCode === 400 && rSig.body.code === 8, `tampered sig unexpected: ${JSON.stringify(rSig)}`);
  console.log(`   ✓ Firma alterada rechazada (HTTP 400): "${rSig.body.error}"`);

  // 11. top_up on-chain (+5 tUSDC: 25 -> 30 tUSDC)
  console.log('11. Probando top_up (+5 tUSDC) y cierre anticipado rechazado...');
  const topUpTx = await topUpVaultOnChain(clientKp, 50_000_000n);
  const vAfterTopUp = await invokeHandler(vaultHandler, { method: 'GET', query: { signer: clientKp.publicKey() } });
  assert(vAfterTopUp.body.vault.balance === '300000000', `top_up balance mismatch: ${JSON.stringify(vAfterTopUp.body)}`);
  console.log(`   ✓ top_up confirmado (tx: ${topUpTx}), bóveda: 25 -> 30 tUSDC`);

  // 12. Wait for vault expiry & test close_vault on-chain!
  const remainingMs = (expiresAt + 6) * 1000 - Date.now();
  if (remainingMs > 0) {
    console.log(`12. Esperando ${Math.ceil(remainingMs / 1000)}s a que venza la bóveda para probar close_vault real...`);
    // Verify early close fails first!
    let earlyFailed = false;
    try {
      await closeVaultOnChain(clientKp);
    } catch (e: any) {
      earlyFailed = String(e.message).includes('no vence');
    }
    assert(earlyFailed, 'close_vault before expiry should have failed cleanly');
    console.log('   ✓ Cierre anticipado rechazado correctamente por Soroban.');
    await new Promise((r) => setTimeout(r, remainingMs));
  }
  const clientBalBeforeClose = await fetchAccountBalances(clientKp.publicKey());
  const closeTx = await closeVaultOnChain(clientKp);
  const clientBalAfterClose = await fetchAccountBalances(clientKp.publicKey());
  const refunded = Number(clientBalAfterClose.tUsdc) - Number(clientBalBeforeClose.tUsdc);
  assert(Math.abs(refunded - 30) < 0.001, `expected 30 tUSDC refund, got ${refunded}`);
  console.log(`   ✓ close_vault confirmado: https://stellar.expert/explorer/testnet/tx/${closeTx}`);
  console.log(`   ✓ Saldo cliente devuelto: ${clientBalBeforeClose.tUsdc} -> ${clientBalAfterClose.tUsdc} tUSDC (+30 tUSDC)\n`);

  console.log('===============================================================');
  console.log('TODAS LAS 12 PRUEBAS E2E EN STELLAR TESTNET PASARON AL 100%');
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('\nERROR EN E2E:', err);
  process.exit(1);
});
