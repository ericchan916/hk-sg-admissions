#!/usr/bin/env python3
"""Turn official-page JSON into the website database."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "web", "data.js")

SCHOOLS = {
    "hku": ("香港大学", "HKU", 11),
    "cuhk": ("香港中文大学", "CUHK", 18),
    "hkust": ("香港科技大学", "HKUST", 33),
    "polyu": ("香港理工大学", "PolyU", 50),
    "cityu": ("香港城市大学", "CityU", 52),
    "nus": ("新加坡国立大学", "NUS", 10),
    "ntu": ("南洋理工大学", "NTU", 12),
}

# Mode-specific rules copied from the official sentences already stored on these records.
OVERRIDES = {
    "hkust-mba": {
        "workByMode": {"full-time": 2, "part-time": 3},
        "gmatByMode": {"full-time": True, "part-time": False},
        "gmatRequired": False,
    },
    "hkust-mfin": {"workByMode": {"full-time": 0, "part-time": 1}},
    "44087-iss": {"internRequired": False},
    "cuhk-emba": {"mgrMin": 5},
    "cuhk-emba-chinese": {"mgrMin": 5},
    "cuhk-dba": {"mgrMin": 6},
    "nanyang-emba": {"mgrMin": 5},
    "nanyang-emba-cn": {"mgrMin": 5},
}


def texts_of(english):
    bits = []
    for item in english.get("other") or []:
        if isinstance(item, str):
            bits.append(item)
        elif isinstance(item, dict):
            bits.append(json.dumps(item, ensure_ascii=False))
    return "\n".join(bits)


def ielts_op(english):
    blob = texts_of(english)
    if "comparator is ≥" in blob or "Admissions page comparator is ≥" in blob:
        return ">="
    if "strict greater-than" in blob or "Comparator is strict" in blob or "score above 6.5" in blob:
        return ">"
    return ">="


def cet_score(english):
    for item in english.get("other") or []:
        if isinstance(item, dict) and item.get("test") == "CET-6" and item.get("score"):
            return item["score"]
    return None


def modes_of(program):
    raw = program.get("study_mode") or []
    out = []
    for mode in raw:
        label = str(mode).lower()
        if "full" in label and "full-time" not in out:
            out.append("full-time")
        elif "part" in label and "part-time" not in out:
            out.append("part-time")
        elif "mixed" in label or "combined" in label:
            if "full-time" not in out:
                out.append("full-time")
            if "part-time" not in out:
                out.append("part-time")
    return out


def school_id_of(payload, filename):
    sid = payload.get("university_id")
    if sid in SCHOOLS:
        return sid
    return filename.replace(".json", "")


def convert(payload, filename):
    sid = school_id_of(payload, filename)
    school_zh, school_en, qs = SCHOOLS[sid]
    records = []
    for program in payload.get("programs") or []:
        english = program.get("english") or {}
        academic = program.get("academic") or {}
        experience = program.get("experience") or {}
        gmat = program.get("gmat_gre") or {}
        raw_id = str(program.get("id"))
        pid = raw_id if raw_id.startswith(sid + "-") or raw_id.startswith(sid) else sid + "-" + raw_id
        override = OVERRIDES.get(raw_id) or OVERRIDES.get(pid) or {}
        work_text = experience.get("work_text") or ""
        record = {
            "id": pid,
            "schoolId": sid,
            "schoolZh": school_zh,
            "schoolEn": school_en,
            "qs": qs,
            "nameZh": program.get("name_zh") or program.get("name_en"),
            "nameEn": program.get("name_en"),
            "degree": program.get("degree_label") or "",
            "modes": modes_of(program),
            "duration": program.get("duration") or "",
            "medium": program.get("medium") or "",
            "location": program.get("location") or "",
            "intake": " ".join(str(x) for x in [program.get("intake") or "", program.get("intake_cycle") or ""] if x),
            "tuition": program.get("tuition") or "",
            "academicText": academic.get("text") or "",
            "honours": academic.get("honours") or "",
            "gradeLetter": academic.get("grade_letter") or "",
            "gpaMin": academic.get("gpa_min_4"),
            "major": academic.get("major_prerequisite") or "",
            "ielts": english.get("ielts_overall"),
            "ieltsSub": english.get("ielts_min_sub"),
            "ieltsOp": ielts_op(english),
            "toeflPre": english.get("toefl_ibt_pre_2026_01_21"),
            "toeflPost": english.get("toefl_ibt_from_2026_01_21"),
            "cet6": cet_score(english),
            "waiver": english.get("waiver") or "",
            "englishOther": english.get("other") or [],
            "gmatRequired": override.get("gmatRequired", bool(gmat.get("required"))),
            "gmatText": gmat.get("text") or "",
            "workMin": experience.get("work_years_min"),
            "workByMode": override.get("workByMode"),
            "gmatByMode": override.get("gmatByMode"),
            "mgrMin": override.get("mgrMin"),
            "workText": work_text,
            "internRequired": override.get("internRequired", bool(experience.get("internship_required"))),
            "internText": experience.get("internship_text") or "官方页面没有把实习时长写成申请门槛。",
            "documents": program.get("documents") or [],
            "interview": program.get("interview") or "",
            "deadlines": program.get("deadlines") or [],
            "quotes": program.get("official_quotes") or [],
            "sources": program.get("source_urls") or [],
            "gaps": program.get("gaps") or [],
            "applyUrl": program.get("apply_url") or "",
        }
        blob = " ".join(json.dumps(value, ensure_ascii=False) for value in [
            record["nameZh"], record["nameEn"], record["schoolZh"], record["academicText"],
            record["workText"], record["gmatText"], record["waiver"], record["major"],
            record["englishOther"], record["quotes"], record["gaps"], record["tuition"],
            record["duration"], record["documents"], record["deadlines"],
        ])
        record["search"] = blob.lower()
        records.append(record)
    return records


def main():
    programs = []
    for filename in sorted(os.listdir(RAW)):
        if not filename.endswith(".json"):
            continue
        payload = json.load(open(os.path.join(RAW, filename), encoding="utf-8"))
        programs.extend(convert(payload, filename))
    programs.sort(key=lambda item: (item["qs"], item["schoolZh"], item["nameEn"] or ""))
    meta = {
        "retrieved": "2026-10-21",
        "ranking": "QS World University Rankings 2027，2026年6月18日公布",
        "schools": [
            {"id": "nus", "zh": "新加坡国立大学", "qs": 10},
            {"id": "hku", "zh": "香港大学", "qs": 11},
            {"id": "ntu", "zh": "南洋理工大学", "qs": 12},
            {"id": "cuhk", "zh": "香港中文大学", "qs": 18},
            {"id": "hkust", "zh": "香港科技大学", "qs": 33},
            {"id": "polyu", "zh": "香港理工大学", "qs": 50},
            {"id": "cityu", "zh": "香港城市大学", "qs": 52},
        ],
        "mustScale": [
            ["A+/A", "4.0"], ["A-", "3.7"], ["B+", "3.3"], ["B", "3.0"],
            ["B-", "2.7"], ["C+", "2.3"], ["C", "2.0"], ["C-", "1.7"],
            ["D+", "1.3"], ["D", "1.0"], ["F", "0"],
        ],
        "mustSource": "https://www.must.edu.mo/images/SGS/files/%E6%88%90%E7%B8%BE%E7%AD%89%E7%B4%9A%E5%88%B6%E5%BA%A6.pdf",
        "count": len(programs),
    }
    payload = {"meta": meta, "programs": programs}
    with open(OUT, "w", encoding="utf-8") as handle:
        handle.write("window.ADMISSION_DB = ")
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write(";\n")
    print("wrote", len(programs), "programs")


if __name__ == "__main__":
    main()
