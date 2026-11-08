// GS1 barcode parsing (same idea as SFDA "Tameni"):
// a medicine pack in Saudi Arabia carries a GS1 DataMatrix (or a linear EAN-13) holding the
// product number (GTIN) plus expiry, batch and serial. The name is NOT in the barcode:
// the GTIN is looked up in a product registry.
const FIXED = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
const VARIABLE = ['10', '21', '22', '240', '241', '30', '37', '710', '711', '712', '713', '714', '715', '716'];
const GS = '\u001d';

export function gtinCheckDigitOk(code) {
  if (!/^\d{8,14}$/.test(code)) return false;
  const d = code.split('').map(Number);
  const check = d.pop();
  let sum = 0;
  d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10 === check;
}
const pad14 = (s) => s.padStart(14, '0');

function expiryOf(yymmdd) {
  if (!/^\d{6}$/.test(yymmdd || '')) return null;
  const y = 2000 + Number(yymmdd.slice(0, 2));
  const m = Number(yymmdd.slice(2, 4));
  let d = Number(yymmdd.slice(4, 6));
  if (m < 1 || m > 12) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d === 0) d = last; // "00" = last day of month
  if (d > last) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parse raw scanner text. Returns {gtin, expiry, batch, serial, valid, format} or null. */
export function parseBarcode(raw) {
  let s = String(raw ?? '').replace(/^\s+|\s+$/g, '');
  if (!s) return null;
  s = s.replace(/^\][A-Za-z]\d/, ''); // symbology identifier, e.g. ]d2 ]C1 ]E0
  const ai = {};
  let format = 'gs1';
  if (/^\(\d{2,4}\)/.test(s)) {
    // human-readable form: (01)06285...(17)271231(10)AB12
    for (const m of s.matchAll(/\((\d{2,4})\)([^(]*)/g)) ai[m[1]] = m[2].trim();
  } else {
    const digitsOnly = s.replace(/[\s-]/g, '');
    if (/^\d{8}$|^\d{12,14}$/.test(digitsOnly)) {
      const gtin = pad14(digitsOnly);
      return { gtin, expiry: null, batch: null, serial: null, valid: gtinCheckDigitOk(gtin), format: 'linear' };
    }
    let i = 0;
    s = s.replace(/^\u001d/, '');
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      let code = null;
      for (const len of [2, 3, 4]) {
        const c = s.slice(i, i + len);
        if (FIXED[c] || VARIABLE.includes(c)) { code = c; break; }
      }
      if (!code) break;
      i += code.length;
      if (FIXED[code]) { ai[code] = s.slice(i, i + FIXED[code]); i += FIXED[code]; }
      else {
        let j = s.indexOf(GS, i);
        if (j === -1) j = s.length;
        ai[code] = s.slice(i, j).slice(0, 20);
        i = j;
      }
    }
  }
  const g = ai['01'] || ai['02'];
  if (!g || !/^\d{14}$/.test(g)) return null;
  return { gtin: g, expiry: expiryOf(ai['17']), batch: ai['10'] || null, serial: ai['21'] || null, valid: gtinCheckDigitOk(g), format };
}

export const isExpired = (iso, now = Date.now()) => Boolean(iso && Date.parse(iso + 'T23:59:59Z') < now);

/** Append the GS1 check digit to a body of 7, 11, 12 or 13 digits. */
export function withCheckDigit(body) {
  for (let c = 0; c <= 9; c++) if (gtinCheckDigitOk(body + c)) return body + c;
  return null;
}
