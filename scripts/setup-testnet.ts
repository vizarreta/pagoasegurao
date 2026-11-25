import {
  Keypair,
  Asset,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  StrKey,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  Transaction,
} from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildCanonicalMessage } from '../app/src/lib/stellar';

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const ASSET_CODE = 'tPEN';
const ASSET_SYMBOL = 'S/';
const DEPLOYMENTS_DIR = path.join(process.cwd(), 'deployments');
const OUT_FILE = path.join(DEPLOYMENTS_DIR, 'testnet.json');
const APP_PUBLIC_DEPLOYMENT = path.join(process.cwd(), 'app', 'public', 'deployments', 'testnet.json');
const LOCAL_ENV_FILE = path.join(process.cwd(), '.env');

const WASM_CANDIDATES = [
  path.join(process.cwd(), 'target', 'wasm32v1-none', 'release', 'pagoasegurao.wasm'),
  path.join(process.cwd(), 'target', 'wasm32-unknown-unknown', 'release', 'pagoasegurao.wasm'),
];

function findWasmPath(): string {
  for (const candidate of WASM_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `No se encontró el WASM compilado. Ejecuta "stellar contract build" primero.\nBuscado en:\n${WASM_CANDIDATES.join('\n')}`
  );
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function accountExists(pubKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${pubKey}`);
    return res.ok;
  } catch {
    return false;
  }
}

async function fundWithFriendbot(pubKey: string, label: string): Promise<void> {
  if (await accountExists(pubKey)) {
    console.log(`✓ ${label} (${pubKey.slice(0, 8)}...) ya existe en testnet.`);
    return;
  }
  console.log(`Fondeando ${label} (${pubKey.slice(0, 8)}...) con Friendbot...`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://friendbot.stellar.org?addr=${pubKey}`);
      if (res.ok || res.status === 400) {
        await sleep(2500);
        if (await accountExists(pubKey)) {
          console.log(`✓ ${label} fondeada con éxito.`);
          return;
        }
      }
      const txt = await res.text();
      console.warn(`Intento ${attempt} Friendbot (${res.status}): ${txt.slice(0, 140)}`);
    } catch (err: any) {
      console.warn(`Intento ${attempt} Friendbot error: ${err.message}`);
    }
    await sleep(3000);
  }
  throw new Error(`No se pudo fondear la cuenta ${label} (${pubKey}) con Friendbot.`);
}

interface TxResult {
  hash: string;
  returnValue?: xdr.ScVal;
}

async function waitForTx(server: rpc.Server, hash: string): Promise<TxResult> {
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const txStatus = await server.getTransaction(hash);
    if (txStatus.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash, returnValue: txStatus.returnValue };
    }
    if (txStatus.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transacción ${hash} falló en ledger: ${JSON.stringify(txStatus.resultXdr?.toXDR('base64'))}`);
    }
  }
  throw new Error(`Timeout esperando confirmación de transacción ${hash}`);
}

async function sendClassicTx(server: rpc.Server, tx: Transaction, signer: Keypair, label: string): Promise<TxResult> {
  tx.sign(signer);
  const sendRes = await server.sendTransaction(tx);
  if (sendRes.status === 'ERROR') {
    throw new Error(`Error enviando tx clásica (${label}): ${JSON.stringify(sendRes.errorResult?.toXDR('base64') || sendRes)}`);
  }
  console.log(`  → ${label} enviada: ${sendRes.hash}`);
  const result = await waitForTx(server, sendRes.hash);
  console.log(`  ✓ ${label} confirmada.`);
  return result;
}

async function sendSorobanTx(server: rpc.Server, tx: Transaction, signer: Keypair, label: string): Promise<TxResult> {
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);
  const sendRes = await server.sendTransaction(prepared);
  if (sendRes.status === 'ERROR') {
    throw new Error(`Error enviando tx Soroban (${label}): ${JSON.stringify(sendRes.errorResult?.toXDR('base64') || sendRes)}`);
  }
  console.log(`  → ${label} enviada: ${sendRes.hash}`);
  const result = await waitForTx(server, sendRes.hash);
  console.log(`  ✓ ${label} confirmada.`);
  return result;
}

function loadDotEnv(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!fs.existsSync(LOCAL_ENV_FILE)) return vars;
  const content = fs.readFileSync(LOCAL_ENV_FILE, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  return vars;
}

async function getTokenBalance(pubKey: string, assetCode: string, issuerPub: string): Promise<string> {
  const res = await fetch(`${HORIZON_URL}/accounts/${pubKey}`);
  if (!res.ok) return '0';
  const data = (await res.json()) as { balances: Array<{ asset_code?: string; asset_issuer?: string; balance: string }> };
  const found = data.balances.find((b) => b.asset_code === assetCode && b.asset_issuer === issuerPub);
  return found ? found.balance : '0';
}

async function main() {
  const wasmPath = findWasmPath();
  const wasmBytes = fs.readFileSync(wasmPath);
  const wasmHash = crypto.createHash('sha256').update(wasmBytes).digest();

  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(APP_PUBLIC_DEPLOYMENT), { recursive: true });

  const envFile = loadDotEnv();
  const server = new rpc.Server(RPC_URL);

  console.log('=== PAGOASEGURAO: Despliegue Real y Validación E2E en Stellar Testnet ===');
  console.log(`Red:  ${NETWORK_PASSPHRASE}`);
  console.log(`RPC:  ${RPC_URL}`);
  console.log(`WASM: ${wasmPath} (${wasmBytes.length} bytes, sha256=${wasmHash.toString('hex')})\n`);

  // 1. Issuer & Relayer accounts (reused from env if provided for idempotency)
  const issuerSecret = process.env.ISSUER_SECRET || envFile.ISSUER_SECRET;
  const issuer = issuerSecret ? Keypair.fromSecret(issuerSecret) : Keypair.random();
  console.log(`Emisor ${ASSET_CODE}: ${issuer.publicKey()}`);

  const relayerSecret = process.env.RELAYER_SECRET || envFile.RELAYER_SECRET;
  const relayer = relayerSecret ? Keypair.fromSecret(relayerSecret) : Keypair.random();
  console.log(`Relayer (fee sponsor): ${relayer.publicKey()}`);

  // Fresh demo client & merchant for clean E2E test
  const clientKp = Keypair.random();
  const merchantKp = Keypair.random();
  console.log(`Cliente Demo:  ${clientKp.publicKey()}`);
  console.log(`Comercio Demo: ${merchantKp.publicKey()}\n`);

  await fundWithFriendbot(issuer.publicKey(), 'Emisor');
  await fundWithFriendbot(relayer.publicKey(), 'Relayer');
  await fundWithFriendbot(clientKp.publicKey(), 'Cliente Demo');
  await fundWithFriendbot(merchantKp.publicKey(), 'Comercio Demo');

  // 2. Test asset tPEN (Soles de prueba) & SAC
  const tokenAsset = new Asset(ASSET_CODE, issuer.publicKey());
  const tokenContractId = tokenAsset.contractId(NETWORK_PASSPHRASE);
  console.log(`\nActivo de prueba: ${ASSET_CODE} (${ASSET_SYMBOL} Soles de prueba, emisor ${issuer.publicKey()})`);
  console.log(`SAC Contract ID:  ${tokenContractId}`);

  // Establish trustlines for client and merchant
  console.log(`\n--- Paso 1: Trustlines y emisión de ${ASSET_CODE} ---`);
  const clientAcc = await server.getAccount(clientKp.publicKey());
  const clientTrustTx = new TransactionBuilder(clientAcc, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: tokenAsset, limit: '1000000' }))
    .setTimeout(60)
    .build();
  await sendClassicTx(server, clientTrustTx, clientKp, 'Trustline Cliente');

  const merchantAcc = await server.getAccount(merchantKp.publicKey());
  const merchantTrustTx = new TransactionBuilder(merchantAcc, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: tokenAsset, limit: '1000000' }))
    .setTimeout(60)
    .build();
  await sendClassicTx(server, merchantTrustTx, merchantKp, 'Trustline Comercio');

  // Mint tPEN to client & merchant
  const issuerAccMint = await server.getAccount(issuer.publicKey());
  const mintTx = new TransactionBuilder(issuerAccMint, {
    fee: '20000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: clientKp.publicKey(),
        asset: tokenAsset,
        amount: '1000.0000000',
      })
    )
    .addOperation(
      Operation.payment({
        destination: merchantKp.publicKey(),
        asset: tokenAsset,
        amount: '10.0000000',
      })
    )
    .setTimeout(60)
    .build();
  await sendClassicTx(server, mintTx, issuer, `Emisión ${ASSET_CODE} a Cliente y Comercio`);

  // 3. Deploy SAC contract (idempotent if already deployed)
  console.log(`\n--- Paso 2: Despliegue de Stellar Asset Contract (SAC) para ${ASSET_CODE} ---`);
  let sacTxHash = '';
  try {
    const issuerAccSac = await server.getAccount(issuer.publicKey());
    const createSacTx = new TransactionBuilder(issuerAccSac, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.createStellarAssetContract({ asset: tokenAsset }))
      .setTimeout(60)
      .build();
    const sacRes = await sendSorobanTx(server, createSacTx, issuer, `Deploy SAC ${ASSET_CODE}`);
    sacTxHash = sacRes.hash;
  } catch (err: any) {
    if (String(err.message).includes('ExistingValue') || String(err.message).includes('already exists')) {
      console.log(`  ✓ SAC ya existía en testnet: ${tokenContractId}`);
    } else {
      throw err;
    }
  }

  // 4. Upload WASM & Deploy PagoAsegurao contract (or reuse existing CONTRACT_ID if provided)
  console.log('\n--- Paso 3: Subida de WASM, despliegue e inicialización de PagoAsegurao ---');
  const existingContractId = process.env.CONTRACT_ID || envFile.CONTRACT_ID;
  let wasmUploadTxHash = '';
  let deployTxHash = '';
  let initTxHash = '';
  let contractId = '';

  if (existingContractId && process.argv.includes('--reuse-contract')) {
    contractId = existingContractId;
    console.log(`  ✓ Reutilizando contrato existente: ${contractId}`);
  } else {
    const issuerAccUpload = await server.getAccount(issuer.publicKey());
    const uploadTx = new TransactionBuilder(issuerAccUpload, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.uploadContractWasm({ wasm: wasmBytes }))
      .setTimeout(60)
      .build();
    const uploadRes = await sendSorobanTx(server, uploadTx, issuer, 'Upload WASM');
    wasmUploadTxHash = uploadRes.hash;

    const issuerAccDeploy = await server.getAccount(issuer.publicKey());
    const salt = crypto.randomBytes(32);
    const createContractTx = new TransactionBuilder(issuerAccDeploy, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.createCustomContract({
          address: Address.fromString(issuer.publicKey()),
          wasmHash,
          salt,
        })
      )
      .setTimeout(60)
      .build();
    const createRes = await sendSorobanTx(server, createContractTx, issuer, 'Deploy Contrato PagoAsegurao');
    deployTxHash = createRes.hash;
    if (!createRes.returnValue) {
      throw new Error('No se recibió el Address del contrato desplegado en returnValue');
    }
    contractId = Address.fromScVal(createRes.returnValue).toString();
    console.log(`  ★ Contract ID real en testnet: ${contractId}`);

    // Initialize contract with tPEN SAC
    const issuerAccInit = await server.getAccount(issuer.publicKey());
    const initTx = new TransactionBuilder(issuerAccInit, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: 'initialize',
          args: [Address.fromString(tokenContractId).toScVal()],
        })
      )
      .setTimeout(60)
      .build();
    const initRes = await sendSorobanTx(server, initTx, issuer, `Initialize PagoAsegurao(${ASSET_CODE} SAC)`);
    initTxHash = initRes.hash;
  }

  // 5. Real E2E Validation on Testnet: open_vault -> offline voucher -> relayer redeem -> double redeem rejected
  console.log('\n--- Paso 4: Validación E2E en vivo en Stellar Testnet ---');
  const signerBytes = StrKey.decodeEd25519PublicKey(clientKp.publicKey());
  const vaultExpiresAt = Math.floor(Date.now() / 1000) + 3 * 86400; // 3 days
  const maxPerVoucher = 300_000_000n; // S/ 30.00 (30 tPEN)
  const depositAmount = 1_000_000_000n; // S/ 100.00 (100 tPEN)

  const clientAccVault = await server.getAccount(clientKp.publicKey());
  const openVaultTx = new TransactionBuilder(clientAccVault, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: 'open_vault',
        args: [
          Address.fromString(clientKp.publicKey()).toScVal(),
          xdr.ScVal.scvBytes(signerBytes),
          nativeToScVal(depositAmount, { type: 'i128' }),
          nativeToScVal(BigInt(vaultExpiresAt), { type: 'u64' }),
          nativeToScVal(maxPerVoucher, { type: 'i128' }),
        ],
      })
    )
    .setTimeout(60)
    .build();
  const openVaultRes = await sendSorobanTx(server, openVaultTx, clientKp, 'open_vault (S/ 100.00 tPEN, tope S/ 30.00)');
  const openVaultTxHash = openVaultRes.hash;

  // Sign offline voucher (S/ 15.00 = 15 tPEN)
  const voucherAmount = 150_000_000n; // S/ 15.00
  const voucherNonce = BigInt(Date.now());
  const voucherExpiry = BigInt(vaultExpiresAt);

  const canonicalMsg = buildCanonicalMessage(
    contractId,
    signerBytes,
    merchantKp.publicKey(),
    voucherAmount,
    voucherNonce,
    voucherExpiry
  );
  const signature = clientKp.sign(canonicalMsg);
  console.log(`  ✓ Vale offline firmado (${canonicalMsg.length} bytes canónicos, firma Ed25519 de ${signature.length} bytes).`);

  // Merchant balance before redeem
  const merchantBalBefore = await getTokenBalance(merchantKp.publicKey(), ASSET_CODE, issuer.publicKey());

  // Relayer submits redeem (real fee sponsorship — merchant pays 0 XLM!)
  const voucherScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('amount'), val: nativeToScVal(voucherAmount, { type: 'i128' }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('expiry'), val: nativeToScVal(voucherExpiry, { type: 'u64' }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('merchant'), val: Address.fromString(merchantKp.publicKey()).toScVal() }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('nonce'), val: nativeToScVal(voucherNonce, { type: 'u64' }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('signer'), val: xdr.ScVal.scvBytes(signerBytes) }),
  ]);

  const relayerAcc = await server.getAccount(relayer.publicKey());
  const redeemTx = new TransactionBuilder(relayerAcc, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: 'redeem',
        args: [voucherScVal, xdr.ScVal.scvBytes(signature)],
      })
    )
    .setTimeout(60)
    .build();
  const redeemRes = await sendSorobanTx(server, redeemTx, relayer, 'redeem patrocinado por Relayer (S/ 15.00 tPEN)');
  const redeemTxHash = redeemRes.hash;

  // Verify on-chain state after redeem
  const merchantBalAfter = await getTokenBalance(merchantKp.publicKey(), ASSET_CODE, issuer.publicKey());
  console.log(`  ✓ Saldo comercio en Horizon: S/ ${merchantBalBefore} -> S/ ${merchantBalAfter} (${ASSET_CODE})`);
  if (Number(merchantBalAfter) - Number(merchantBalBefore) !== 15) {
    throw new Error(`El saldo del comercio no aumentó en 15 ${ASSET_CODE} (${merchantBalBefore} -> ${merchantBalAfter})`);
  }

  // Verify get_vault on-chain
  const relayerAccRead = await server.getAccount(relayer.publicKey());
  const getVaultTx = new TransactionBuilder(relayerAccRead, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: 'get_vault',
        args: [xdr.ScVal.scvBytes(signerBytes)],
      })
    )
    .setTimeout(30)
    .build();
  const vaultSim = await server.simulateTransaction(getVaultTx);
  if (!rpc.Api.isSimulationSuccess(vaultSim) || !vaultSim.result) {
    throw new Error('Error leyendo get_vault tras redeem');
  }
  const vaultNative = scValToNative(vaultSim.result.retval);
  console.log(`  ✓ Saldo bóveda on-chain restante: S/ ${Number(vaultNative.balance) / 1e7} ${ASSET_CODE} (esperado: 85)`);
  if (BigInt(vaultNative.balance) !== 850_000_000n) {
    throw new Error(`Saldo inesperado en bóveda: ${vaultNative.balance}`);
  }

  // Verify double redeem is rejected with Error(Contract, #1)
  const doubleRedeemTx = new TransactionBuilder(relayerAccRead, {
    fee: '10000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: 'redeem',
        args: [voucherScVal, xdr.ScVal.scvBytes(signature)],
      })
    )
    .setTimeout(30)
    .build();
  const doubleSim = await server.simulateTransaction(doubleRedeemTx);
  if (!rpc.Api.isSimulationError(doubleSim) || !doubleSim.error.includes('#1')) {
    throw new Error(`Doble canje debía fallar con #1, resultado: ${JSON.stringify(doubleSim)}`);
  }
  console.log(`  ✓ Doble canje rechazado en simulación on-chain: Error(Contract, #1) AlreadyRedeemed.`);

  const deployment = {
    network: 'testnet',
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    horizonUrl: HORIZON_URL,
    assetCode: ASSET_CODE,
    assetSymbol: ASSET_SYMBOL,
    issuer: issuer.publicKey(),
    tokenContractId,
    contractId,
    wasmHash: wasmHash.toString('hex'),
    relayerAccount: relayer.publicKey(),
    clientAccount: clientKp.publicKey(),
    merchantAccount: merchantKp.publicKey(),
    createdAt: new Date().toISOString(),
    transactions: {
      sacDeploy: sacTxHash || undefined,
      wasmUpload: wasmUploadTxHash || undefined,
      contractDeploy: deployTxHash || undefined,
      contractInit: initTxHash || undefined,
      openVault: openVaultTxHash,
      redeem: redeemTxHash,
    },
    links: {
      contract: `https://stellar.expert/explorer/testnet/contract/${contractId}`,
      token: `https://stellar.expert/explorer/testnet/contract/${tokenContractId}`,
      issuer: `https://stellar.expert/explorer/testnet/account/${issuer.publicKey()}`,
      relayer: `https://stellar.expert/explorer/testnet/account/${relayer.publicKey()}`,
      client: `https://stellar.expert/explorer/testnet/account/${clientKp.publicKey()}`,
      merchant: `https://stellar.expert/explorer/testnet/account/${merchantKp.publicKey()}`,
      openVaultTx: `https://stellar.expert/explorer/testnet/tx/${openVaultTxHash}`,
      redeemTx: `https://stellar.expert/explorer/testnet/tx/${redeemTxHash}`,
    },
  };

  const json = JSON.stringify(deployment, null, 2) + '\n';
  fs.writeFileSync(OUT_FILE, json);
  fs.writeFileSync(APP_PUBLIC_DEPLOYMENT, json);

  // Write local gitignored .env for local dev & Vercel env configuration
  const envContents = [
    '# Generado por scripts/setup-testnet.ts (NO commitear - protegido por .gitignore)',
    `STELLAR_RPC_URL=${RPC_URL}`,
    `STELLAR_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}`,
    `ASSET_CODE=${ASSET_CODE}`,
    `CONTRACT_ID=${contractId}`,
    `TOKEN_CONTRACT_ID=${tokenContractId}`,
    `TOKEN_ISSUER=${issuer.publicKey()}`,
    `ISSUER_SECRET=${issuer.secret()}`,
    `RELAYER_SECRET=${relayer.secret()}`,
    '',
  ].join('\n');
  fs.writeFileSync(LOCAL_ENV_FILE, envContents);

  console.log('\n============================================================');
  console.log(`DESPLIEGUE ${ASSET_CODE} (${ASSET_SYMBOL}) Y VALIDACIÓN E2E COMPLETADOS`);
  console.log('============================================================');
  console.log(`Contrato PagoAsegurao: ${deployment.links.contract}`);
  console.log(`Token ${ASSET_CODE} (SAC):     ${deployment.links.token}`);
  console.log(`Tx open_vault:         ${deployment.links.openVaultTx}`);
  console.log(`Tx redeem (Relayer):   ${deployment.links.redeemTx}`);
  console.log(`Config pública:        ${OUT_FILE}`);
  console.log(`Secrets locales:       ${LOCAL_ENV_FILE} (gitignored)`);
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('\nError fatal en setup-testnet:', err);
  process.exit(1);
});
