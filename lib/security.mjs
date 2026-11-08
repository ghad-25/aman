import crypto from 'node:crypto';
import { getStore } from './store.mjs';

const B62 = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function randomId(len = 12) {
  let s = '';
  for (let i = 0; i < len; i++) s += B62[crypto.randomInt(B62.length)];
  return s;
}
export function randomPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

export function hashSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(secret), salt, 32).toString('hex');
  return `scrypt$${salt}$${h}`;
}
export function verifySecret(secret, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, h] = stored.split('$');
  const got = crypto.scryptSync(String(secret), salt, 32);
  const want = Buffer.from(h, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

let cachedKey = null;
async function signingKey() {
  if (process.env.AMAN_SESSION_SECRET && process.env.AMAN_SESSION_SECRET.length >= 16) return process.env.AMAN_SESSION_SECRET;
  if (cachedKey) return cachedKey;
  const store = await getStore();
  let cfg = await store.get('config/secret');
  if (!cfg) {
    cfg = { key: crypto.randomBytes(32).toString('hex'), createdAt: new Date().toISOString() };
    await store.set('config/secret', cfg);
  }
  cachedKey = cfg.key;
  return cachedKey;
}

const b64 = (s) => Buffer.from(s).toString('base64url');
export async function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', await signingKey()).update(body).digest('base64url');
  return `${body}.${mac}`;
}
export async function unsign(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', await signingKey()).update(body).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch { return null; }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
