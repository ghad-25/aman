"""Build lib/rules-data.mjs from data/aman_drug_rules_draft_v2.xlsx.

Run:  python3 scripts/build_rules.py
The spreadsheet is the single source of truth: the emergency card and the
drug checker are both generated from the JSON this script writes.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "data" / "aman_drug_rules_draft_v2.xlsx"
OUT = ROOT / "lib" / "rules-data.mjs"

COND = {"Myasthenia gravis": "MG", "MG": "MG", "G6PD deficiency": "G6PD", "G6PD": "G6PD"}

# Words inside parentheses that are synonyms (not route notes).
SYNONYMS = {
    "paracetamol": ["acetaminophen"],
    "aspirin": ["acetylsalicylic acid"],
    "methylene blue": ["methylthioninium chloride", "methylthioninium"],
    "desferrioxamine": ["deferoxamine"],
    "glibenclamide": ["glyburide"],
    "succinylcholine": ["suxamethonium"],
    "rifampicin": ["rifampin"],
    "toluidine blue": ["tolonium chloride"],
    "interferon alfa": ["peginterferon alfa", "interferon", "peginterferon"],
    "co-trimoxazole": ["sulfamethoxazole/trimethoprim", "trimethoprim/sulfamethoxazole",
                       "sulfamethoxazole trimethoprim", "trimethoprim sulfamethoxazole",
                       "sulfamethoxazole", "cotrimoxazole", "smx-tmp", "tmp-smx"],
    "onabotulinumtoxinA": ["botulinum toxin", "botulinum toxin type a"],
}

# Keys that should also be reachable from a broader word (rule belongs to both keys).
EXTRA_KEYS = {"magnesium sulfate": ["magnesium"]}

# Arabic names for medicines that appear only in the interaction or no-warning sheets.
EXTRA_AR = {
    "allopurinol": ["ألوبيورينول", "الوبيورينول", "زيلوريك"],
    "febuxostat": ["فيبوكسوستات", "أدينوريك"],
    "ibuprofen": ["إيبوبروفين", "ايبوبروفين", "بروفين", "بروفن"],
    "naproxen": ["نابروكسين", "نابروسين"],
    "diclofenac": ["ديكلوفيناك", "فولتارين", "كتافلام"],
    "warfarin": ["وارفارين", "ماريفان"],
    "rifampicin": ["ريفامبيسين", "ريفامبين"],
    "enalapril": ["إنالابريل", "انالابريل"],
    "lisinopril": ["ليسينوبريل", "زيستريل"],
    "atropine": ["أتروبين", "اتروبين"],
    "paracetamol": ["باراسيتامول", "بنادول", "أدول", "ادول", "فيفادول", "تايلينول"],
    "measles-mumps-rubella vaccine": ["لقاح الحصبة", "لقاح الحصبة والنكاف والحصبة الألمانية", "mmr", "mmr vaccine"],
    "varicella vaccine": ["لقاح الجديري", "لقاح جدري الماء", "varivax"],
    "yellow fever vaccine": ["لقاح الحمى الصفراء", "stamaril"],
    "oral typhoid vaccine": ["لقاح التيفوئيد الفموي", "vivotif"],
}

ROUTE_TOKENS = ["oral mucosa", "intra-arterial", "intradermal", "ophthalmic", "inhaled", "topical",
                "dental", "oral", "iv", "im", "sc", "any"]


def base(name):
    if name is None:
        return ""
    n = str(name).strip()
    n = re.sub(r"\s*\(.*?\)\s*", " ", n).strip()
    return re.sub(r"\s+", " ", n)


def key_of(name):
    b = base(name).lower()
    if b in ("sulfamethoxazole/trimethoprim", "sulfamethoxazole"):
        return "co-trimoxazole"
    if b.startswith("onabotulinumtoxina"):
        return "onabotulinumtoxinA"
    return b


def routes_of(scope):
    s = (scope or "any").lower()
    s = s.replace("systemic", "")
    found = []
    rest = s
    for t in ROUTE_TOKENS:
        if re.search(r"(?<![a-z])" + re.escape(t) + r"(?![a-z])", rest):
            found.append(t.replace(" ", "_"))
            rest = re.sub(r"(?<![a-z])" + re.escape(t) + r"(?![a-z])", " ", rest)
    if not found or "any" in found:
        return ["*"]
    return found


def rows(ws, header_row=1):
    data = list(ws.iter_rows(values_only=True))
    h = [str(x).strip() if x else "" for x in data[header_row - 1]]
    out = []
    for r in data[header_row:]:
        if not r or not r[0]:
            continue
        out.append({h[i]: r[i] for i in range(len(h)) if h[i]})
    return out


def clean(v):
    if v is None:
        return ""
    return str(v).strip()


def main():
    wb = openpyxl.load_workbook(XLSX, data_only=True)
    names = {}  # key -> {"en": display en, "ar": display ar, "names": set()}

    def add_name(key, n, en=None, ar=None):
        e = names.setdefault(key, {"en": "", "ar": "", "names": set()})
        if en and not e["en"]:
            e["en"] = en
        if ar and not e["ar"]:
            e["ar"] = ar
        if n:
            e["names"].add(str(n).strip())

    rules = []
    for sheet in ("MG_rules", "G6PD_rules"):
        for r in rows(wb[sheet]):
            cond = COND[r["condition"]]
            k = key_of(r["ingredient_en"])
            keys = [k] + EXTRA_KEYS.get(k, [])
            en_disp = base(r["ingredient_en"])
            ar_disp = clean(r["ingredient_ar"])
            add_name(k, en_disp, en=en_disp, ar=base(ar_disp))
            add_name(k, base(ar_disp))
            for syn in SYNONYMS.get(k, []):
                add_name(k, syn)
            sev = clean(r["proposed_severity"]).upper()
            if sev not in ("AVOID", "CAUTION", "INFO"):
                print("skip severity", r["rule_id"], sev, file=sys.stderr)
                continue
            urls = [u.strip() for u in clean(r.get("source_urls")).split("|") if u.strip()]
            rules.append({
                "id": r["rule_id"], "condition": cond, "keys": keys,
                "en": clean(r["ingredient_en"]), "ar": ar_disp,
                "class": clean(r.get("class")),
                "routes": routes_of(r.get("route_scope")), "routeScope": clean(r.get("route_scope")),
                "appliesWhen": clean(r.get("applies_when")) or "any",
                "severity": sev,
                "reason": clean(r.get("reason_ar")), "action": clean(r.get("action_staff_ar")),
                "alternative": clean(r.get("alternative_from_source")),
                "monitor": clean(r.get("monitor_ar")),
                "sources": clean(r.get("source_ids")), "urls": urls[:3],
                "version": clean(r.get("rule_set_version")),
            })

    nondrug = []
    for r in rows(wb["G6PD_non_drug"]):
        nondrug.append({"id": r["id"], "condition": "G6PD", "ar": clean(r["trigger_ar"]), "en": clean(r["trigger_en"]),
                        "type": clean(r["type"]), "severity": clean(r["proposed_level"]).upper(),
                        "advice": clean(r["advice_ar"])})

    nowarn = []
    for r in rows(wb["reviewed_no_warning"]):
        k = key_of(r["ingredient_en"])
        add_name(k, base(r["ingredient_en"]), en=base(r["ingredient_en"]), ar=base(r["ingredient_ar"]))
        add_name(k, base(r["ingredient_ar"]))
        for syn in SYNONYMS.get(k, []):
            add_name(k, syn)
        nowarn.append({"id": r["id"], "condition": COND[r["condition"]], "key": k,
                       "routes": routes_of(r.get("route_scope")), "ar": clean(r["ingredient_ar"]),
                       "en": clean(r["ingredient_en"]), "note": clean(r.get("note"))})

    inter = []
    ws = wb["interactions_demo"]
    for r in rows(ws, header_row=2):
        sev = clean(r.get("proposed_severity")).upper()
        if sev not in ("AVOID", "CAUTION", "INFO"):
            continue
        pm_raw = re.sub(r"\s*\d+\s*mg/day", "", clean(r["patient_medicine"]))  # "prednisolone 20 mg/day"
        pm = [key_of(x) for x in re.split(r"\s*/\s*", pm_raw)]
        nm_raw = clean(r["new_medicine"])
        nm_raw_base = base(nm_raw)
        if "vaccines" in nm_raw_base:
            nm = ["varicella vaccine", "yellow fever vaccine", "oral typhoid vaccine"]
        elif nm_raw_base.startswith("measles-mumps-rubella"):
            nm = ["measles-mumps-rubella vaccine"]
        elif nm_raw_base == "sulfamethoxazole/trimethoprim":
            nm = ["co-trimoxazole"]
        else:
            nm = [key_of(x) for x in re.split(r"\s*/\s*", nm_raw_base)]
        initiation = "new or higher dose" in nm_raw
        for k in nm:
            add_name(k, k, en=k)
        inter.append({"id": r["id"], "patientMeds": pm, "newMeds": nm, "severity": sev,
                      "initiationOnly": initiation,
                      "reason": clean(r.get("reason_ar")), "action": clean(r.get("action_staff_ar")),
                      "monitor": clean(r.get("monitor")), "sources": clean(r.get("source_ids"))})

    route_alias = {}
    for r in rows(wb["aliases"]):
        tgt = clean(r["target_ingredient"])
        if tgt.startswith("(UNMAPPED)"):
            continue
        k = key_of(tgt)
        add_name(k, clean(r["alias"]))
        low = tgt.lower()
        if low.endswith("(eye drops)"):
            route_alias[clean(r["alias"])] = "ophthalmic"

    for k, lst in EXTRA_AR.items():
        e = names.setdefault(k, {"en": k, "ar": "", "names": set()})
        if not e["ar"]:
            e["ar"] = lst[0]
        for n in lst:
            e["names"].add(n)
        e["names"].add(k)

    DISPLAY = {"magnesium": ("magnesium", "مغنيسيوم"),
               "co-trimoxazole": ("co-trimoxazole", "كوتريموكسازول")}
    for k, (en, ar) in DISPLAY.items():
        names[k]["en"], names[k]["ar"] = en, ar
    names["co-trimoxazole"]["names"].update(["كوتريموكسازول", "باكتريم", "سبترين"])

    # Arabic display fallback
    for k, e in names.items():
        if not e["en"]:
            e["en"] = k

    allergy = build_allergy(names)

    meds = {k: {"en": v["en"], "ar": v["ar"], "names": sorted(v["names"])} for k, v in sorted(names.items())}

    conditions = {
        "MG": {
            "code": "MG", "ar": "الوهن العضلي الوبيل", "en": "Myasthenia gravis",
            "headline": "بعض الأدوية قد تسبب ضعفًا شديدًا مفاجئًا وفشلًا في التنفس. راجع قائمة التحذيرات قبل إعطاء أي دواء.",
            "version": "MG-2.0",
        },
        "G6PD": {
            "code": "G6PD", "ar": "نقص إنزيم G6PD", "en": "G6PD deficiency",
            "headline": "بعض الأدوية والفول والنفثالين قد تسبب تكسّرًا حادًا في كريات الدم الحمراء. راجع القائمة قبل إعطاء أي دواء.",
            "version": "G6PD-1.0",
        },
    }

    data = {"generated": "from data/aman_drug_rules_draft_v2.xlsx + data/aman_allergy_library_v1.xlsx", "conditions": conditions,
            "rules": rules, "nonDrug": nondrug, "noWarning": nowarn, "interactions": inter,
            "meds": meds, "routeAlias": route_alias, "allergy": allergy}
    OUT.write_text("// Generated by scripts/build_rules.py. Do not edit by hand.\nexport default "
                   + json.dumps(data, ensure_ascii=False, indent=0) + ";\n", encoding="utf-8")
    print(f"rules={len(rules)} nonDrug={len(nondrug)} noWarning={len(nowarn)} interactions={len(inter)} meds={len(meds)} "
          f"names={sum(len(v['names']) for v in meds.values())} allergyGroups={len(allergy['groups'])} "
          f"allergyRules={len(allergy['rules'])} classMapped={len(allergy['drugClasses'])}")


ALLERGY_XLSX = ROOT / "data" / "aman_allergy_library_v1.xlsx"
APPLIES = re.compile(r"^(any|culprit_known|culprit_unknown|culprit_in:[a-z0-9_]+|culprit_not_in:[a-z0-9_]+)$")


def build_allergy(names):
    """Allergy library: groups, classes, drug -> classes, cross-reactivity rules (with source + licence)."""
    wb = openpyxl.load_workbook(ALLERGY_XLSX, data_only=True)
    split = lambda v: [x.strip() for x in clean(v).split(";") if x.strip()]
    classes = {clean(r["class_id"]): {"ar": clean(r["name_ar"]), "en": clean(r["name_en"])} for r in rows(wb["classes"])}
    sources = {clean(r["source_id"]): {"citation": clean(r["citation"]), "url": clean(r["url"]), "license": clean(r["license"])}
               for r in rows(wb["sources"])}
    groups = {}
    for r in rows(wb["groups"]):
        members = split(r["member_classes"])
        for c in members:
            assert c in classes, f"group {r['allergy_id']}: unknown class {c}"
        groups[clean(r["allergy_id"])] = {"ar": clean(r["name_ar"]), "en": clean(r["name_en"]), "members": members,
                                          "kind": clean(r["kind"]) or "drug", "delabel": clean(r["delabel"]) == "yes"}
    drug_classes = {}
    for r in rows(wb["drug_map"]):
        k = clean(r["key"])
        e = names.setdefault(k, {"en": "", "ar": "", "names": set()})
        if not e["en"]:
            e["en"] = base(r["name_en"]) or k
        if not e["ar"]:
            e["ar"] = clean(r["name_ar"])
        for n in [base(r["name_en"]), clean(r["name_ar"]), k] + split(r["aliases"]):
            if n:
                e["names"].add(n)
        cl = split(r["classes"])
        for c in cl:
            assert c in classes, f"drug {k}: unknown class {c}"
        if cl:
            drug_classes[k] = cl
    rules = []
    for r in rows(wb["rules"]):
        g = clean(r["allergy_id"])
        assert g in groups, f"rule {r['rule_id']}: unknown allergy {g}"
        tgt = clean(r["target"])
        kind, _, val = tgt.partition(":")
        assert (kind == "class" and val in classes) or (kind == "drug" and val in names) or tgt == "r1:same", f"rule {r['rule_id']}: bad target {tgt}"
        ap = clean(r["applies_if"]) or "any"
        assert APPLIES.match(ap), f"rule {r['rule_id']}: bad applies_if {ap}"
        if ":" in ap:
            assert ap.split(":")[1] in classes, f"rule {r['rule_id']}: unknown class in {ap}"
        lv = clean(r["level"]).upper()
        sev = clean(r.get("level_if_severe")).upper()
        assert lv in ("AVOID", "CAUTION", "INFO") and sev in ("", "AVOID", "CAUTION", "INFO"), r["rule_id"]
        src = [s.strip() for s in clean(r["source_ids"]).split("|") if s.strip()]
        for s in src:
            assert s in sources, f"rule {r['rule_id']}: unknown source {s}"
        rules.append({"id": clean(r["rule_id"]), "allergy": g, "target": tgt, "appliesIf": ap, "severity": lv,
                      "severityIfSevere": sev, "reason": clean(r["reason_ar"]), "action": clean(r["action_staff_ar"]),
                      "sources": " · ".join(x for x in src if sources[x]["license"] != "داخلي"), "sourceIds": src, "urls": [sources[s]["url"] for s in src if sources[s]["url"]][:3],
                      "license": clean(r.get("license")), "review": clean(r.get("review_status"))})
    return {"version": "ALG-1.0", "groups": groups, "classes": classes, "drugClasses": drug_classes,
            "rules": rules, "sources": sources}


if __name__ == "__main__":
    main()
