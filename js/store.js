// Patient records live in this browser's IndexedDB, on this device only.
import { todayIso } from './dom.js';

const DB_NAME = 'thsc-cardiac-rehab';
const STORE = 'patients';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const listPatients = () => run('readonly', (s) => s.getAll());
export const getPatient = (id) => run('readonly', (s) => s.get(id));
export const deletePatient = (id) => run('readwrite', (s) => s.delete(id));
export function savePatient(p) {
  p.updated = new Date().toISOString();
  return run('readwrite', (s) => s.put(p));
}

export function newPatient() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}${Math.random().toString(16).slice(2)}`,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    fields: { pt_date: todayIso() },
    signatures: {},
  };
}

export async function importPatients(list) {
  let n = 0;
  for (const p of list) {
    if (!p || typeof p.id !== 'string' || typeof p.fields !== 'object') continue;
    await run('readwrite', (s) => s.put({ signatures: {}, ...p }));
    n++;
  }
  return n;
}
