import { rpc, StrKey, xdr, Account, TransactionBuilder, Operation, Networks, scValToNative } from '@stellar/stellar-sdk';

// Public testnet deployment defaults for tPEN (Peruvian Soles test asset — never secrets)
export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';
export const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const DEFAULT_CONTRACT_ID = 'CAWJ3NQHILVST2RHVNSIOSQFRJXXZY7KSBEZZXWGMBOHZ7OVQKQ6GQPT';
export const DEFAULT_TOKEN_CONTRACT_ID = 'CDUBDTM5Z3Y3OKKQ5BIKEP4XHW2WTHS6AUB4N2LMN6TOZQDAL2WPX5HF';
export const DEFAULT_TOKEN_ISSUER = 'GDX4ZNACYNYJFY2QK6P7BKSF5UTDUYFY6J5VLRHMEN2H76KSN6N3AWYL';
export const DEFAULT_RELAYER_PUBLIC = 'GDTAPYWCT4VCDKAQ7NUI6E5NQ6DYXDX5AV7OUF7ACQ6JO575ZMRPKBQV';
export const ASSET_CODE = 'tPEN';
export const ASSET_SYMBOL = 'S/';

export function getConfig() {
  return {
    rpcUrl: process.env.STELLAR_RPC_URL || DEFAULT_RPC_URL,
    horizonUrl: process.env.STELLAR_HORIZON_URL || DEFAULT_HORIZON_URL,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET,
    assetCode: process.env.ASSET_CODE || ASSET_CODE,
    contractId: process.env.CONTRACT_ID || DEFAULT_CONTRACT_ID,
    tokenContractId: process.env.TOKEN_CONTRACT_ID || DEFAULT_TOKEN_CONTRACT_ID,
    tokenIssuer: process.env.TOKEN_ISSUER || DEFAULT_TOKEN_ISSUER,
    relayerSecret: process.env.RELAYER_SECRET || '',
    issuerSecret: process.env.ISSUER_SECRET || '',
  };
}

export const CONTRACT_ERROR_MAP: Record<number, string> = {
  1: 'Este vale ya fue liquidado anteriormente (doble canje evitado).',
  2: 'El vale ha vencido o supera la fecha límite de la bóveda.',
  3: 'El monto del vale es inválido o supera el tope por compra autorizado.',
  4: 'Saldo insuficiente en la bóveda del cliente.',
  5: 'No se encontró una bóveda activa en Stellar para este cliente.',
  6: 'La bóveda aún no vence; espera a su fecha de expiración para cerrarla.',
  7: 'Ya existe una bóveda activa para esta cuenta.',
  8: 'Firma criptográfica inválida (el vale fue alterado).',
  9: 'No tienes autorización para modificar esta bóveda.',
  10: 'La fecha de vencimiento de la bóveda debe ser posterior a hoy.',
};

export function parseContractError(rawError: string): { code?: number; message: string } {
  const match = rawError.match(/Error\(Contract,\s*#(\d+)\)/i);
  if (match) {
    const code = Number(match[1]);
    return {
      code,
      message: CONTRACT_ERROR_MAP[code] || `Error del contrato Soroban (#${code}).`,
    };
  }
  if (/ed25519|signature|crypto|InvalidInput/i.test(rawError)) {
    return {
      code: 8,
      message: CONTRACT_ERROR_MAP[8],
    };
  }
  if (/trustline|op_no_trust|balance is not sufficient|missing trustline/i.test(rawError)) {
    return {
      message: 'La cuenta del comercio necesita tener la línea de confianza (trustline) de Soles de prueba (tPEN) activa.',
    };
  }
  return {
    message: 'El contrato rechazó el vale. Verifica que la bóveda exista, tenga saldo y el comercio esté activo.',
  };
}

export interface HorizonBalances {
  exists: boolean;
  xlm: string;
  balance: string;
  hasTrustline: boolean;
}

export async function fetchHorizonBalances(
  accountPubKey: string,
  issuerPubKey: string,
  horizonUrl = DEFAULT_HORIZON_URL,
  assetCode = ASSET_CODE
): Promise<HorizonBalances> {
  try {
    const res = await fetch(`${horizonUrl}/accounts/${accountPubKey}`);
    if (res.status === 404) {
      return { exists: false, xlm: '0', balance: '0', hasTrustline: false };
    }
    if (!res.ok) {
      throw new Error(`Horizon HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }>;
    };
    const native = data.balances.find((b) => b.asset_type === 'native');
    const token = data.balances.find((b) => b.asset_code === assetCode && b.asset_issuer === issuerPubKey);
    return {
      exists: true,
      xlm: native ? native.balance : '0',
      balance: token ? token.balance : '0',
      hasTrustline: Boolean(token),
    };
  } catch {
    return { exists: false, xlm: '0', balance: '0', hasTrustline: false };
  }
}

export async function waitForTransaction(
  server: rpc.Server,
  hash: string,
  maxAttempts = 35
): Promise<{ status: 'SUCCESS' | 'FAILED'; hash: string; returnValue?: xdr.ScVal }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const txStatus = await server.getTransaction(hash);
    if (txStatus.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { status: 'SUCCESS', hash, returnValue: txStatus.returnValue };
    }
    if (txStatus.status === rpc.Api.GetTransactionStatus.FAILED) {
      return { status: 'FAILED', hash };
    }
  }
  throw new Error(`Tiempo agotado esperando confirmación en Stellar Testnet (tx: ${hash})`);
}

export async function checkIsRedeemedOnChain(
  server: rpc.Server,
  contractId: string,
  signerStrKey: string,
  nonce: bigint,
  sourcePubKey = DEFAULT_RELAYER_PUBLIC
): Promise<boolean> {
  try {
    const signerBytes = StrKey.decodeEd25519PublicKey(signerStrKey);
    const dummyAcc = new Account(sourcePubKey, '0');
    const tx = new TransactionBuilder(dummyAcc, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: 'is_redeemed',
          args: [
            xdr.ScVal.scvBytes(signerBytes),
            xdr.ScVal.scvU64(xdr.Uint64.fromString(nonce.toString())),
          ],
        })
      )
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
      return Boolean(scValToNative(sim.result.retval));
    }
    return false;
  } catch {
    return false;
  }
}
