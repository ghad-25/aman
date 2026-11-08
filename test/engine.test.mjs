import test from 'node:test';
import assert from 'node:assert/strict';
import DATA from '../lib/rules-data.mjs';
import { checkForPatient, parseQuery, cardLists } from '../lib/engine.mjs';

const sara = { conditions: ['MG'], meds: [{ name: 'Mestinon' }, { name: 'Prednisolone' }, { name: 'Imuran' }] };
const yousef = { conditions: ['G6PD'], meds: [] };
const level = (p, q, o = {}) => checkForPatient(p, { query: q, ...o });

test('every AVOID rule is found by its English and Arabic name (with the route it applies to)', () => {
  let n = 0;
  for (const r of DATA.rules.filter((x) => x.severity === 'AVOID')) {
    const p = { conditions: [r.condition], meds: [] };
    const route = r.routes.includes('*') ? null : (r.routes.includes('oral') ? 'oral' : r.routes.some((x) => ['iv', 'im', 'sc', 'intradermal', 'intra-arterial'].includes(x)) ? 'injection' : r.routes.includes('ophthalmic') ? 'ophthalmic' : r.routes.includes('inhaled') ? 'inhaled' : 'topical');
    for (const name of [r.en, r.ar]) {
      const res = level(p, name.replace(/\s*\(.*?\)\s*/g, ' '), { route });
      assert.equal(res.status, 'result', `${r.id} ${name} -> ${res.status}`);
      assert.equal(res.level, 'avoid', `${r.id} ${name} -> ${res.level}`);
      n++;
    }
  }
  assert.ok(n >= 50);
});

test('every alias reaches its medicine', () => {
  for (const [key, m] of Object.entries(DATA.meds)) {
    for (const name of m.names) {
      const keys = parseQuery(name).keys;
      assert.ok(keys.includes(key), `${name} -> ${keys} (want ${key})`);
    }
  }
});

test('dose and form words are ignored; extra words ask to check ingredients', () => {
  assert.equal(level(sara, 'Cipro 500 mg tablets').level, 'avoid');
  assert.equal(level(sara, 'سيبروفلوكساسين ٥٠٠ ملغ حبوب').level, 'avoid');
  const extra = level(sara, 'Panadol Extra');
  assert.equal(extra.level, 'none');
  assert.equal(extra.verifyIngredients, true);
});

test('close spelling is never checked automatically', () => {
  const r = level(sara, 'ciprofloxcin');
  assert.equal(r.status, 'confirm');
  assert.equal(r.suggestions[0].key, 'ciprofloxacin');
});

test('unknown medicine says so', () => {
  assert.equal(level(sara, 'Augmentin').status, 'unknown');
});

test('route matters: eye drops vs tablets', () => {
  assert.equal(level(sara, 'Vigamox').level, 'none');
  assert.equal(level(sara, 'moxifloxacin').status, 'need_route');
  assert.equal(level(sara, 'moxifloxacin', { route: 'oral' }).level, 'avoid');
  assert.equal(level(sara, 'مغنيسيوم').status, 'need_route');
  assert.equal(level(sara, 'مغنيسيوم بالوريد').level, 'avoid');
  assert.equal(level(sara, 'مغنيسيوم', { route: 'oral' }).level, 'info');
});

test('interactions with the patient\'s own medicines', () => {
  assert.equal(level(sara, 'Allopurinol').level, 'avoid');
  assert.equal(level(sara, 'Brufen').level, 'caution');
  assert.equal(level(yousef, 'Allopurinol').level, 'none');
});

test('stable steroid the patient already takes is information, not a stop', () => {
  const r = level(sara, 'prednisolone');
  assert.equal(r.level, 'info');
  assert.deepEqual(r.alreadyTaking, ['بريدنيزولون']);
});

test('G6PD examples', () => {
  assert.equal(level(yousef, 'primaquine').level, 'avoid');
  assert.equal(level(yousef, 'nitrofurantoin').level, 'caution');
  assert.equal(level(yousef, 'Bactrim').level, 'info');
  assert.equal(level(yousef, 'aspirin').level, 'none');
});

test('doctor removal keeps the warning visible at caution', () => {
  const p = { ...sara, removedRules: ['MG-001'] };
  const r = level(p, 'ciprofloxacin');
  assert.equal(r.level, 'caution');
  const lists = cardLists(p);
  assert.ok(lists.caution.some((g) => g.removed && g.items.some((i) => i.ruleId === 'MG-001')));
  assert.ok(!lists.avoid.some((g) => g.items.some((i) => i.ruleId === 'MG-001')));
});

test('G6PD card lists non-drug triggers', () => {
  const l = cardLists(yousef);
  assert.ok(l.nonDrug.some((n) => n.ar.includes('الفول')));
});

test('doctor-added medicine matches even with dose words', () => {
  const p = { conditions: ['MG'], meds: [], customAvoid: [{ name: 'Augmentin', note: 'حساسية' }] };
  assert.equal(level(p, 'Augmentin 1g').level, 'avoid');
  assert.equal(level(p, 'augmentin').level, 'avoid');
  assert.equal(level(p, 'Augmentinx').status, 'unknown');
});
