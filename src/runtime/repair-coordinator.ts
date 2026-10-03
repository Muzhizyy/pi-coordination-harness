import { loadPrompt } from "../prompts.js";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { HarnessConfig, PlanTaskSpec, ProjectPlan, RunMetrics, VerificationObligation, VerificationResult } from "../types.js";
import type { ProjectIrSnapshot } from "../project/project-ir.js";
import { projectArchitecture } from "../project/architecture.js";
import { PiRuntime, roleMetrics } from "../pi/session.js";
import { terminalExtension } from "../pi/terminal.js";
import { addRoleMetrics } from "./metrics.js";
import { pathMatchesScope } from "../sandbox/path-policy.js";

export function isNarrowerScope(scope: string, authorized: string[]): boolean {
  if (!scope || scope.startsWith("/") || scope.split("/").some((s) => s === ".." || s === ".git")) return false;
  if (authorized.includes(scope)) return true;
  if (!scope.includes("*")) return pathMatchesScope(scope, authorized);
  return scope.endsWith("/**") && !scope.slice(0, -3).includes("*") && authorized.some((a) => a.endsWith("/**") && pathMatchesScope(scope.slice(0, -3), [a]));
}

/** Converts observed integration failures into corrective work; cannot weaken acceptance. */
export class RepairCoordinator {
  constructor(private readonly config: HarnessConfig, private readonly pi: PiRuntime, private readonly metrics: RunMetrics) {}
  async contract(workspace: string, plan: ProjectPlan, ir: ProjectIrSnapshot, verification: VerificationResult, allObligations: VerificationObligation[], sequence: number): Promise<PlanTaskSpec> {
    const authorized = [...new Set(plan.tasks.flatMap((t) => t.writeScopes))];
    const failedIds = new Set(verification.obligations?.filter((o) => o.status !== "verified").map((o) => o.id));
    const failed = allObligations.filter((o) => failedIds.has(o.id));
    for (const c of verification.commands.filter((c) => c.exitCode !== 0)) if (!failed.some((o) => o.check.kind === "command" && o.check.command === c.command)) failed.push({ id: `final-command-${failed.length}`, requirementId: plan.requirements[0].id, description: `Restore final command: ${c.command}`, mandatory: true, category: "invariant", covers: [], check: { kind: "command", command: c.command } });
    // A verification command that mutates source is not repaired by accepting its output.
    if (!failed.length) throw new Error("Final verification changed its candidate or has no reproducible repair obligation; checkpoint retained");
    let captured: { summary: string; writeScopes: string[]; files: string[]; tests: string[] } | undefined;
    const tool = defineTool({ name: "commit_repair_task", label: "Commit repair task", description: "Choose a bounded corrective scope within existing authorization. Original failing checks are attached by runtime and cannot be removed.", parameters: Type.Object({ summary: Type.String({ maxLength: 600 }), writeScopes: Type.Array(Type.String(), { minItems: 1 }), files: Type.Array(Type.String()), tests: Type.Array(Type.String()) }),
      execute: async (_call, params) => {
        if (captured) throw new Error("Repair task already committed");
        if (params.writeScopes.some((s) => !isNarrowerScope(s, authorized))) throw new Error("Repair scope exceeds the original plan authorization");
        captured = params;
        return { content: [{ type: "text", text: "Corrective contract captured; stop." }], details: {} };
      } });
    const session = await this.pi.createRoleSession({ cwd: workspace, profile: this.config.scout ?? this.config.worker,
      systemPrompt: await loadPrompt("repair-system.md"), tools: [tool.name], customTools: [tool], extensionFactories: [terminalExtension(tool.name, () => captured !== undefined, 12)] });
    try {
      await session.prompt(JSON.stringify({ verification, failedObligations: failed, authorizedScopes: authorized, architecture: projectArchitecture(ir.index, verification.failures.join(" "), 6000) }));
      if (!captured) throw new Error("Repair coordinator did not create a corrective contract");
      const id = `repair-${sequence}`;
      return { id, goal: captured.summary, writeScopes: captured.writeScopes, constraints: [], acceptanceCriteria: failed.map((o) => o.description),
        verificationCommands: [], dependencies: [], contextHints: { files: captured.files, tests: captured.tests, symbols: [], capabilities: [] }, escalateWhen: ["Pinned architecture contradicts corrective obligations"], knowledgeRefs: [],
        obligations: failed.map((o, i) => ({ ...o, id: `${id}.${i}`, mandatory: true, covers: [`acceptance:${i}`] })),
      };
    } finally { addRoleMetrics(this.metrics.repair, roleMetrics(session)); session.dispose(); }
  }
}
