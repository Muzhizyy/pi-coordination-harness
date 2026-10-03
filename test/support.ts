import type { HarnessConfig, ProjectIrIndex } from "../src/types.js";
import { emptyRoleMetrics } from "../src/runtime/metrics.js";

export const model = { provider: "test", model: "fake" };
export const config: HarnessConfig = {
  planner: model, worker: model,
  plannerContext: { architectureTokens: 12000, rawCodeTokens: 2000, evidenceRequests: 6 },
  sandbox: { enabled: false, allowNetwork: false, allowedDomains: [], denyRead: [], denyWrite: [] },
  budgets: { workerVerificationRetries: 2, fastWorkerAttempts: 2, diagnosisCalls: 2, projectRepairAttempts: 2, plannerDeferrals: 2 }, verification: { finalCommands: [] },
};
export const simpleIndex: ProjectIrIndex = {
  schemaVersion: 2, revision: "a".repeat(40), generatedAt: "now",
  repository: { name: "demo", languages: {}, manifests: [], trackedFileCount: 1, topLevelEntries: ["src"] },
  modules: [{ id: "core", path: "src", responsibility: "Core behavior", evidence: ["src/main.ts"], confidence: "high", nonResponsibilities: [], publicInterfaces: ["API"], tests: [] }],
  interfaces: [{ id: "API", name: "API", kind: "function", owner: "core", stability: "public", location: "src/main.ts", summary: "Public entry", evidence: ["src/main.ts"] }],
  capabilities: [], constraints: [], decisions: [], dependencies: [], unresolved: [],
};
export function fakePi(handler: (options: any, prompt: string) => Promise<void>) {
  const sessions: any[] = [];
  return {
    sessions,
    async createRoleSession(options: any) {
      const session = { options, disposed: false, prompts: [] as string[],
        async prompt(prompt: string) { this.prompts.push(prompt); await handler(options, prompt); },
        getSessionStats: () => ({ toolCalls: 1, tokens: emptyRoleMetrics().tokens, cost: 0 }),
        dispose() { this.disposed = true; },
      };
      sessions.push(session);
      return session;
    },
  };
}

export const obligation = (id: string) => ({ id, requirementId: "R1", description: "Node runtime works", category: "invariant" as const, mandatory: true, covers: [], check: { kind: "command" as const, command: "node --version" } });
export const planFields = { requirements: [{ id: "R1", description: "Fixture requirement", mandatory: true }], projectObligations: [obligation("project-node")], decisions: [] };
export const apiObligation = (id: string, value = 2) => ({ id, requirementId: "R1", description: `API = ${value}`, category: "interface" as const, mandatory: true, covers: ["acceptance:0"], check: { kind: "source" as const, file: "src/main.ts", contains: [`export const API = ${value};`], notContains: [] } });
export async function answerReview(opts: any, prompt: string): Promise<boolean> {
  const tool = opts.customTools.find((t: any) => t.name === "submit_review");
  if (!tool) return false;
  const input = JSON.parse(prompt);
  await tool.execute("review", { results: input.items.map((i: any) => ({ id: i.id, status: i.files.some((f: string) => f in input.sources) ? "verified" : "unverified", summary: "Fixture source supports statement", locators: i.files.filter((f: string) => f in input.sources).slice(0, 1) })) });
  return true;
}
