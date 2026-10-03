import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { config, simpleIndex, fakePi, apiObligation, answerReview, planFields } from "./support.ts";
import type { PiRuntime } from "../src/pi/session.js";
import type { PlanTaskSpec, ProjectPlan, VerificationObligation } from "../src/types.js";
import { git, gitOk } from "../src/utils/exec.js";
import { ProjectRuntime } from "../src/runtime/project-runtime.js";
import { makeContract, validatePlan } from "../src/runtime/plan.js";
import { Verifier } from "../src/verifier/verifier.js";
import { SemanticReviewer } from "../src/verifier/semantic-reviewer.js";
import { emptyRunMetrics } from "../src/runtime/metrics.js";
import { KnowledgeBuilder } from "../src/project/knowledge-builder.js";
import { KnowledgeCoordinator } from "../src/project/knowledge-coordinator.js";
import { ProjectIrStore } from "../src/project/project-ir.js";
import { EvidenceCache } from "../src/project/evidence-cache.js";
import { PlannerRuntime } from "../src/planner/planner-runtime.js";
import { Diagnoser } from "../src/runtime/diagnoser.js";
import { isNarrowerScope } from "../src/runtime/repair-coordinator.js";

async function fixture(extra: Record<string, string> = {}) {
  const root = await mkdtemp(join(tmpdir(), "mechanism-"));
  await gitOk(root, ["init"]);
  for (const [file, source] of Object.entries({ "src/main.ts": "export const API = 1;\n", ".gitignore": ".agent-orch/\n", ...extra })) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), source);
  }
  await gitOk(root, ["add", "."]);
  await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
  return root;
}
function sourceObligation(id: string, file: string, text: string): VerificationObligation {
  return { id, requirementId: "R1", description: `${file} includes ${text}`, category: "behavior", mandatory: true, covers: ["acceptance:0"], check: { kind: "source", file, contains: [text], notContains: [] } };
}
function task(id = "T1", obligation = apiObligation(`${id}.api`)): PlanTaskSpec {
  return { id, goal: obligation.description, writeScopes: ["src/**"], constraints: [], acceptanceCriteria: [obligation.description], verificationCommands: [], dependencies: [], contextHints: { files: ["src/main.ts"], symbols: ["API"], tests: [], capabilities: [] }, escalateWhen: [], obligations: [obligation], knowledgeRefs: [] };
}
function plan(tasks: PlanTaskSpec[], obligations = [{ ...apiObligation("project-api"), covers: [] }]): ProjectPlan {
  return { ...structuredClone(planFields), summary: "Verified update", assumptions: [], tasks, finalVerificationCommands: [], projectObligations: obligations };
}
const tools = (opts: any, name: string) => opts.customTools.find((t: any) => t.name === name);
async function candidate(opts: any, prompt: string, file: string, source: string) {
  const match = prompt.match(/"id":\s*"([^"]+)"/);
  const version = Number(prompt.match(/"version":\s*(\d+)/)?.[1]);
  await writeFile(join(opts.cwd, file), source);
  await tools(opts, "submit_outcome").execute("candidate", { status: "candidate_ready", taskId: match![1], contractVersion: version, summary: "Implemented", changedFiles: [file], checksRun: [], evidence: [], residualRisks: [] });
}

test("requirement/criterion/constraint coverage fails closed and semantic uncertainty cannot accept a candidate", async () => {
  const p = plan([task()]);
  assert.throws(() => validatePlan({ ...p, tasks: [{ ...task(), obligations: [] }] }), /obligations/);
  assert.throws(() => validatePlan({ ...p, tasks: [{ ...task(), constraints: ["Preserve behavior"] }] }), /uncovered constraint/);
  assert.throws(() => validatePlan({ ...p, requirements: [...p.requirements, { id: "R2", description: "Missing behavior", mandatory: true }] }), /cover requirement R2/);
  const root = await fixture();
  try {
    await writeFile(join(root, "src/main.ts"), "export const API = 2;\n");
    const obligation: VerificationObligation = { ...apiObligation("T1.review"), check: { kind: "review", question: "Does this preserve all API error behavior?", files: ["src/main.ts"] } };
    const pi = fakePi(async (opts, prompt) => {
      const input = JSON.parse(prompt);
      await tools(opts, "submit_review").execute("review", { results: input.items.map((i: any) => ({ id: i.id, status: "unverified", summary: "No error behavior evidence", locators: [] })) });
    });
    const reviewer = new SemanticReviewer(config, pi as unknown as PiRuntime, emptyRunMetrics());
    const v = await new Verifier(config, reviewer).verifyTask(root, makeContract(task("T1", obligation), await gitOk(root, ["rev-parse", "HEAD"])));
    assert.equal(v.ok, false);
    assert.equal(v.obligations![0].status, "unverified");
    assert.ok(v.failures.some((f) => f.includes("Mandatory obligation")));
    assert.ok(pi.sessions[0].options.tools.every((t: string) => t === "submit_review"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a changed public assumption invalidates only dependent pending contracts before their dispatch", async () => {
  const root = await fixture({ "src/client.ts": "export const client = 1;\n", "docs/note.md": "old\n" });
  const first = task();
  const second = { ...task("T2", sourceObligation("T2.client", "src/client.ts", "client = 2") as any), goal: "Consume initial API assumption", dependencies: ["T1"], contextHints: { files: ["src/client.ts"], symbols: ["API"], tests: [], capabilities: [] } };
  const unrelated = { ...task("T3", sourceObligation("T3.docs", "docs/note.md", "new") as any), writeScopes: ["docs/**"], contextHints: { files: ["docs/note.md"], symbols: [], tests: [], capabilities: [] } };
  let knowledgeCalls = 0, deltaCommitted = false;
  const pi = fakePi(async (opts, prompt) => {
    if (await answerReview(opts, prompt)) return;
    if (tools(opts, "commit_project_ir")) {
      knowledgeCalls++;
      const updated = (await readFile(join(opts.cwd, "src/main.ts"), "utf8")).includes("API = 2");
      const modules = [...simpleIndex.modules, { id: "docs", path: "docs", responsibility: "Project notes", evidence: ["docs/note.md"], confidence: "high", tests: [], publicInterfaces: [], nonResponsibilities: [] }];
      await tools(opts, "commit_project_ir").execute("ir", { ...simpleIndex, modules: knowledgeCalls === 1 ? modules : simpleIndex.modules, interfaces: simpleIndex.interfaces.map((i) => ({ ...i, summary: `Public API value is ${updated ? 2 : 1}` })), architectureMarkdown: "Focused architecture" });
    } else if (tools(opts, "commit_plan")) await tools(opts, "commit_plan").execute("plan", plan([first, second, unrelated]));
    else if (tools(opts, "commit_plan_delta")) {
      assert.ok(prompt.includes('"affectedTaskIds":["T2"]'));
      deltaCommitted = true;
      await tools(opts, "commit_plan_delta").execute("delta", { reason: "Public API changed", revisedTasks: [{ ...second, goal: "Consume API value 2", knowledgeRefs: [] }], addedTasks: [], cancelledTaskIds: [], invalidatedTaskIds: ["T2"], unaffectedTaskIds: ["T1", "T3"] });
    } else if (tools(opts, "submit_outcome")) {
      if (prompt.includes('"id": "T1"')) await candidate(opts, prompt, "src/main.ts", "export const API = 2;\n");
      else if (prompt.includes('"id": "T2"')) { assert.ok(deltaCommitted); assert.ok(prompt.includes('"version": 2')); await candidate(opts, prompt, "src/client.ts", "export const client = 2;\n"); }
      else { assert.ok(prompt.includes('"version": 1')); await candidate(opts, prompt, "docs/note.md", "new\n"); }
    } else throw new Error("Unexpected role");
  });
  try {
    const result = await new ProjectRuntime(root, config, pi as unknown as PiRuntime).run("Update API and client, revise docs");
    assert.deepEqual(result.acceptedTasks, ["T1", "T2", "T3"]);
    assert.equal(knowledgeCalls, 2);
    const metrics = JSON.parse(await readFile(result.metricsPath, "utf8"));
    assert.deepEqual(metrics.plannerWakeups.map((e: any) => e.reason), ["INITIAL_REQUIREMENT", "ARCHITECTURE_ASSUMPTION_INVALIDATED"]);
    const t3 = JSON.parse(await readFile(join(root, ".agent-orch/runs", result.runId, "tasks/T3.json"), "utf8"));
    assert.equal(t3.version, 1);
    assert.deepEqual(t3.knowledgeRefs.map((r: any) => r.id), ["module:docs"]);
    assert.equal((await git(root, ["apply", "--check", result.patchPath])).exitCode, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const interrupt of [false, true]) test(`final integration failures create a verified repair and ${interrupt ? "resume retained progress after an environment failure" : "repeat original project acceptance"}`, async () => {
  const root = await fixture({ "src/flags.txt": "pending\n" });
  let unavailable = interrupt, firstWorkers = 0, repairs = 0;
  const ready = { ...sourceObligation("project-ready", "src/flags.txt", "ready"), covers: [] };
  const pi = fakePi(async (opts, prompt) => {
    if (await answerReview(opts, prompt)) return;
    if (tools(opts, "commit_project_ir")) await tools(opts, "commit_project_ir").execute("ir", { ...simpleIndex, architectureMarkdown: "IR" });
    else if (tools(opts, "commit_plan")) {
      const p = plan([task()], [{ ...apiObligation("project-api"), covers: [] }, ready] as any);
      p.decisions = [{ id: "Dapi", area: "Public API", summary: "Use value 2", rationale: "The explicit requirement requests API value 2", rejectedAlternatives: ["Keep API = 1"], evidence: ["interface:API"], taskIds: ["T1"] }];
      await tools(opts, "commit_plan").execute("plan", p);
    } else if (tools(opts, "submit_diagnosis")) {
      const input = JSON.parse(prompt);
      await tools(opts, "submit_diagnosis").execute("diagnosis", { classification: input.outcome.status === "environment_failure" ? "environment" : "implementation", summary: "Flags need corrective implementation", observations: [] });
    } else if (tools(opts, "commit_repair_task")) {
      assert.ok(prompt.includes("project-ready"));
      await tools(opts, "commit_repair_task").execute("repair", { summary: "Set flags ready", writeScopes: ["src/flags.txt"], files: ["src/flags.txt"], tests: [] });
    } else if (tools(opts, "submit_outcome")) {
      if (prompt.includes('"id": "T1"')) {
        firstWorkers++;
        const index = (await new ProjectIrStore(root).load()).index;
        assert.equal(index.decisions![0].status, "proposed");
        await candidate(opts, prompt, "src/main.ts", "export const API = 2;\n");
      } else {
        repairs++;
        if (unavailable) await tools(opts, "submit_outcome").execute("environment", { status: "environment_failure", taskId: "repair-1", contractVersion: 1, summary: "Unavailable fixture environment", changedFiles: [], checksRun: [], evidence: [], residualRisks: [] });
        else await candidate(opts, prompt, "src/flags.txt", "ready\n");
      }
    } else throw new Error("Unexpected role");
  });
  try {
    const runtime = new ProjectRuntime(root, config, pi as unknown as PiRuntime);
    let result;
    if (interrupt) {
      await assert.rejects(runtime.run("Update API and prepare flags"), /diagnosis: environment/);
      const [runId] = await readdir(join(root, ".agent-orch/runs"));
      const store = join(root, ".agent-orch/runs", runId);
      const cp = JSON.parse(await readFile(join(store, "checkpoint.json"), "utf8"));
      assert.deepEqual(cp.integratedTasks, ["T1"]);
      assert.ok(await gitOk(root, ["rev-parse", `refs/pi-coordination/runs/${runId}/integration`]));
      assert.equal(cp.ir.index.decisions[0].status, "proposed");
      assert.equal(JSON.parse(await readFile(join(store, "state.json"), "utf8")).status, "failed");
      await assert.rejects(runtime.resume(runId), /diagnosis: environment/);
      unavailable = false;
      result = await runtime.resume(runId);
    } else result = await runtime.run("Update API and prepare flags");
    assert.equal(firstWorkers, 1);
    assert.equal(repairs, interrupt ? 3 : 1);
    assert.deepEqual(result.acceptedTasks, ["T1", "repair-1"]);
    const dir = join(root, ".agent-orch/runs", result.runId);
    assert.equal(JSON.parse(await readFile(join(dir, "final-0.verification.json"), "utf8")).ok, false);
    assert.equal(JSON.parse(await readFile(join(dir, "final-1.verification.json"), "utf8")).ok, true);
    assert.equal((await new ProjectIrStore(root).load()).index.decisions![0].status, "active");
    assert.equal(JSON.parse(await readFile(join(dir, "task-state-T1.json"), "utf8")).state, "project_accepted");
    if (interrupt) {
      const outcomes = await readdir(join(dir, "outcomes"));
      assert.ok(outcomes.includes("repair-1-v1-attempt-1-environment_failure.json"));
      assert.ok(outcomes.includes("repair-1-v1-attempt-2-environment_failure.json"));
      assert.ok(outcomes.includes("repair-1-v1-attempt-3-candidate_ready.json"));
    }
    assert.equal(await readFile(join(root, "src/flags.txt"), "utf8"), "pending\n");
    assert.equal((await git(root, ["apply", "--check", result.patchPath])).exitCode, 0);
    assert.ok(pi.sessions.every((s) => s.disposed));
    await assert.rejects(runtime.resume(result.runId), /already complete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unsupported conflict claims stay local and diagnoses without base proof cannot wake Planner", async () => {
  const root = await fixture();
  let workerCalls = 0;
  const pi = fakePi(async (opts, prompt) => {
    if (await answerReview(opts, prompt)) return;
    if (tools(opts, "commit_project_ir")) await tools(opts, "commit_project_ir").execute("ir", { ...simpleIndex, architectureMarkdown: "IR" });
    else if (tools(opts, "commit_plan")) await tools(opts, "commit_plan").execute("plan", plan([task()]));
    else if (tools(opts, "submit_diagnosis")) {
      await assert.rejects(tools(opts, "submit_diagnosis").execute("unsupported", { classification: "contract", summary: "Worker claims conflict", observations: [] }), /base evidence/);
      await tools(opts, "submit_diagnosis").execute("diagnosis", { classification: "implementation", summary: "API can be updated within contract", observations: [] });
    } else if (tools(opts, "submit_outcome")) {
      workerCalls++;
      if (workerCalls === 1) await tools(opts, "submit_outcome").execute("claimed", { status: "contract_conflict", taskId: "T1", contractVersion: 1, summary: "Cannot implement", conflict: "Guess", changedFiles: [], checksRun: [], evidence: [], residualRisks: [] });
      else { await writeFile(join(opts.cwd, "src/main.ts"), "export const API = 2;\n"); await tools(opts, "submit_outcome").execute("candidate", { status: "candidate_ready", taskId: "T1", contractVersion: 1, summary: "Done", changedFiles: ["src/main.ts"], checksRun: [], evidence: [], residualRisks: [] }); }
    } else throw new Error("Unexpected role");
  });
  try {
    const result = await new ProjectRuntime(root, config, pi as unknown as PiRuntime).run("Update API");
    const metrics = JSON.parse(await readFile(result.metricsPath, "utf8"));
    assert.deepEqual(metrics.plannerWakeups.map((e: any) => e.reason), ["INITIAL_REQUIREMENT"]);
    const sessions = pi.sessions.filter((s) => s.options.tools.includes("submit_outcome"));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].prompts.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Scout facts require entailment assessment, rejected claims remain hypotheses, and cache reuses identical trees", async () => {
  const root = await fixture();
  const metrics = emptyRunMetrics();
  const pi = fakePi(async (opts, prompt) => {
    if (tools(opts, "commit_project_ir")) await tools(opts, "commit_project_ir").execute("ir", { ...simpleIndex, architectureMarkdown: "IR" });
    else {
      const input = JSON.parse(prompt);
      await tools(opts, "submit_review").execute("review", { results: input.items.map((i: any) => ({ id: i.id, status: i.statement.includes("API = 99") ? "violated" : "verified", summary: "Checked actual source", locators: ["src/main.ts:1"] })) });
    }
  });
  try {
    const builder = new KnowledgeBuilder(root, config.worker, pi as unknown as PiRuntime, metrics, config.sandbox);
    const ir = await builder.ensure();
    assert.ok(ir.index.knowledge!.every((k) => k.kind === "hypothesis" && k.validation === "candidate"));
    const coordinator = new KnowledgeCoordinator(root, config, pi as unknown as PiRuntime, metrics, new SemanticReviewer(config, pi as unknown as PiRuntime, metrics));
    const request = { question: "Current API value?", decision: "Choose update", scope: { files: ["src/main.ts"], modules: [], symbols: ["API"] }, types: ["behavior" as const] };
    const packet = { id: "E-fixture", revision: ir.index.revision, question: request.question, confidence: "high" as const, exceptions: [], unresolved: [], excerpts: [], claims: [1, 99].map((v) => ({ statement: `API = ${v}`, evidence: [{ id: `API-${v}`, kind: "source" as const, locator: "src/main.ts:1", summary: "API source", revision: ir.index.revision }] })) };
    await coordinator.promote(ir, root, request, packet);
    const promoted = (await new ProjectIrStore(root).load()).index.knowledge!.filter((k) => k.source === "scout");
    assert.equal(promoted.find((k) => k.statement === "API = 1")!.kind, "fact");
    assert.equal(promoted.find((k) => k.statement === "API = 99")!.validation, "rejected");
    const cache = new EvidenceCache(root);
    await cache.put(request, packet);
    await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "same tree"]);
    const revision = await gitOk(root, ["rev-parse", "HEAD"]);
    const reused = await cache.get(request, revision);
    assert.equal(reused!.revision, revision);
    assert.equal(reused!.claims[0].evidence[0].revision, revision);
    const reusedIr = await builder.ensure();
    assert.equal(reusedIr.index.revision, revision);
    assert.ok(reusedIr.index.knowledge!.every((k) => k.status === "fresh"));
    assert.equal(metrics.knowledgeBuilder.calls, 1);
    await writeFile(join(root, "src/main.ts"), "export const API = 3;\n");
    await gitOk(root, ["add", "src/main.ts"]);
    await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "different tree"]);
    assert.equal(await cache.get(request, await gitOk(root, ["rev-parse", "HEAD"])), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Planner defers missing facts, retrieves scoped evidence, and commits from a fresh bounded session", async () => {
  const root = await fixture();
  const revision = await gitOk(root, ["rev-parse", "HEAD"]);
  let turns = 0;
  const pi = fakePi(async (opts, prompt) => {
    if (tools(opts, "submit_evidence")) await tools(opts, "submit_evidence").execute("evidence", { claims: [{ statement: "API is currently 1", evidence: [{ id: "api", kind: "source", locator: "src/main.ts:1", summary: "API definition" }] }], confidence: "high", exceptions: [], unresolved: [] });
    else {
      turns++;
      if (turns === 1) await tools(opts, "defer_decision").execute("defer", { reason: "Need current behavior", requests: [{ question: "Current API value", decision: "Choose contract", scope: { files: ["src/main.ts"], symbols: ["API"], modules: [] }, types: ["behavior"] }] });
      else { assert.ok(prompt.includes("API is currently 1")); await tools(opts, "commit_plan").execute("plan", plan([task()])); }
    }
  });
  try {
    const metrics = emptyRunMetrics();
    let deferrals = 0;
    const p = await new PlannerRuntime(root, config, pi as unknown as PiRuntime, metrics, { deferral: async () => { deferrals++; } }).plan("Update API", { index: { ...simpleIndex, revision }, architecture: "IR", decisions: "" });
    validatePlan(p);
    assert.equal(deferrals, 1);
    assert.equal(metrics.scout.calls, 1);
    assert.equal(metrics.planner.calls, 2);
    assert.ok(pi.sessions.every((s) => s.disposed));
    assert.ok(metrics.plannerContext.evidenceRequests > 0);
    assert.equal(pi.sessions.filter((s) => s.options.tools.includes("commit_plan")).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repair scopes cannot expand prior authorization", () => {
  assert.equal(isNarrowerScope("src/a.ts", ["src/**"]), true);
  assert.equal(isNarrowerScope("src/sub/**", ["src/**"]), true);
  for (const scope of ["**", "../escape", ".git/config", "docs/**", "src/**"]) assert.equal(isNarrowerScope(scope, ["src/*.ts"]), false);
});

test("project repair budgets survive oscillating fixes and retain integrated progress without exporting acceptance", async () => {
  const root = await fixture({ "src/flags.txt": "pending\n" });
  let repairs = 0;
  const ready = { ...sourceObligation("project-ready", "src/flags.txt", "ready"), covers: [] };
  const pi = fakePi(async (opts, prompt) => {
    if (await answerReview(opts, prompt)) return;
    if (tools(opts, "commit_project_ir")) await tools(opts, "commit_project_ir").execute("ir", { ...simpleIndex, architectureMarkdown: "IR" });
    else if (tools(opts, "commit_plan")) await tools(opts, "commit_plan").execute("plan", plan([task()], [{ ...apiObligation("project-api"), covers: [] }, ready] as any));
    else if (tools(opts, "submit_diagnosis")) await tools(opts, "submit_diagnosis").execute("diagnosis", { classification: "implementation", summary: "Repair current integration regression", observations: [] });
    else if (tools(opts, "commit_repair_task")) { repairs++; await tools(opts, "commit_repair_task").execute("repair", { summary: "Correct regression", writeScopes: ["src/**"], files: ["src/main.ts", "src/flags.txt"], tests: [] }); }
    else if (tools(opts, "submit_outcome")) {
      if (prompt.includes('"id": "T1"')) await candidate(opts, prompt, "src/main.ts", "export const API = 2;\n");
      else if (prompt.includes('"id": "repair-1"')) {
        await writeFile(join(opts.cwd, "src/main.ts"), "export const API = 3;\n");
        await candidate(opts, prompt, "src/flags.txt", "ready\n");
      } else {
        await writeFile(join(opts.cwd, "src/flags.txt"), "pending\n");
        await candidate(opts, prompt, "src/main.ts", "export const API = 2;\n");
      }
    } else throw new Error("Unexpected role");
  });
  try {
    await assert.rejects(new ProjectRuntime(root, config, pi as unknown as PiRuntime).run("Update API and ready flags"), /Project repair limit reached/);
    assert.equal(repairs, 2);
    const [runId] = await readdir(join(root, ".agent-orch/runs"));
    const dir = join(root, ".agent-orch/runs", runId);
    const cp = JSON.parse(await readFile(join(dir, "checkpoint.json"), "utf8"));
    assert.equal(cp.repairAttempts, 2);
    assert.deepEqual(cp.integratedTasks, ["T1", "repair-1", "repair-2"]);
    assert.equal(JSON.parse(await readFile(join(dir, "state.json"), "utf8")).status, "failed");
    assert.ok(!(await readdir(dir)).includes("final.patch"));
    assert.ok(await gitOk(root, ["rev-parse", `refs/pi-coordination/runs/${runId}/integration`]));
    assert.equal(await readFile(join(root, "src/main.ts"), "utf8"), "export const API = 1;\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("optional failures are reported and source mutation invalidates all verification evidence", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "src/main.ts"), "export const API = 2;\n");
    const spec = task();
    spec.obligations.push({ ...apiObligation("T1.optional"), mandatory: false, covers: [], check: { kind: "command", command: "optional-report" } });
    const contract = makeContract(spec, await gitOk(root, ["rev-parse", "HEAD"]));
    const verifier = new Verifier(config);
    const result = await verifier.verifyTask(root, contract, async (cmd) => ({ exitCode: cmd === "optional-report" ? 1 : 0, output: "fixture check" }));
    assert.equal(result.ok, true);
    assert.equal(result.obligations!.find((o) => o.id === "T1.optional")!.status, "violated");
    const mutated = await verifier.verifyTask(root, { ...contract, verificationCommands: ["mutate-source"] }, async (cmd) => {
      if (cmd === "mutate-source") await writeFile(join(root, "src/main.ts"), "export const API = 3;\n");
      return { exitCode: 0, output: "" };
    });
    assert.equal(mutated.ok, false);
    assert.ok(mutated.obligations!.every((o) => o.status === "unverified"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scope-derived knowledge dependencies cannot be omitted by clearing context hints, and scoped refresh discovers new constraints", async () => {
  const root = await fixture();
  const metrics = emptyRunMetrics();
  let builds = 0;
  const pi = fakePi(async (opts, prompt) => {
    if (await answerReview(opts, prompt)) return;
    builds++;
    await tools(opts, "commit_project_ir").execute("ir", { ...simpleIndex, architectureMarkdown: "IR", constraints: builds === 1 ? [] : [{ id: "API2", summary: "API must expose value 2", evidence: ["src/main.ts:1"] }] });
  });
  try {
    const builder = new KnowledgeBuilder(root, config.worker, pi as unknown as PiRuntime, metrics, config.sandbox);
    const ir = await builder.ensure();
    const { bindTaskKnowledge } = await import("../src/project/knowledge.js");
    const spec = task();
    spec.contextHints = { files: [], symbols: [], tests: [], capabilities: [] };
    bindTaskKnowledge(spec, ir.index);
    assert.ok(spec.knowledgeRefs.some((r) => r.id === "interface:API"));
    await writeFile(join(root, "src/main.ts"), "export const API = 2;\n");
    await gitOk(root, ["add", "src/main.ts"]);
    await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "change"]);
    const coordinator = new KnowledgeCoordinator(root, config, pi as unknown as PiRuntime, metrics, new SemanticReviewer(config, pi as unknown as PiRuntime, metrics));
    await coordinator.advance(ir, root, await gitOk(root, ["rev-parse", "HEAD"]));
    const demanded = await coordinator.demand(ir, root, spec.knowledgeRefs.map((r) => r.id));
    assert.ok(demanded.changes.some((c) => c.kind === "added" && c.id === "constraint:API2"));
    assert.equal(demanded.ir.index.constraints[0].id, "API2");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("decision bases preserve authored historical evidence after the live catalogue advances", async () => {
  const { proposeDecisions } = await import("../src/project/knowledge.js");
  const index = structuredClone(simpleIndex);
  index.knowledge = [{ id: "interface:API", kind: "fact", statement: "API = 1", source: "scout", sourceScope: ["src/main.ts"], evidence: [{ id: "api-base", kind: "source", locator: "src/main.ts:1", summary: "API = 1", revision: index.revision }], validation: "corroborated", status: "fresh", revision: index.revision, digest: "before", evidenceDigest: "blob-before" }];
  proposeDecisions(index, [{ id: "D1", area: "API", summary: "Change to 2", rationale: "Requested update", rejectedAlternatives: ["Keep 1"], evidence: ["interface:API", "requirement:R1"], taskIds: ["T1"] }], new Set(["T1"]), planFields.requirements);
  index.knowledge[0].statement = "API = 2";
  index.knowledge[0].digest = "after";
  index.knowledge[0].evidence[0].revision = "b".repeat(40);
  assert.equal(index.decisions![0].basis![0].statement, "API = 1");
  assert.equal(index.decisions![0].basis![0].digest, "before");
  assert.equal(index.decisions![0].basis![0].evidence[0].revision, "a".repeat(40));
  assert.equal(index.decisions![0].basis![1].validation, "corroborated");
});

test("run lease rejects overlapping resume and permits access after release", async () => {
  const { RunStore } = await import("../src/runtime/run-store.js");
  const root = await fixture();
  try {
    const store = new RunStore(root, "lease-test");
    const release = await store.acquire();
    await assert.rejects(store.acquire(), /already active/);
    await release();
    await (await store.acquire())();
    await assert.rejects(Promise.resolve().then(() => new RunStore(root, "../escape")), /Invalid run id/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
