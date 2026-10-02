import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceResolver, PlannerContextBudget } from "../src/project/evidence.js";
import { gitOk } from "../src/utils/exec.js";
import { simpleIndex, config } from "./support.ts";
import type { EvidenceRequest } from "../src/types.js";

test("evidence is pinned to a commit and excerpts obey scope, ambiguity, request and source budgets", async () => {
  const root = await mkdtemp(join(tmpdir(), "evidence-"));
  try {
    await gitOk(root, ["init"]);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src/main.ts"), "export const API = 1;\n// committed\n");
    await gitOk(root, ["add", "."]);
    await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
    const revision = await gitOk(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "src/main.ts"), "DIRTY_SENTINEL\n");
    const index = { ...simpleIndex, revision };
    let scouts = 0;
    let saved = 0;
    const budget = new PlannerContextBudget({ ...config.plannerContext, rawCodeTokens: 24 });
    const resolver = new EvidenceResolver(root, index, budget, async () => {
      scouts++;
      return { claims: [{ statement: "API is a constant", evidence: [] }], confidence: "medium", exceptions: [], unresolved: [] };
    }, [], async () => { saved++; });
    const request: EvidenceRequest = { question: "What is the API?", decision: "Preserve its public shape", scope: { files: ["src/main.ts"], symbols: ["API"], modules: [] }, types: ["interfaces"] };
    const packet = await resolver.resolve(request);
    assert.equal(packet.revision, revision);
    assert.equal(scouts, 0);
    const excerpt = { ...request, types: ["excerpt"] as const, excerpt: { file: "src/main.ts", startLine: 1, endLine: 1, ambiguity: "Constant versus callable surface" } };
    const raw = await resolver.resolve({ ...excerpt, types: ["excerpt"] });
    assert.equal(raw.excerpts[0].source, "export const API = 1;");
    assert.ok(!JSON.stringify(raw).includes("DIRTY_SENTINEL"));
    await assert.rejects(resolver.resolve({ ...excerpt, types: ["excerpt"] }), /Raw source budget/);
    await assert.rejects(resolver.resolve({ ...request, types: ["excerpt"] }), /ambiguity/);
    await assert.rejects(resolver.resolve({ ...request, scope: { ...request.scope, files: ["../escape"] } }), /Invalid evidence path/);
    await assert.rejects(resolver.resolve({ ...excerpt, types: ["excerpt"], excerpt: { ...excerpt.excerpt, endLine: 81 } }), /1–80/);
    assert.equal(saved, 2);
    const denied = new EvidenceResolver(root, index, new PlannerContextBudget(config.plannerContext), async () => { throw new Error("must not scout"); }, ["src/**"]);
    await assert.rejects(denied.resolve(request), /protected/);
    const zero = new EvidenceResolver(root, index, new PlannerContextBudget({ ...config.plannerContext, evidenceRequests: 0 }), async () => { throw new Error("must not scout"); });
    await assert.rejects(zero.resolve(request), /request budget/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
