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
}

export interface VoucherRecord {
  id: string;
  signer: string;
  merchant: string;
  amount: string;
  nonce: string;
  expiry: string;
  signature: string;
  status: 'pendiente' | 'liquidado' | 'rechazado';
  error?: string;
  txHash?: string;
  createdAt: number;
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
}

const DB_NAME = 'pagoasegurao';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<PagoAseguraoDB>> | null = null;

export async function getDb(): Promise<IDBPDatabase<PagoAseguraoDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PagoAseguraoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
        if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault');
        if (!db.objectStoreNames.contains('vouchers')) db.createObjectStore('vouchers');
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

export async function saveVault(key: string, record: VaultRecord): Promise<void> {
  const db = await getDb();
  await db.put('vault', record, key);
}

export async function getVault(key: string): Promise<VaultRecord | undefined> {
  const db = await getDb();
  return db.get('vault', key);
}

export async function saveVoucher(record: VoucherRecord): Promise<void> {
  const db = await getDb();
  await db.put('vouchers', record, record.id);
}

export async function getVouchers(): Promise<VoucherRecord[]> {
  const db = await getDb();
  return db.getAll('vouchers');
}

export async function updateVoucherStatus(
  id: string,
  status: VoucherRecord['status'],
  txHash?: string,
  error?: string
): Promise<void> {
  const db = await getDb();
  const v = await db.get('vouchers', id);
  if (v) {
    v.status = status;
    if (txHash) v.txHash = txHash;
    if (error) v.error = error;
    await db.put('vouchers', v, id);
  }
}
