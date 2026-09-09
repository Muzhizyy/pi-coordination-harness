import { join } from "node:path";
import type { ProjectIrIndex } from "../types.js";
import { deterministicInventory } from "./repository.js";
import { readJson, readText, writeJson, writeText } from "../utils/fs.js";

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
    architectureMarkdown: string;
    modules: ProjectIrIndex["modules"];
    interfaces: ProjectIrIndex["interfaces"];
    capabilities: ProjectIrIndex["capabilities"];
    constraints: ProjectIrIndex["constraints"];
    unresolved: string[];
  }): Promise<void> {
    const inventory = await this.buildInventory();
    const index: ProjectIrIndex = {
      schemaVersion: 1,
      revision: input.revision,
      generatedAt: new Date().toISOString(),
      repository: {
        name: inventory.name,
        languages: inventory.languages,
        manifests: inventory.manifests,
        trackedFileCount: inventory.files.length,
        topLevelEntries: inventory.topLevelEntries,
      },
      modules: input.modules,
      interfaces: input.interfaces,
      capabilities: input.capabilities,
      constraints: input.constraints,
      unresolved: input.unresolved,
    };
    await writeText(this.architecturePath, `${input.architectureMarkdown.trim()}\n`);
    await writeJson(this.indexPath, index);
    try { await readText(this.decisionsPath); } catch { await writeText(this.decisionsPath, "# Durable project decisions\n\n"); }
    await writeJson(this.manifestPath, {
      schemaVersion: 1,
      indexedRevision: input.revision,
      generatedAt: index.generatedAt,
      status: "fresh",
    });
  }

  async load(): Promise<ProjectIrSnapshot> {
    return {
      architecture: await readText(this.architecturePath),
      index: await readJson<ProjectIrIndex>(this.indexPath),
      decisions: await readText(this.decisionsPath),
    };
  }
}
