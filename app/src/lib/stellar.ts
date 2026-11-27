import {
  Keypair,
  Address,
  Asset,
  StrKey,
  Networks,
  Operation,
  TransactionBuilder,
  Account,
  rpc,
  xdr,
  nativeToScVal,
  scValToNative,
} from '@stellar/stellar-sdk';
import testnetDeployment from '../../../deployments/testnet.json';
import { CONTRACT_ERROR_MAP } from '../../../api/_errors';

// Fallback configuration matching public testnet deployment (never secrets)
const DEFAULT_DEPLOYMENT = {
  networkPassphrase: Networks.TESTNET,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  assetCode: 'tPEN',
  assetSymbol: 'S/',
  issuer: 'GDX4ZNACYNYJFY2QK6P7BKSF5UTDUYFY6J5VLRHMEN2H76KSN6N3AWYL',
  tokenContractId: 'CDUBDTM5Z3Y3OKKQ5BIKEP4XHW2WTHS6AUB4N2LMN6TOZQDAL2WPX5HF',
  contractId: 'CAWJ3NQHILVST2RHVNSIOSQFRJXXZY7KSBEZZXWGMBOHZ7OVQKQ6GQPT',
  relayerAccount: 'GDTAPYWCT4VCDKAQ7NUI6E5NQ6DYXDX5AV7OUF7ACQ6JO575ZMRPKBQV',
  explorerBase: 'https://stellar.expert/explorer/testnet',
};

const d = (testnetDeployment || {}) as Record<string, any>;

export const NETWORK_PASSPHRASE = d.networkPassphrase || DEFAULT_DEPLOYMENT.networkPassphrase;
export const RPC_URL = d.rpcUrl || DEFAULT_DEPLOYMENT.rpcUrl;
export const HORIZON_URL = d.horizonUrl || DEFAULT_DEPLOYMENT.horizonUrl;

export const TESTNET_CONFIG = {
  networkPassphrase: NETWORK_PASSPHRASE,
  rpcUrl: RPC_URL,
  horizonUrl: HORIZON_URL,
  assetCode: d.assetCode || DEFAULT_DEPLOYMENT.assetCode,
  assetSymbol: d.assetSymbol || DEFAULT_DEPLOYMENT.assetSymbol,
  issuer: d.issuer || DEFAULT_DEPLOYMENT.issuer,
  tokenContractId: d.tokenContractId || DEFAULT_DEPLOYMENT.tokenContractId,
  contractId: d.contractId || DEFAULT_DEPLOYMENT.contractId,
  relayerAccount: d.relayerAccount || DEFAULT_DEPLOYMENT.relayerAccount,
  explorerBase: DEFAULT_DEPLOYMENT.explorerBase,
};

export function mapSorobanError(raw: string): string {
  const match = raw.match(/Error\(Contract,\s*#(\d+)\)/i);
  if (match) {
    const code = Number(match[1]);
    return CONTRACT_ERROR_MAP[code] || `Error del contrato Soroban (#${code}).`;
  }
  if (/insufficient balance|underfunded|op_underfunded/i.test(raw)) {
    return `Saldo insuficiente de Soles (${TESTNET_CONFIG.assetCode}) en tu cuenta para apartar ese monto.`;
  }
  if (/trustline|op_no_trust/i.test(raw)) {
    return `Primero activa tu cuenta para crear la línea de confianza de Soles (${TESTNET_CONFIG.assetCode}).`;
  }
  return raw;
}

/**
 * Parses a decimal string like "12.5" or "12,50" into exact 7-decimal stroops (BigInt) without floats.
 */
export function parseAmountToStroops(input: string): bigint | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,7})?$/.test(normalized)) return null;
  const [wholeStr, fracStr = ''] = normalized.split('.');
  const paddedFrac = fracStr.padEnd(7, '0');
  const total = BigInt(wholeStr) * 10_000_000n + BigInt(paddedFrac);
  return total > 0n ? total : null;
}

/**
 * Formats 7-decimal stroops (BigInt or numeric string) cleanly with 2 decimals (no float rounding issues).
 */
export function formatStroops(stroops: string | bigint | number): string {
  const val = typeof stroops === 'bigint' ? stroops : BigInt(stroops);
  const negative = val < 0n;
  const abs = negative ? -val : val;
  const whole = abs / 10_000_000n;
  const frac = (abs % 10_000_000n).toString().padStart(7, '0');
  const twoDec = frac.slice(0, 2);
  const extra = frac.slice(2).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}.${twoDec}${extra}`;
}

export function formatSoles(stroops: string | bigint | number): string {
  return `${TESTNET_CONFIG.assetSymbol} ${formatStroops(stroops)}`;
}

export function keypairFromSecret(secret: string): Keypair {
  return Keypair.fromSecret(secret);
}

export function randomKeypair(): Keypair {
  return Keypair.random();
}

export function publicKeyToStrKey(publicKey: Buffer | Uint8Array): string {
  return StrKey.encodeEd25519PublicKey(Buffer.from(publicKey));
}

export function strKeyToPublicKey(strKey: string): Uint8Array {
  return StrKey.decodeEd25519PublicKey(strKey);
}

export function addressToXdr(address: string): Buffer {
  const addr = Address.fromString(address);
  return Buffer.from(addr.toScVal().toXDR());
}

export function i128ToBeBytes(amount: bigint): Buffer {
  const buf = Buffer.alloc(16);
  let v = BigInt.asIntN(128, amount);
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(BigInt.asUintN(8, v & 0xffn));
    v >>= 8n;
  }
  return buf;
}

export function u64ToBeBytes(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  let v = BigInt.asUintN(64, BigInt(value));
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

export function buildCanonicalMessage(
  contractAddress: string,
  signerPublicKey: Uint8Array,
  merchantAddress: string,
  amount: bigint,
  nonce: number | bigint,
  expiry: number | bigint
): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from('PAGOASEGURAO1', 'ascii'));
  parts.push(addressToXdr(contractAddress));
  parts.push(Buffer.from(signerPublicKey));
  parts.push(addressToXdr(merchantAddress));
  parts.push(i128ToBeBytes(amount));
  parts.push(u64ToBeBytes(nonce));
  parts.push(u64ToBeBytes(expiry));
  return Buffer.concat(parts);
}

export function signMessage(keypair: Keypair, message: Buffer | Uint8Array): Buffer {
  return Buffer.from(keypair.sign(Buffer.from(message)));
}

export function verifySignature(
  publicKey: Uint8Array,
  message: Buffer | Uint8Array,
  signature: Buffer | Uint8Array
): boolean {
  try {
    const strKey = StrKey.encodeEd25519PublicKey(Buffer.from(publicKey));
    const kp = Keypair.fromPublicKey(strKey);
    return kp.verify(Buffer.from(message), Buffer.from(signature));
  } catch {
    return false;
  }
}

export interface AccountBalances {
  exists: boolean;
  xlm: string;
  balance: string;
  hasTrustline: boolean;
}

export async function fetchAccountBalances(publicKey: string): Promise<AccountBalances> {
  const res = await fetch(`${TESTNET_CONFIG.horizonUrl}/accounts/${publicKey}`);
  if (res.status === 404) {
    return { exists: false, xlm: '0', balance: '0', hasTrustline: false };
  }
  if (!res.ok) {
    throw new Error(`Horizon error (${res.status})`);
  }
  const data = (await res.json()) as {
    balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }>;
  };
  const native = data.balances.find((b) => b.asset_type === 'native');
  const token = data.balances.find(
    (b) => b.asset_code === TESTNET_CONFIG.assetCode && b.asset_issuer === TESTNET_CONFIG.issuer
  );
  return {
    exists: true,
    xlm: native ? native.balance : '0',
    balance: token ? token.balance : '0',
    hasTrustline: Boolean(token),
  };
}

async function waitForTx(server: rpc.Server, hash: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const txStatus = await server.getTransaction(hash);
    if (txStatus.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (txStatus.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`La transacción falló en Stellar Testnet (tx: ${hash}).`);
    }
  }
  throw new Error(`Tiempo de espera agotado confirmando la transacción (${hash}).`);
}

export async function ensureTrustlineOnChain(keypair: Keypair): Promise<string | null> {
  const bal = await fetchAccountBalances(keypair.publicKey());
  if (bal.hasTrustline) return null;

  const server = new rpc.Server(TESTNET_CONFIG.rpcUrl);
  const account = await server.getAccount(keypair.publicKey());
  const asset = new Asset(TESTNET_CONFIG.assetCode, TESTNET_CONFIG.issuer);

  const tx = new TransactionBuilder(account, {
    fee: '10000',
    networkPassphrase: TESTNET_CONFIG.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset, limit: '1000000' }))
    .setTimeout(60)
    .build();

  tx.sign(keypair);
  const sendRes = await server.sendTransaction(tx);
  if (sendRes.status === 'ERROR') {
    throw new Error(`No se pudo crear la línea de confianza (trustline) de ${TESTNET_CONFIG.assetCode} en testnet.`);
  }
  return waitForTx(server, sendRes.hash);
}

export async function activateAccountWithFaucet(
  keypair: Keypair,
  mintToken: boolean
): Promise<{
  balances: AccountBalances;
  txHash?: string;
  message: string;
}> {
  const res1 = await fetch('/api/faucet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: keypair.publicKey(), mintToken }),
  });
  const data1 = await res1.json();
  if (!res1.ok || !data1.ok) {
    throw new Error(data1.error || 'No se pudo contactar al faucet de Stellar Testnet.');
  }

  if (!data1.hasTrustline) {
    await ensureTrustlineOnChain(keypair);
  }

  if (mintToken && !data1.fundedToken) {
    const res2 = await fetch('/api/faucet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: keypair.publicKey(), mintToken: true }),
    });
    const data2 = await res2.json();
    if (!res2.ok || !data2.ok) {
      throw new Error(data2.error || 'Error enviando Soles de prueba (tPEN).');
    }
    const balances = await fetchAccountBalances(keypair.publicKey());
    return {
      balances,
      txHash: data2.hash,
      message: data2.message || '¡S/ 200.00 (tPEN de prueba) acreditados en Stellar Testnet!',
    };
  }

  const balances = await fetchAccountBalances(keypair.publicKey());
  return {
    balances,
    txHash: data1.hash,
    message: data1.message || 'Cuenta activa y lista en Stellar Testnet.',
  };
}

async function submitSorobanContractCall(
  keypair: Keypair,
  functionName: string,
  args: xdr.ScVal[]
): Promise<string> {
  const server = new rpc.Server(TESTNET_CONFIG.rpcUrl);
  const account = await server.getAccount(keypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: TESTNET_CONFIG.networkPassphrase,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: TESTNET_CONFIG.contractId,
        function: functionName,
        args,
      })
    )
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(mapSorobanError(sim.error || 'Error en simulación de Soroban'));
  }

  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const sendRes = await server.sendTransaction(prepared);
  if (sendRes.status === 'ERROR') {
    throw new Error('Stellar Testnet rechazó la transacción. Intenta nuevamente.');
  }

  return waitForTx(server, sendRes.hash);
}

export async function openVaultOnChain(
  keypair: Keypair,
  amountStroops: bigint,
  expiresAtSec: number,
  maxPerVoucherStroops: bigint
): Promise<string> {
  const signerBytes = strKeyToPublicKey(keypair.publicKey());
  return submitSorobanContractCall(keypair, 'open_vault', [
    Address.fromString(keypair.publicKey()).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(signerBytes)),
    nativeToScVal(amountStroops, { type: 'i128' }),
    nativeToScVal(BigInt(expiresAtSec), { type: 'u64' }),
    nativeToScVal(maxPerVoucherStroops, { type: 'i128' }),
  ]);
}

export async function topUpVaultOnChain(keypair: Keypair, amountStroops: bigint): Promise<string> {
  const signerBytes = strKeyToPublicKey(keypair.publicKey());
  return submitSorobanContractCall(keypair, 'top_up', [
    Address.fromString(keypair.publicKey()).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(signerBytes)),
    nativeToScVal(amountStroops, { type: 'i128' }),
  ]);
}

export async function closeVaultOnChain(keypair: Keypair): Promise<string> {
  const signerBytes = strKeyToPublicKey(keypair.publicKey());
  return submitSorobanContractCall(keypair, 'close_vault', [
    Address.fromString(keypair.publicKey()).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(signerBytes)),
  ]);
}

export interface RemoteVaultResponse {
  ok: boolean;
  exists: boolean;
  vault: {
    owner: string;
    balance: string;
    expiresAt: number;
    maxPerVoucher: string;
  } | null;
  balances: AccountBalances;
  syncedAt: number;
}

export async function fetchVaultFromRelayer(signerPublicKey: string): Promise<RemoteVaultResponse> {
  const res = await fetch(`/api/vault/${encodeURIComponent(signerPublicKey)}`);
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'No se pudo consultar la bóveda en Stellar Testnet.');
  }
  return data as RemoteVaultResponse;
}

export async function checkVoucherRedeemedOnChain(
  signerPublicKey: string,
  nonce: string | bigint
): Promise<boolean | null> {
  try {
    const server = new rpc.Server(TESTNET_CONFIG.rpcUrl);
    const signerBytes = strKeyToPublicKey(signerPublicKey);
    const dummyAcc = new Account(TESTNET_CONFIG.relayerAccount, '0');
    const tx = new TransactionBuilder(dummyAcc, {
      fee: '100',
      networkPassphrase: TESTNET_CONFIG.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: TESTNET_CONFIG.contractId,
          function: 'is_redeemed',
          args: [
            xdr.ScVal.scvBytes(Buffer.from(signerBytes)),
            nativeToScVal(BigInt(nonce), { type: 'u64' }),
          ],
        })
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      return Boolean(scValToNative(sim.result.retval));
    }
    return null;
  } catch {
    return null;
  }
}
