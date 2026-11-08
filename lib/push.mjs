// Phone notifications for doctors (Web Push).
// Works on Android (Chrome) and on iPhone (iOS 16.4+) once the dashboard is added to the Home Screen.
// VAPID keys are created on first use and kept in storage, so nothing needs configuring.
import crypto from 'node:crypto';
import webpush from 'web-push';
import { getStore } from './store.mjs';

let vapid = null;
export async function vapidKeys() {
  if (vapid) return vapid;
  if (process.env.AMAN_VAPID_PUBLIC && process.env.AMAN_VAPID_PRIVATE) {
    vapid = { publicKey: process.env.AMAN_VAPID_PUBLIC, privateKey: process.env.AMAN_VAPID_PRIVATE };
    return vapid;
  }
  const s = await getStore();
  let k = await s.get('config/vapid');
  if (!k) { k = webpush.generateVAPIDKeys(); await s.set('config/vapid', k); }
  vapid = k;
  return vapid;
}

const subKey = (doctorId, endpoint) => `push/${doctorId}/${crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 24)}`;

export async function saveSubscription(doctorId, sub, userAgent = '') {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return false;
  const s = await getStore();
  await s.set(subKey(doctorId, sub.endpoint), { endpoint: sub.endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, ua: String(userAgent).slice(0, 160), at: new Date().toISOString() });
  return true;
}
export async function removeSubscription(doctorId, endpoint) {
  await (await getStore()).del(subKey(doctorId, String(endpoint || '')));
}
export async function countSubscriptions(doctorId) {
  return (await (await getStore()).list(`push/${doctorId}/`)).length;
}

// Tests replace this to avoid network calls.
let sender = (sub, payload, options) => webpush.sendNotification(sub, payload, options);
export function setPushSender(fn) { sender = fn; }

/** Send to every device the doctor enabled. Never throws; returns how many were delivered. */
export async function pushToDoctor(doctorId, message) {
  try {
    const s = await getStore();
    const keys = await s.list(`push/${doctorId}/`);
    if (!keys.length) return 0;
    const k = await vapidKeys();
    const options = { TTL: 3600, urgency: 'high', timeout: 5000, vapidDetails: { subject: 'mailto:aman-demo@example.com', publicKey: k.publicKey, privateKey: k.privateKey } };
    const payload = JSON.stringify(message);
    let ok = 0;
    await Promise.allSettled(keys.map(async (key) => {
      const sub = await s.get(key);
      if (!sub) return;
      try { await sender(sub, payload, options); ok++; } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) await s.del(key); // device unsubscribed
      }
    }));
    return ok;
  } catch (e) {
    console.error('push', e);
    return 0;
  }
}
