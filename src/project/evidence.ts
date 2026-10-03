import { createHash, randomUUID } from "node:crypto";
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { EvidencePacket, EvidenceRef, EvidenceRequest, HarnessConfig, ModelProfile, ProjectIrIndex, RunMetrics } from "../types.js";
import { PiRuntime, roleMetrics } from "../pi/session.js";
import { terminalExtension } from "../pi/terminal.js";
import { loadPrompt } from "../prompts.js";
import { addRoleMetrics } from "../runtime/metrics.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { createPathPolicyExtension } from "../sandbox/path-policy-extension.js";
import { pathMatchesPattern } from "../sandbox/path-policy.js";
import { contextUnits, withinModule } from "./architecture.js";
import { readRevisionFile } from "./source.js";
import { EvidenceCache } from "./evidence-cache.js";

export class PlannerContextBudget {
  architectureUnits = 0;
  rawCodeUnits = 0;
  evidenceRequests = 0;
  constructor(readonly limits: HarnessConfig["plannerContext"]) {}
  semantic(value: unknown): void {
    const size = contextUnits(value);
    if (this.architectureUnits + size > this.limits.architectureTokens) throw new Error("Architecture context budget exhausted; narrow the query or use defer_decision");
    this.architectureUnits += size;
  }
  request(): void {
    if (this.evidenceRequests >= this.limits.evidenceRequests) throw new Error("Evidence request budget exhausted; use defer_decision");
    this.evidenceRequests++;
  }
  raw(source: string): void {
    const size = contextUnits(source);
    if (this.rawCodeUnits + size > this.limits.rawCodeTokens) throw new Error("Raw source budget exhausted; request a semantic summary");
    this.rawCodeUnits += size;
  }
}

export type ScoutResult = Pick<EvidencePacket, "claims" | "confidence" | "exceptions" | "unresolved">;
export type EvidenceScout = (request: EvidenceRequest, revision: string) => Promise<ScoutResult>;

export function createEvidenceScout(repo: string, profile: ModelProfile, pi: PiRuntime, metrics: RunMetrics, sandbox: HarnessConfig["sandbox"]): EvidenceScout {
  return async (request, revision) => {
    const workspace = new WorkspaceManager(repo, `scout-${randomUUID()}`);
    const path = await workspace.createIntegration(revision);
    let session: Awaited<ReturnType<PiRuntime["createRoleSession"]>> | undefined;
    let captured: ScoutResult | undefined;
    const tool = defineTool({
      name: "submit_evidence", label: "Submit Evidence", description: "Submit concise facts, exact file/line evidence, exceptions and uncertainty; no code bodies or trajectory.",
      parameters: Type.Object({
        claims: Type.Array(Type.Object({ statement: Type.String({ maxLength: 400 }), evidence: Type.Array(Type.Object({
          id: Type.String(), kind: Type.Union([Type.Literal("source"), Type.Literal("test"), Type.Literal("decision")]),
          locator: Type.String(), summary: Type.String({ maxLength: 200 }),
        }), { minItems: 1, maxItems: 5 }) }), { maxItems: 8 }),
        confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
        exceptions: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 5 }),
        unresolved: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 5 }),
      }),
      execute: async (_id, params) => {
        if (captured) throw new Error("Evidence already submitted");
        if (contextUnits(params) > 6000) throw new Error("Evidence packet too large; summarize the decision-relevant facts");
        for (const claim of params.claims) for (const ref of claim.evidence) {
          const file = ref.locator.replace(/:\d+(?:-\d+)?$/, "");
          const moduleScope = request.scope.modules.map((id) => id);
          // Symbol-only queries require file/module evidence scope for Scout work.
          if (!request.scope.files.includes(file) && !moduleScope.length) throw new Error("Scout evidence needs an explicit file or module scope");
          if (pathMatchesPattern(file, sandbox.denyRead)) throw new Error("Evidence references a protected path");
          const source = await readRevisionFile(repo, revision, file);
          const range = ref.locator.match(/:(\d+)(?:-(\d+))?$/);
          if (range && (Number(range[1]) < 1 || Number(range[2] ?? range[1]) < Number(range[1]) || Number(range[2] ?? range[1]) > source.split("\n").length)) throw new Error("Evidence reference has an invalid line range");
        }
        captured = { ...params, claims: params.claims.map((c) => ({ ...c, evidence: c.evidence.map((e) => ({ ...e, revision })) })) };
        return { content: [{ type: "text", text: "Evidence captured; stop." }], details: {} };
      },
    });
    try {
      session = await pi.createRoleSession({
        cwd: path, profile, systemPrompt: await loadPrompt("scout-system.md"),
        tools: ["read", "grep", "find", "ls", tool.name], customTools: [tool],
        extensionFactories: [createPathPolicyExtension(path, sandbox), terminalExtension(tool.name, () => captured !== undefined)],
      });
      await session.prompt(JSON.stringify({ revision, request }));
      if (!captured) throw new Error("Scout did not submit evidence");
      return captured;
    } finally {
      if (session) { addRoleMetrics(metrics.scout, roleMetrics(session)); session.dispose(); }
      await workspace.dispose();
    }
  };
}

export class EvidenceResolver {
  private readonly semanticDecisions = new Set<string>();
  constructor(private readonly repo: string, private readonly index: ProjectIrIndex, private readonly budget: PlannerContextBudget,
    private readonly scout: EvidenceScout, private readonly denyRead: string[] = [],
    private readonly persist?: (request: EvidenceRequest, packet: EvidencePacket) => Promise<void>) {}

  async resolve(request: EvidenceRequest): Promise<EvidencePacket> {
    if (!request.question.trim() || !request.decision.trim()) throw new Error("Evidence requests must identify a missing fact and the project decision it affects");
    if (!request.types.length || request.types.some((t) => !["interfaces", "dependencies", "callers", "tests", "behavior", "excerpt"].includes(t))) throw new Error("Invalid evidence types");
    if (!request.scope.files.length && !request.scope.modules.length && !request.scope.symbols.length) throw new Error("Evidence requests need a bounded file, module or symbol scope");
    for (const id of request.scope.modules) if (!this.index.modules.some((m) => m.id === id)) throw new Error(`Unknown module: ${id}`);
    for (const file of request.scope.files) {
      if (pathMatchesPattern(file, this.denyRead)) throw new Error("Evidence path is protected");
      await readRevisionFile(this.repo, this.index.revision, file);
    }
    this.budget.request();
    const cache = new EvidenceCache(this.repo);
    const cached = await cache.get(request, this.index.revision);
    if (cached) {
      this.budget.semantic(cached);
      await this.persist?.(request, cached);
      if (cached.claims.length) this.semanticDecisions.add(request.decision);
      return cached;
    }
    const refs = (locators: string[], statement: string): EvidenceRef[] => locators.map((locator) => ({
      id: `IR-${createHash("sha256").update(`${this.index.revision}:${locator}`).digest("hex").slice(0, 16)}`, kind: "source", locator, summary: statement, revision: this.index.revision,
    }));
    const packet: EvidencePacket = { id: `E-${randomUUID()}`, revision: this.index.revision, question: request.question,
      claims: [], confidence: "medium", exceptions: [], unresolved: [], excerpts: [] };
    if (request.types.includes("interfaces")) {
      for (const face of this.index.interfaces.filter((i) => request.scope.symbols.includes(i.id) || request.scope.symbols.includes(i.name) || request.scope.modules.includes(i.owner ?? "") || request.scope.files.some((f) => i.location.startsWith(f)))) {
        const record = this.index.knowledge?.find((k) => k.id === `interface:${face.id}`);
        packet.claims.push({ statement: `${face.name}: ${face.summary} (${face.stability ?? "unknown stability"})`, evidence: refs(face.evidence, face.summary), validation: record?.status === "fresh" ? record.validation : "candidate" });
      }
    }
    if (request.types.includes("dependencies")) {
      const ids = new Set([...request.scope.modules, ...this.index.modules.filter((m) => request.scope.files.some((f) => withinModule(f, m.path))).map((m) => m.id)]);
      for (const edge of (this.index.dependencies ?? []).filter((e) => ids.has(e.from) || ids.has(e.to))) {
        packet.claims.push({ statement: `${edge.from} depends on ${edge.to} (${edge.kind})`, evidence: refs(edge.evidence, "Dependency evidence") });
      }
    }
    if (request.types.some((t) => ["callers", "tests", "behavior"].includes(t))) {
      const found = await this.scout(request, this.index.revision);
      packet.claims.push(...found.claims); packet.confidence = found.confidence;
      packet.exceptions = found.exceptions; packet.unresolved = found.unresolved;
    }
    for (const claim of packet.claims) for (const ref of claim.evidence) {
      const file = ref.locator.replace(/:\d+(?:-\d+)?$/, "");
      if (request.scope.files.length || request.scope.modules.length) {
        if (!request.scope.files.includes(file) && !this.index.modules.some((m) => request.scope.modules.includes(m.id) && withinModule(file, m.path))) throw new Error("Evidence exceeds the requested scope");
      }
    }
    if (request.types.includes("excerpt")) {
      if (!this.semanticDecisions.has(request.decision)) throw new Error("Request semantic evidence for this decision before drilling into raw source");
      const ex = request.excerpt;
      if (!ex || !ex.ambiguity.trim() || !request.scope.files.includes(ex.file)) throw new Error("Raw evidence requires a scoped file and a decision-changing ambiguity");
      if (!Number.isSafeInteger(ex.startLine) || !Number.isSafeInteger(ex.endLine) || ex.startLine < 1 || ex.endLine < ex.startLine || ex.endLine - ex.startLine >= 80) throw new Error("Excerpts must contain 1–80 valid lines");
      const lines = (await readRevisionFile(this.repo, this.index.revision, ex.file)).split("\n");
      if (ex.endLine > lines.length) throw new Error("Excerpt exceeds file length");
      const source = lines.slice(ex.startLine - 1, ex.endLine).join("\n");
      this.budget.raw(source);
      packet.excerpts.push({ locator: `${ex.file}:${ex.startLine}-${ex.endLine}`, source });
    }
    if (!packet.claims.length && !packet.excerpts.length && !packet.unresolved.length) packet.unresolved.push("No indexed evidence matches this query; request specific behavior or a symbol-scoped Scout lookup.");
    // Source bytes have their own budget; only excerpt locators count as architecture context.
    this.budget.semantic({ ...packet, excerpts: packet.excerpts.map(({ locator }) => ({ locator })) });
    await this.persist?.(request, packet);
    await cache.put(request, packet);
    if (!request.types.includes("excerpt") && packet.claims.length > 0) this.semanticDecisions.add(request.decision);
    return packet;
  }
}
