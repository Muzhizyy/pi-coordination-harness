import { createHash } from "node:crypto";
import type { DecisionProposal, KnowledgeRecord, PlanTaskSpec, ProjectDelta, ProjectIrIndex, Requirement } from "../types.js";
import { git, gitOk } from "../utils/exec.js";
import { pathMatchesScope } from "../sandbox/path-policy.js";
import { readRevisionFile } from "./source.js";
import { withinModule } from "./architecture.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const evidenceFile = (locator: string): string => locator.replace(/:\d+(?:-\d+)?$/, "");

export async function scopeDigest(repo: string, revision: string, scopes: string[]): Promise<string> {
  const tree = await git(repo, ["ls-tree", "-r", "-z", revision]);
  if (tree.exitCode !== 0) throw new Error("Cannot fingerprint knowledge evidence scope");
  return hash(tree.stdout.split("\0").filter((line) => {
    const file = line.slice(line.indexOf("\t") + 1);
    return pathMatchesScope(file, scopes);
  }).sort());
}

export async function materializeKnowledge(repo: string, index: ProjectIrIndex, previous: KnowledgeRecord[] = []): Promise<KnowledgeRecord[]> {
  const entries = [
    ...index.modules.map((m) => ({ id: `module:${m.id}`, value: m, statement: `${m.responsibility}; excludes: ${(m.nonResponsibilities ?? []).join("; ")}`, scope: [m.path === "." ? "**" : `${m.path}/**`], deterministic: false })),
    ...index.interfaces.map((i) => ({ id: `interface:${i.id}`, value: i, statement: `${i.name}: ${i.summary}; owner=${i.owner}; stability=${i.stability}`, scope: [...i.evidence.map(evidenceFile), evidenceFile(i.location)], deterministic: false })),
    ...index.capabilities.map((c) => ({ id: `capability:${c.id}`, value: c, statement: `${c.name}: ${c.summary}`, scope: [...c.evidence.map(evidenceFile), ...c.entrypoints.map(evidenceFile)], deterministic: false })),
    ...index.constraints.map((c) => ({ id: `constraint:${c.id}`, value: c, statement: c.summary, scope: c.evidence.map(evidenceFile), deterministic: false })),
    ...(index.dependencies ?? []).map((d) => ({ id: `dependency:${d.from}:${d.to}`, value: d, statement: `${d.from} has an indexed ${d.kind} dependency on ${d.to}`, scope: [...d.evidence.map(evidenceFile), ...index.modules.filter((m) => m.id === d.from).map((m) => m.path === "." ? "**" : `${m.path}/**`)], deterministic: d.kind === "import" })),
  ];
  const records: KnowledgeRecord[] = [];
  for (const entry of entries) {
    const evidence = [];
    for (const locator of entry.value.evidence) {
      try {
        const source = await readRevisionFile(repo, index.revision, evidenceFile(locator));
        const range = locator.match(/:(\d+)(?:-(\d+))?$/);
        if (range && (Number(range[1]) < 1 || Number(range[2] ?? range[1]) < Number(range[1]) || Number(range[2] ?? range[1]) > source.split("\n").length)) continue;
        evidence.push({ id: `${entry.id}:${locator}`, kind: "source" as const, locator, summary: entry.statement, revision: index.revision });
      } catch { /* An unsupported claim remains a hypothesis. */ }
    }
    const { evidence: _locators, ...semanticValue } = entry.value;
    const digest = hash({ id: entry.id, value: semanticValue });
    const evidenceDigest = await scopeDigest(repo, index.revision, entry.scope);
    const old = previous.find((k) => k.id === entry.id);
    const reusable = old?.digest === digest && old.evidenceDigest === evidenceDigest;
    const validation = reusable ? old.validation : entry.deterministic && evidence.length ? "corroborated" : "candidate";
    records.push({ id: entry.id, statement: entry.statement, source: entry.deterministic ? "deterministic" : "builder", sourceScope: [...new Set(entry.scope)], evidence, digest, evidenceDigest, revision: index.revision, status: "fresh", validation, kind: validation === "corroborated" ? "fact" : "hypothesis" });
  }
  // Scout discoveries have their own identity and validity; a builder cannot overwrite them.
  for (const k of previous.filter((k) => k.source === "scout")) {
    const digest = await scopeDigest(repo, index.revision, k.sourceScope);
    records.push({ ...k, status: digest === k.evidenceDigest ? "fresh" : "dirty", revision: index.revision, evidence: k.evidence.map((e) => ({ ...e, revision: index.revision })) });
  }
  return records;
}

export async function advanceKnowledge(repo: string, index: ProjectIrIndex, revision: string): Promise<ProjectDelta> {
  const diff = await git(repo, ["diff", "--name-only", "--no-renames", "-z", index.revision, revision]);
  if (diff.exitCode !== 0) throw new Error("Cannot determine knowledge invalidation");
  const changedFiles = diff.stdout.split("\0").filter(Boolean);
  const delta: ProjectDelta = { fromRevision: index.revision, toRevision: revision, changedFiles, dirtyKnowledgeIds: [], changes: [] };
  for (const record of index.knowledge ?? []) {
    if (changedFiles.some((f) => pathMatchesScope(f, record.sourceScope))) record.status = "dirty";
    if (record.status === "dirty") delta.dirtyKnowledgeIds.push(record.id);
    else { record.revision = revision; record.evidence = record.evidence.map((e) => ({ ...e, revision })); }
  }
  index.revision = revision;
  index.tree = await gitOk(repo, ["rev-parse", `${revision}^{tree}`]);
  return delta;
}

export function knowledgeChanges(before: KnowledgeRecord[], after: KnowledgeRecord[]): ProjectDelta["changes"] {
  const result: ProjectDelta["changes"] = [];
  for (const old of before) {
    const next = after.find((k) => k.id === old.id);
    if (!next) result.push({ id: old.id, kind: "removed", beforeDigest: old.digest });
    else if (next.digest !== old.digest || next.validation === "rejected") result.push({ id: old.id, kind: "changed", beforeDigest: old.digest, afterDigest: next.digest });
  }
  for (const next of after) if (!before.some((k) => k.id === next.id)) result.push({ id: next.id, kind: "added", afterDigest: next.digest });
  return result;
}

/** Explicit refs plus structural context dependencies, frozen at plan creation. */
export function bindTaskKnowledge(task: PlanTaskSpec, index: ProjectIrIndex): void {
  const moduleIds = new Set(index.modules.filter((m) => pathMatchesScope(m.path, task.writeScopes) || task.writeScopes.some((s) => withinModule(s.replace(/\/\*\*$/, ""), m.path)) || [...task.contextHints.files, ...task.contextHints.tests].some((f) => withinModule(f, m.path))).map((m) => m.id));
  const ids = new Set(task.knowledgeRefs.map((r) => r.id));
  for (const id of moduleIds) ids.add(`module:${id}`);
  for (const i of index.interfaces) if (moduleIds.has(i.owner ?? "") || task.contextHints.symbols.includes(i.id) || task.contextHints.symbols.includes(i.name)) ids.add(`interface:${i.id}`);
  for (const c of index.constraints) ids.add(`constraint:${c.id}`);
  for (const c of index.capabilities) if (task.contextHints.capabilities.includes(c.id) || task.contextHints.capabilities.includes(c.name)) ids.add(`capability:${c.id}`);
  for (const edge of index.dependencies ?? []) if (moduleIds.has(edge.from) || moduleIds.has(edge.to)) ids.add(`dependency:${edge.from}:${edge.to}`);
  for (const id of ids) {
    const record = index.knowledge?.find((k) => k.id === id);
    if (!record) throw new Error(`Unknown contract knowledge reference: ${id}`);
    const supplied = task.knowledgeRefs.find((r) => r.id === id);
    if (supplied && supplied.digest !== record.digest) throw new Error(`Planner used stale knowledge: ${id}`);
    if (!supplied) task.knowledgeRefs.push({ id, digest: record.digest });
  }
}

export function invalidTaskRefs(task: PlanTaskSpec, index: ProjectIrIndex): string[] {
  return task.knowledgeRefs.filter((ref) => {
    const record = index.knowledge?.find((k) => k.id === ref.id);
    return !record || record.digest !== ref.digest || record.validation === "rejected";
  }).map((r) => r.id);
}

export function proposeDecisions(index: ProjectIrIndex, decisions: DecisionProposal[], taskIds: Set<string>, requirements: Requirement[] = []): void {
  for (const d of decisions) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(d.id) || !d.rationale.trim() || !d.taskIds.length || d.taskIds.some((id) => !taskIds.has(id)) || !d.evidence.length || d.evidence.some((id) => !index.knowledge?.some((k) => k.id === id || k.evidence.some((e) => e.id === id)) && !requirements.some((r) => id === `requirement:${r.id}`))) throw new Error(`Decision needs valid task links, rationale and evidence: ${d.id}`);
    const old = index.decisions?.find((x) => x.id === d.id);
    if (old?.status === "active") throw new Error(`Use a new id to supersede an active decision: ${d.id}`);
    const basis = d.evidence.map((id) => {
      const record = index.knowledge?.find((k) => k.id === id || k.evidence.some((e) => e.id === id));
      if (record) return { id, digest: record.digest, revision: record.revision, statement: record.statement, evidence: structuredClone(record.evidence), validation: record.status === "fresh" ? record.validation : "candidate" as const };
      const requirement = requirements.find((r) => id === `requirement:${r.id}`)!;
      return { id, digest: hash(requirement), revision: index.revision, statement: requirement.description, evidence: [{ id, kind: "decision" as const, locator: id, summary: requirement.description, revision: index.revision }], validation: "corroborated" as const };
    });
    index.decisions = [...(index.decisions ?? []).filter((x) => x.id !== d.id), { ...d, basis, status: "proposed", revision: index.revision }];
  }
}
