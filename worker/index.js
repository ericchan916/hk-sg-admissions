import { matchProgram } from "./match.js";

const MODEL = "deepseek-flash";
const API_URL = "https://api.deepseek.com/chat/completions";
const SYSTEM = `你是申请材料说明员。只根据用户消息里给出的官方摘录和已经算好的对照结果写中文分析。
规则：
- 不得新造 GPA、雅思、托福、CET、GMAT 分数线、录取率或录取均分。
- 官方没有写数字的项目，直接说页面没有写数字，不能据此判不符合。
- 实习只有在对照结果把它标成硬性条件时，才当成门槛。否则只当背景。
- 达到已公布的最低条件不等于录取。不要给录取概率。
- 用四段，每段不超过四句：结论、哪里不符合、可以补什么、不要看错。
- 用「符合要求」「不符合要求」这种普通说法。不要写「硬性门槛」「未撞上」「官方未卡死」。
- 全职工作指毕业后的正式工作，不含实习。管理年数指带团队或当主管的时间。
- 不要使用破折号。`;

let programsById;

async function getPrograms(env) {
  if (programsById) return programsById;
  const res = await env.ASSETS.fetch(new Request("https://assets.local/data.js"));
  if (!res.ok) throw new Error("读不到 data.js");
  const text = await res.text();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const data = JSON.parse(text.slice(start, end + 1));
  programsById = new Map(data.programs.map((program) => [program.id, program]));
  return programsById;
}

function num(raw, key, fallback, lo, hi) {
  const value = raw[key];
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < lo || parsed > hi) throw new Error(key + " 超出范围");
  return parsed;
}

function cleanProfile(raw) {
  if (!raw || typeof raw !== "object") throw new Error("profile 必须是对象");
  const subs = raw.subs;
  if (!Array.isArray(subs) || subs.length !== 4) throw new Error("雅思小分需要四项");
  if (!["en", "other", "unknown"].includes(raw.moi)) throw new Error("授课语言无效");
  if (!["either", "full-time", "part-time"].includes(raw.mode)) throw new Error("修读方式无效");
  if (!["old", "new"].includes(raw.toeflScale)) throw new Error("托福量表无效");
  return {
    gpa: num(raw, "gpa", 0, 0, 4),
    moi: raw.moi,
    mode: raw.mode,
    ieltsTaken: Boolean(raw.ieltsTaken),
    ielts: num(raw, "ielts", null, 0, 9),
    subs: subs.map((item) => (item == null || item === "" ? null : num({ item }, "item", null, 0, 9))),
    toeflTaken: Boolean(raw.toeflTaken),
    toeflScale: raw.toeflScale,
    toeflScore: num(raw, "toeflScore", null, 0, 120),
    cet: num(raw, "cet", null, 0, 710),
    workYears: num(raw, "workYears", 0, 0, 40),
    mgrYears: num(raw, "mgrYears", 0, 0, 40),
    internMonths: num(raw, "internMonths", 0, 0, 60),
    internRelevant: Boolean(raw.internRelevant),
    hasGmat: Boolean(raw.hasGmat)
  };
}

function publicProgram(program) {
  const keep = ["id", "schoolZh", "schoolEn", "qs", "nameZh", "nameEn", "degree", "modes", "duration", "medium", "location", "intake", "tuition", "academicText", "honours", "gradeLetter", "gpaMin", "major", "ielts", "ieltsSub", "ieltsOp", "toeflPre", "toeflPost", "cet6", "waiver", "gmatRequired", "gmatText", "workMin", "workByMode", "gmatByMode", "mgrMin", "workText", "internRequired", "internText", "interview", "quotes", "gaps"];
  const out = {};
  for (const key of keep) out[key] = program[key];
  return out;
}

function requestKey(request) {
  const key = (request.headers.get("x-deepseek-key") || "").trim();
  if (!/^sk-[A-Za-z0-9_-]{16,180}$/.test(key)) return "";
  return key;
}

function redact(text) {
  return String(text || "").replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
}

async function askModel(key, userText) {
  if (!key) return [401, { error: "请在网页里填写你自己的 DeepSeek API Key。" }];
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userText }
      ],
      thinking: { type: "disabled" },
      max_tokens: 900
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return [502, { error: "DeepSeek 返回 " + response.status, detail: redact(JSON.stringify(body)).slice(0, 400) }];
  }
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) return [502, { error: "模型没有返回正文。" }];
  return [200, { model: MODEL, analysis: text }];
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Build": "matcher-import"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || (url.pathname !== "/api/analyze" && url.pathname !== "/api/analyze-list")) {
      return env.ASSETS.fetch(request);
    }
    const key = requestKey(request);
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "请求不是 JSON" });
    }
    let profile;
    try {
      profile = cleanProfile(body.profile || {});
    } catch (error) {
      return json(400, { error: error.message });
    }
    try {
      const programs = await getPrograms(env);
      if (url.pathname === "/api/analyze") {
        const program = programs.get(body.programId);
        if (!program) return json(404, { error: "找不到这个项目" });
        const note = redact(String(body.question || "").trim().slice(0, 400));
        const result = matchProgram(program, profile);
        let userText = "项目官方摘录：\n" + JSON.stringify(publicProgram(program)) + "\n\n申请人材料：\n" + JSON.stringify(profile) + "\n\n程序对照结果：\n" + JSON.stringify(result);
        if (note) userText += "\n\n申请人还问：" + note;
        const [status, payload] = await askModel(key, userText);
        return json(status, payload);
      }
      const ids = Array.isArray(body.programIds) ? body.programIds.slice(0, 8) : [];
      const rows = [];
      for (const id of ids) {
        const program = programs.get(id);
        if (!program) continue;
        const result = matchProgram(program, profile);
        rows.push({
          id: program.id,
          name: program.nameZh,
          school: program.schoolZh,
          verdict: result.verdict,
          checks: result.checks,
          ielts: program.ielts,
          ieltsOp: program.ieltsOp,
          gradeLetter: program.gradeLetter,
          gpaMin: program.gpaMin,
          workMin: program.workMin,
          workByMode: program.workByMode
        });
      }
      if (!rows.length) return json(404, { error: "这些项目不在名册里" });
      const userText = "申请人材料：\n" + JSON.stringify(profile) + "\n\n当前列表最多 8 个项目的对照结果：\n" + JSON.stringify(rows) + "\n请按可先准备、还缺材料、硬性不够分组，并指出最多 3 个优先看的项目。不要新造分数线。";
      const [status, payload] = await askModel(key, userText);
      return json(status, payload);
    } catch (error) {
      return json(500, { error: error.message || "分析失败" });
    }
  }
};
