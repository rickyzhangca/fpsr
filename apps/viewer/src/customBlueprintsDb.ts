import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const DB_NAME = "fpsr-viewer";
const DB_VERSION = 1;
const STORE_NAME = "custom-blueprints";

export interface CustomBlueprintRecord {
  id: string;
  raw: string;
  createdAt: number;
}

interface FpsrViewerDb extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: CustomBlueprintRecord;
    indexes: { "by-createdAt": number };
  };
}

let dbPromise: Promise<IDBPDatabase<FpsrViewerDb>> | null = null;

function getDb(): Promise<IDBPDatabase<FpsrViewerDb>> {
  if (!dbPromise) {
    dbPromise = openDB<FpsrViewerDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("by-createdAt", "createdAt");
      },
    });
  }
  return dbPromise;
}

export async function listCustoms(): Promise<CustomBlueprintRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex(STORE_NAME, "by-createdAt");
}

export async function addCustom(raw: string): Promise<CustomBlueprintRecord> {
  const record: CustomBlueprintRecord = {
    id: crypto.randomUUID(),
    raw,
    createdAt: Date.now(),
  };
  const db = await getDb();
  await db.put(STORE_NAME, record);
  return record;
}

export async function clearCustoms(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}
