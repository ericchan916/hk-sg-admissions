const assert = require("assert");
const { matchProgram } = require("./match.js");
const fs = require("fs");
const vm = require("vm");
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + "/data.js", "utf8"), sandbox);
const programs = sandbox.window.ADMISSION_DB.programs;
const byId = Object.fromEntries(programs.map((p) => [p.id, p]));

function user(extra) {
  return Object.assign({
    gpa: 3.2,
    moi: "other",
    mode: "either",
    ieltsTaken: true,
    ielts: 6.5,
    subs: [6, 6.5, 6, 6],
    toeflTaken: false,
    toeflScale: "old",
    toeflScore: null,
    cet: null,
    workYears: 0,
    mgrYears: 0,
    internMonths: 3,
    internRelevant: true,
    hasGmat: false
  }, extra);
}

function verdict(id, extra) {
  return matchProgram(byId[id], user(extra)).verdict;
}
function check(id, key, extra) {
  return matchProgram(byId[id], user(extra)).checks.find((c) => c.id === key);
}

assert.equal(programs.length, 131);
assert.ok(byId["cuhk-msf"]);
assert.equal(check("cuhk-msf", "gpa", { gpa: 2.9 }).level, "fail");
assert.equal(check("cuhk-msf", "gpa", { gpa: 3 }).level, "pass");
assert.equal(check("hku-mfin", "gpa", { gpa: 2.4 }).level, "open");
assert.equal(check("hku-mfin", "english", { ielts: 6, subs: [5.5, 5.5, 5.5, 5.5] }).level, "pass");
assert.equal(check("hku-mfin", "english", { ielts: 6, subs: [5.5, 5.5, 5, 5.5] }).level, "fail");
assert.equal(check("hku-mfin", "intern", { internMonths: 0 }).level, "open");

const asset = programs.find((p) => p.schoolId === "ntu" && /Asset and Wealth/.test(p.nameEn));
assert.ok(asset, "NTU asset programme");
assert.equal(asset.ieltsOp, ">");
assert.equal(check(asset.id, "english", { ielts: 6.5, subs: [6.5, 6.5, 6.5, 6.5] }).level, "fail");
assert.equal(check(asset.id, "english", { ielts: 7, subs: [6.5, 6.5, 6.5, 6.5] }).level, "pass");

const ntuFin = programs.find((p) => p.schoolId === "ntu" && p.nameEn === "MSc Finance");
assert.equal(check(ntuFin.id, "english", { ielts: 6.5, subs: [6, 6, 6, 6] }).level, "pass");

assert.equal(verdict("hkust-mba", { workYears: 1, hasGmat: false, mode: "full-time", ielts: 6.5, subs: [5.5, 5.5, 5.5, 5.5] }), "fail");
assert.equal(check("hkust-mba", "gmat", { mode: "part-time", workYears: 3, hasGmat: false, ielts: 6.5, subs: [5.5, 5.5, 5.5, 5.5] }).level, "open");
assert.equal(check("hkust-mba", "work", { mode: "part-time", workYears: 3, ielts: 6.5, subs: [5.5, 5.5, 5.5, 5.5] }).level, "pass");

const nusFin = programs.find((p) => p.schoolId === "nus" && p.nameEn === "MSc in Finance");
assert.equal(nusFin.ielts, 7);
assert.equal(nusFin.toeflPost, 5);
assert.equal(check(nusFin.id, "english", { ielts: 7, subs: [6.5, 6.5, 6, 6] }).level, "pass");
assert.equal(check(nusFin.id, "english", { ielts: 6.5, subs: [6.5, 6.5, 6.5, 6.5] }).level, "fail");

const iss = programs.find((p) => p.id === "polyu-44087-iss");
assert.equal(iss.internRequired, false);
assert.equal(check(iss.id, "intern", { internMonths: 0 }).level, "open");

console.log("match tests passed", programs.length);
