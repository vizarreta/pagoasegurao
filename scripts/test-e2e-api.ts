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
  parseAmountToStroops,
  formatStroops,
} from '../app/src/lib/stellar';
import { encodeQRA, decodeQRA, encodeQRB, decodeQRB, verifyVoucherLocally } from '../app/src/lib/voucher';

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
  console.log('=== PAGOASEGURAO (S/ tPEN): Prueba E2E completa en Stellar Testnet ===');
  console.log(`Contract ID: ${TESTNET_CONFIG.contractId}\n`);

  const clientKp = Keypair.random();
  const merchantKp = Keypair.random();
  console.log(`Cliente E2E:  ${clientKp.publicKey()}`);
  console.log(`Comercio E2E: ${merchantKp.publicKey()}\n`);

  // 1. Client onboarding via /api/faucet + trustline + /api/faucet mint (S/ 200.00 tPEN)
  console.log('1. Onboarding Cliente (/api/faucet -> trustline tPEN -> /api/faucet S/ 200.00)...');
  const f1 = await invokeHandler(faucetHandler, {
    method: 'POST',
    body: { account: clientKp.publicKey(), mintToken: true },
  });
  assert(f1.statusCode === 200 && f1.body.ok && f1.body.needsTrustline, `faucet step 1 failed: ${JSON.stringify(f1)}`);
  await ensureTrustlineOnChain(clientKp);
  const f2 = await invokeHandler(faucetHandler, {
    method: 'POST',
    body: { account: clientKp.publicKey(), mintToken: true },
  });
  assert(f2.statusCode === 200 && f2.body.ok && f2.body.fundedToken, `faucet step 2 failed: ${JSON.stringify(f2)}`);
  console.log(`   ✓ Cliente fondeado con S/ ${f2.body.balance} tPEN (tx: ${f2.body.hash})`);

  // 2. Merchant onboarding via /api/faucet (XLM only) + trustline
  console.log('2. Onboarding Comercio (/api/faucet XLM -> trustline tPEN)...');
  const m1 = await invokeHandler(faucetHandler, {
    method: 'POST',
    body: { account: merchantKp.publicKey(), mintToken: false },
  });
  assert(m1.statusCode === 200 && m1.body.ok, `merchant faucet failed: ${JSON.stringify(m1)}`);
  await ensureTrustlineOnChain(merchantKp);
  const mBal0 = await fetchAccountBalances(merchantKp.publicKey());
  assert(mBal0.hasTrustline && Number(mBal0.balance) === 0, `merchant trustline check failed: ${JSON.stringify(mBal0)}`);
  console.log('   ✓ Comercio activo con trustline tPEN (saldo inicial: S/ 0.00)');

  // 3. Client opens vault on-chain (S/ 80.00, max S/ 25.00/vale, expires in 60s)
  console.log('3. Cliente abre bóveda on-chain (S/ 80.00, tope S/ 25.00, vigencia 60s)...');
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  const openTx = await openVaultOnChain(clientKp, 800_000_000n, expiresAt, 250_000_000n);
  console.log(`   ✓ open_vault confirmado: https://stellar.expert/explorer/testnet/tx/${openTx}`);

  // 4. Query /api/vault/:signer
  console.log('4. Consultando bóveda real vía GET /api/vault/:signer...');
  const vRes = await invokeHandler(vaultHandler, {
    method: 'GET',
    query: { signer: clientKp.publicKey() },
  });
  assert(vRes.statusCode === 200 && vRes.body.exists && vRes.body.vault.balance === '800000000', `vault query failed: ${JSON.stringify(vRes)}`);
  console.log(`   ✓ /api/vault confirmó saldo: S/ ${Number(vRes.body.vault.balance) / 1e7}, tope: S/ ${Number(vRes.body.vault.maxPerVoucher) / 1e7}`);

  // 5. Offline QR-A -> QR-B -> Local Ed25519 verification
  console.log('5. Simulando Fase Offline (QR-A -> QR-B -> verificación Ed25519 local sin red)...');
  const chargeStroops = 150_000_000n; // S/ 15.00
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
  const decodedQRB = decodeQRB(qrb);
  assert(decodedQRB !== null, 'QR-B decode failed');
  const localCheck = verifyVoucherLocally(TESTNET_CONFIG.contractId, decodedQRB!, merchantKp.publicKey(), chargeStroops);
  assert(localCheck.valid, `Local offline verification failed: ${localCheck.error}`);
  console.log(`   ✓ QR-A (${qra.length} chars) y QR-B (${qrb.length} chars) verificados localmente sin señal.`);

  // 6. Online settlement via POST /api/redeem (fee-sponsored by Relayer)
  console.log('6. Liquidación online vía POST /api/redeem (S/ 15.00 patrocinado por relayer)...');
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
  assert(
    (r1.statusCode === 200 || r1.statusCode === 202) && r1.body.ok && r1.body.hash,
    `redeem failed: ${JSON.stringify(r1)}`
  );
  if (r1.statusCode === 202) {
    // Poll briefly until ledger finality if relayer returned 202 PENDING
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const bal = await fetchAccountBalances(merchantKp.publicKey());
      if ((parseAmountToStroops(bal.balance) ?? 0n) === 150_000_000n) break;
    }
  }
  const mBal1 = await fetchAccountBalances(merchantKp.publicKey());
  assert((parseAmountToStroops(mBal1.balance) ?? 0n) === 150_000_000n, `merchant balance expected 15, got ${mBal1.balance}`);
  console.log(`   ✓ Liquidado en Stellar Testnet: ${r1.body.explorerUrl}`);
  console.log(`   ✓ Saldo comercio en Horizon: S/ 0.00 -> S/ ${mBal1.balance} tPEN`);

  // 7. Error case: Double redeem
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

  // 8. Error case: Amount above max_per_voucher (S/ 30.00 > S/ 25.00)
  console.log('8. Probando caso de error: Monto mayor al tope por vale (S/ 30 > S/ 25)...');
  const overCap = encodeQRB(TESTNET_CONFIG.contractId, clientKp, merchantKp.publicKey(), 300_000_000n, BigInt(expiresAt));
  const rCap = await invokeHandler(redeemHandler, {
    method: 'POST',
    body: { voucher: overCap.voucher, signature: overCap.voucher.signature },
  });
  assert(rCap.statusCode === 400 && rCap.body.code === 3, `over cap unexpected: ${JSON.stringify(rCap)}`);
  console.log(`   ✓ Tope respetado (HTTP 400): "${rCap.body.error}"`);

  // 9. Error case: Expired voucher
  console.log('9. Probando caso de error: Vale vencido...');
  const pastExp = BigInt(Math.floor(Date.now() / 1000) - 60);
  const expiredV = encodeQRB(TESTNET_CONFIG.contractId, clientKp, merchantKp.publicKey(), 50_000_000n, pastExp);
  const rExp = await invokeHandler(redeemHandler, {
    method: 'POST',
    body: { voucher: expiredV.voucher, signature: expiredV.voucher.signature },
  });
  assert(rExp.statusCode === 400 && rExp.body.code === 2, `expired unexpected: ${JSON.stringify(rExp)}`);
  console.log(`   ✓ Vale vencido rechazado (HTTP 400): "${rExp.body.error}"`);

  // 10. Error case: Tampered signature
  console.log('10. Probando caso de error: Firma alterada...');
  const validV = encodeQRB(TESTNET_CONFIG.contractId, clientKp, merchantKp.publicKey(), 50_000_000n, BigInt(expiresAt));
  const tamperedSig = (validV.voucher.signature.startsWith('00') ? 'ff' : '00') + validV.voucher.signature.slice(2);
  const rSig = await invokeHandler(redeemHandler, {
    method: 'POST',
    body: { voucher: validV.voucher, signature: tamperedSig },
  });
  assert(rSig.statusCode === 400 && rSig.body.code === 8, `tampered sig unexpected: ${JSON.stringify(rSig)}`);
  console.log(`   ✓ Firma alterada rechazada (HTTP 400): "${rSig.body.error}"`);

  // 11. top_up on-chain (+S/ 15.00: S/ 65 -> S/ 80)
  console.log('11. Probando top_up (+S/ 15.00) y cierre anticipado rechazado...');
  const topUpTx = await topUpVaultOnChain(clientKp, 150_000_000n);
  const vAfterTopUp = await invokeHandler(vaultHandler, { method: 'GET', query: { signer: clientKp.publicKey() } });
  assert(vAfterTopUp.body.vault.balance === '800000000', `top_up balance mismatch: ${JSON.stringify(vAfterTopUp.body)}`);
  console.log(`   ✓ top_up confirmado (tx: ${topUpTx}), bóveda: S/ 65 -> S/ 80`);

  // 12. Wait for vault expiry & test close_vault on-chain
  const remainingMs = (expiresAt + 6) * 1000 - Date.now();
  if (remainingMs > 0) {
    console.log(`12. Esperando ${Math.ceil(remainingMs / 1000)}s a que venza la bóveda para probar close_vault real...`);
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
  const beforeStroops = parseAmountToStroops(clientBalBeforeClose.balance) ?? 0n;
  const afterStroops = parseAmountToStroops(clientBalAfterClose.balance) ?? 0n;
  const refundedStroops = afterStroops - beforeStroops;
  const expectedRefundStroops = 800_000_000n; // Exact S/ 80.00 tPEN
  assert(refundedStroops === expectedRefundStroops, `expected 80 tPEN refund, got ${formatStroops(refundedStroops)}`);
  console.log(`   ✓ close_vault confirmado: https://stellar.expert/explorer/testnet/tx/${closeTx}`);
  console.log(`   ✓ Saldo cliente devuelto: S/ ${clientBalBeforeClose.balance} -> S/ ${clientBalAfterClose.balance} (+S/ 80.00 tPEN)\n`);

  console.log('===============================================================');
  console.log('TODAS LAS 12 PRUEBAS E2E EN SOLES (tPEN) PASARON AL 100%');
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('\nERROR EN E2E:', err);
  process.exit(1);
});
