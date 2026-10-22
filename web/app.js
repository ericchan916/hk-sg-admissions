(function () {
  const db = window.ADMISSION_DB;
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  const state = {
    query: "",
    school: "",
    verdict: "",
    selected: null,
    profile: null,
    analysis: null
  };

  const rankRow = document.getElementById("rank-row");
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  const count = document.getElementById("count");
  const scale = document.getElementById("scale");

  db.meta.schools.forEach(function (school) {
    const chip = document.createElement("button");
    chip.type = "button";
    const short = { nus: "国大", hku: "港大", ntu: "南大", cuhk: "中大", hkust: "科大", polyu: "理大", cityu: "城大" };
    chip.textContent = (short[school.id] || school.zh) + " " + school.qs;
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", function () {
      state.school = state.school === school.id ? "" : school.id;
      rankRow.querySelectorAll("button").forEach(function (button) {
        button.setAttribute("aria-pressed", button === chip && state.school ? "true" : "false");
      });
      renderList();
    });
    rankRow.appendChild(chip);
  });
  scale.textContent = "等级：" + db.meta.mustScale.map(function (pair) {
    return pair[0] + " " + pair[1];
  }).join("，");

  function readProfile() {
    const num = function (id) {
      const value = document.getElementById(id).value;
      return value === "" ? null : Number(value);
    };
    return {
      gpa: num("gpa"),
      moi: document.getElementById("moi").value,
      mode: document.getElementById("mode").value,
      ieltsTaken: document.getElementById("ielts-taken").checked,
      ielts: num("ielts"),
      subs: [num("ielts-l"), num("ielts-r"), num("ielts-w"), num("ielts-s")],
      toeflTaken: document.getElementById("toefl-taken").checked,
      toeflScale: document.getElementById("toefl-scale").value,
      toeflScore: num("toefl"),
      cet: num("cet"),
      workYears: num("work") || 0,
      mgrYears: num("mgr") || 0,
      internMonths: num("intern") || 0,
      internRelevant: document.getElementById("relevant").checked,
      hasGmat: document.getElementById("gmat").checked
    };
  }

  function verdictLabel(level, overall) {
    if (overall) {
      return { pass: "符合要求", fail: "不符合要求", gap: "还不能判断" }[level] || "还不能判断";
    }
    return {
      pass: "符合",
      fail: "不符合",
      gap: "还不能判断",
      open: "没有硬性规定",
      note: "供参考"
    }[level] || level;
  }

  function visible() {
    const q = state.query.trim().toLowerCase();
    return db.programs.filter(function (program) {
      if (state.school && program.schoolId !== state.school) return false;
      if (q && program.search.indexOf(q) < 0 && (program.nameZh || "").toLowerCase().indexOf(q) < 0) return false;
      if (state.verdict) {
        const result = window.AdmissionMatch.matchProgram(program, state.profile);
        if (result.verdict !== state.verdict) return false;
      }
      return true;
    });
  }

  function line(program, key) {
    if (key === "ielts") {
      if (program.ielts == null) return "雅思未写数字";
      return "雅思 " + (program.ieltsOp === ">" ? ">" : "≥") + program.ielts + (program.ieltsSub != null ? " / 单项≥" + program.ieltsSub : "");
    }
    if (key === "gpa") {
      if (program.gpaMin != null) return "GPA ≥ " + program.gpaMin;
      if (program.gradeLetter === "B") return "二等荣誉或均分 B";
      return "无数字 GPA";
    }
    if (program.workByMode) return "工作按全日制/兼读分开";
    if (program.workMin) return "工作 ≥ " + program.workMin + " 年";
    return "不要求工作年限";
  }

  function renderList() {
    const rows = visible();
    count.textContent = "收录 " + db.meta.count + " 个，当前 " + rows.length + " 个。";
    list.innerHTML = "";
    rows.forEach(function (program) {
      const result = window.AdmissionMatch.matchProgram(program, state.profile);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card" + (state.selected === program.id ? " active" : "");
      card.innerHTML = "<header><h3>" + esc(program.nameZh) + "</h3><span class='badge " + result.verdict + "'>" + verdictLabel(result.verdict, true) + "</span></header>" +
        "<p class='meta'>" + esc(program.schoolZh) + " " + program.qs + " · " + esc(program.nameEn) + "</p>" +
        "<div class='chips'><span>" + esc(line(program, "gpa")) + "</span><span>" + esc(line(program, "ielts")) + "</span><span>" + esc(line(program, "work")) + "</span></div>";
      card.addEventListener("click", function () {
        state.selected = program.id;
        if (!state.analysis || state.analysis.id !== program.id) state.analysis = null;
        renderList();
        renderDetail(program, result);
      });
      list.appendChild(card);
    });
    if (!rows.length) list.innerHTML = "<p class='empty'>没有项目对上这个筛选。</p>";
  }

  function analysisHtml() {
    if (!state.analysis) {
      return "<p class='analysis-lead'>点「生成分析」之后，DeepSeek 会根据你填的成绩和这个专业的官方要求，写成一段说明。分数线仍以学校页面为准。</p>";
    }
    if (state.analysis.loading) return "<div class='analysis-body loading'>大模型正在写这段说明。</div>";
    if (state.analysis.error) return "<div class='analysis-body'>" + esc(state.analysis.error) + "</div>";
    return "<div class='analysis-body'>" + esc(state.analysis.text) + "</div>";
  }

  function renderDetail(program, result) {
    const checks = result.checks.map(function (check) {
      return "<div class='check-row'><span class='badge " + check.level + "'>" + verdictLabel(check.level) + "</span><div><strong>" + esc(check.label) + "</strong><p>" + esc(check.text) + "</p></div></div>";
    }).join("");
    const quotes = (program.quotes || []).map(function (quote) {
      return "<blockquote>" + esc(quote) + "</blockquote>";
    }).join("") || "<p>这一条没有单独摘出短句，要求见上方原文。</p>";
    const sources = (program.sources || []).map(function (url) {
      return "<li><a href='" + esc(url) + "' target='_blank' rel='noreferrer'>" + esc(url) + "</a></li>";
    }).join("");
    const gaps = (program.gaps || []).map(function (gap) { return "<li>" + esc(gap) + "</li>"; }).join("");
    detail.innerHTML =
      "<p class='kicker'>" + esc(program.schoolZh) + " · QS " + program.qs + "</p>" +
      "<h2>" + esc(program.nameZh) + "</h2>" +
      "<p class='sub'>" + esc(program.nameEn) + "</p>" +
      "<p class='sub'>" + esc([program.duration, program.medium, program.location, program.intake].filter(Boolean).join(" · ")) + "</p>" +
      "<p class='result-line'><span class='badge " + result.verdict + "'>" + verdictLabel(result.verdict, true) + "</span> 这是按学校写明的最低条件逐项核对的结果。</p>" +
      "<section class='analysis'><div class='analysis-bar'><div><h3>大模型分析</h3><p>这一段由 DeepSeek 写成，用来解释上面的核对结果。</p></div><button class='primary ask-btn' id='ask-one' type='button'>生成分析</button></div>" +
      "<label class='ask'>想让它多回答一句<input id='ask-note' type='text' maxlength='400' placeholder='例如：兼读会不会更合适'></label>" +
      analysisHtml() + "</section>" +
      "<h3>逐项核对</h3>" + checks +
      "<h3>学术门槛</h3><p>" + esc(program.academicText || "页面未单列。") + "</p>" +
      (program.major ? "<p>先修或背景：" + esc(program.major) + "</p>" : "") +
      "<h3>语言、考试与经历</h3><p>" + esc(program.waiver || "") + "</p><p>" + esc(program.gmatText || "") + "</p><p>" + esc(program.workText || "") + "</p><p>" + esc(program.internText || "") + "</p>" +
      (program.tuition ? "<p>学费：" + esc(program.tuition) + "</p>" : "") +
      (program.interview ? "<p>面试：" + esc(program.interview) + "</p>" : "") +
      "<h3>页面原句</h3>" + quotes +
      (gaps ? "<h3>页面没写清或互相冲突</h3><ul>" + gaps + "</ul>" : "") +
      "<h3>来源</h3><ul>" + sources + "</ul>";
    document.getElementById("ask-one").addEventListener("click", function () {
      ask("/api/analyze", { programId: program.id, question: document.getElementById("ask-note").value }, program.id);
    });
  }

  const keyStore = "hk-sg-deepseek-key";

  function savedKey() {
    try {
      return localStorage.getItem(keyStore) || "";
    } catch (error) {
      return "";
    }
  }

  function keyHint(key) {
    if (!key) return "还没有保存密钥。";
    return "已保存在这台浏览器，末尾是 " + key.slice(-4) + "。关闭页面后仍然在，点清除就会删掉。";
  }

  function refreshKeyStatus() {
    document.getElementById("key-status").textContent = keyHint(savedKey());
  }

  function ask(url, extra, analysisId) {
    const key = savedKey();
    if (!key) {
      state.analysis = { id: analysisId, error: "请先在左侧填入你自己的 DeepSeek API Key，并保存在这台浏览器。" };
      paintAnalysis();
      return;
    }
    state.profile = readProfile();
    state.analysis = { id: analysisId, loading: true };
    if (state.selected) {
      const program = db.programs.find(function (item) { return item.id === state.selected; });
      if (program) renderDetail(program, window.AdmissionMatch.matchProgram(program, state.profile));
    } else {
      detail.innerHTML = "<h2>当前列表</h2>" + analysisHtml();
    }
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Deepseek-Key": key
      },
      body: JSON.stringify(Object.assign({ profile: state.profile }, extra))
    }).then(function (response) {
      return response.json().then(function (body) { return { ok: response.ok, body: body }; });
    }).then(function (result) {
      state.analysis = {
        id: analysisId,
        text: result.body.analysis || "",
        error: result.ok ? "" : (result.body.error || "分析失败")
      };
      paintAnalysis();
    }).catch(function () {
      state.analysis = { id: analysisId, error: "请求没有发出。请用 scripts/server.py 打开页面，不要用纯静态服务器。" };
      paintAnalysis();
    });
  }

  function paintAnalysis() {
    if (state.selected && state.analysis && state.analysis.id === state.selected) {
      const program = db.programs.find(function (item) { return item.id === state.selected; });
      renderDetail(program, window.AdmissionMatch.matchProgram(program, state.profile));
      return;
    }
    if (state.analysis && state.analysis.id === "list") {
      detail.innerHTML = "<p class='kicker'>DeepSeek V4.1 Flash</p><h2>当前列表</h2><section class='analysis'>" + analysisHtml() + "</section>";
    }
  }

  document.getElementById("profile").addEventListener("submit", function (event) {
    event.preventDefault();
    state.profile = readProfile();
    renderList();
    if (state.selected) {
      const program = db.programs.find(function (item) { return item.id === state.selected; });
      if (program) renderDetail(program, window.AdmissionMatch.matchProgram(program, state.profile));
    }
  });
  document.getElementById("q").addEventListener("input", function (event) {
    state.query = event.target.value;
    renderList();
  });
  document.getElementById("verdict").addEventListener("change", function (event) {
    state.verdict = event.target.value;
    renderList();
  });
  document.getElementById("ask-list").addEventListener("click", function () {
    const ids = visible().slice(0, 8).map(function (program) { return program.id; });
    state.selected = null;
    ask("/api/analyze-list", { programIds: ids }, "list");
  });

  document.getElementById("api-key").addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("save-key").click();
    }
  });
  document.getElementById("save-key").addEventListener("click", function () {
    const value = document.getElementById("api-key").value.trim();
    if (!/^sk-[A-Za-z0-9_-]{16,}$/.test(value)) {
      document.getElementById("key-status").textContent = "密钥应以 sk- 开头。请到 DeepSeek 开放平台复制 API Key。";
      return;
    }
    localStorage.setItem(keyStore, value);
    document.getElementById("api-key").value = "";
    refreshKeyStatus();
  });
  document.getElementById("clear-key").addEventListener("click", function () {
    localStorage.removeItem(keyStore);
    document.getElementById("api-key").value = "";
    refreshKeyStatus();
  });

  state.profile = readProfile();
  refreshKeyStatus();
  renderList();
})();
