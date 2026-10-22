#!/usr/bin/env python3
"""Static site plus DeepSeek V4.1 Flash analysis. The key never leaves this process."""
import json
import os
import subprocess
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
MODEL = "deepseek-flash"
API_URL = "https://api.deepseek.com/chat/completions"

SYSTEM = """你是申请材料说明员。只根据用户消息里给出的官方摘录和已经算好的对照结果写中文分析。
规则：
- 不得新造 GPA、雅思、托福、CET、GMAT 分数线、录取率或录取均分。
- 官方没有写数字的项目，直接说页面没有写数字，不能据此判不符合。
- 实习只有在对照结果把它标成硬性条件时，才当成门槛。否则只当背景。
- 达到已公布的最低条件不等于录取。不要给录取概率。
- 用四段，每段不超过四句：结论、硬性缺口、可以补什么、不要误读。
- 不要使用破折号。"""


def load_db():
    raw = open(os.path.join(WEB, "data.js"), encoding="utf-8").read()
    raw = raw.split("=", 1)[1].strip().rstrip(";")
    return json.loads(raw)


def match_one(program, profile):
    script = """
const { matchProgram } = require("./match.js");
let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  const body = JSON.parse(raw);
  process.stdout.write(JSON.stringify(matchProgram(body.program, body.profile)));
});
"""
    proc = subprocess.run(
        ["node", "-e", script],
        input=json.dumps({"program": program, "profile": profile}, ensure_ascii=False),
        text=True,
        capture_output=True,
        cwd=WEB,
        timeout=20,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "match failed")
    return json.loads(proc.stdout)


def clean_profile(raw):
    if not isinstance(raw, dict):
        raise ValueError("profile 必须是对象")
    def num(key, default=None, lo=0, hi=800):
        value = raw.get(key, default)
        if value is None or value == "":
            return default
        value = float(value)
        if value < lo or value > hi:
            raise ValueError(key + " 超出范围")
        return value
    subs = raw.get("subs") or [None, None, None, None]
    if not isinstance(subs, list) or len(subs) != 4:
        raise ValueError("雅思小分需要四项")
    clean_subs = []
    for item in subs:
        if item is None or item == "":
            clean_subs.append(None)
        else:
            item = float(item)
            if item < 0 or item > 9:
                raise ValueError("雅思小分超出范围")
            clean_subs.append(item)
    moi = raw.get("moi")
    mode = raw.get("mode")
    scale = raw.get("toeflScale")
    if moi not in ("en", "other", "unknown"):
        raise ValueError("授课语言无效")
    if mode not in ("either", "full-time", "part-time"):
        raise ValueError("修读方式无效")
    if scale not in ("old", "new"):
        raise ValueError("托福量表无效")
    return {
        "gpa": num("gpa", 0, 0, 4),
        "moi": moi,
        "mode": mode,
        "ieltsTaken": bool(raw.get("ieltsTaken")),
        "ielts": num("ielts", None, 0, 9),
        "subs": clean_subs,
        "toeflTaken": bool(raw.get("toeflTaken")),
        "toeflScale": scale,
        "toeflScore": num("toeflScore", None, 0, 120),
        "cet": num("cet", None, 0, 710),
        "workYears": num("workYears", 0, 0, 40),
        "mgrYears": num("mgrYears", 0, 0, 40),
        "internMonths": num("internMonths", 0, 0, 60),
        "internRelevant": bool(raw.get("internRelevant")),
        "hasGmat": bool(raw.get("hasGmat")),
    }


def public_program(program):
    keep = [
        "id", "schoolZh", "schoolEn", "qs", "nameZh", "nameEn", "degree", "modes",
        "duration", "medium", "location", "intake", "tuition", "academicText", "honours",
        "gradeLetter", "gpaMin", "major", "ielts", "ieltsSub", "ieltsOp", "toeflPre",
        "toeflPost", "cet6", "waiver", "gmatRequired", "gmatText", "workMin", "workByMode",
        "gmatByMode", "mgrMin", "workText", "internRequired", "internText", "interview",
        "quotes", "gaps",
    ]
    return {key: program.get(key) for key in keep}


def request_key(handler):
    key = (handler.headers.get("X-Deepseek-Key") or "").strip()
    if not key or len(key) < 20 or len(key) > 200 or not key.startswith("sk-"):
        return ""
    return key


def redact(text):
    import re
    return re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-***", text or "")


def ask_model(key, user_text):
    if not key:
        return 401, {"error": "请在网页里填写你自己的 DeepSeek API Key。"}
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user_text},
        ],
        "thinking": {"type": "disabled"},
        "max_tokens": 900,
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = redact(exc.read().decode("utf-8", "replace"))[:500]
        return 502, {"error": "DeepSeek 返回 " + str(exc.code) + "。请检查密钥和额度。", "detail": detail}
    except urllib.error.URLError as exc:
        return 502, {"error": "连不上 DeepSeek：" + str(exc.reason)}
    text = ""
    choices = body.get("choices") or []
    if choices:
        text = ((choices[0].get("message") or {}).get("content") or "").strip()
    if not text:
        return 502, {"error": "模型没有返回正文。"}
    return 200, {"model": MODEL, "analysis": text}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 200_000:
            self._json(413, {"error": "请求过大"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            profile = clean_profile(body.get("profile") or {})
        except (json.JSONDecodeError, ValueError) as exc:
            self._json(400, {"error": str(exc)})
            return
        try:
            if self.path == "/api/analyze":
                self._analyze_one(body, profile)
            elif self.path == "/api/analyze-list":
                self._analyze_list(body, profile)
            else:
                self._json(404, {"error": "没有这个接口"})
        except Exception as exc:
            self._json(500, {"error": str(exc)})

    def _analyze_one(self, body, profile):
        program = DB["by_id"].get(body.get("programId"))
        if not program:
            self._json(404, {"error": "找不到这个项目"})
            return
        note = str(body.get("question") or "").strip()[:400]
        result = match_one(program, profile)
        user_text = "项目官方摘录：\n" + json.dumps(public_program(program), ensure_ascii=False) + \
            "\n\n申请人材料：\n" + json.dumps(profile, ensure_ascii=False) + \
            "\n\n程序对照结果：\n" + json.dumps(result, ensure_ascii=False)
        if note:
            user_text += "\n\n申请人还问：" + note
        status, payload = ask_model(request_key(self), user_text)
        self._json(status, payload)

    def _analyze_list(self, body, profile):
        ids = body.get("programIds") or []
        if not isinstance(ids, list) or not ids:
            self._json(400, {"error": "先筛选出项目再分析"})
            return
        rows = []
        for program_id in ids[:8]:
            program = DB["by_id"].get(program_id)
            if not program:
                continue
            result = match_one(program, profile)
            rows.append({
                "id": program["id"],
                "name": program["nameZh"],
                "school": program["schoolZh"],
                "verdict": result["verdict"],
                "checks": result["checks"],
                "ielts": program.get("ielts"),
                "ieltsOp": program.get("ieltsOp"),
                "gradeLetter": program.get("gradeLetter"),
                "gpaMin": program.get("gpaMin"),
                "workMin": program.get("workMin"),
                "workByMode": program.get("workByMode"),
            })
        if not rows:
            self._json(404, {"error": "这些项目不在名册里"})
            return
        user_text = "申请人材料：\n" + json.dumps(profile, ensure_ascii=False) + \
            "\n\n当前列表最多 8 个项目的对照结果：\n" + json.dumps(rows, ensure_ascii=False) + \
            "\n请按可先准备、还缺材料、硬性不够分组，并指出最多 3 个优先看的项目。不要新造分数线。"
        status, payload = ask_model(request_key(self), user_text)
        self._json(status, payload)

    def _json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


DB = {"programs": load_db()["programs"]}
DB["by_id"] = {item["id"]: item for item in DB["programs"]}

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8891), Handler)
    print("http://127.0.0.1:8891  model=%s  key=browser" % MODEL)
    server.serve_forever()
