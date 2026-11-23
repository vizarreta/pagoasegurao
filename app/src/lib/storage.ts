import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface KeyRecord {
  publicKey: string;
  secretKey: string;
}

export interface VaultRecord {
  signer: string;
  owner: string;
  balance: string;
  expiresAt: number;
  maxPerVoucher: string;
  openTxHash?: string;
  lastSyncedAt?: number;
}

export interface VoucherRecord {
  id: string;
  signer: string;
  merchant: string;
  amount: string;
  nonce: string;
  expiry: string;
  signature: string;
  qrString?: string;
  status: 'pendiente' | 'liquidado' | 'rechazado';
  error?: string;
  txHash?: string;
  createdAt: number;
}

export interface CachedVaultRecord {
  signer: string;
  exists: boolean;
  balance: string;
  expiresAt: number;
  maxPerVoucher: string;
  syncedAt: number;
}

interface PagoAseguraoDB extends DBSchema {
  keys: {
    key: string;
    value: KeyRecord;
  };
  vault: {
    key: string;
    value: VaultRecord;
  };
  vouchers: {
    key: string;
    value: VoucherRecord;
  };
  client_vouchers: {
    key: string;
    value: VoucherRecord;
  };
  merchant_vouchers: {
    key: string;
    value: VoucherRecord;
  };
  vault_cache: {
    key: string;
    value: CachedVaultRecord;
  };
}

const DB_NAME = 'pagoasegurao';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<PagoAseguraoDB>> | null = null;

export async function getDb(): Promise<IDBPDatabase<PagoAseguraoDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PagoAseguraoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
        if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault');
        if (!db.objectStoreNames.contains('vouchers')) db.createObjectStore('vouchers');
        if (!db.objectStoreNames.contains('client_vouchers')) db.createObjectStore('client_vouchers');
        if (!db.objectStoreNames.contains('merchant_vouchers')) db.createObjectStore('merchant_vouchers');
        if (!db.objectStoreNames.contains('vault_cache')) db.createObjectStore('vault_cache');
      },
    });
  }
  return dbPromise;
}

export async function saveKeys(key: string, record: KeyRecord): Promise<void> {
  const db = await getDb();
  await db.put('keys', record, key);
}

export async function getKeys(key: string): Promise<KeyRecord | undefined> {
  const db = await getDb();
  return db.get('keys', key);
}

export async function deleteKeys(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('keys', key);
}

export async function saveVault(key: string, record: VaultRecord): Promise<void> {
  const db = await getDb();
  await db.put('vault', record, key);
}

export async function getVault(key: string): Promise<VaultRecord | undefined> {
  const db = await getDb();
  return db.get('vault', key);
}

export async function deleteVault(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('vault', key);
}

export async function saveClientVoucher(record: VoucherRecord): Promise<void> {
  const db = await getDb();
  await db.put('client_vouchers', record, record.id);
}

export async function getClientVouchers(): Promise<VoucherRecord[]> {
  const db = await getDb();
  return db.getAll('client_vouchers');
}

export async function clearClientVouchers(): Promise<void> {
  const db = await getDb();
  await db.clear('client_vouchers');
}

export async function saveMerchantVoucher(record: VoucherRecord): Promise<void> {
  const db = await getDb();
  await db.put('merchant_vouchers', record, record.id);
}

export async function getMerchantVouchers(): Promise<VoucherRecord[]> {
  const db = await getDb();
  return db.getAll('merchant_vouchers');
}

export async function hasMerchantVoucher(signer: string, nonce: string): Promise<boolean> {
  const all = await getMerchantVouchers();
  return all.some((v) => v.signer === signer && v.nonce === nonce);
}

export async function updateMerchantVoucherStatus(
  id: string,
  status: VoucherRecord['status'],
  txHash?: string,
  error?: string
): Promise<void> {
  const db = await getDb();
  const v = await db.get('merchant_vouchers', id);
  if (v) {
    v.status = status;
    if (txHash) v.txHash = txHash;
    v.error = error;
    await db.put('merchant_vouchers', v, id);
  }
}

export async function clearMerchantVouchers(): Promise<void> {
  const db = await getDb();
  await db.clear('merchant_vouchers');
}

export async function saveVaultCache(record: CachedVaultRecord): Promise<void> {
  const db = await getDb();
  await db.put('vault_cache', record, record.signer);
}

export async function getVaultCache(signer: string): Promise<CachedVaultRecord | undefined> {
  const db = await getDb();
  return db.get('vault_cache', signer);
}
