// Key-value JSON storage.
// On Netlify: Netlify Blobs (no setup needed, shared by all visitors).
// Locally (npm run dev / npm test): JSON files under .data/ (or memory for tests).
import { promises as fs } from 'node:fs';
import path from 'node:path';

let storePromise = null;

function onNetlify() {
  return Boolean(globalThis.Netlify || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY || process.env.AMAN_STORE === 'blobs');
}

async function blobsStore() {
  const { getStore } = await import('@netlify/blobs');
  const s = getStore({ name: 'aman', consistency: 'strong' });
  return {
    kind: 'blobs',
    async get(key) { return (await s.get(key, { type: 'json' })) ?? null; },
    async set(key, val) { await s.setJSON(key, val); },
    async del(key) { await s.delete(key); },
    async list(prefix) {
      const out = [];
      let res = await s.list({ prefix, paginate: false });
      for (const b of res.blobs || []) out.push(b.key);
      return out;
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
