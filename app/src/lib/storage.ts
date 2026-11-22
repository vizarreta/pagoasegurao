import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface PagoAseguraoDB extends DBSchema {
  keys: {
    key: string;
    value: { publicKey: string; secretKey: string };
  };
  vault: {
    key: string;
    value: { signer: string; balance: string; expiresAt: number; maxPerVoucher: string };
  };
  vouchers: {
    key: string;
    value: { signer: string; merchant: string; amount: string; nonce: string; expiry: string; signature: string; status: string };
  };
}

const DB_NAME = 'pagoasegurao';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<PagoAseguraoDB>> | null = null;

export async function getDb(): Promise<IDBPDatabase<PagoAseguraoDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PagoAseguraoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('keys');
        db.createObjectStore('vault');
        db.createObjectStore('vouchers');
      },
    });
  }
  return dbPromise;
}

export async function setItem<T extends keyof PagoAseguraoDB>(
  store: T,
  key: string,
  value: PagoAseguraoDB[T]['value']
): Promise<void> {
  const db = await getDb();
  await db.put(store, value, key);
}

export async function getItem<T extends keyof PagoAseguraoDB>(
  store: T,
  key: string
): Promise<PagoAseguraoDB[T]['value'] | undefined> {
  const db = await getDb();
  return db.get(store, key);
}

export async function deleteItem<T extends keyof PagoAseguraoDB>(
  store: T,
  key: string
): Promise<void> {
  const db = await getDb();
  await db.delete(store, key);
}

export async function getAllItems<T extends keyof PagoAseguraoDB>(
  store: T
): Promise<PagoAseguraoDB[T]['value'][]> {
  const db = await getDb();
  return db.getAll(store);
}
