(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AdmissionMatch = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function cmp(score, min, op) {
    if (score == null || min == null || Number.isNaN(score)) return null;
    return op === ">" ? score > min : score >= min;
  }

  function workMinFor(program, mode) {
    if (program.workByMode && Object.prototype.hasOwnProperty.call(program.workByMode, mode)) {
      return program.workByMode[mode];
    }
    return program.workMin;
  }

  function gmatRequiredFor(program, mode) {
    if (program.gmatByMode && Object.prototype.hasOwnProperty.call(program.gmatByMode, mode)) {
      return program.gmatByMode[mode];
    }
    return !!program.gmatRequired;
  }

  function modesToJudge(program, user) {
    const available = program.modes && program.modes.length ? program.modes : [];
    if (!available.length) return { targets: ["unspecified"], mismatch: false };
    if (user.mode === "either") return { targets: available, mismatch: false };
    if (available.indexOf(user.mode) >= 0) return { targets: [user.mode], mismatch: false };
    return { targets: [], mismatch: true };
  }

  function gpaCheck(program, user) {
    if (program.gpaMin != null) {
      const ok = user.gpa >= program.gpaMin;
      return {
        id: "gpa",
        label: "澳科大 GPA",
        level: ok ? "pass" : "fail",
        text: "官方写明不低于 " + program.gpaMin + "/4.0。你的澳科大 GPA 是 " + user.gpa + "。"
      };
    }
    if (program.gradeLetter === "B") {
      const ok = user.gpa >= 3;
      return {
        id: "gpa",
        label: "澳科大 GPA",
        level: ok ? "pass" : "fail",
        text: "官方要求二等荣誉，或平均成绩不低于 B。澳科大学生手册把 B 定为 3.0，本站据此把这条对照成 GPA ≥ 3.0。你的 GPA 是 " + user.gpa + "。这不是该校公布的澳科大换算表。"
      };
    }
    return {
      id: "gpa",
      label: "澳科大 GPA",
      level: "open",
      text: "官方没有公布 4.0 制数字线，GPA 不能用来判不符合。" + (program.academicText ? " 原文：" + program.academicText : "")
    };
  }

  function englishCheck(program, user) {
    const hasNumber = program.ielts != null || program.toeflPre != null || program.toeflPost != null || program.cet6 != null;
    if (user.moi === "en" && program.waiver) {
      return {
        id: "english",
        label: "英语",
        level: "pass",
        text: "你勾选了学士阶段英语授课。豁免口径：" + program.waiver
      };
    }
    if (!hasNumber) {
      const chinese = /中文|普通话|Putonghua|Chinese/i.test((program.medium || "") + (program.nameEn || "") + (program.nameZh || ""));
      if (chinese && program.ielts == null) {
        return {
          id: "english",
          label: "英语",
          level: "open",
          text: "已打开的页面没有把雅思写成数字门槛。授课语言：" + (program.medium || "见项目说明") + "。"
        };
      }
      return {
        id: "english",
        label: "英语",
        level: "open",
        text: "已打开的页面没有公布雅思或托福数字线。" + (program.waiver ? " " + program.waiver : "")
      };
    }
    if (user.moi === "unknown") {
      return {
        id: "english",
        label: "英语",
        level: "gap",
        text: "是否可以免语言，取决于学士是否英语授课。请先选择。"
      };
    }

    const attempts = [];
    if (user.ieltsTaken) {
      if (program.ielts == null) {
        attempts.push({ kind: "gap", text: "这个项目页面没有把雅思写成可接受的数字线。" });
      } else if (user.ielts == null || user.subs.some(function (s) { return s == null; })) {
        attempts.push({ kind: "gap", text: "雅思总分或小分还没填全。" });
      } else {
        const overallOk = cmp(user.ielts, program.ielts, program.ieltsOp);
        const subOk = program.ieltsSub == null || user.subs.every(function (s) { return s >= program.ieltsSub; });
        const opWord = program.ieltsOp === ">" ? "高于" : "不低于";
        attempts.push({
          kind: overallOk && subOk ? "pass" : "fail",
          text: "雅思要求总分" + opWord + " " + program.ielts +
            (program.ieltsSub != null ? "，单项不低于 " + program.ieltsSub : "，页面没有写小分下限") +
            "。你的成绩是 " + user.ielts + "（听" + user.subs[0] + " 读" + user.subs[1] + " 写" + user.subs[2] + " 说" + user.subs[3] + "）。"
        });
      }
    }
    if (user.toeflTaken) {
      const scale = user.toeflScale;
      const min = scale === "new" ? program.toeflPost : program.toeflPre;
      if (min == null) {
        attempts.push({
          kind: "gap",
          text: scale === "new"
            ? "页面没有公布 2026 年 1 月 21 日及之后的新托福分数线，不能用新分直接判断。"
            : "页面没有公布 2026 年 1 月 21 日之前的旧托福分数线，不能用旧分直接判断。"
        });
      } else if (user.toeflScore == null) {
        attempts.push({ kind: "gap", text: "托福分数还没填。" });
      } else {
        const ok = cmp(user.toeflScore, min, program.toeflOp || program.ieltsOp || ">=");
        attempts.push({
          kind: ok ? "pass" : "fail",
          text: (scale === "new" ? "新托福" : "旧托福 iBT") + " 对照线是 " + min + "。你的分数是 " + user.toeflScore + "。"
        });
      }
    }
    if (user.cet != null && user.cet !== "") {
      if (program.cet6 == null) {
        attempts.push({ kind: "gap", text: "这个项目页面没有把 CET-6 写成可接受成绩。" });
      } else {
        const ok = user.cet >= program.cet6;
        attempts.push({
          kind: ok ? "pass" : "fail",
          text: "CET-6 对照线是 " + program.cet6 + "。你的分数是 " + user.cet + "。"
        });
      }
    }
    if (!attempts.length) {
      return {
        id: "english",
        label: "英语",
        level: "gap",
        text: "非英语授课需要语言成绩。请填写雅思、托福或项目接受的 CET-6。"
      };
    }
    if (attempts.some(function (a) { return a.kind === "pass"; })) {
      return { id: "english", label: "英语", level: "pass", text: attempts.filter(function (a) { return a.kind === "pass"; }).map(function (a) { return a.text; }).join(" ") };
    }
    if (attempts.some(function (a) { return a.kind === "gap"; }) && !attempts.some(function (a) { return a.kind === "fail"; })) {
      return { id: "english", label: "英语", level: "gap", text: attempts.map(function (a) { return a.text; }).join(" ") };
    }
    if (attempts.some(function (a) { return a.kind === "fail"; }) && attempts.some(function (a) { return a.kind === "gap"; })) {
      return { id: "english", label: "英语", level: "fail", text: attempts.map(function (a) { return a.text; }).join(" ") };
    }
    return { id: "english", label: "英语", level: "fail", text: attempts.map(function (a) { return a.text; }).join(" ") };
  }

  function workCheck(program, user) {
    const judged = modesToJudge(program, user);
    if (judged.mismatch) {
      return {
        id: "work",
        label: "工作经验",
        level: "fail",
        text: "这个项目的修读方式是" + program.modes.join("、") + "，和你选的方式对不上。"
      };
    }
    const rows = judged.targets.map(function (mode) {
      return { mode: mode, min: workMinFor(program, mode) };
    });
    const numeric = rows.filter(function (row) { return row.min != null && row.min > 0; });
    if (!numeric.length) {
      const preference = /prefer|advantage|add weight|加分|优先/i.test(program.workText || "");
      if (preference && user.workYears === 0 && user.internMonths === 0) {
        return {
          id: "work",
          label: "工作经验",
          level: "note",
          text: "官方没有写成硬性年限，但写了经历会加分或优先。你目前工作 0 年、实习 0 个月。原文：" + program.workText
        };
      }
      return {
        id: "work",
        label: "工作经验",
        level: "open",
        text: program.workText || "官方没有写最少工作年限。"
      };
    }
    const results = numeric.map(function (row) {
      return { mode: row.mode, min: row.min, ok: user.workYears >= row.min };
    });
    const modeName = { "full-time": "全日制", "part-time": "兼读", unspecified: "该项目" };
    const detail = results.map(function (row) {
      return (modeName[row.mode] || row.mode) + "至少 " + row.min + " 年，你有 " + user.workYears + " 年" + (row.ok ? "，达到" : "，未达到");
    }).join("。");
    const mgrFail = program.mgrMin != null && user.mgrYears < program.mgrMin;
    const mgrText = program.mgrMin != null
      ? " 其中管理或领导经验官方写了至少 " + program.mgrMin + " 年，你填了 " + user.mgrYears + " 年。"
      : "";
    if (user.mode === "either") {
      if (results.some(function (row) { return row.ok; }) && !mgrFail) {
        return { id: "work", label: "工作经验", level: "pass", text: detail + "。" + mgrText + (program.workText ? " " + program.workText : "") };
      }
    } else if (results.every(function (row) { return row.ok; }) && !mgrFail) {
      return { id: "work", label: "工作经验", level: "pass", text: detail + "。" + mgrText };
    }
    return { id: "work", label: "工作经验", level: "fail", text: detail + "。" + mgrText };
  }

  function gmatCheck(program, user) {
    const judged = modesToJudge(program, user);
    if (judged.mismatch) return null;
    const rows = judged.targets.map(function (mode) {
      return { mode: mode, required: gmatRequiredFor(program, mode) };
    });
    if (!rows.some(function (row) { return row.required; })) {
      return {
        id: "gmat",
        label: "GMAT / GRE",
        level: "open",
        text: program.gmatText || "官方没有把 GMAT 或 GRE 写成必须提交。"
      };
    }
    if (user.mode === "either" && rows.some(function (row) { return !row.required; })) {
      return {
        id: "gmat",
        label: "GMAT / GRE",
        level: user.hasGmat ? "pass" : "note",
        text: "只有部分修读方式强制 GMAT/GRE。" + (program.gmatText || "")
      };
    }
    if (!user.hasGmat) {
      return {
        id: "gmat",
        label: "GMAT / GRE",
        level: "fail",
        text: "这条修读路径要求提交 GMAT 或 GRE，你选择了没有成绩。页面没有公布最低分。" + (program.gmatText || "")
      };
    }
    return {
      id: "gmat",
      label: "GMAT / GRE",
      level: "pass",
      text: "你有 GMAT 或 GRE。页面没有公布最低分，所以这里只核对是否提交。" + (program.gmatText || "")
    };
  }

  function internCheck(program, user) {
    if (program.internRequired) {
      const min = program.internMinMonths || 1;
      const ok = user.internMonths >= min;
      return {
        id: "intern",
        label: "实习",
        level: ok ? "pass" : "fail",
        text: (program.internText || "官方把实习写成申请条件。") + " 你填了 " + user.internMonths + " 个月" + (user.internRelevant ? "，且与目标方向对口。" : "。")
      };
    }
    return {
      id: "intern",
      label: "实习",
      level: "open",
      text: (program.internText || "官方没有把实习时长写成申请门槛。") +
        " 你填了 " + user.internMonths + " 个月" + (user.internRelevant ? "，并勾选了对口。" : "。") +
        " 实习不会单独把你判成不符合，除非上面的工作经验条款把经历写成硬性条件。"
    };
  }

  function matchProgram(program, user) {
    const checks = [gpaCheck(program, user), englishCheck(program, user), workCheck(program, user), internCheck(program, user)];
    const gmat = gmatCheck(program, user);
    if (gmat) checks.push(gmat);
    let verdict = "pass";
    if (checks.some(function (c) { return c.level === "fail"; })) verdict = "fail";
    else if (checks.some(function (c) { return c.level === "gap"; })) verdict = "gap";
    return { verdict: verdict, checks: checks };
  }

  return { matchProgram: matchProgram };
});
