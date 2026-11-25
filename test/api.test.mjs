process.env.AMAN_STORE = 'memory';
process.env.AMAN_SESSION_SECRET = 'test-secret-test-secret-test-secret';
import test from 'node:test';
import assert from 'node:assert/strict';
const { handle } = await import('../lib/api.mjs');
const { setPushSender } = await import('../lib/push.mjs');
const pushed = [];
setPushSender(async (sub, payload) => { pushed.push({ endpoint: sub.endpoint, msg: JSON.parse(payload) }); if (sub.endpoint.includes('gone')) { const e = new Error('gone'); e.statusCode = 410; throw e; } });

const BASE = 'https://aman.test';
let cookie = '';
async function call(method, path, body, headers = {}) {
  const res = await handle(new Request(BASE + path, {
    method, headers: { 'content-type': 'application/json', cookie, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  }));
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: res.status, body: await res.json() };
}

test('health', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.engine.rules, 100);
});

test('dashboard needs login', async () => {
  cookie = '';
  const r = await call('GET', '/api/patients');
  assert.equal(r.status, 401);
});

test('demo login seeds Sara, Yousef and Faisal with fixed links', async () => {
  const r = await call('POST', '/api/auth/demo');
  assert.equal(r.status, 200);
  const list = await call('GET', '/api/patients');
  assert.deepEqual(list.body.patients.map((p) => p.id).sort(), ['demo-faisal', 'demo-sara', 'demo-yousef']);
  // Faisal's real bracelet is written with this link: it must open his card.
  const faisal = await call('GET', '/api/card/5RPNwhpEcP');
  assert.equal(faisal.status, 200);
  assert.equal(faisal.body.card?.name ?? faisal.body.name, 'فيصل الغامدي');
  const card = await call('GET', '/api/card/demo-sara');
  assert.equal(card.status, 200);
  assert.equal(card.body.card.name, 'سارة أحمد');
  assert.ok(card.body.card.lists.avoid.length > 5);
  assert.equal(card.body.card.meds.length, 3);
  assert.equal(card.body.card.meds[0].dose, undefined, 'card must not show doses');
});

test('demo password login works too', async () => {
  cookie = '';
  const bad = await call('POST', '/api/auth/login', { email: 'doctor@aman.demo', password: 'nope' });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/api/auth/login', { email: 'Doctor@Aman.demo', password: '123456' });
  assert.equal(ok.status, 200);
});

test('drug check: staff vs patient view', async () => {
  const staff = await call('POST', '/api/card/demo-sara/check', { query: 'Cipro 500mg', role: 'staff' });
  assert.equal(staff.body.level, 'avoid');
  assert.ok(staff.body.findings[0].action);
  const pt = await call('POST', '/api/card/demo-sara/check', { query: 'Cipro 500mg', role: 'patient' });
  assert.equal(pt.body.level, 'avoid');
  assert.equal(pt.body.findings, undefined, 'patient never gets the clinical plan');
  assert.equal(pt.body.message, 'راجع الصيدلي قبل ما تاخذه');
  const y = await call('POST', '/api/card/demo-yousef/check', { query: 'Ciprofloxacin', role: 'staff' });
  assert.equal(y.body.level, 'none');
});

test('register, create patient, edit list, card follows', async () => {
  cookie = '';
  const reg = await call('POST', '/api/auth/register', { name: 'د. اختبار', email: 'test@x.sa', password: 'abcdef', specialty: 'أعصاب' });
  assert.equal(reg.status, 201);
  const dup = await call('POST', '/api/auth/register', { name: 'x', email: 'test@x.sa', password: 'abcdef' });
  assert.equal(dup.status, 409);
  const c = await call('POST', '/api/patients', { name: 'مريض تجريبي', age: 40, sex: 'ذكر', conditions: ['MG'], meds: [{ name: 'Mestinon', dose: '60', when: '3' }] });
  assert.equal(c.status, 201);
  assert.match(c.body.pin, /^\d{4}$/);
  const id = c.body.patient.id;
  const token = c.body.patient.access.band.token;
  assert.equal((await call('POST', `/api/card/${token}/check`, { query: 'azithromycin' })).body.level, 'avoid');
  // Doctor removes azithromycin (MG-006): stays visible as caution
  await call('POST', `/api/patients/${id}/rules`, { remove: 'MG-006' });
  const after = await call('POST', `/api/card/${token}/check`, { query: 'azithromycin' });
  assert.equal(after.body.level, 'caution');
  assert.ok(after.body.findings[0].removed);
  // Doctor adds a custom drug
  await call('POST', `/api/patients/${id}/rules`, { addCustom: { name: 'Augmentin', note: 'حساسية سابقة' } });
  assert.equal((await call('POST', `/api/card/${token}/check`, { query: 'augmentin' })).body.level, 'avoid');
  // Other doctor cannot read this patient
  cookie = '';
  await call('POST', '/api/auth/demo');
  assert.equal((await call('GET', `/api/patients/${id}`)).status, 404);
});

test('PIN unlock, lockout, record token', async () => {
  const noTok = await call('GET', '/api/card/demo-sara/record');
  assert.equal(noTok.status, 401);
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', '/api/card/demo-sara/unlock', { pin: '0000' })).status, 403);
  const locked = await call('POST', '/api/card/demo-sara/unlock', { pin: '0000' });
  assert.equal(locked.status, 429);
  const stillLocked = await call('POST', '/api/card/demo-sara/unlock', { pin: '6305' });
  assert.equal(stillLocked.status, 429, 'correct PIN is refused while locked');
  // reset demo clears locks
  await call('POST', '/api/demo/reset');
  const ok = await call('POST', '/api/card/demo-sara/unlock', { pin: '٦٣٠٥' });
  assert.equal(ok.status, 200);
  const rec = await call('GET', '/api/card/demo-sara/record', null, { 'x-aman-record': ok.body.recordToken });
  assert.equal(rec.status, 200);
  assert.equal(rec.body.record.meds[0].dose, '60 ملغ');
  // token for Sara does not open Yousef
  const other = await call('GET', '/api/card/demo-yousef/record', null, { 'x-aman-record': ok.body.recordToken });
  assert.equal(other.status, 401);
});

test('stop and reissue bracelet', async () => {
  const pid = 'demo-sara';
  const off = await call('POST', `/api/patients/${pid}/access`, { kind: 'band', action: 'toggle' });
  assert.equal(off.body.patient.access.band.active, false);
  assert.equal((await call('GET', '/api/card/demo-sara')).status, 410);
  // the drug check never works through a stopped bracelet either
  assert.equal((await call('POST', '/api/card/demo-sara/check', { query: 'cipro' })).status, 410);
  // wallet still works
  assert.equal((await call('GET', '/api/card/demo-sara-wallet')).status, 200);
  await call('POST', `/api/patients/${pid}/access`, { kind: 'band', action: 'toggle' });
  const re = await call('POST', `/api/patients/${pid}/access`, { kind: 'band', action: 'reissue' });
  const t2 = re.body.patient.access.band.token;
  assert.notEqual(t2, 'demo-sara');
  assert.equal((await call('GET', '/api/card/demo-sara')).status, 410);
  assert.equal((await call('GET', `/api/card/${t2}`)).status, 200);
  await call('POST', '/api/demo/reset');
});

test('contact loop: request reaches doctor, reply goes back', async () => {
  const req = await call('POST', '/api/card/demo-sara/contact', { drug: 'سيبروفلوكساسين', level: 'avoid', role: 'staff', note: 'التهاب رئوي' });
  assert.equal(req.status, 201);
  const alerts = await call('GET', '/api/alerts');
  assert.equal(alerts.body.unread, 1);
  const a = alerts.body.alerts[0];
  assert.equal(a.patientName, 'سارة أحمد');
  await call('POST', `/api/alerts/${a.id}`, { action: 'reply', reply: 'لا تعطه. أموكسيسيلين مناسب.' });
  const st = await call('GET', `/api/card/demo-sara/contact/${req.body.id}`);
  assert.equal(st.body.status, 'replied');
  assert.match(st.body.reply, /أموكسيسيلين/);
  const ev = await call('GET', '/api/events');
  assert.ok(ev.body.events.some((e) => e.type === 'contact_request'));
});

test('unknown token', async () => {
  assert.equal((await call('GET', '/api/card/nope123')).status, 404);
});

test('barcode: demo pack, GS1 DataMatrix with expiry, unknown pack, doctor links a new pack', async () => {
  // linear EAN-13 of a demo pack
  const a = await call('POST', '/api/card/demo-sara/check', { barcode: '2000001000014', role: 'staff' });
  assert.equal(a.body.status, 'result');
  assert.equal(a.body.level, 'avoid');
  assert.equal(a.body.barcode.gtin, '02000001000014');
  // GS1 DataMatrix content: (01) GTIN (17) expiry (10) batch, GS separator
  const dm = await call('POST', '/api/card/demo-sara/check', { barcode: '010200000100001417250131' + '10LOT7\u001d21SN1', role: 'patient' });
  assert.equal(dm.body.level, 'avoid');
  assert.equal(dm.body.barcode.expired, true);
  assert.equal(dm.body.barcode.batch, 'LOT7');
  assert.equal(dm.body.findings, undefined);
  // unknown pack
  const u = await call('POST', '/api/card/demo-sara/check', { barcode: '6281086011232' });
  assert.equal(u.body.status, 'barcode_unknown');
  // doctor links it once, then everyone gets it
  const bad = await call('POST', '/api/barcodes', { code: '6281086011231', drug: 'Zithromax' });
  assert.equal(bad.status, 400, 'wrong check digit is refused');
  const ok = await call('POST', '/api/barcodes', { code: '6281086011232', drug: 'Zithromax', label: 'Zithromax 250 mg' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.barcode.key, 'azithromycin');
  const again = await call('POST', '/api/card/demo-sara/check', { barcode: '6281086011232' });
  assert.equal(again.body.level, 'avoid');
  const y = await call('POST', '/api/card/demo-yousef/check', { barcode: '6281086011232' });
  assert.equal(y.body.status, 'unknown', 'azithromycin was never reviewed for G6PD: "check with the pharmacist", not "no warning"');
  assert.equal(y.body.notInList, true);
  const fuzzy = await call('POST', '/api/barcodes', { code: '6281086011232', drug: 'Zithromx' });
  assert.equal(fuzzy.status, 400);
});

test('automatic alert on AVOID: once per medicine per day, can be switched off, reaches the phone', async () => {
  cookie = '';
  await call('POST', '/api/auth/demo');
  await call('POST', '/api/demo/reset');
  // doctor turns on phone notifications on two devices (one is no longer valid)
  const key = await call('GET', '/api/push/key');
  assert.ok(key.body.publicKey.length > 60);
  const sub = (ep) => ({ endpoint: ep, keys: { p256dh: 'BPx', auth: 'au' } });
  await call('POST', '/api/push/subscribe', { subscription: sub('https://push.example/phone') });
  const two = await call('POST', '/api/push/subscribe', { subscription: sub('https://push.example/gone') });
  assert.equal(two.body.devices, 2);
  assert.equal((await call('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://x' } })).status, 400);
  pushed.length = 0;
  // a caution result does not alert
  await call('POST', '/api/card/demo-sara/check', { query: 'Brufen', role: 'staff' });
  assert.equal((await call('GET', '/api/alerts')).body.alerts.length, 0);
  // an avoid result alerts automatically, once
  await call('POST', '/api/card/demo-sara/check', { query: 'Cipro', role: 'staff' });
  await call('POST', '/api/card/demo-sara/check', { query: 'ciprofloxacin 500mg', role: 'patient' });
  await call('POST', '/api/card/demo-sara/check', { barcode: '2000001000014' });
  let al = (await call('GET', '/api/alerts')).body;
  assert.equal(al.alerts.length, 1);
  assert.equal(al.alerts[0].type, 'auto');
  assert.match(al.alerts[0].drug, /سيبروفلوكساسين/);
  assert.ok(pushed.some((x) => x.endpoint.endsWith('/phone') && x.msg.title.includes('تجنّب')));
  assert.equal((await call('GET', '/api/push/key')).body.devices, 1, 'expired device removed');
  // a different avoid medicine alerts again
  await call('POST', '/api/card/demo-sara/check', { query: 'azithromycin' });
  assert.equal((await call('GET', '/api/alerts')).body.alerts.length, 2);
  // the doctor switches automatic alerts off for this patient
  await call('PUT', '/api/patients/demo-sara', { autoNotify: false });
  await call('POST', '/api/card/demo-sara/check', { query: 'gentamicin' });
  assert.equal((await call('GET', '/api/alerts')).body.alerts.length, 2);
  // contact requests still arrive and still push
  pushed.length = 0;
  await call('POST', '/api/card/demo-sara/contact', { drug: 'جنتاميسين', level: 'avoid', role: 'staff', place: 'الطوارئ' });
  al = (await call('GET', '/api/alerts')).body;
  assert.equal(al.alerts[0].type, 'request');
  assert.equal(pushed.length, 1);
  assert.equal((await call('POST', '/api/push/test')).body.delivered, 1);
  await call('POST', '/api/demo/reset');
  assert.equal((await call('GET', '/api/patients/demo-sara')).body.patient.autoNotify, true);
});

test('demo reset never deletes patients the user added; missing demo patients come back without a reset', async () => {
  cookie = '';
  await call('POST', '/api/auth/demo');
  const made = await call('POST', '/api/patients', { name: 'مريض أضافه المستخدم', conditions: ['G6PD'] });
  assert.equal(made.status, 201);
  const id = made.body.patient.id;
  const band = made.body.patient.access.band.token;
  await call('PUT', '/api/patients/demo-sara', { autoNotify: false });
  await call('POST', '/api/demo/reset');
  const ids = (await call('GET', '/api/patients')).body.patients.map((p) => p.id);
  assert.ok(ids.includes(id), 'user patient survives the reset');
  assert.equal((await call('GET', `/api/card/${band}`)).status, 200, 'its bracelet still opens');
  assert.equal((await call('GET', '/api/patients/demo-sara')).body.patient.autoNotify, true, 'demo patient was reset');
  assert.equal((await call('GET', '/api/card/5RPNwhpEcP')).status, 200);
  // a demo patient that is missing (e.g. newly added to demo.mjs) is created on the next demo login
  await call('DELETE', '/api/patients/demo-faisal');
  assert.equal((await call('GET', '/api/card/5RPNwhpEcP')).status, 404);
  await call('POST', '/api/auth/demo');
  assert.equal((await call('GET', '/api/card/5RPNwhpEcP')).status, 200);
  assert.ok((await call('GET', '/api/patients')).body.patients.some((p) => p.id === id), 'still there');
  await call('DELETE', `/api/patients/${id}`);
});

test('Faisal demo: the three committee checks (condition, allergy, interaction)', async () => {
  const lvl = async (q) => (await call('POST', '/api/card/5RPNwhpEcP/check', { query: q, role: 'staff' })).body;
  let r = await lvl('Azithromycin');
  assert.equal(r.level, 'avoid'); assert.ok(r.findings.some((f) => f.type === 'condition'));
  r = await lvl('أوقمنتين');
  assert.equal(r.level, 'avoid'); assert.ok(r.findings.some((f) => f.type === 'allergy'));
  r = await lvl('Zyloric');
  assert.equal(r.level, 'avoid'); assert.ok(r.findings.some((f) => f.type === 'interaction'));
  await call('POST', '/api/demo/reset');
});
