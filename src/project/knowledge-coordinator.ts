import type { EvidencePacket, EvidenceRequest, HarnessConfig, KnowledgeRecord, ProjectDelta, RunMetrics } from "../types.js";
import type { PiRuntime } from "../pi/session.js";
import { KnowledgeBuilder } from "./knowledge-builder.js";
import { ProjectIrStore, type ProjectIrSnapshot } from "./project-ir.js";
import { advanceKnowledge, evidenceFile, hash, knowledgeChanges, scopeDigest } from "./knowledge.js";
import { SemanticReviewer } from "../verifier/semantic-reviewer.js";

/** Dirty markers are cheap; only dependencies of the current decision are refreshed. */
export class KnowledgeCoordinator {
  constructor(private readonly repo: string, private readonly config: HarnessConfig, private readonly pi: PiRuntime, private readonly metrics: RunMetrics, private readonly reviewer: SemanticReviewer) {}
  async advance(ir: ProjectIrSnapshot, workspace: string, revision: string): Promise<ProjectDelta> {
    const delta = await advanceKnowledge(workspace, ir.index, revision);
    await new ProjectIrStore(this.repo).saveSnapshot(ir);
    return delta;
  }
  async demand(ir: ProjectIrSnapshot, workspace: string, ids: string[]): Promise<{ ir: ProjectIrSnapshot; changes: ProjectDelta["changes"] }> {
    const before = structuredClone(ir.index.knowledge ?? []);
    const focus = new Set(ids);
    // Include owners when an interface may have moved or disappeared.
    for (const face of ir.index.interfaces) if (focus.has(`interface:${face.id}`) && face.owner) focus.add(`module:${face.owner}`);
    const dirty = [...focus].filter((id) => { const k = ir.index.knowledge?.find((k) => k.id === id); return k?.status === "dirty" || k?.validation === "rejected"; });
    if (dirty.length) {
      // Expand only within affected module boundaries. Deletion must be explicit.
      for (const face of ir.index.interfaces) if (dirty.includes(`module:${face.owner}`)) focus.add(`interface:${face.id}`);
      ir = await new KnowledgeBuilder(workspace, this.config.scout ?? this.config.worker, this.pi, this.metrics, this.config.sandbox).refresh(ir, [...focus]);
    }
    const candidates = ir.index.knowledge?.filter((k) => focus.has(k.id) && k.status === "fresh" && k.validation === "candidate") ?? [];
    const verdicts = await this.reviewer.assess(workspace, ir.index.revision, candidates.map((k) => ({ id: k.id, statement: k.statement, files: [...new Set(k.evidence.map((e) => evidenceFile(e.locator)))] })));
    for (const verdict of verdicts) {
      const record = candidates.find((k) => k.id === verdict.id)!;
      record.validation = verdict.status === "verified" ? "corroborated" : verdict.status === "violated" ? "rejected" : "candidate";
      record.kind = record.validation === "corroborated" ? "fact" : "hypothesis";
      if (verdict.evidence.length) record.evidence = verdict.evidence;
    }
    await new ProjectIrStore(this.repo).saveSnapshot(ir);
    return { ir, changes: knowledgeChanges(before, ir.index.knowledge ?? []) };
  }
  async promote(ir: ProjectIrSnapshot, workspace: string, request: EvidenceRequest, packet: EvidencePacket): Promise<void> {
    if (packet.revision !== ir.index.revision) throw new Error("Cannot promote evidence from a different integration revision");
    const candidates = packet.claims.filter((c) => c.validation !== "corroborated");
    const reviews = await this.reviewer.assess(workspace, packet.revision, candidates.map((c, i) => ({ id: `claim-${i}`, statement: c.statement, files: [...new Set(c.evidence.map((e) => evidenceFile(e.locator)))] })));
    for (let i = 0; i < candidates.length; i++) candidates[i].validation = reviews[i].status === "verified" ? "corroborated" : reviews[i].status === "violated" ? "rejected" : "candidate";
    for (const claim of packet.claims) {
      const sourceScope = request.types.includes("callers") ? ["**"] : [...new Set([...claim.evidence.map((e) => evidenceFile(e.locator)), ...request.scope.files, ...ir.index.modules.filter((m) => request.scope.modules.includes(m.id)).map((m) => m.path === "." ? "**" : `${m.path}/**`)])];
      const record: KnowledgeRecord = { id: `scout:${hash({ statement: claim.statement, scope: sourceScope }).slice(0, 24)}`, statement: claim.statement, kind: claim.validation === "corroborated" ? "fact" : "hypothesis", source: "scout", sourceScope, evidence: claim.evidence, validation: claim.validation ?? "candidate", status: "fresh", revision: packet.revision, digest: hash(claim.statement), evidenceDigest: await scopeDigest(workspace, packet.revision, sourceScope) };
      ir.index.knowledge = [...(ir.index.knowledge ?? []).filter((k) => k.id !== record.id), record];
    }
    await new ProjectIrStore(this.repo).saveSnapshot(ir);
  }
}
