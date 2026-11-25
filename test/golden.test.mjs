import test from 'node:test';
import assert from 'node:assert/strict';
import { summary as s } from './golden.mjs';

test('reference cases (written from the rules file, not from engine output): no false "no warning", every AVOID caught or asked', () => {
  assert.equal(s.falseReassure, 0, 'a "no warning" for something that is not on the reviewed list');
  // the only allowed misses ask the user first (route or "did you mean"), they never answer wrongly
  for (const f of s.fails) assert.match(f, /got=(need_route|confirm)$/, f);
  assert.ok(s.pass >= 402, `${s.pass}/${s.total}`);
});
