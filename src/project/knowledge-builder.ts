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
      if (manifest.status === "fresh" && manifest.indexedRevision === revision && previous.index.schemaVersion === 2) return previous;
    }
    return this.refresh(previous);
  }

  async refresh(previous?: ProjectIrSnapshot): Promise<ProjectIrSnapshot> {
    const store = new ProjectIrStore(this.repo);
    if (await store.exists()) await store.markStale();
    const inventory = await store.buildInventory();
    let changedFiles = inventory.files;
    if (previous) {
      try {
        changedFiles = (await gitOk(this.repo, ["diff", "--name-only", `${previous.index.revision}..${inventory.revision}`])).split("\n").filter(Boolean);
      } catch { /* A rebased or unavailable base requires a complete refresh. */ }
    }
    const workspace = new WorkspaceManager(this.repo, `knowledge-${randomUUID()}`);
    const path = await workspace.createIntegration(inventory.revision);
    let session: Awaited<ReturnType<PiRuntime["createRoleSession"]>> | undefined;
    let committed: Parameters<ProjectIrStore["saveSemantic"]>[0] | undefined;
    const tool = createCommitProjectIrTool((value) => {
      if (committed) throw new Error("Project IR already committed");
      committed = { ...value, revision: inventory.revision, repositoryName: previous?.index.repository.name ?? inventory.name };
    });
    try {
      session = await this.pi.createRoleSession({
        cwd: path, profile: this.profile, systemPrompt: await loadPrompt("project-bootstrap-system.md"),
        tools: ["read", "grep", "find", "ls", tool.name], customTools: [tool],
        extensionFactories: [createPathPolicyExtension(path, this.sandbox), terminalExtension(tool.name, () => committed !== undefined)],
      });
      const template = await loadPrompt(previous ? "project-refresh-request.md" : "project-bootstrap-request.md");
      await session.prompt(render(template, {
        INVENTORY: JSON.stringify(inventory), ARCHITECTURE: previous?.architecture ?? "",
        PROJECT_INDEX: JSON.stringify(previous?.index ?? {}), DECISIONS: previous?.decisions ?? "",
        PREVIOUS_REVISION: previous?.index.revision ?? "", CURRENT_REVISION: inventory.revision,
        CHANGED_FILES: changedFiles.join("\n") || "<none>",
      }));
      if (!committed) throw new Error("Knowledge Builder did not commit Project IR");
      await store.saveSemantic(committed);
      return store.load();
    } finally {
      if (session) { addRoleMetrics(this.metrics.knowledgeBuilder, roleMetrics(session)); session.dispose(); }
      await workspace.dispose();
    }
  }
}
