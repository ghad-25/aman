// AMAN API. One handler used by the Netlify Function and by the local dev server.
// handle(Request) -> Response
import { getStore } from './store.mjs';
import { randomId, randomPin, hashSecret, verifySecret, sign, unsign, parseCookies } from './security.mjs';
import { checkForPatient, patientView, cardLists, libraryFor, suggest, resolveMedKeys, didYouMean, medInfo, conditions as CONDS, RULE_IDS, stats, allergyLibrary, allergyLabel, allergyGroups, allergyLowRisk, REACTIONS, CERTAINTY } from './engine.mjs';
import { DEMO_DOCTOR, demoPatients, DEMO_BARCODES } from './demo.mjs';
import { parseBarcode, isExpired } from './gs1.mjs';
import { vapidKeys, saveSubscription, removeSubscription, countSubscriptions, pushToDoctor } from './push.mjs';

const SESSION_COOKIE = 'aman_s';
const SESSION_DAYS = 7;
const RECORD_MINUTES = 30;
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MIN = 15;
const STALE_DAYS = 180;
const EVENTS_CAP = 300;
const AUTO_ALERT_HOURS = 24;
const LEVEL_AR = { avoid: 'تجنّب', caution: 'بحذر', info: 'معلومة', none: 'لا تنبيه' };
const KIND_AR = { band: 'الإسوارة', wallet: 'البطاقة الرقمية' };

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const bad = (m, extra) => new HttpError(400, m, extra);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

const now = () => new Date().toISOString();
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const normEmail = (e) => str(e, 120).toLowerCase();
const VALID_CONDS = () => Object.keys(CONDS());

// ---------------- persistence helpers ----------------
async function S() { return getStore(); }
async function getDoctor(id) { return (await S()).get(`doctors/${id}`); }
async function getPatient(id) { return (await S()).get(`patients/${id}`); }
async function savePatient(p) { p.updatedAt = now(); await (await S()).set(`patients/${p.id}`, p); }

async function addEvent(patientId, ev) {
  const s = await S();
  const list = (await s.get(`events/${patientId}`)) || [];
  list.unshift({ id: randomId(8), at: now(), ...ev });
  await s.set(`events/${patientId}`, list.slice(0, EVENTS_CAP));
}

function cleanMeds(meds) {
  return (Array.isArray(meds) ? meds : []).slice(0, 30).map((m) => {
    const name = str(m.name, 120);
    return { name, dose: str(m.dose, 60), when: str(m.when, 120), keys: resolveMedKeys(name) };
  }).filter((m) => m.name);
}
// An allergy must be checkable: a family from the library, or a medicine name that resolves to exactly one key.
function cleanAllergy(input) {
  const lib = allergyLibrary();
  const group = lib.groups.some((g) => g.id === input.group) ? input.group : null;
  let key = null;
  const name = str(input.name, 80);
  if (name) {
    const keys = resolveMedKeys(name);
    if (keys.length !== 1) {
      const sug = didYouMean(name);
      throw bad(keys.length > 1 ? 'اكتب دواءً واحدًا.' : sug.length ? `ما عرفنا اسم الدواء. هل تقصد: ${sug.map((x) => x.ar).join('، ')}؟` : 'اسم الدواء غير موجود في مكتبة أمان. اختر نوع الحساسية من القائمة بدلًا منه.');
    }
    key = keys[0];
  }
  if (!group && !key) throw bad('اختر نوع الحساسية أو اكتب اسم الدواء الذي سببها.');
  const yr = str(input.year, 4);
  return {
    group, key, name,
    reaction: REACTIONS[input.reaction] ? input.reaction : 'unknown',
    year: /^(19|20)\d\d$/.test(yr) ? yr : '',
    certainty: CERTAINTY[input.certainty] ? input.certainty : 'reported',
    note: str(input.note, 200),
  };
}
function cleanAllergies(list) {
  const out = [];
  for (const a of (Array.isArray(list) ? list : []).slice(0, 12)) { try { out.push(cleanAllergy(a)); } catch { /* skip invalid */ } }
  return out;
}
const allergyView = (a) => ({ ...a, label: allergyLabel(a), drug: a.key ? medInfo(a.key) : null, groups: allergyGroups(a), reactionAr: (REACTIONS[a.reaction] || REACTIONS.unknown).short, certaintyAr: CERTAINTY[a.certainty] || CERTAINTY.reported, lowRisk: allergyLowRisk(a) });
function cleanContacts(list) {
  return (Array.isArray(list) ? list : []).slice(0, 4).map((c) => ({ name: str(c.name, 60), relation: str(c.relation, 60), phone: str(c.phone, 30) })).filter((c) => c.name || c.phone);
}

async function issueToken(patientId, kind, fixed) {
  const s = await S();
  const token = fixed || randomId(10);
  await s.set(`tokens/${token}`, { patientId, kind });
  return { token, active: true, issuedAt: now() };
}

async function createPatient(doctor, input, fixed = {}) {
  const s = await S();
  const id = fixed.id || 'p' + randomId(10);
  const pin = fixed.pin || randomPin();
  const conds = (input.conditions || []).filter((c) => VALID_CONDS().includes(c));
  if (!str(input.name)) throw bad('اكتب اسم المريض.');
  if (!conds.length) throw bad('اختر حالة واحدة على الأقل.');
  const p = {
    id, doctorId: doctor.id,
    name: str(input.name, 80), age: Math.max(0, Math.min(120, parseInt(input.age, 10) || 0)), sex: str(input.sex, 10) || '',
    conditions: conds,
    diagnosisNote: str(input.diagnosisNote, 200), diagnosisYear: str(input.diagnosisYear, 10),
    contacts: cleanContacts(input.contacts),
    doctorName: str(input.doctorName, 80) || doctor.name, doctorSpecialty: str(input.doctorSpecialty, 80) || doctor.specialty || '',
    doctorPhone: str(input.doctorPhone, 30) || doctor.phone || '',
    meds: cleanMeds(input.meds),
    history: { episodes: str(input.history?.episodes, 2000), treatments: str(input.history?.treatments, 2000), conditions: str(input.history?.conditions, 2000), tests: str(input.history?.tests, 2000) },
    plan: str(input.plan, 2000),
    removedRules: (input.removedRules || []).filter((r) => RULE_IDS.has(r)),
    customAvoid: [],
    allergies: cleanAllergies(input.allergies),
    access: { band: await issueToken(id, 'band', fixed.band), wallet: await issueToken(id, 'wallet', fixed.wallet) },
    pinHash: hashSecret(pin), pinVersion: 1,
    lastConfirmedAt: input.lastConfirmedAt || now(),
    createdAt: now(), updatedAt: now(),
    demo: Boolean(fixed.demo),
    autoNotify: input.autoNotify !== false,
  };
  await s.set(`patients/${id}`, p);
  await s.set(`dp/${doctor.id}/${id}`, { at: p.createdAt });
  return { patient: p, pin };
}

async function deletePatientData(p) {
  const s = await S();
  for (const k of ['band', 'wallet']) if (p.access?.[k]?.token) await s.del(`tokens/${p.access[k].token}`);
  for (const t of p.oldTokens || []) await s.del(`tokens/${t}`);
  await s.del(`events/${p.id}`);
  await s.del(`pinlock/${p.id}`);
  for (const k of await s.list(`autoalert/${p.id}/`)) await s.del(k);
  await s.del(`dp/${p.doctorId}/${p.id}`);
  await s.del(`patients/${p.id}`);
  for (const k of await s.list(`alerts/${p.doctorId}/`)) {
    const a = await s.get(k);
    if (a && a.patientId === p.id) await s.del(k);
  }
}

async function ensureDemo(force = false) {
  const s = await S();
  let d = await s.get(`doctors/${DEMO_DOCTOR.id}`);
  if (d && !force) {
    if (!(await s.get(`gtin/${DEMO_BARCODES[0].gtin}`))) {
      for (const b of DEMO_BARCODES) await s.set(`gtin/${b.gtin}`, { ...b, addedBy: 'demo', addedByName: 'بيانات التجربة', addedAt: now(), demo: true });
    }
    return d;
  }
  if (!d) {
    d = { id: DEMO_DOCTOR.id, email: DEMO_DOCTOR.email, name: DEMO_DOCTOR.name, specialty: DEMO_DOCTOR.specialty, phone: DEMO_DOCTOR.phone, passHash: hashSecret(DEMO_DOCTOR.password), createdAt: now(), demo: true };
    await s.set(`doctors/${d.id}`, d);
    await s.set(`email/${d.email}`, { id: d.id });
  }
  for (const k of await s.list(`dp/${d.id}/`)) {
    const p = await getPatient(k.split('/').pop());
    if (p) await deletePatientData(p); else await s.del(k);
  }
  for (const k of await s.list(`alerts/${d.id}/`)) await s.del(k);
  for (const b of DEMO_BARCODES) await s.set(`gtin/${b.gtin}`, { ...b, addedBy: 'demo', addedByName: 'بيانات التجربة', addedAt: now(), demo: true });
  for (const dp of demoPatients()) {
    const { patient } = await createPatient(d, dp.data, { id: dp.id, pin: dp.pin, band: dp.band, wallet: dp.wallet, demo: true });
    await addEvent(patient.id, { type: 'doctor_create', actor: 'doctor' });
  }
  return d;
}


// Doctor alerts: "request" (the clinician pressed "contact the treating doctor") or
// "auto" (an AVOID result was found; sent once per medicine per patient every 24 hours).
async function createAlert(p, a) {
  const s = await S();
  const alert = {
    id: randomId(12), patientId: p.id, patientName: p.name, doctorId: p.doctorId,
    type: a.type, drug: a.drug, level: a.level, role: a.role, place: a.place || '', note: a.note || '', kind: a.kind,
    status: 'new', createdAt: now(), seenAt: null, reply: null, repliedAt: null,
  };
  await s.set(`alerts/${p.doctorId}/${alert.id}`, alert);
  const who = alert.role === 'patient' ? 'المريض أو عائلته' : 'معالج';
  const title = alert.type === 'auto' ? `أمان: ${alert.drug} — ${LEVEL_AR[alert.level]}` : `أمان: طلب تواصل بخصوص ${p.name}`;
  const body = alert.type === 'auto'
    ? `فحص ${who} ${alert.drug} لـ${p.name} عبر ${KIND_AR[alert.kind] || 'البطاقة'}، والنتيجة ${LEVEL_AR[alert.level]}.`
    : `${who}${alert.place ? ' في ' + alert.place : ''} يسأل عن ${alert.drug} (${LEVEL_AR[alert.level]}).${alert.note ? ' ' + alert.note : ''}`;
  alert.pushed = await pushToDoctor(p.doctorId, { title, body: body.slice(0, 180), url: '/doctor/dashboard#alerts', tag: alert.id });
  return alert;
}
async function maybeAutoAlert(p, res, kind, role) {
  if (p.autoNotify === false || res.status !== 'result' || res.level !== 'avoid' || res.nonDrugOnly) return null;
  const s = await S();
  const drugKey = res.drug.map((d) => d.key || d.ar).join('+');
  const k = `autoalert/${p.id}/${encodeURIComponent(drugKey)}`;
  const last = await s.get(k);
  if (last && Date.now() - Date.parse(last.at) < AUTO_ALERT_HOURS * 3600000) return null;
  await s.set(k, { at: now() });
  return createAlert(p, { type: 'auto', drug: res.drug.map((d) => d.ar).join(' + '), level: res.level, role, kind });
}

// ---------------- auth ----------------
async function sessionDoctor(req) {
  const c = parseCookies(req.headers.get('cookie'));
  const p = await unsign(c[SESSION_COOKIE]);
  if (!p || !p.d) return null;
  const d = await getDoctor(p.d);
  if (!d) return null;
  return d;
}
async function requireDoctor(req) {
  const d = await sessionDoctor(req);
  if (!d) throw new HttpError(401, 'سجّل الدخول أولًا.');
  return d;
}
async function sessionCookie(req, doctorId) {
  const tok = await sign({ d: doctorId, exp: Date.now() + SESSION_DAYS * 86400000 });
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(tok)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
const clearCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
const publicDoctor = (d) => ({ id: d.id, name: d.name, email: d.email, specialty: d.specialty || '', phone: d.phone || '', demo: Boolean(d.demo) });

async function ownPatient(doctor, id) {
  const p = await getPatient(id);
  if (!p || p.doctorId !== doctor.id) throw new HttpError(404, 'الملف غير موجود.');
  return p;
}

// ---------------- views ----------------
const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : 9999);

function doctorView(p, base) {
  const link = (t) => (t ? `${base}/medical/${t.token}` : '');
  return {
    id: p.id, name: p.name, age: p.age, sex: p.sex, conditions: p.conditions,
    conditionNames: p.conditions.map((c) => CONDS()[c]?.ar || c),
    diagnosisNote: p.diagnosisNote, diagnosisYear: p.diagnosisYear, contacts: p.contacts,
    doctorName: p.doctorName, doctorSpecialty: p.doctorSpecialty, doctorPhone: p.doctorPhone,
    meds: p.meds.map((m) => ({ name: m.name, dose: m.dose, when: m.when, known: m.keys.length > 0 })),
    history: p.history, plan: p.plan,
    removedRules: p.removedRules, customAvoid: p.customAvoid.map((c) => ({ name: c.name, note: c.note })),
    allergies: (p.allergies || []).map(allergyView),
    access: {
      band: { ...p.access.band, url: link(p.access.band), shortUrl: `${base}/m/${p.access.band.token}` },
      wallet: { ...p.access.wallet, url: link(p.access.wallet), claimUrl: `${base}/claim/${p.access.wallet.token}` },
    },
    lastConfirmedAt: p.lastConfirmedAt, stale: daysSince(p.lastConfirmedAt) > STALE_DAYS,
    createdAt: p.createdAt, updatedAt: p.updatedAt, demo: p.demo, autoNotify: p.autoNotify !== false,
  };
}
function summaryView(p) {
  return { id: p.id, name: p.name, age: p.age, sex: p.sex, conditions: p.conditions, conditionNames: p.conditions.map((c) => CONDS()[c]?.ar || c), diagnosisNote: p.diagnosisNote, lastConfirmedAt: p.lastConfirmedAt, bandActive: p.access.band.active, walletActive: p.access.wallet.active, demo: p.demo };
}
function cardView(p, kind) {
  return {
    name: p.name, age: p.age, sex: p.sex,
    conditions: p.conditions.map((c) => ({ code: c, ar: CONDS()[c]?.ar, en: CONDS()[c]?.en, headline: CONDS()[c]?.headline, version: CONDS()[c]?.version })),
    lists: cardLists(p),
    meds: p.meds.map((m) => ({ name: m.name })),
    contacts: p.contacts,
    doctor: { name: p.doctorName, specialty: p.doctorSpecialty, phone: p.doctorPhone },
    lastConfirmedAt: p.lastConfirmedAt, stale: daysSince(p.lastConfirmedAt) > STALE_DAYS,
    accessKind: kind,
  };
}
function recordView(p) {
  return {
    name: p.name, age: p.age, sex: p.sex,
    conditions: p.conditions.map((c) => ({ code: c, ar: CONDS()[c]?.ar, en: CONDS()[c]?.en })),
    diagnosisNote: p.diagnosisNote, diagnosisYear: p.diagnosisYear,
    meds: p.meds.map((m) => ({ name: m.name, dose: m.dose, when: m.when })),
    allergies: (p.allergies || []).map((a) => { const v = allergyView(a); return { label: v.label, reaction: v.reactionAr, year: v.year, certainty: v.certaintyAr, note: v.note }; }),
    history: p.history, plan: p.plan, contacts: p.contacts,
    doctor: { name: p.doctorName, specialty: p.doctorSpecialty, phone: p.doctorPhone },
    lastConfirmedAt: p.lastConfirmedAt, stale: daysSince(p.lastConfirmedAt) > STALE_DAYS,
  };
}

async function patientByToken(token) {
  const s = await S();
  const t = await s.get(`tokens/${str(token, 40)}`);
  if (!t) throw new HttpError(404, 'هذا الرابط غير صحيح.', { code: 'not_found' });
  const p = await getPatient(t.patientId);
  if (!p) throw new HttpError(404, 'هذا الرابط غير صحيح.', { code: 'not_found' });
  const acc = p.access[t.kind];
  if (!acc || acc.token !== token) throw new HttpError(410, 'هذه الوسيلة لم تعد صالحة. أُصدرت وسيلة جديدة للمريض.', { code: 'replaced' });
  if (!acc.active) throw new HttpError(410, 'أوقف الطبيب المعالج هذه الوسيلة. تواصل مع المريض أو مرافقه.', { code: 'revoked' });
  return { p, kind: t.kind };
}

// ---------------- router ----------------
const routes = [];
const route = (method, pattern, fn) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, fn });
};

// Health
route('GET', '/api/health', async () => {
  const s = await S();
  return json({ ok: true, store: s.kind, engine: stats(), time: now() });
});

// Auth
route('POST', '/api/auth/register', async (req, b) => {
  const s = await S();
  const email = normEmail(b.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('اكتب بريدًا إلكترونيًا صحيحًا.');
  if (String(b.password || '').length < 6) throw bad('كلمة المرور 6 أحرف على الأقل.');
  if (!str(b.name)) throw bad('اكتب اسمك.');
  if (await s.get(`email/${email}`)) throw new HttpError(409, 'هذا البريد مسجّل. سجّل الدخول.');
  const d = { id: 'd' + randomId(10), email, name: str(b.name, 80), specialty: str(b.specialty, 80), phone: str(b.phone, 30), passHash: hashSecret(b.password), createdAt: now() };
  await s.set(`doctors/${d.id}`, d);
  await s.set(`email/${email}`, { id: d.id });
  return json({ doctor: publicDoctor(d) }, 201, { 'set-cookie': await sessionCookie(req, d.id) });
});
route('POST', '/api/auth/login', async (req, b) => {
  const s = await S();
  const email = normEmail(b.email);
  if (email === DEMO_DOCTOR.email) await ensureDemo();
  const ref = await s.get(`email/${email}`);
  const d = ref && (await getDoctor(ref.id));
  if (!d || !verifySecret(String(b.password || ''), d.passHash)) throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة.');
  return json({ doctor: publicDoctor(d) }, 200, { 'set-cookie': await sessionCookie(req, d.id) });
});
route('POST', '/api/auth/demo', async (req) => {
  const d = await ensureDemo();
  return json({ doctor: publicDoctor(d) }, 200, { 'set-cookie': await sessionCookie(req, d.id) });
});
route('POST', '/api/auth/logout', async () => json({ ok: true }, 200, { 'set-cookie': clearCookie }));
route('GET', '/api/me', async (req) => {
  const d = await sessionDoctor(req);
  if (!d) throw new HttpError(401, 'سجّل الدخول أولًا.');
  return json({ doctor: publicDoctor(d) });
});
route('POST', '/api/demo/reset', async (req) => {
  const d = await requireDoctor(req);
  if (!d.demo) throw new HttpError(403, 'هذا الإجراء لحساب التجربة فقط.');
  await ensureDemo(true);
  return json({ ok: true });
});

// Library
route('GET', '/api/library', async (req) => {
  await requireDoctor(req);
  const c = CONDS();
  return json({ conditions: Object.values(c).map((x) => ({ code: x.code, ar: x.ar, en: x.en, version: x.version })), library: libraryFor(Object.keys(c)) });
});

// Patients (doctor)
const baseUrl = (req) => { const u = new URL(req.url); return `${u.protocol}//${u.host}`; };
route('GET', '/api/patients', async (req) => {
  const d = await requireDoctor(req);
  const s = await S();
  const keys = await s.list(`dp/${d.id}/`);
  const list = [];
  for (const k of keys) { const p = await getPatient(k.split('/').pop()); if (p) list.push(summaryView(p)); }
  list.sort((a, b) => String(b.lastConfirmedAt).localeCompare(String(a.lastConfirmedAt)));
  return json({ patients: list });
});
route('POST', '/api/patients', async (req, b) => {
  const d = await requireDoctor(req);
  const { patient, pin } = await createPatient(d, b);
  await addEvent(patient.id, { type: 'doctor_create', actor: 'doctor' });
  return json({ patient: doctorView(patient, baseUrl(req)), pin }, 201);
});
route('GET', '/api/patients/:id', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const p = await ownPatient(d, prm.id);
  const s = await S();
  return json({ patient: doctorView(p, baseUrl(req)), lists: cardLists(p), library: libraryFor(p.conditions), allergyLibrary: allergyLibrary(), events: ((await s.get(`events/${p.id}`)) || []).slice(0, 40) });
});
route('PUT', '/api/patients/:id', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const p = await ownPatient(d, prm.id);
  if (b.name !== undefined) { if (!str(b.name)) throw bad('اكتب اسم المريض.'); p.name = str(b.name, 80); }
  if (b.age !== undefined) p.age = Math.max(0, Math.min(120, parseInt(b.age, 10) || 0));
  if (b.sex !== undefined) p.sex = str(b.sex, 10);
  if (b.conditions !== undefined) {
    const c = (b.conditions || []).filter((x) => VALID_CONDS().includes(x));
    if (!c.length) throw bad('اختر حالة واحدة على الأقل.');
    p.conditions = c;
  }
  for (const f of ['diagnosisNote', 'diagnosisYear', 'doctorName', 'doctorSpecialty', 'doctorPhone']) if (b[f] !== undefined) p[f] = str(b[f], 200);
  if (b.plan !== undefined) p.plan = str(b.plan, 2000);
  if (b.history !== undefined) for (const f of ['episodes', 'treatments', 'conditions', 'tests']) if (b.history[f] !== undefined) p.history[f] = str(b.history[f], 2000);
  if (b.contacts !== undefined) p.contacts = cleanContacts(b.contacts);
  if (b.meds !== undefined) p.meds = cleanMeds(b.meds);
  if (b.autoNotify !== undefined) p.autoNotify = Boolean(b.autoNotify);
  await savePatient(p);
  await addEvent(p.id, { type: 'doctor_edit', actor: 'doctor' });
  return json({ patient: doctorView(p, baseUrl(req)), lists: cardLists(p) });
});
route('DELETE', '/api/patients/:id', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const p = await ownPatient(d, prm.id);
  await deletePatientData(p);
  return json({ ok: true });
});
route('POST', '/api/patients/:id/confirm', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const p = await ownPatient(d, prm.id);
  p.lastConfirmedAt = now();
  await savePatient(p);
  await addEvent(p.id, { type: 'doctor_confirm', actor: 'doctor' });
  return json({ patient: doctorView(p, baseUrl(req)) });
});
route('POST', '/api/patients/:id/rules', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const p = await ownPatient(d, prm.id);
  if (b.remove) { if (!RULE_IDS.has(b.remove)) throw bad('قاعدة غير معروفة.'); if (!p.removedRules.includes(b.remove)) p.removedRules.push(b.remove); }
  if (b.restore) p.removedRules = p.removedRules.filter((r) => r !== b.restore);
  if (b.addCustom) {
    const name = str(b.addCustom.name, 80);
    if (!name) throw bad('اكتب اسم الدواء.');
    p.customAvoid.push({ name, note: str(b.addCustom.note, 200), keys: resolveMedKeys(name) });
  }
  if (b.removeCustom !== undefined) p.customAvoid.splice(Number(b.removeCustom), 1);
  await savePatient(p);
  await addEvent(p.id, { type: 'doctor_rules', actor: 'doctor' });
  return json({ patient: doctorView(p, baseUrl(req)), lists: cardLists(p) });
});
route('POST', '/api/patients/:id/allergies', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const p = await ownPatient(d, prm.id);
  p.allergies = p.allergies || [];
  if (b.add) {
    if (p.allergies.length >= 12) throw bad('وصلت للحد الأعلى (12 حساسية).');
    p.allergies.push(cleanAllergy(b.add));
  }
  if (b.remove !== undefined) p.allergies.splice(Number(b.remove), 1);
  await savePatient(p);
  await addEvent(p.id, { type: 'doctor_allergies', actor: 'doctor' });
  return json({ patient: doctorView(p, baseUrl(req)), lists: cardLists(p) });
});
route('POST', '/api/patients/:id/access', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const p = await ownPatient(d, prm.id);
  const kind = b.kind === 'wallet' ? 'wallet' : 'band';
  if (b.action === 'toggle') {
    p.access[kind].active = !p.access[kind].active;
    await addEvent(p.id, { type: p.access[kind].active ? 'access_on' : 'access_off', kind, actor: 'doctor' });
  } else if (b.action === 'reissue') {
    p.oldTokens = [...(p.oldTokens || []), p.access[kind].token].slice(-10);
    p.access[kind] = await issueToken(p.id, kind);
    await addEvent(p.id, { type: 'access_reissue', kind, actor: 'doctor' });
  } else throw bad('إجراء غير معروف.');
  await savePatient(p);
  return json({ patient: doctorView(p, baseUrl(req)) });
});
route('POST', '/api/patients/:id/pin', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const p = await ownPatient(d, prm.id);
  const pin = randomPin();
  p.pinHash = hashSecret(pin);
  p.pinVersion = (p.pinVersion || 1) + 1;
  await savePatient(p);
  await (await S()).del(`pinlock/${p.id}`);
  await addEvent(p.id, { type: 'pin_reset', actor: 'doctor' });
  return json({ pin });
});
route('POST', '/api/patients/:id/check', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const p = await ownPatient(d, prm.id);
  return json(checkForPatient(p, { query: str(b.query, 120), key: b.key || null, route: b.route || null }));
});

// Barcode library (shared by all doctors; like the SFDA product registry behind Tameni)
route('GET', '/api/suggest', async (req) => {
  await requireDoctor(req);
  return json({ suggestions: suggest(new URL(req.url).searchParams.get('q') || '') });
});
route('GET', '/api/barcodes', async (req) => {
  await requireDoctor(req);
  const s = await S();
  const list = [];
  for (const k of await s.list('gtin/')) { const e = await s.get(k); if (e) list.push({ ...e, drug: medInfo(e.key) }); }
  list.sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
  return json({ barcodes: list });
});
route('POST', '/api/barcodes/parse', async (req, b) => {
  await requireDoctor(req);
  const { entry, info } = await lookupBarcode(b.code);
  return json({ barcode: info, existing: entry ? { ...entry, drug: medInfo(entry.key) } : null });
});
route('POST', '/api/barcodes', async (req, b) => {
  const d = await requireDoctor(req);
  const bc = parseBarcode(str(b.code, 200));
  if (!bc) throw bad('رقم الباركود غير صحيح.');
  if (!bc.valid) throw bad('خانة التحقق في رقم الباركود غير صحيحة. امسح العلبة مرة ثانية أو راجع الرقم.');
  let key = b.key && medInfo(b.key) ? b.key : null;
  if (!key) {
    const keys = resolveMedKeys(str(b.drug, 120));
    if (keys.length !== 1) {
      const sug = didYouMean(str(b.drug, 120));
      throw bad(keys.length > 1 ? 'اختر مادة فعالة واحدة.' : sug.length ? `ما عرفنا الاسم. هل تقصد: ${sug.map((x) => x.ar).join('، ')}؟` : 'الاسم غير موجود في مكتبة أمان.');
    }
    key = keys[0];
  }
  const label = str(b.label, 100) || medInfo(key).en;
  const entry = { gtin: bc.gtin, key, label, addedBy: d.id, addedByName: d.name, addedAt: now() };
  await (await S()).set(`gtin/${bc.gtin}`, entry);
  return json({ barcode: { ...entry, drug: medInfo(key) } }, 201);
});
route('DELETE', '/api/barcodes/:gtin', async (req, b, prm) => {
  await requireDoctor(req);
  await (await S()).del(`gtin/${str(prm.gtin, 20)}`);
  return json({ ok: true });
});

// Phone notifications (doctor)
route('GET', '/api/push/key', async (req) => {
  const d = await requireDoctor(req);
  return json({ publicKey: (await vapidKeys()).publicKey, devices: await countSubscriptions(d.id) });
});
route('POST', '/api/push/subscribe', async (req, b) => {
  const d = await requireDoctor(req);
  if (!(await saveSubscription(d.id, b.subscription, req.headers.get('user-agent') || ''))) throw bad('اشتراك الإشعارات غير صالح.');
  return json({ ok: true, devices: await countSubscriptions(d.id) });
});
route('POST', '/api/push/unsubscribe', async (req, b) => {
  const d = await requireDoctor(req);
  await removeSubscription(d.id, b.endpoint);
  return json({ ok: true, devices: await countSubscriptions(d.id) });
});
route('POST', '/api/push/test', async (req) => {
  const d = await requireDoctor(req);
  const n = await pushToDoctor(d.id, { title: 'أمان: الإشعارات تعمل', body: 'بيوصلك تنبيه هنا لما يُفحص دواء «تجنّب» لأحد مرضاك، أو يطلب معالج التواصل معك.', url: '/doctor/dashboard#alerts', tag: 'test' });
  return json({ delivered: n });
});

// Events and alerts (doctor)
route('GET', '/api/events', async (req) => {
  const d = await requireDoctor(req);
  const s = await S();
  const out = [];
  for (const k of await s.list(`dp/${d.id}/`)) {
    const id = k.split('/').pop();
    const p = await getPatient(id);
    if (!p) continue;
    for (const e of ((await s.get(`events/${id}`)) || []).slice(0, 60)) out.push({ ...e, patientId: id, patientName: p.name });
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return json({ events: out.slice(0, 120) });
});
route('GET', '/api/alerts', async (req) => {
  const d = await requireDoctor(req);
  const s = await S();
  const list = [];
  for (const k of await s.list(`alerts/${d.id}/`)) { const a = await s.get(k); if (a) list.push(a); }
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json({ alerts: list.slice(0, 60), unread: list.filter((a) => a.status === 'new').length });
});
route('POST', '/api/alerts/:id', async (req, b, prm) => {
  const d = await requireDoctor(req);
  const s = await S();
  const key = `alerts/${d.id}/${str(prm.id, 40)}`;
  const a = await s.get(key);
  if (!a) throw new HttpError(404, 'التنبيه غير موجود.');
  if (b.action === 'seen' && a.status === 'new') { a.status = 'seen'; a.seenAt = now(); }
  if (b.action === 'reply') {
    const reply = str(b.reply, 400);
    if (!reply) throw bad('اكتب الرد.');
    a.status = 'replied'; a.reply = reply; a.repliedAt = now(); a.seenAt = a.seenAt || now();
    await addEvent(a.patientId, { type: 'doctor_reply', actor: 'doctor', drug: a.drug });
  }
  await s.set(key, a);
  return json({ alert: a });
});

// Public: emergency card by bracelet / wallet token
route('GET', '/api/card/:token', async (req, b, prm) => {
  const { p, kind } = await patientByToken(prm.token);
  if (new URL(req.url).searchParams.get('log') !== '0') await addEvent(p.id, { type: 'card_open', kind });
  return json({ card: cardView(p, kind) });
});
route('GET', '/api/card/:token/suggest', async (req, b, prm) => {
  await patientByToken(prm.token);
  return json({ suggestions: suggest(new URL(req.url).searchParams.get('q') || '') });
});
async function lookupBarcode(raw) {
  const bc = parseBarcode(str(raw, 200));
  if (!bc) throw bad('ما قدرنا نقرأ رقم المنتج من هذا الباركود. جرّب مرة ثانية أو اكتب اسم الدواء.');
  const entry = await (await S()).get(`gtin/${bc.gtin}`);
  const info = { gtin: bc.gtin, expiry: bc.expiry, expired: isExpired(bc.expiry), batch: bc.batch, validCheckDigit: bc.valid, format: bc.format };
  return { entry, info };
}
route('POST', '/api/card/:token/check', async (req, b, prm) => {
  const { p, kind } = await patientByToken(prm.token);
  const role = b.role === 'patient' ? 'patient' : 'staff';
  if (b.barcode) {
    const { entry, info } = await lookupBarcode(b.barcode);
    if (!entry) {
      await addEvent(p.id, { type: 'barcode_unknown', kind, role, drug: info.gtin });
      return json({ status: 'barcode_unknown', barcode: info });
    }
    const r = checkForPatient(p, { query: entry.label, key: entry.key, route: b.route || null });
    r.barcode = { ...info, label: entry.label };
    if (r.status === 'unknown' && r.notInList) await addEvent(p.id, { type: 'drug_check', kind, role, via: 'barcode', drug: r.drug.map((x) => x.ar).join(' + '), level: 'not_in_list' });
    if (r.status === 'result') { await addEvent(p.id, { type: 'drug_check', kind, role, via: 'barcode', drug: r.drug.map((x) => x.ar).join(' + '), level: r.level }); await maybeAutoAlert(p, r, kind, role); }
    if (role === 'patient') { const v = patientView(r); v.barcode = r.barcode; return json(v); }
    return json(r);
  }
  const res = checkForPatient(p, { query: str(b.query, 120), key: b.key || null, route: b.route || null });
  if (res.status === 'unknown' && res.notInList) await addEvent(p.id, { type: 'drug_check', kind, role, drug: res.drug.map((x) => x.ar).join(' + '), level: 'not_in_list' });
  if (res.status === 'result') { await addEvent(p.id, { type: 'drug_check', kind, role, drug: res.drug.map((x) => x.ar).join(' + '), level: res.level }); await maybeAutoAlert(p, res, kind, role); }
  return json(role === 'patient' ? patientView(res) : res);
});
route('POST', '/api/card/:token/unlock', async (req, b, prm) => {
  const { p, kind } = await patientByToken(prm.token);
  const s = await S();
  const lockKey = `pinlock/${p.id}`;
  const lock = (await s.get(lockKey)) || { fails: 0, until: 0 };
  if (lock.until > Date.now()) throw new HttpError(429, 'تم إيقاف المحاولات مؤقتًا للحماية.', { until: lock.until });
  const pin = String(b.pin || '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 1632)).replace(/\D/g, '');
  if (pin.length !== 4 || !verifySecret(pin, p.pinHash)) {
    lock.fails += 1;
    if (lock.fails >= PIN_MAX_FAILS) {
      lock.until = Date.now() + PIN_LOCK_MIN * 60000; lock.fails = 0;
      await s.set(lockKey, lock);
      await addEvent(p.id, { type: 'record_locked', kind });
      throw new HttpError(429, 'تم إيقاف المحاولات مؤقتًا للحماية.', { until: lock.until });
    }
    await s.set(lockKey, lock);
    await addEvent(p.id, { type: 'record_fail', kind });
    throw new HttpError(403, 'الرمز غير صحيح.', { remaining: PIN_MAX_FAILS - lock.fails });
  }
  await s.del(lockKey);
  const recordToken = await sign({ r: p.id, v: p.pinVersion, exp: Date.now() + RECORD_MINUTES * 60000 });
  await addEvent(p.id, { type: 'record_open', kind });
  return json({ recordToken, minutes: RECORD_MINUTES });
});
route('GET', '/api/card/:token/record', async (req, b, prm) => {
  const { p } = await patientByToken(prm.token);
  const t = await unsign(req.headers.get('x-aman-record'));
  if (!t || t.r !== p.id || t.v !== p.pinVersion) throw new HttpError(401, 'أدخل رمز الوصول أولًا.', { code: 'need_pin' });
  return json({ record: recordView(p) });
});
route('POST', '/api/card/:token/contact', async (req, b, prm) => {
  const { p, kind } = await patientByToken(prm.token);
  const s = await S();
  const drug = str(b.drug, 120);
  if (!drug) throw bad('لا يوجد دواء في الطلب.');
  const level = ['avoid', 'caution', 'info', 'none'].includes(b.level) ? b.level : 'avoid';
  const role = b.role === 'patient' ? 'patient' : 'staff';
  // Simple flood guard: at most 10 open requests per patient.
  const open = [];
  for (const k of await s.list(`alerts/${p.doctorId}/`)) { const x = await s.get(k); if (x && x.patientId === p.id && x.status === 'new' && x.type !== 'auto') open.push(x); }
  if (open.length >= 10) throw new HttpError(429, 'وصلت طلبات كثيرة للطبيب. انتظر رده.');
  const a = await createAlert(p, { type: 'request', drug, level, role, place: str(b.place, 60), note: str(b.note, 300), kind });
  await addEvent(p.id, { type: 'contact_request', kind, role: a.role, drug, level: a.level });
  return json({ id: a.id, status: a.status }, 201);
});
route('GET', '/api/card/:token/contact/:id', async (req, b, prm) => {
  const { p } = await patientByToken(prm.token);
  const a = await (await S()).get(`alerts/${p.doctorId}/${str(prm.id, 40)}`);
  if (!a || a.patientId !== p.id) throw new HttpError(404, 'الطلب غير موجود.');
  return json({ status: a.status, seenAt: a.seenAt, reply: a.reply, repliedAt: a.repliedAt, doctorName: p.doctorName });
});
route('GET', '/api/claim/:token', async (req, b, prm) => {
  const { p, kind } = await patientByToken(prm.token);
  const base = baseUrl(req);
  await addEvent(p.id, { type: 'wallet_claim_view', kind });
  return json({ name: p.name, cardUrl: `${base}/medical/${p.access[kind].token}`, kind });
});

let demoReady = false;
export async function handle(req) {
  const url = new URL(req.url);
  if (!demoReady) { try { await ensureDemo(); demoReady = true; } catch (e) { console.error('demo seed', e); } }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      let body = {};
      if (req.method !== 'GET' && req.method !== 'DELETE') {
        const text = await req.text();
        if (text) { try { body = JSON.parse(text); } catch { throw bad('طلب غير صالح.'); } }
        if (text.length > 50000) throw bad('الطلب كبير جدًا.');
      }
      return await r.fn(req, body, params);
    }
    return json({ error: 'غير موجود' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status);
    console.error(e);
    return json({ error: 'حدث خطأ في الخادم. حاول مرة أخرى.' }, 500);
  }
}
