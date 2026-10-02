import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { contextUnits, projectArchitecture } from "../src/project/architecture.js";
import { ProjectIrStore } from "../src/project/project-ir.js";
import { workerProjectContext } from "../src/runtime/context.js";
import { gitOk } from "../src/utils/exec.js";
import type { ProjectIrIndex, TaskContract } from "../src/types.js";

export const index: ProjectIrIndex = {
  schemaVersion: 2, revision: "a".repeat(40), generatedAt: "now",
  repository: { name: "demo", languages: { TypeScript: 2 }, manifests: [], trackedFileCount: 2, topLevelEntries: ["src"] },
  modules: [
    { id: "payment", path: "src/payment", responsibility: "Own payment transport", evidence: [], confidence: "high" },
    { id: "retry", path: "src/retry", responsibility: "Shared retry policies", evidence: [], confidence: "high" },
    { id: "unrelated", path: "src/unrelated", responsibility: "Unrelated subsystem", evidence: [], confidence: "medium" },
  ],
  interfaces: [{ id: "PaymentClient", name: "PaymentClient", owner: "payment", kind: "class", location: "src/payment/client.ts", summary: "Public transport client", evidence: [] }],
  capabilities: [], constraints: [{ id: "transport", summary: "Clients own retries", evidence: [] }],
  dependencies: [{ from: "payment", to: "retry", kind: "import", evidence: [] }],
  decisions: [{ id: "ADR-1", area: "payment", summary: "Retry at transport boundary", rationale: "Avoid duplicate retries", rejectedAlternatives: ["business retries"], evidence: [] }],
  unresolved: [],
};

test("planner projection retains a global map, constraints and decision neighbours without source bodies", () => {
  const view = projectArchitecture(index, "payment", 12000);
  assert.equal(view.moduleMap.length, 3);
  assert.deepEqual(view.modules.map((m) => m.id), ["payment", "retry"]);
  assert.equal(view.decisions[0].id, "ADR-1");
  const large = { ...index, modules: Array.from({ length: 200 }, (_, n) => ({ ...index.modules[0], id: `M${n}`, responsibility: "long".repeat(100) })) };
  const bounded = projectArchitecture(large, "payment", 2000);
  assert.ok(contextUnits(bounded) <= 2000);
  assert.ok(bounded.omitted.moduleMap > 0);
});

test("worker slice does not include global prose or sibling modules with similar prefixes", () => {
  const snapshot = { index, architecture: "GLOBAL_PROSE_SENTINEL", decisions: "" };
  const contract = { contextHints: { files: ["src/payment/client.ts"], tests: [], capabilities: [], symbols: [] } } as TaskContract;
  const context = workerProjectContext(snapshot, contract);
  assert.ok(context.includes("Own payment transport"));
  assert.ok(!context.includes("Unrelated subsystem"));
  assert.ok(!context.includes("GLOBAL_PROSE_SENTINEL"));
});

test("IR v2 records committed import edges and rejects saving against a different revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "architecture-ir-"));
  try {
    await gitOk(root, ["init"]);
    await mkdir(join(root, "src/payment"), { recursive: true });
    await mkdir(join(root, "src/retry"), { recursive: true });
    await writeFile(join(root, "src/payment/client.ts"), 'import { retry } from "../retry/policy.js";\n');
    await writeFile(join(root, "src/retry/policy.ts"), "export const retry = 1;\n");
    await gitOk(root, ["add", "."]);
    await gitOk(root, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"]);
    const revision = await gitOk(root, ["rev-parse", "HEAD"]);
    const store = new ProjectIrStore(root);
    const input = { ...index, revision, architectureMarkdown: "Architecture" };
    await store.saveSemantic(input);
    assert.equal((await store.load()).index.schemaVersion, 2);
    assert.deepEqual((await store.load()).index.dependencies, [{ from: "payment", to: "retry", kind: "import", evidence: ["src/payment/client.ts"] }]);
    await store.markStale();
    assert.equal((await store.manifest()).status, "stale");
    await assert.rejects(store.saveSemantic({ ...input, revision: "b".repeat(40) }), /changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
