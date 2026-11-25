// Allergy checks (library: data/aman_allergy_library_v1.xlsx).
// Expected levels are written from the rules sheet and the 2022 drug-allergy practice parameter, not from engine output.
process.env.AMAN_STORE = 'memory';
process.env.AMAN_SESSION_SECRET = 'test-secret-test-secret-test-secret';
import test from 'node:test';
import assert from 'node:assert/strict';
import DATA from '../lib/rules-data.mjs';
import { checkForPatient, patientView, cardLists, allergyLowRisk } from '../lib/engine.mjs';
import { demoPatients } from '../lib/demo.mjs';

const P = (allergies, conditions = ['MG']) => ({ conditions, meds: [], allergies });
const allergyLevel = (p, q) => {
  const r = checkForPatient(p, { query: q });
  const f = (r.findings || []).filter((x) => x.type === 'allergy');
  return f.length ? f[0].level : r.status === 'result' ? 'none' : r.status;
};

test('penicillin allergy (family only): penicillins avoid, aminopenicillin-like cephalosporins caution, other cephalosporins and carbapenems info', () => {
  const p = P([{ group: 'penicillin', reaction: 'rash', year: '2003', certainty: 'reported' }]);
  for (const q of ['Augmentin', 'أوقمنتين', 'amoxicillin', 'Megamox', 'Tazocin', 'penicillin', 'بنسلين', 'Unasyn', 'flucloxacillin']) assert.equal(allergyLevel(p, q), 'avoid', q);
  for (const q of ['Keflex', 'Duricef', 'cefaclor']) assert.equal(allergyLevel(p, q), 'caution', q);
  for (const q of ['Zinnat', 'Rocephin', 'cefazolin', 'Suprax', 'Meronem', 'Tienam']) assert.equal(allergyLevel(p, q), 'info', q);
  assert.equal(allergyLevel(p, 'Panadol'), 'none');
});

test('known culprit amoxicillin: same-side-chain cephalosporins become avoid; anaphylaxis does not upgrade dissimilar cephalosporins', () => {
  const p = P([{ name: 'Amoxil', key: 'amoxicillin', reaction: 'anaphylaxis', year: '2024', certainty: 'documented' }]);
  for (const q of ['Keflex', 'Duricef', 'cefprozil']) assert.equal(allergyLevel(p, q), 'avoid', q);
  assert.equal(allergyLevel(p, 'Zinnat'), 'info');
  assert.equal(allergyLevel(p, 'Meronem'), 'info');
});

test('cephalosporin culprit: same R1 avoid (incl. ceftazidime -> aztreonam), dissimilar caution, unknown culprit avoids the family', () => {
  const tri = P([{ key: 'ceftriaxone', reaction: 'hives', certainty: 'documented' }]);
  assert.equal(allergyLevel(tri, 'Rocephin'), 'avoid');
  assert.equal(allergyLevel(tri, 'cefotaxime'), 'avoid');
  assert.equal(allergyLevel(tri, 'Maxipime'), 'avoid');
  assert.equal(allergyLevel(tri, 'Keflex'), 'caution');
  assert.equal(allergyLevel(tri, 'amoxicillin'), 'info');
  const taz = P([{ key: 'ceftazidime', reaction: 'hives', certainty: 'documented' }]);
  assert.equal(allergyLevel(taz, 'Azactam'), 'avoid');
  const unk = P([{ group: 'cephalosporin', reaction: 'unknown' }]);
  for (const q of ['Zinnat', 'Keflex', 'Rocephin']) assert.equal(allergyLevel(unk, q), 'avoid', q);
});

test('sulfa antibiotic allergy: sulfa antibiotics avoid, non-antibiotic sulfonamides only info (never blocked)', () => {
  const p = P([{ group: 'sulfa_antibiotic', reaction: 'rash', certainty: 'reported' }]);
  assert.equal(allergyLevel(p, 'Bactrim'), 'avoid');
  assert.equal(allergyLevel(p, 'sulfasalazine'), 'avoid');
  assert.equal(allergyLevel(p, 'dapsone'), 'caution');
  for (const q of ['Lasix', 'HCTZ', 'Diamox', 'Celebrex', 'Diamicron']) assert.equal(allergyLevel(p, q), 'info', q);
});

test('NSAID hypersensitivity: COX-1 NSAIDs and aspirin avoid, COX-2 caution, paracetamol info', () => {
  const p = P([{ group: 'nsaid', reaction: 'hives' }]);
  for (const q of ['Brufen', 'Voltaren', 'aspirin', 'Ponstan', 'Feldene', 'Xefo']) assert.equal(allergyLevel(p, q), 'avoid', q);
  for (const q of ['Celebrex', 'Arcoxia', 'Mobic']) assert.equal(allergyLevel(p, q), 'caution', q);
  assert.equal(allergyLevel(p, 'Panadol'), 'info');
});

test('other families: quinolones, aromatic antiepileptics, opioids, local anaesthetics', () => {
  assert.equal(allergyLevel(P([{ group: 'fluoroquinolone', reaction: 'rash' }]), 'Tavanic'), 'avoid');
  const aed = P([{ key: 'carbamazepine', reaction: 'scar', certainty: 'documented' }]);
  for (const q of ['phenytoin', 'Trileptal', 'Lamictal']) assert.equal(allergyLevel(aed, q), 'avoid', q);
  assert.equal(allergyLevel(aed, 'Keppra'), 'caution', 'SCAR raises a non-aromatic alternative from info to caution');
  const op = P([{ key: 'morphine', reaction: 'hives' }]);
  assert.equal(allergyLevel(op, 'codeine'), 'avoid');
  assert.equal(allergyLevel(op, 'fentanyl'), 'caution');
  const la = P([{ key: 'benzocaine', reaction: 'hives' }]);
  assert.equal(allergyLevel(la, 'procaine'), 'avoid');
  assert.equal(allergyLevel(la, 'Xylocaine'), 'info');
});

test('reaction type changes the answer: side effect is info only, severe skin reaction raises one level, anaphylaxis uses the severe level', () => {
  assert.equal(allergyLevel(P([{ key: 'codeine', reaction: 'intolerance' }]), 'codeine'), 'info');
  assert.equal(allergyLevel(P([{ key: 'codeine', reaction: 'intolerance' }]), 'morphine'), 'info');
  assert.equal(allergyLevel(P([{ group: 'penicillin', reaction: 'scar' }]), 'Zinnat'), 'caution');
  assert.equal(allergyLevel(P([{ group: 'iodinated_contrast', reaction: 'hives' }]), 'Omnipaque'), 'caution');
  assert.equal(allergyLevel(P([{ group: 'iodinated_contrast', reaction: 'anaphylaxis' }]), 'Omnipaque'), 'avoid');
});

test('food allergies linked to medicines: egg -> yellow fever vaccine, gelatin -> MMR, seafood is not a reason to block contrast', () => {
  assert.equal(allergyLevel(P([{ group: 'egg', reaction: 'anaphylaxis' }], ['G6PD']), 'لقاح الحمى الصفراء'), 'avoid');
  assert.equal(allergyLevel(P([{ group: 'egg', reaction: 'hives' }], ['G6PD']), 'mmr'), 'info');
  assert.equal(allergyLevel(P([{ group: 'gelatin', reaction: 'hives' }], ['G6PD']), 'mmr'), 'caution');
  assert.equal(allergyLevel(P([{ group: 'seafood_iodine', reaction: 'hives' }]), 'Omnipaque'), 'info');
});

test('no false reassurance: a medicine never reviewed for the condition stays "not in list" even when the allergy has no warning', () => {
  const p = P([{ group: 'penicillin', reaction: 'rash' }]);
  const r = checkForPatient(p, { query: 'Azactam' });
  assert.equal(r.status, 'unknown');
  // allergy avoid on a medicine not reviewed for MG: the result says so
  const a = checkForPatient(p, { query: 'Augmentin' });
  assert.equal(a.level, 'avoid');
  assert.ok(a.notReviewedFor.includes('الوهن العضلي الوبيل'));
  assert.ok(patientView(a).notReviewedFor.length);
});

test('"no warning" names both the condition list and the allergy that were checked', () => {
  const r = checkForPatient(P([{ group: 'penicillin', reaction: 'rash' }]), { query: 'Panadol' });
  assert.equal(r.level, 'none');
  assert.ok(r.noWarningFor.includes('حساسية البنسلين'));
});

test('low-risk label (mild, more than 5 years, not tested) is flagged for staff only', () => {
  const a = { group: 'penicillin', reaction: 'rash', year: '2003', certainty: 'reported' };
  assert.equal(allergyLowRisk(a), true);
  assert.equal(allergyLowRisk({ ...a, certainty: 'tested' }), false);
  assert.equal(allergyLowRisk({ ...a, reaction: 'anaphylaxis' }), false);
  assert.equal(allergyLowRisk({ ...a, year: String(new Date().getFullYear() - 1) }), false);
  const res = checkForPatient(P([a]), { query: 'Augmentin' });
  assert.ok(res.findings[0].notes.some((n) => n.includes('منخفضة الخطورة')));
  assert.equal(JSON.stringify(patientView(res)).includes('منخفضة الخطورة'), false, 'patient view never shows the de-labelling note');
});

test('every allergy rule has a reason, an action, a source and a licence', () => {
  for (const r of DATA.allergy.rules) {
    assert.ok(r.reason && r.action && r.sources && r.license, r.id);
  }
});

test('every medicine in a family is reachable by name, and the demo Sara card shows her allergy', () => {
  for (const k of Object.keys(DATA.allergy.drugClasses)) assert.ok(DATA.meds[k], k);
  const sara = demoPatients()[0].data;
  const card = cardLists(sara);
  assert.equal(card.allergies.length, 1);
  assert.ok(card.allergies[0].avoid.includes('البنسلينات'));
  assert.equal(card.allergies[0].lowRisk, true);
});

test('API: doctor adds an allergy by medicine name; unknown names are refused, never stored as free text', async () => {
  const { handle } = await import('../lib/api.mjs');
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await handle(new Request('https://aman.test' + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined }));
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  await call('POST', '/api/auth/demo');
  const add = await call('POST', '/api/patients/demo-yousef/allergies', { add: { name: 'Brufen', reaction: 'hives', year: '2025', certainty: 'documented' } });
  assert.equal(add.status, 200);
  assert.equal(add.body.patient.allergies[0].groups[0], 'nsaid');
  const chk = await call('POST', '/api/card/demo-yousef/check', { query: 'Voltaren', role: 'staff' });
  assert.equal(chk.body.findings.find((f) => f.type === 'allergy').level, 'avoid');
  const bad = await call('POST', '/api/patients/demo-yousef/allergies', { add: { name: 'xyzzy pills' } });
  assert.equal(bad.status, 400);
  const card = await call('GET', '/api/card/demo-yousef');
  assert.equal(card.body.card.lists.allergies.length, 1);
  const rm = await call('POST', '/api/patients/demo-yousef/allergies', { remove: 0 });
  assert.equal(rm.body.patient.allergies.length, 0);
});
