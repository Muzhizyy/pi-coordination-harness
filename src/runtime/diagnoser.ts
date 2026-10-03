import { loadPrompt } from "../prompts.js";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { DiagnosticReport, EvidenceRef, HarnessConfig, ProjectIrIndex, RunMetrics, TaskContract, VerificationResult, WorkerOutcome } from "../types.js";
import { PiRuntime, roleMetrics } from "../pi/session.js";
import { terminalExtension } from "../pi/terminal.js";
import { addRoleMetrics } from "./metrics.js";
import { EvidenceRefSchema } from "../planner/protocol-schema.js";
import { readRevisionFile } from "../project/source.js";
import { evidenceFile } from "../project/knowledge.js";
import { pathMatchesPattern } from "../sandbox/path-policy.js";
import { readCandidateFile } from "../verifier/source-snapshot.js";

export class Diagnoser {
  constructor(private readonly config: HarnessConfig, private readonly pi: PiRuntime, private readonly metrics: RunMetrics) {}
  async inspect(workspace: string, contract: TaskContract, outcome: WorkerOutcome, verification?: VerificationResult, index?: ProjectIrIndex): Promise<DiagnosticReport> {
    const statements = new Map(contract.obligations.map((o) => [o.id, o.description]));
    for (const ref of contract.knowledgeRefs) {
      const record = index?.knowledge?.find((k) => k.id === ref.id);
      if (record) statements.set(`knowledge:${ref.id}`, record.statement);
    }
    const files = [...new Set([...contract.contextHints.files, ...contract.contextHints.tests, ...contract.obligations.flatMap((o) => o.check.kind === "source" ? [o.check.file] : o.check.kind === "review" ? o.check.files : []), ...contract.knowledgeRefs.flatMap((r) => index?.knowledge?.find((k) => k.id === r.id)?.evidence.map((e) => evidenceFile(e.locator)) ?? [])])];
    const sources: Record<string, { base?: string; candidate?: string }> = {};
    let bytes = 0;
    for (const file of files) {
      if (pathMatchesPattern(file, this.config.sandbox.denyRead)) continue;
      const pair: { base?: string; candidate?: string } = {};
      try { pair.base = await readRevisionFile(workspace, contract.baseRevision, file); } catch {}
      try { pair.candidate = await readCandidateFile(workspace, file, this.config.sandbox.denyRead); } catch {}
      const size = Buffer.byteLength(JSON.stringify(pair));
      if (size + bytes <= 64000) { sources[file] = pair; bytes += size; }
    }
    let captured: DiagnosticReport | undefined;
    const tool = defineTool({ name: "submit_diagnosis", label: "Submit diagnosis", description: "Classify the failure from actual checks and pinned base evidence. Worker status is a claim, not a routing decision.",
      parameters: Type.Object({ classification: Type.Union([Type.Literal("implementation"), Type.Literal("context"), Type.Literal("environment"), Type.Literal("contract"), Type.Literal("inconclusive")]), summary: Type.String({ maxLength: 600 }), observations: Type.Array(Type.Object({ obligationId: Type.String(), expected: Type.String({ maxLength: 1000 }), observed: Type.String({ minLength: 1, maxLength: 600 }), evidence: Type.Array(EvidenceRefSchema, { minItems: 1, maxItems: 5 }) }), { maxItems: 8 }) }),
      execute: async (_call, params) => {
        if (captured) throw new Error("Diagnosis already submitted");
        for (const observation of params.observations) {
          if (statements.get(observation.obligationId) !== observation.expected) throw new Error("Diagnosis must cite an actual contract obligation or bound knowledge statement");
          for (const ref of observation.evidence) {
            if (ref.kind === "command") {
              if (!verification?.commands.some((c) => c.command === ref.locator)) throw new Error("Unknown diagnostic command evidence");
              ref.revision = `candidate:${verification.candidateDigest}`;
            } else {
              const file = evidenceFile(ref.locator);
              const source = sources[file]?.base;
              if (!source || ref.revision !== contract.baseRevision) throw new Error("Contract diagnosis requires pinned base evidence, not an unverified candidate");
              const range = ref.locator.match(/:(\d+)(?:-(\d+))?$/);
              if (range && (Number(range[1]) < 1 || Number(range[2] ?? range[1]) < Number(range[1]) || Number(range[2] ?? range[1]) > source.split("\n").length)) throw new Error("Invalid diagnostic line range");
            }
          }
        }
        if (params.classification === "contract" && (!params.observations.length || !params.observations.some((o) => o.evidence.some((e) => e.revision === contract.baseRevision)))) throw new Error("Contract conflict needs base evidence and expected/observed proof");
        captured = { id: `diagnostic-${randomUUID()}`, ...params };
        return { content: [{ type: "text", text: "Diagnosis captured; stop." }], details: {} };
      },
    });
    const session = await this.pi.createRoleSession({ cwd: workspace, profile: this.config.scout ?? this.config.worker,
      systemPrompt: await loadPrompt("diagnostic-system.md"),
      tools: [tool.name], customTools: [tool], extensionFactories: [terminalExtension(tool.name, () => captured !== undefined, 12)] });
    try {
      await session.prompt(JSON.stringify({ contract, outcome, verification, sources }));
      if (!captured) throw new Error("Diagnostic stage did not produce a classification");
      return captured;
    } finally { addRoleMetrics(this.metrics.diagnostic, roleMetrics(session)); session.dispose(); }
  }
}
