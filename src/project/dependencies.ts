import { posix } from "node:path";
import type { ArchitectureDependency, ProjectIrIndex } from "../types.js";
import { readRevisionFile } from "./source.js";
import { withinModule } from "./architecture.js";

/** Conservative relative-import index for JS/TS. Semantic edges come from Scouts. */
export async function indexDependencies(repo: string, revision: string, files: string[], modules: ProjectIrIndex["modules"]): Promise<ArchitectureDependency[]> {
  const tracked = new Set(files);
  const owner = (file: string) => [...modules].sort((a, b) => b.path.length - a.path.length).find((m) => withinModule(file, m.path))?.id;
  const edges = new Map<string, ArchitectureDependency>();
  for (const file of files.filter((f) => /\.[cm]?[jt]sx?$/.test(f))) {
    let source: string;
    try { source = await readRevisionFile(repo, revision, file); } catch { continue; }
    const from = owner(file);
    if (!from) continue;
    const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']/g);
    for (const match of imports) {
      const base = posix.normalize(posix.join(posix.dirname(file), match[1]));
      const stem = base.replace(/\.[cm]?js$/, "");
      const resolved = [base, ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", "/index.ts", "/index.js"].map((ext) => stem + ext)].find((f) => tracked.has(f));
      const to = resolved ? owner(resolved) : undefined;
      if (!to || to === from) continue;
      const key = `${from}\0${to}`;
      const edge = edges.get(key) ?? { from, to, kind: "import", evidence: [] };
      if (!edge.evidence.includes(file)) edge.evidence.push(file);
      edges.set(key, edge);
    }
  }
  return [...edges.values()];
}
