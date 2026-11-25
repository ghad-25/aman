// node test/golden.mjs  -> per-category report.
// Runs the v0.4 reference cases (query + search types, demo patients) against the live platform engine v1.3.
import fs from 'node:fs';
import { checkForPatient, didYouMean } from '../lib/engine.mjs';
import { demoPatients } from '../lib/demo.mjs';
// Condition reference cases: run without the demo allergies (allergy cases are in allergy.test.mjs).
const [sara, yousef] = demoPatients().map((x) => ({ ...x.data, allergies: [] }));
const P = { sara, yousef };
const RG = { oral: 'oral', iv: 'injection', im: 'injection', eye: 'ophthalmic', topical: 'topical', inhaled: 'inhaled' };
const L = { AVOID: 'avoid', CAUTION: 'caution', INFO: 'info', NO_WARNING: 'none' };
function parse(t){const rows=[];let row=[],cur='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c=='"'&&t[i+1]=='"'){cur+='"';i++}else if(c=='"')q=false;else cur+=c}else if(c=='"')q=true;else if(c==','){row.push(cur);cur=''}else if(c=='\n'){row.push(cur);cur='';if(row.some(x=>x))rows.push(row);row=[]}else if(c!='\r')cur+=c}if(cur||row.length){row.push(cur);rows.push(row)}const[h,...d]=rows;return d.map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])))}
const cases = parse(fs.readFileSync(new URL('./golden_cases.csv', import.meta.url),'utf8')).filter(c => P[c.patient] && (c.input_type==='query'||c.input_type==='search') && c.role==='staff');
const by={}; let pass=0, falseReassure=0, avoidT=0, avoidD=0; const fails=[];
for (const c of cases) {
  let r = checkForPatient(P[c.patient], { query: c.input, route: RG[c.route] || null });
  if (r.status==='need_route' && c.route) r = checkForPatient(P[c.patient], { query: c.input, route: RG[c.route] });
  if (c.input_type==='search' && r.status==='confirm' && c.expect_tier!=='NOT_IN_LIST') { // UI path: user confirms top suggestion
    const top = r.suggestions[0]; r = checkForPatient(P[c.patient], { query: c.input, key: top.key, route: RG[c.route]||null });
  }
  const got = r.status==='result' ? r.level : r.status;
  let ok;
  if (c.expect_tier==='NOT_IN_LIST') ok = r.status!=='result' || r.level!=='none' || r.verifyIngredients;
  else ok = r.status==='result' && r.level===L[c.expect_tier];
  if (r.status==='result' && r.level==='none' && !r.verifyIngredients && c.expect_tier!=='NO_WARNING') falseReassure++;
  if (c.expect_tier==='AVOID') { avoidT++; if (r.status==='result' && r.level==='avoid') avoidD++; }
  by[c.category] ??= {p:0,t:0}; by[c.category].t++; if (ok){by[c.category].p++;pass++} else fails.push(`${c.id} ${c.category} ${c.patient} "${c.input}" route=${c.route||'-'} expect=${c.expect_tier} got=${got}`);
}
export const summary = { total: cases.length, pass, avoidT, avoidD, falseReassure, fails, by };
if (process.argv[1] && process.argv[1].endsWith('golden.mjs')) {
for (const [k,v] of Object.entries(by)) console.log(k.padEnd(24), `${v.p}/${v.t}`);
console.log(`TOTAL ${pass}/${cases.length}; AVOID detected ${avoidD}/${avoidT}; false "no warning" ${falseReassure}`);
console.log(fails.join('\n'));
}
