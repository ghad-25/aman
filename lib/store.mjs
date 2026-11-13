// Key-value JSON storage.
// On Netlify: Netlify Blobs (no setup needed, shared by all visitors).
// Locally (npm run dev / npm test): JSON files under .data/ (or memory for tests).
import { promises as fs } from 'node:fs';
import path from 'node:path';

let storePromise = null;

function onNetlify() {
  return Boolean(globalThis.Netlify || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY || process.env.AMAN_STORE === 'blobs');
}

// Netlify gives each request a short-lived Blobs token. Never keep a Blobs client between
// requests: a warm function instance would reuse an expired token ("Token expired").
// So every operation asks Netlify for a fresh client (cheap, no network call).
let blobsModule = null;
async function blobsStore() {
  if (!blobsModule) blobsModule = await import('@netlify/blobs');
  const fresh = () => blobsModule.getStore({ name: 'aman', consistency: 'strong' });
  return {
    kind: 'blobs',
    async get(key) { return (await fresh().get(key, { type: 'json' })) ?? null; },
    async set(key, val) { await fresh().setJSON(key, val); },
    async del(key) { await fresh().delete(key); },
    async list(prefix) {
      const res = await fresh().list({ prefix, paginate: false });
      return (res.blobs || []).map((b) => b.key);
    },
  };
}

function memoryStore() {
  const m = new Map();
  return {
    kind: 'memory',
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : null; },
    async set(k, v) { m.set(k, structuredClone(v)); },
    async del(k) { m.delete(k); },
    async list(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

function fileStore(dir) {
  const enc = (k) => encodeURIComponent(k) + '.json';
  const dec = (f) => decodeURIComponent(f.replace(/\.json$/, ''));
  return {
    kind: 'file',
    async get(k) {
      try { return JSON.parse(await fs.readFile(path.join(dir, enc(k)), 'utf8')); } catch { return null; }
    },
    async set(k, v) {
      await fs.mkdir(dir, { recursive: true });
      const f = path.join(dir, enc(k));
      await fs.writeFile(f + '.tmp', JSON.stringify(v));
      await fs.rename(f + '.tmp', f);
    },
    async del(k) { try { await fs.unlink(path.join(dir, enc(k))); } catch { /* gone */ } },
    async list(prefix) {
      try { return (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).map(dec).filter((k) => k.startsWith(prefix)); } catch { return []; }
    },
  };
}

export function getStore() {
  if (!storePromise) {
    if (process.env.AMAN_STORE === 'memory') storePromise = Promise.resolve(memoryStore());
    else if (onNetlify()) storePromise = blobsStore();
    else storePromise = Promise.resolve(fileStore(process.env.AMAN_DATA_DIR || path.resolve('.data')));
  }
  return storePromise;
}

export function resetStoreForTests() { storePromise = null; }
