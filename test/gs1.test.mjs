import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBarcode, gtinCheckDigitOk, isExpired } from '../lib/gs1.mjs';

test('linear EAN-13 becomes GTIN-14', () => {
  const r = parseBarcode('6281086011232');
  assert.equal(r.gtin, '06281086011232');
  assert.equal(r.valid, true);
});
test('GS1 DataMatrix element string with GS separators and symbology id', () => {
  const r = parseBarcode(']d2010628108601123217281231' + '10AB12\u001d21SN998877');
  assert.deepEqual([r.gtin, r.expiry, r.batch, r.serial], ['06281086011232', '2028-12-31', 'AB12', 'SN998877']);
});
test('human-readable form and day 00', () => {
  const r = parseBarcode('(01)06281086011232(17)250600(10)X1');
  assert.equal(r.expiry, '2025-06-30');
  assert.equal(isExpired(r.expiry, Date.parse('2026-01-01')), true);
});
test('rejects junk and impossible dates', () => {
  assert.equal(parseBarcode('12345'), null);
  assert.equal(parseBarcode('hello'), null);
  assert.equal(parseBarcode('010628108601123217250631').expiry, null);
  assert.equal(gtinCheckDigitOk('6281086011231'), false);
});
