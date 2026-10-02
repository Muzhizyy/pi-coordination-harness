import type { HarnessConfig, ProjectIrIndex } from "../src/types.js";
import { emptyRoleMetrics } from "../src/runtime/metrics.js";

export const model = { provider: "test", model: "fake" };
export const config: HarnessConfig = {
  planner: model, worker: model,
  plannerContext: { architectureTokens: 12000, rawCodeTokens: 2000, evidenceRequests: 6 },
  sandbox: { enabled: false, allowNetwork: false, allowedDomains: [], denyRead: [], denyWrite: [] },
  budgets: { workerVerificationRetries: 2, fastWorkerAttempts: 2 }, verification: { finalCommands: [] },
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
