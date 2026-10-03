import { randomUUID } from "node:crypto";
import type { HarnessConfig, ModelProfile, RunMetrics } from "../types.js";
import { PiRuntime, roleMetrics } from "../pi/session.js";
import { terminalExtension } from "../pi/terminal.js";
import { createCommitProjectIrTool } from "../planner/tools.js";
import { loadPrompt, render } from "../prompts.js";
import { gitOk } from "../utils/exec.js";
import { repositoryHead } from "./repository.js";
import { ProjectIrStore, type ProjectIrSnapshot } from "./project-ir.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { createPathPolicyExtension } from "../sandbox/path-policy-extension.js";
import { addRoleMetrics } from "../runtime/metrics.js";
import { advanceKnowledge } from "./knowledge.js";
import { pathMatchesScope } from "../sandbox/path-policy.js";

/** Repository exploration belongs to this independent fast-model role. */
export class KnowledgeBuilder {
  constructor(private readonly repo: string, private readonly profile: ModelProfile, private readonly pi: PiRuntime,
    private readonly metrics: RunMetrics, private readonly sandbox: HarnessConfig["sandbox"]) {}

  async ensure(): Promise<ProjectIrSnapshot> {
    const store = new ProjectIrStore(this.repo);
    const revision = await repositoryHead(this.repo);
    let previous: ProjectIrSnapshot | undefined;
    if (await store.exists()) {
      const manifest = await store.manifest();
      previous = await store.load();
      if (previous.index.schemaVersion === 3) {
        if (manifest.indexedRevision === revision) return previous;
        // Revisions with identical trees reuse the semantic catalogue and assessments.
        await advanceKnowledge(this.repo, previous.index, revision);
        await store.saveSnapshot(previous);
        return previous;
      }
    }
    return this.refresh(previous);
  }

  async refresh(previous?: ProjectIrSnapshot, focusIds?: string[]): Promise<ProjectIrSnapshot> {
    const store = new ProjectIrStore(this.repo);
    if (await store.exists()) await store.markStale();
    const inventory = await store.buildInventory();
    let changedFiles = inventory.files;
    if (previous) {
      try {
        changedFiles = (await gitOk(this.repo, ["diff", "--name-only", `${previous.index.revision}..${inventory.revision}`])).split("\n").filter(Boolean);
      } catch { /* A rebased or unavailable base requires a complete refresh. */ }
    }
    if (focusIds) changedFiles = inventory.files.filter((f) => pathMatchesScope(f, previous?.index.knowledge?.filter((k) => focusIds.includes(k.id)).flatMap((k) => k.sourceScope) ?? []));
    const workspace = new WorkspaceManager(this.repo, `knowledge-${randomUUID()}`);
    const path = await workspace.createIntegration(inventory.revision);
    let session: Awaited<ReturnType<PiRuntime["createRoleSession"]>> | undefined;
    let committed: Parameters<ProjectIrStore["saveSemantic"]>[0] | undefined;
    const tool = createCommitProjectIrTool((value) => {
      if (committed) throw new Error("Project IR already committed");
      if (focusIds) {
        const allowed = new Set(focusIds);
        const owners = previous?.index.modules.filter((m) => allowed.has(`module:${m.id}`)) ?? [];
        for (const m of value.modules) if (!allowed.has(`module:${m.id}`)) throw new Error("Scoped refresh cannot overwrite an unrelated module");
        for (const i of value.interfaces) if (!allowed.has(`interface:${i.id}`) && !owners.some((m) => m.id === i.owner)) throw new Error("Scoped refresh cannot overwrite an unrelated interface");
        for (const c of value.capabilities) if (!allowed.has(`capability:${c.id}`)) throw new Error("Scoped refresh cannot overwrite an unrelated capability");
        for (const c of value.constraints) if (!allowed.has(`constraint:${c.id}`)) throw new Error("Scoped refresh cannot overwrite an unrelated constraint");
        for (const id of value.removedKnowledgeIds ?? []) if (!allowed.has(id)) throw new Error("Scoped refresh cannot remove unrelated knowledge");
      }
      committed = { ...value, revision: inventory.revision, repositoryName: previous?.index.repository.name ?? inventory.name, previous, focusIds };
    });
    try {
      session = await this.pi.createRoleSession({
        cwd: path, profile: this.profile, systemPrompt: await loadPrompt("project-bootstrap-system.md"),
        tools: ["read", "grep", "find", "ls", tool.name], customTools: [tool],
        extensionFactories: [createPathPolicyExtension(path, this.sandbox), terminalExtension(tool.name, () => committed !== undefined)],
      });
      const template = await loadPrompt(previous ? "project-refresh-request.md" : "project-bootstrap-request.md");
      const focus = new Set(focusIds);
      const projected = previous && focusIds ? { ...previous.index,
        modules: previous.index.modules.filter((m) => focus.has(`module:${m.id}`)),
        interfaces: previous.index.interfaces.filter((i) => focus.has(`interface:${i.id}`)),
        capabilities: previous.index.capabilities.filter((c) => focus.has(`capability:${c.id}`)),
        constraints: previous.index.constraints.filter((c) => focus.has(`constraint:${c.id}`)),
        dependencies: [], decisions: [], knowledge: previous.index.knowledge?.filter((k) => focus.has(k.id)),
      } : previous?.index;
      await session.prompt(render(template, {
        INVENTORY: JSON.stringify(focusIds ? { ...inventory, files: changedFiles } : inventory), ARCHITECTURE: focusIds ? "Use the focused structured index" : previous?.architecture ?? "",
        PROJECT_INDEX: JSON.stringify(projected ?? {}), DECISIONS: "Decisions are maintained separately by Planner; do not infer rationale.",
        PREVIOUS_REVISION: previous?.index.revision ?? "", CURRENT_REVISION: inventory.revision,
        CHANGED_FILES: changedFiles.join("\n") || "<none>",
      }) + `\nREFRESH_SCOPE: ${JSON.stringify(focusIds ?? "bootstrap/all")}. For scoped refresh return only these records and explicitly list removedKnowledgeIds for deleted records. Preserve ids for stable concepts. Describe exact public signatures, behavioral constraints and uncertainty, not just file names.`);
      if (!committed) throw new Error("Knowledge Builder did not commit Project IR");
      await store.saveSemantic(committed);
      return store.load();
    } finally {
      if (session) { addRoleMetrics(this.metrics.knowledgeBuilder, roleMetrics(session)); session.dispose(); }
      await workspace.dispose();
    }
  }
}
