import { join } from "node:path";
import type { ProjectIrIndex } from "../types.js";
import { deterministicInventory } from "./repository.js";
import { indexDependencies } from "./dependencies.js";
import { readJson, readText, writeJson, writeText } from "../utils/fs.js";
import { materializeKnowledge } from "./knowledge.js";
import { gitOk } from "../utils/exec.js";

export interface ProjectIrManifest {
  schemaVersion: 1;
  indexedRevision: string;
  generatedAt: string;
  status: "fresh" | "stale";
}

export interface ProjectIrSnapshot {
  architecture: string;
  index: ProjectIrIndex;
  decisions: string;
}

export class ProjectIrStore {
  constructor(private readonly repo: string) {}

  get dir(): string { return join(this.repo, ".agent-orch", "project"); }
  get manifestPath(): string { return join(this.dir, "manifest.json"); }
  get architecturePath(): string { return join(this.dir, "architecture.md"); }
  get indexPath(): string { return join(this.dir, "index.json"); }
  get decisionsPath(): string { return join(this.dir, "decisions.md"); }
  get inventoryPath(): string { return join(this.dir, "inventory.json"); }

  async exists(): Promise<boolean> {
    try { await readJson(this.manifestPath); return true; } catch { return false; }
  }

  async manifest(): Promise<ProjectIrManifest> {
    return readJson<ProjectIrManifest>(this.manifestPath);
  }

  async buildInventory(): Promise<ReturnType<typeof deterministicInventory> extends Promise<infer T> ? T : never> {
    const inventory = await deterministicInventory(this.repo);
    await writeJson(this.inventoryPath, inventory);
    return inventory;
  }

  async saveSemantic(input: {
    revision: string;
    repositoryName?: string;
    architectureMarkdown: string;
    modules: ProjectIrIndex["modules"];
    interfaces: ProjectIrIndex["interfaces"];
    capabilities: ProjectIrIndex["capabilities"];
    constraints: ProjectIrIndex["constraints"];
    unresolved: string[];
    dependencies?: ProjectIrIndex["dependencies"];
    decisions?: ProjectIrIndex["decisions"];
    previous?: ProjectIrSnapshot;
    focusIds?: string[];
    removedKnowledgeIds?: string[];
  }): Promise<void> {
    const inventory = await this.buildInventory();
    if (inventory.revision !== input.revision) throw new Error("Repository changed during Project IR construction");
    const old = input.previous?.index;
    const scoped = input.focusIds !== undefined;
    const removed = new Set(input.removedKnowledgeIds ?? []);
    const merge = <T extends { id: string }>(kind: string, values: T[], previous: T[] = []): T[] => scoped
      ? [...previous.filter((x) => !values.some((v) => v.id === x.id) && !removed.has(`${kind}:${x.id}`)), ...values] : values;
    const modules = merge("module", input.modules, old?.modules);
    const index: ProjectIrIndex = {
      schemaVersion: 3,
      revision: input.revision,
      tree: await gitOk(this.repo, ["rev-parse", `${input.revision}^{tree}`]),
      generatedAt: new Date().toISOString(),
      repository: {
        name: input.repositoryName ?? inventory.name,
        languages: inventory.languages,
        manifests: inventory.manifests,
        trackedFileCount: inventory.files.length,
        topLevelEntries: inventory.topLevelEntries,
      },
      modules,
      interfaces: merge("interface", input.interfaces, old?.interfaces),
      capabilities: merge("capability", input.capabilities, old?.capabilities),
      constraints: merge("constraint", input.constraints, old?.constraints),
      unresolved: scoped ? [...new Set([...(old?.unresolved ?? []), ...input.unresolved])] : input.unresolved,
      dependencies: [...await indexDependencies(this.repo, input.revision, inventory.files, modules), ...(scoped ? old?.dependencies?.filter((d) => d.kind === "semantic" && !(input.dependencies ?? []).some((n) => n.from === d.from && n.to === d.to)) ?? [] : []), ...(input.dependencies ?? []).filter((d) => d.kind === "semantic")],
      // The builder cannot reconstruct decisions or overwrite Planner's rationale.
      decisions: (old?.decisions ?? []).map((d) => d.status ? d : { ...d, status: "superseded" }),
    };
    index.knowledge = await materializeKnowledge(this.repo, index, old?.knowledge);
    if (scoped) for (const record of index.knowledge) {
      const previous = old?.knowledge?.find((k) => k.id === record.id);
      if (previous?.status === "dirty" && !input.focusIds!.includes(record.id) && record.source !== "deterministic") Object.assign(record, previous);
    }
    await this.saveSnapshot({ index, architecture: scoped ? `${input.previous!.architecture}\n\n${input.architectureMarkdown.trim()}\n` : `${input.architectureMarkdown.trim()}\n`, decisions: "" });
  }

  async saveSnapshot(snapshot: ProjectIrSnapshot): Promise<void> {
    const { index } = snapshot;
    snapshot.decisions = `# Durable project decisions\n\n${JSON.stringify(index.decisions ?? [], null, 2)}\n`;
    await writeText(this.architecturePath, snapshot.architecture);
    await writeJson(this.indexPath, index);
    await writeText(this.decisionsPath, snapshot.decisions);
    await writeJson(this.manifestPath, {
      schemaVersion: 1,
      indexedRevision: index.revision,
      generatedAt: index.generatedAt,
      status: index.knowledge?.some((k) => k.status === "dirty") ? "stale" : "fresh",
    });
  }

  async load(): Promise<ProjectIrSnapshot> {
    return {
      architecture: await readText(this.architecturePath),
      index: await readJson<ProjectIrIndex>(this.indexPath),
      decisions: await readText(this.decisionsPath),
    };
  }

  async markStale(): Promise<void> {
    const manifest = await this.manifest();
    await writeJson(this.manifestPath, { ...manifest, status: "stale" });
  }
}
