// AMAN drug-check engine.
// One source of rules (lib/rules-data.mjs, generated from the clinical spreadsheet)
// builds both the emergency card lists and the drug check result.
// Principle carried over from v0.4: a wrong medicine is worse than no answer.
//   - only exact name matches are checked automatically;
//   - close spellings are offered as "did you mean" and need confirmation;
//   - any unknown word next to a known name means "check the other ingredients".
import DATA from './rules-data.mjs';
import EXTRA_ALIASES from './aliases-extra.mjs';

export const LEVELS = ['none', 'info', 'caution', 'avoid'];
const SEV = { AVOID: 'avoid', CAUTION: 'caution', INFO: 'info' };
const rank = (l) => LEVELS.indexOf(l);
const maxLevel = (a, b) => (rank(a) >= rank(b) ? a : b);

export const CLASS_AR = {
  'Fluoroquinolone antibiotic': 'مضادات حيوية من الكينولونات',
  'Ketolide antibiotic': 'مضاد حيوي (كيتوليد)',
  'Macrolide antibiotic': 'مضادات حيوية من الماكروليدات',
  'Aminoglycoside antibiotic': 'مضادات حيوية من الأمينوغليكوزيدات',
  'Aminoglycoside antibiotic (ophthalmic)': 'أمينوغليكوزيد (قطرة عين)',
  'Magnesium salt (parenteral)': 'المغنيسيوم بالوريد أو العضل',
  'Magnesium salt (oral)': 'المغنيسيوم بالفم',
  'Botulinum toxin': 'البوتوكس وما يشبهه',
  'Chelating / antirheumatic': 'بنسيلامين',
  'Antimalarial (quinoline)': 'الكينين',
  'Antimalarial (4-aminoquinoline)': 'مضادات الملاريا',
  'Antimalarial / DMARD': 'مضادات الملاريا (للروماتيزم)',
  'Antimalarial': 'مضادات الملاريا',
  'Class Ia antiarrhythmic': 'أدوية اضطراب نظم القلب (الفئة Ia)',
  'Class Ic antiarrhythmic': 'أدوية اضطراب نظم القلب (الفئة Ic)',
  'Beta-blocker': 'حاصرات بيتا',
  'Calcium-channel blocker': 'حاصرات قنوات الكالسيوم',
  'Statin': 'أدوية الكوليسترول (الستاتينات)',
  'Iodinated contrast agent': 'صبغات الأشعة اليودية',
  'Immune checkpoint inhibitor': 'أدوية المناعة للأورام',
  'Systemic corticosteroid': 'الكورتيزون عند البدء أو رفع الجرعة',
  'Iron chelator': 'خالب الحديد',
  'Depolarising neuromuscular blocker (anaesthesia/RSI)': 'مرخيات العضلات في التخدير',
  'Non-depolarising neuromuscular blocker (anaesthesia/RSI)': 'مرخيات العضلات في التخدير',
  'Inhaled anaesthetic': 'غازات التخدير',
  'Benzodiazepine': 'المهدئات (البنزوديازيبينات)',
  'Antipsychotic': 'مضادات الذهان',
  'Mood stabiliser': 'الليثيوم',
  'Gabapentinoid': 'جابابنتين وبريجابالين',
  'Interferon': 'الإنترفيرون',
  'Urate oxidase (tumour lysis)': 'أدوية خفض حمض اليوريك الوريدية',
  'Urate oxidase (gout)': 'أدوية خفض حمض اليوريك الوريدية',
  'Sulfone (antibacterial/anti-inflammatory)': 'دابسون',
  'Methaemoglobinaemia antidote / dye': 'أزرق الميثيلين',
  '8-aminoquinoline antimalarial': 'بريماكوين وتافينوكوين',
  'Diagnostic dye': 'صبغات تشخيصية',
  'Urinary antibacterial': 'نيتروفورانتوين',
  'Cyanide antidote': 'ترياق السيانيد',
  'BRAF inhibitor (oncology)': 'أدوية أورام',
  'Local anaesthetic (topical)': 'مخدر موضعي',
  'Urinary analgesic': 'مسكن المسالك البولية',
  'Sulfonamide antibacterial': 'السلفا',
  'Aminosalicylate (IBD/RA)': 'سلفاسالازين',
  'Sulfonylurea': 'أدوية السكري (السلفونيل يوريا)',
};

export const ROUTE_GROUPS = {
  oral: { ar: 'بالفم (حبوب أو شراب)', routes: ['oral'] },
  injection: { ar: 'إبرة (وريد أو عضل)', routes: ['iv', 'im', 'sc', 'intradermal', 'intra-arterial'] },
  ophthalmic: { ar: 'قطرة عين', routes: ['ophthalmic'] },
  topical: { ar: 'موضعي (كريم أو جل أو للفم)', routes: ['topical', 'oral_mucosa', 'dental'] },
  inhaled: { ar: 'استنشاق أو بخاخ', routes: ['inhaled'] },
};
const groupOfRoute = (r) => Object.keys(ROUTE_GROUPS).find((g) => ROUTE_GROUPS[g].routes.includes(r));

export function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[\/\-_+،,؛;:()\[\]{}"'.&]/g, ' ')
    .replace(/[^\p{L}\p{N}\s%]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const stripAl = (w) => (w.length > 4 && w.startsWith('ال') ? w.slice(2) : w);
const variants = (n) => {
  const a = norm(n);
  const b = a.split(' ').map(stripAl).join(' ');
  return a === b ? [a] : [a, b];
};

// ---------- name index ----------
const NAME_INDEX = new Map(); // normalized name -> key
const NAME_LIST = []; // {n, key, label}
for (const [key, m] of Object.entries(DATA.meds)) {
  for (const raw of m.names.concat([m.en, m.ar])) {
    if (!raw) continue;
    for (const v of variants(raw)) {
      if (!v) continue;
      if (!NAME_INDEX.has(v)) NAME_INDEX.set(v, key);
      NAME_LIST.push({ n: v, key, label: raw });
    }
  }
}
// Extra aliases (QA rounds): only for keys that exist, and never overriding a name already indexed.
const ND_INDEX = new Map(); // normalized non-drug name -> ND id
for (const { alias, target } of EXTRA_ALIASES) {
  if (target.startsWith('ND-')) { for (const v of variants(alias)) ND_INDEX.set(v, target); continue; }
  const key = target.split('|').find((k) => DATA.meds[k]) || (DATA.meds[target.replace(/-/g, ' ')] ? target.replace(/-/g, ' ') : null);
  if (!key) continue;
  for (const v of variants(alias)) {
    if (!v || NAME_INDEX.has(v)) continue;
    NAME_INDEX.set(v, key);
    NAME_LIST.push({ n: v, key, label: alias });
  }
}
const ROUTE_ALIAS = new Map(Object.entries(DATA.routeAlias).map(([k, v]) => [norm(k), v]));

// Words that only describe dose, form or route. They are removed before matching.
const ROUTE_WORDS = {
  ophthalmic: ['eye', 'eyes', 'ophthalmic', 'قطره', 'قطرات', 'عين', 'للعين', 'العين', 'عيون'],
  injection: ['iv', 'im', 'sc', 'inj', 'injection', 'injectable', 'ampoule', 'amp', 'vial', 'infusion', 'حقن', 'حقنه', 'ابره', 'ابر', 'وريد', 'بالوريد', 'وريدي', 'الوريد', 'عضل', 'بالعضل', 'عضلي', 'العضل', 'مغذي', 'امبول'],
  inhaled: ['inhaler', 'inhalation', 'inhaled', 'nebuliser', 'nebulizer', 'بخاخ', 'استنشاق', 'بالاستنشاق', 'جلسه'],
  topical: ['cream', 'ointment', 'gel', 'topical', 'lotion', 'كريم', 'مرهم', 'جل', 'موضعي', 'دهان', 'لوشن'],
  oral: ['tablet', 'tablets', 'tab', 'tabs', 'cap', 'caps', 'capsule', 'capsules', 'syrup', 'suspension', 'susp', 'oral', 'sachet', 'حبوب', 'حبه', 'قرص', 'اقراص', 'كبسول', 'كبسوله', 'كبسولات', 'شراب', 'معلق', 'بالفم', 'فموي', 'فوار', 'اكياس', 'كيس'],
};
const ROUTE_WORD_MAP = new Map();
for (const [g, ws] of Object.entries(ROUTE_WORDS)) for (const w of ws) ROUTE_WORD_MAP.set(norm(w), g);
const NOISE = new Set(['mg', 'g', 'gm', 'mcg', 'µg', 'ml', 'iu', 'unit', 'units', 'مجم', 'ملغ', 'ملجم', 'ملج', 'مغ', 'جم', 'غم', 'مل', 'ملم', 'وحده', 'drops', 'drop', 'نقط', 'نقطه', 'دواء', 'علاج', 'حبوب', 'mg/ml', 'ممغ']);
const isNoise = (t) => NOISE.has(t) || /^\d+([.,]\d+)?(mg|g|ml|mcg|%|iu)?$/.test(t) || /^%$/.test(t);

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function medInfo(key) {
  const m = DATA.meds[key];
  return m ? { key, ar: m.ar || m.en, en: m.en } : null;
}

/** Parse free text into medicine keys, a route hint and leftover unknown words. */
const startsName = (t) => NAME_INDEX.has(t) || NAME_LIST.some((x) => x.n.startsWith(t + ' '));
export function parseQuery(text) {
  const q = norm(text);
  // "بنادول وسيبرو": a joined Arabic "و" (and) before a medicine name is split off.
  const tokens = q.split(' ').filter(Boolean).map((t) => (t.length > 3 && t.startsWith('و') && !NAME_INDEX.has(t) && !ROUTE_WORD_MAP.has(t) && startsName(t.slice(1)) ? t.slice(1) : t));
  let route = null;
  // 1) names first (a name may itself contain a route word, e.g. "oral typhoid vaccine")
  const used = new Array(tokens.length).fill(false);
  const keys = [];
  for (let len = Math.min(tokens.length, 6); len >= 1; len--) {
    for (let i = 0; i + len <= tokens.length; i++) {
      if (used.slice(i, i + len).some(Boolean)) continue;
      const win = tokens.slice(i, i + len).join(' ');
      if (len === 1 && (isNoise(win) || ROUTE_WORD_MAP.has(win))) continue;
      const key = NAME_INDEX.get(win) || NAME_INDEX.get(tokens.slice(i, i + len).map(stripAl).join(' '));
      if (key) {
        for (let j = i; j < i + len; j++) used[j] = true;
        if (!keys.includes(key)) keys.push(key);
        const ra = ROUTE_ALIAS.get(win);
        if (ra && !route) route = groupOfRoute(ra);
      }
    }
  }
  // 2) leftover words: route hints, dose/form noise, or unknown
  const unknown = [];
  // "+" or "plus" is a different product (Adol + = paracetamol + another ingredient): never a silent match.
  if (/[+＋]/.test(String(text))) unknown.push('+');
  tokens.forEach((t, i) => {
    if (used[i]) return;
    const g = ROUTE_WORD_MAP.get(t) || ROUTE_WORD_MAP.get(stripAl(t));
    if (g) { route = route || g; return; }
    // A short bare number right after a name is part of the name (vitamin K3, 5-ASA), not a dose.
    if (/^\d{1,2}$/.test(t) && !(tokens[i + 1] && isNoise(tokens[i + 1]))) { unknown.push(t); return; }
    if (isNoise(t) || /^\d+$/.test(t) || t.length < 2) return;
    unknown.push(t);
  });
  return { keys, route, unknown, normalized: q };
}

/** Typeahead: names that start with / contain the text. Display only, never auto-checked. */
export function suggest(text, limit = 8) {
  const q = norm(text);
  if (q.length < 2) return [];
  const seen = new Map();
  const score = (n) => (n === q ? 0 : n.startsWith(q) ? 1 : n.split(' ').some((w) => w.startsWith(q)) ? 2 : n.includes(q) ? 3 : 9);
  for (const e of NAME_LIST) {
    const s = score(e.n);
    if (s > 3) continue;
    const prev = seen.get(e.key);
    if (!prev || s < prev.s) seen.set(e.key, { s, label: e.label });
  }
  return [...seen.entries()]
    .sort((a, b) => a[1].s - b[1].s || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, v]) => ({ ...medInfo(key), matched: v.label }));
}

/** Close spellings for a query with no exact match. */
export function didYouMean(text, limit = 5) {
  const q = norm(text).split(' ').filter((t) => !isNoise(t) && !ROUTE_WORD_MAP.has(t)).join(' ');
  if (q.length < 3) return [];
  const best = new Map();
  for (const e of NAME_LIST) {
    const tol = e.n.length >= 9 ? 2 : 1;
    const candidates = [q, ...q.split(' ').filter((t) => t.length >= 4)];
    for (const c of candidates) {
      const d = lev(c, e.n);
      if (d <= tol || (c.length >= 4 && e.n.startsWith(c))) {
        const s = e.n.startsWith(c) ? 0.5 : d;
        const prev = best.get(e.key);
        if (prev === undefined || s < prev) best.set(e.key, s);
      }
    }
  }
  return [...best.entries()].sort((a, b) => a[1] - b[1]).slice(0, limit).map(([k]) => medInfo(k));
}

/** Resolve a patient's free-text medicine name to known keys (exact names only). */
export function resolveMedKeys(name) {
  return parseQuery(name).keys;
}

function routeMatches(ruleRoutes, group) {
  if (!group) return true;
  if (ruleRoutes.includes('*')) return true;
  return ruleRoutes.some((r) => ROUTE_GROUPS[group].routes.includes(r));
}
const routeGroupsOf = (routes) => (routes.includes('*') ? Object.keys(ROUTE_GROUPS) : [...new Set(routes.map(groupOfRoute).filter(Boolean))]);

export const condName = (c) => DATA.conditions[c]?.ar || c;
export const conditions = () => DATA.conditions;

// ---------- allergies (library: data/aman_allergy_library_v1.xlsx) ----------
// A patient allergy: { group, key, reaction, year, certainty, note }.
//   group = allergy family from the library (penicillin, nsaid, egg ...), key = the medicine that caused it (if known).
// At least one of them is required, so every allergy can be checked; free text is never matched silently.
const ALG = DATA.allergy;
export const REACTIONS = {
  anaphylaxis: { ar: 'صدمة تحسسية أو تورم الوجه أو الحلق أو ضيق تنفس', short: 'صدمة تحسسية', tier: 'severe' },
  scar: { ar: 'تقشّر أو فقاعات بالجلد أو إصابة أعضاء (مثل ستيفنز جونسون)', short: 'تفاعل جلدي شديد', tier: 'scar' },
  hives: { ar: 'شرى (حكة وانتفاخات بالجلد)', short: 'شرى', tier: 'mild' },
  rash: { ar: 'طفح جلدي خفيف', short: 'طفح جلدي', tier: 'mild' },
  intolerance: { ar: 'عرض جانبي وليس حساسية (غثيان أو إسهال أو صداع)', short: 'عرض جانبي', tier: 'intolerance' },
  unknown: { ar: 'غير معروف', short: 'تفاعل غير معروف', tier: 'unknown' },
};
export const CERTAINTY = { tested: 'مؤكدة بفحص حساسية', documented: 'موثقة طبيًا', reported: 'حسب كلام المريض أو الأهل' };
const RAISE = { info: 'caution', caution: 'avoid', avoid: 'avoid' };
const LOW_RISK_NOTE = 'السجل يشير إلى حساسية منخفضة الخطورة (تفاعل خفيف قبل أكثر من 5 سنوات، وغير مؤكد بفحص). كثير من هذه الحالات ليست حساسية حقيقية، وقد يستفيد المريض من تقييم الحساسية بقرار الطبيب.';
const NOT_ALLERGY_NOTE = 'العرض المسجّل جانبي وليس حساسية. يمكن للطبيب مراجعة التسمية وإزالتها.';

export const allergyLibrary = () => ({
  version: ALG.version,
  groups: Object.entries(ALG.groups).map(([id, g]) => ({ id, ar: g.ar, en: g.en, kind: g.kind })),
  reactions: Object.entries(REACTIONS).map(([id, r]) => ({ id, ar: r.ar })),
  certainty: Object.entries(CERTAINTY).map(([id, ar]) => ({ id, ar })),
});
const classesOf = (k) => ALG.drugClasses[k] || [];
const r1Of = (k) => classesOf(k).filter((c) => c.startsWith('r1_'));

/** Groups an allergy belongs to: the chosen family, plus the family of the culprit medicine. */
export function allergyGroups(a) {
  const s = new Set();
  if (a.group && ALG.groups[a.group]) s.add(a.group);
  if (a.key) for (const [id, g] of Object.entries(ALG.groups)) if (g.members.some((c) => classesOf(a.key).includes(c))) s.add(id);
  return [...s];
}
export function allergyLabel(a) {
  const gid = a.group && ALG.groups[a.group] ? a.group : allergyGroups(a)[0];
  const g = gid ? ALG.groups[gid].ar : '';
  const d = a.key && DATA.meds[a.key] ? medInfo(a.key).ar : '';
  if (g && d) return `${g} (${d})`;
  if (g) return g;
  if (d) return `حساسية ${d}`;
  return a.name ? `حساسية: ${a.name}` : 'حساسية غير محددة';
}
const tierOf = (a) => (REACTIONS[a.reaction] || REACTIONS.unknown).tier;
export function allergyLowRisk(a) {
  const yr = parseInt(a.year, 10);
  return tierOf(a) === 'mild' && yr > 1900 && new Date().getFullYear() - yr > 5 && a.certainty !== 'tested'
    && allergyGroups(a).some((g) => ALG.groups[g].delabel);
}
function applies(rule, a) {
  const cc = a.key ? classesOf(a.key) : [];
  const [kind, cls] = rule.appliesIf.split(':');
  if (kind === 'any') return true;
  if (kind === 'culprit_known') return Boolean(a.key);
  if (kind === 'culprit_unknown') return !a.key;
  if (kind === 'culprit_in') return cc.includes(cls);
  if (kind === 'culprit_not_in') return !cc.includes(cls);
  return false;
}
function hitsTarget(rule, k, a) {
  const [kind, val] = rule.target.split(':');
  if (kind === 'class') return classesOf(k).includes(val);
  if (kind === 'drug') return k === val;
  if (rule.target === 'r1:same') return Boolean(a.key) && k !== a.key && r1Of(a.key).some((c) => r1Of(k).includes(c));
  return false;
}
function adjust(level, rule, a) {
  const t = tierOf(a);
  if (t === 'intolerance') return 'info';
  if (t === 'severe' && rule?.severityIfSevere) return SEV[rule.severityIfSevere];
  if (t === 'scar') return RAISE[level];
  return level;
}
function allergyNotes(a) {
  const notes = [];
  const r = REACTIONS[a.reaction] || REACTIONS.unknown;
  notes.push(`التفاعل السابق: ${r.short}${a.year ? ` (${a.year})` : ''} · ${CERTAINTY[a.certainty] || CERTAINTY.reported}.`);
  if (r.tier === 'scar') notes.push('تفاعل جلدي شديد سابق: لا يُعاد التعرض لهذه العائلة إلا بقرار أخصائي حساسية.');
  if (r.tier === 'intolerance') notes.push(NOT_ALLERGY_NOTE);
  if (allergyLowRisk(a)) notes.push(LOW_RISK_NOTE);
  return notes;
}

/** One allergy against one medicine key: the strongest finding, or null. */
export function allergyFinding(a, k) {
  const groups = allergyGroups(a);
  let best = null;
  const consider = (level, rule, reason, action, ruleId, sources, urls) => {
    if (!best || rank(level) > rank(best.level)) best = { level, reason, action, ruleId, source: sources, urls, rule };
  };
  if (a.key && a.key === k) {
    consider(adjust('avoid', null, a), null, 'هذا هو الدواء المسجّل في حساسية المريض.', 'لا يُعطى إلا بقرار الطبيب.', null, 'ملف المريض', []);
  }
  for (const rule of ALG.rules) {
    if (!groups.includes(rule.allergy) || !applies(rule, a) || !hitsTarget(rule, k, a)) continue;
    consider(adjust(SEV[rule.severity], rule, a), rule, rule.reason, rule.action, rule.id, rule.sources, rule.urls);
  }
  if (!best) return null;
  return {
    type: 'allergy', level: best.level, ruleId: best.ruleId, with: allergyLabel(a),
    reason: best.reason, action: best.action, source: best.source, urls: best.urls,
    version: best.rule ? ALG.version : undefined, license: best.rule?.license, notes: allergyNotes(a),
  };
}
const allergyCheckable = (a) => Boolean((a.group && ALG.groups[a.group]) || (a.key && DATA.meds[a.key]));

/** Emergency-card summary per allergy: which families to avoid / give with caution / are usually fine. */
export function allergyCard(patient) {
  return (patient.allergies || []).map((a) => {
    const groups = allergyGroups(a);
    const out = { avoid: new Map(), caution: new Map(), info: new Map() };
    const put = (level, label) => {
      for (const l of ['avoid', 'caution', 'info']) if (out[l].has(label) && rank(l) >= rank(level)) return;
      for (const l of ['avoid', 'caution', 'info']) out[l].delete(label);
      out[level].set(label, true);
    };
    if (a.key && DATA.meds[a.key]) put(adjust('avoid', null, a), medInfo(a.key).ar);
    for (const rule of ALG.rules) {
      if (!groups.includes(rule.allergy) || !applies(rule, a)) continue;
      const [kind, val] = rule.target.split(':');
      const label = kind === 'class' ? ALG.classes[val].ar : kind === 'drug' ? (medInfo(val)?.ar || val)
        : `سيفالوسبورينات لها نفس السلسلة الجانبية لـ${medInfo(a.key)?.ar || 'الدواء المسبب'}`;
      if (rule.target === 'r1:same' && !a.key) continue;
      put(adjust(SEV[rule.severity], rule, a), label);
    }
    const r = REACTIONS[a.reaction] || REACTIONS.unknown;
    return {
      label: allergyLabel(a), reaction: r.short, year: a.year || '', certainty: CERTAINTY[a.certainty] || CERTAINTY.reported,
      lowRisk: allergyLowRisk(a), notAllergy: r.tier === 'intolerance', severe: r.tier === 'severe' || r.tier === 'scar', note: a.note || '',
      avoid: [...out.avoid.keys()], caution: [...out.caution.keys()], info: [...out.info.keys()],
    };
  });
}

function patientKeys(patient) {
  const s = new Set();
  for (const m of patient.meds || []) for (const k of m.keys || resolveMedKeys(m.name)) s.add(k);
  return s;
}

function ruleFinding(rule, patient, takes) {
  let level = SEV[rule.severity];
  const notes = [];
  const removed = (patient.removedRules || []).includes(rule.id);
  if (removed) {
    if (level === 'avoid') level = 'caution';
    notes.push('أزاله الطبيب المعالج من قائمة التجنّب لهذا المريض، ويبقى ظاهرًا للحذر.');
  }
  if (rule.appliesWhen === 'initiation_or_high_dose' && rule.keys.some((k) => takes.has(k))) {
    level = 'info';
    notes.push('يستخدمه المريض حاليًا بجرعة ثابتة. التحذير عند البدء أو رفع الجرعة.');
  }
  return {
    type: 'condition', level, ruleId: rule.id,
    with: condName(rule.condition),
    reason: rule.reason, action: rule.action, alternative: rule.alternative, monitor: rule.monitor,
    source: rule.sources, urls: rule.urls, version: DATA.conditions[rule.condition]?.version,
    routeScope: rule.routeScope, notes, removed,
  };
}

/**
 * Check one medicine (by text or confirmed key) for one patient.
 * Returns {status: 'result'|'confirm'|'need_route'|'unknown', ...}
 */
export function checkForPatient(patient, { query = '', key = null, route = null } = {}) {
  const conds = patient.conditions || [];
  let parsed;
  if (key) {
    if (!DATA.meds[key]) return { status: 'unknown', query };
    const p = parseQuery(query || '');
    parsed = { keys: [key], route: route || p.route, unknown: [] };
  } else {
    parsed = parseQuery(query);
    if (route) parsed.route = route;
  }

  // Doctor-added items are matched on the patient's own text as well.
  const custom = (patient.customAvoid || []).filter((c) => {
    const ck = c.keys && c.keys.length ? c.keys : resolveMedKeys(c.name);
    if (parsed.keys.some((k) => ck.includes(k))) return true;
    const cn = norm(c.name);
    return Boolean(query && cn && (' ' + norm(query) + ' ').includes(' ' + cn + ' '));
  });

  // Non-drug triggers (fava beans, naphthalene): matched on whole words, shown as a warning, never sent to the doctor.
  const nq = ' ' + norm(query).split(' ').map(stripAl).join(' ') + ' ';
  const ndIds = new Set();
  for (const [n, id] of ND_INDEX) { const nn = n.split(' ').map(stripAl).join(' '); if (nq.includes(' ' + nn + ' ')) ndIds.add(id); }
  const ndHits = DATA.nonDrug.filter((n) => ndIds.has(n.id) && conds.includes(n.condition) && SEV[n.severity]);
  if (!parsed.keys.length && !custom.length && ndHits.length) {
    const findings = ndHits.map((n) => ({ type: 'nonDrug', level: SEV[n.severity], ruleId: n.id, with: condName(n.condition), reason: n.advice, action: 'ليس دواءً: يُتجنّب تمامًا. إذا تعرّض له المريض راقب علامات تكسّر الدم وراجع الطبيب.', notes: [] }));
    let lv = 'none'; for (const f of findings) lv = maxLevel(lv, f.level);
    return { status: 'result', query, level: lv, nonDrugOnly: true, drug: ndHits.map((n) => ({ key: null, ar: n.ar.replace(/\s*\(.*?\)\s*/g, ' ').trim(), en: n.en })), route: null, findings, noWarningFor: [], notReviewedFor: [], conditions: conds.map((c) => ({ code: c, ar: condName(c), version: DATA.conditions[c]?.version })), alreadyTaking: [], verifyIngredients: false, unknownWords: [] };
  }

  if (!parsed.keys.length && !custom.length) {
    const sug = didYouMean(query);
    if (sug.length) return { status: 'confirm', query, suggestions: sug };
    return { status: 'unknown', query };
  }

  const takes = patientKeys(patient);
  const findings = [];
  const noWarningFor = [];
  const notReviewed = [];
  const routeOptions = new Set();

  for (const c of custom) {
    findings.push({ type: 'doctor', level: 'avoid', with: 'قرار الطبيب المعالج', reason: c.note || 'أضافه الطبيب المعالج إلى قائمة التجنّب لهذا المريض.', action: 'لا يُعطى إلا بعد التواصل مع الطبيب المعالج.', notes: [] });
  }

  for (const k of parsed.keys) {
    for (const c of conds) {
      const rules = DATA.rules.filter((r) => r.condition === c && r.keys.includes(k));
      const nw = DATA.noWarning.filter((r) => r.condition === c && r.key === k);
      let cand = [...rules.map((r) => ({ kind: 'rule', r, routes: r.routes, sev: r.severity })), ...nw.map((r) => ({ kind: 'nw', r, routes: r.routes, sev: 'NONE' }))];
      if (parsed.route) {
        cand = cand.filter((x) => routeMatches(x.routes, parsed.route));
      } else if (cand.length > 1) {
        // Ask for the route only when the answer really differs by route.
        const SEVR = { NONE: 0, INFO: 1, CAUTION: 2, AVOID: 3 };
        const groups = new Set(cand.flatMap((x) => routeGroupsOf(x.routes)));
        const outcome = new Map();
        for (const g of groups) {
          const here = cand.filter((x) => routeGroupsOf(x.routes).includes(g));
          outcome.set(g, Math.max(...here.map((x) => SEVR[x.sev])));
        }
        if (new Set(outcome.values()).size > 1) {
          groups.forEach((g) => routeOptions.add(g));
          continue;
        }
      }
      const rs = cand.filter((x) => x.kind === 'rule');
      for (const x of rs) findings.push(ruleFinding(x.r, patient, takes));
      // "No warning" only for a medicine the list actually reviewed for this condition (a no-warning row).
      // Anything else is "not in the list: check with the pharmacist", never a reassurance.
      if (!rs.length) {
        if (cand.some((x) => x.kind === 'nw')) noWarningFor.push(condName(c));
        else notReviewed.push(condName(c));
      }
    }
    const local = parsed.route === 'ophthalmic' || parsed.route === 'topical';
    for (const ix of DATA.interactions) {
      if (local || !ix.newMeds.includes(k)) continue;
      const hit = ix.patientMeds.filter((pm) => takes.has(pm));
      if (!hit.length) continue;
      findings.push({
        type: 'interaction', level: SEV[ix.severity], ruleId: ix.id,
        with: hit.map((h) => medInfo(h)?.ar || h).join('، '),
        reason: ix.reason, action: ix.action, monitor: ix.monitor, source: ix.sources, notes: [],
      });
    }
    // Allergies apply to every route. "No warning" is said only for an allergy the library can check.
    for (const a of patient.allergies || []) {
      if (!allergyCheckable(a)) { notReviewed.push(allergyLabel(a)); continue; }
      const f = allergyFinding(a, k);
      if (f) findings.push(f);
      else noWarningFor.push(allergyLabel(a));
    }
  }

  if (routeOptions.size) {
    return {
      status: 'need_route', query,
      drug: parsed.keys.map(medInfo),
      options: [...routeOptions].map((g) => ({ id: g, ar: ROUTE_GROUPS[g].ar })),
    };
  }

  if (!findings.length && notReviewed.length) {
    return { status: 'unknown', query, notInList: true, drug: parsed.keys.map(medInfo), notReviewedFor: [...new Set(notReviewed)] };
  }

  let level = 'none';
  for (const f of findings) level = maxLevel(level, f.level);
  // A record not confirmed by the treating doctor for more than 6 months never says "no warning".
  const staleRecord = patient.lastConfirmedAt && (Date.now() - Date.parse(patient.lastConfirmedAt)) / 86400000 > 180;
  if (level === 'none' && staleRecord) {
    return { status: 'unknown', query, stale: true, drug: parsed.keys.map(medInfo) };
  }
  const order = (f) => -rank(f.level);
  findings.sort((a, b) => order(a) - order(b));

  const drugs = parsed.keys.map(medInfo);
  const alreadyTaking = parsed.keys.filter((k) => takes.has(k)).map((k) => medInfo(k).ar);
  const verifyIngredients = parsed.unknown.length > 0;

  return {
    status: 'result', query, level,
    drug: drugs.length ? drugs : [{ key: null, ar: query, en: '' }],
    route: parsed.route ? { id: parsed.route, ar: ROUTE_GROUPS[parsed.route].ar } : null,
    findings,
    noWarningFor: [...new Set(noWarningFor)],
    notReviewedFor: [...new Set(notReviewed)],
    conditions: conds.map((c) => ({ code: c, ar: condName(c), version: DATA.conditions[c]?.version })),
    alreadyTaking,
    verifyIngredients,
    unknownWords: parsed.unknown,
  };
}

const PATIENT_MSG = 'راجع الصيدلي قبل ما تاخذه';

/** What the patient or family sees: the alert and the reason in plain words, never the plan. */
export function patientView(res) {
  if (res.status !== 'result') return res;
  return {
    status: 'result', query: res.query, level: res.level, drug: res.drug, route: res.route,
    reasons: [...new Set(res.findings.map((f) => f.reason).filter(Boolean))].slice(0, 2),
    noWarningFor: res.noWarningFor, notReviewedFor: res.notReviewedFor, conditions: res.conditions,
    alreadyTaking: res.alreadyTaking, verifyIngredients: res.verifyIngredients,
    message: PATIENT_MSG, viewer: 'patient',
  };
}

/** Emergency-card lists for a patient, grouped by level then by medicine class. */
export function cardLists(patient) {
  const removed = new Set(patient.removedRules || []);
  const takes = patientKeys(patient);
  const groups = { avoid: new Map(), caution: new Map(), info: new Map() };
  for (const c of patient.conditions || []) {
    for (const r of DATA.rules.filter((x) => x.condition === c)) {
      const f = ruleFinding(r, patient, takes);
      const lvl = f.level;
      const cls = CLASS_AR[r.class] || r.class;
      const gkey = `${c}|${cls}|${removed.has(r.id) ? 'removed' : ''}`;
      const g = groups[lvl].get(gkey) || { condition: c, conditionAr: condName(c), classAr: cls, reason: r.reason, action: r.action, removed: removed.has(r.id), items: [] };
      g.items.push({ ruleId: r.id, ar: r.ar.replace(/\s*\(.*?\)\s*/g, ' ').trim(), en: r.en.replace(/\s*\(.*?\)\s*/g, ' ').trim(), notes: f.notes });
      groups[lvl].set(gkey, g);
    }
  }
  const custom = (patient.customAvoid || []).map((c) => ({ name: c.name, note: c.note || '' }));
  return {
    avoid: [...groups.avoid.values()],
    caution: [...groups.caution.values()],
    info: [...groups.info.values()],
    custom,
    nonDrug: DATA.nonDrug.filter((n) => (patient.conditions || []).includes(n.condition) && n.severity !== 'INFO')
      .map((n) => ({ ar: n.ar, advice: n.advice })),
    allergies: allergyCard(patient),
    allergyVersion: ALG.version,
  };
}

/** Library listing for the doctor's editor. */
export function libraryFor(conds) {
  return (conds || []).map((c) => ({
    code: c, ar: condName(c), version: DATA.conditions[c]?.version,
    rules: DATA.rules.filter((r) => r.condition === c).map((r) => ({ id: r.id, ar: r.ar, en: r.en, level: SEV[r.severity], classAr: CLASS_AR[r.class] || r.class })),
  }));
}

export const RULE_IDS = new Set(DATA.rules.map((r) => r.id));
export const stats = () => ({ rules: DATA.rules.length, names: NAME_LIST.length, meds: Object.keys(DATA.meds).length, interactions: DATA.interactions.length, allergyRules: ALG.rules.length, allergyGroups: Object.keys(ALG.groups).length });
