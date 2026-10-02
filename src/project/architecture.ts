import type { ArchitectureView, ProjectIrIndex } from "../types.js";

/** UTF-8 bytes are a conservative token budget proxy, not provider token usage. */
export function contextUnits(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

export function withinModule(file: string, path: string): boolean {
  const root = path.replace(/\/$/, "");
  return root === "." || file === root || file.startsWith(`${root}/`);
}

function words(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []))];
}

/** Keep a global module map; focus the detailed view on the current decision. */
export function projectArchitecture(index: ProjectIrIndex, query: string, budget: number): ArchitectureView {
  const terms = words(query);
  const relevant = (value: unknown) => terms.reduce((n, term) => n + (JSON.stringify(value).toLowerCase().includes(term) ? 1 : 0), 0);
  const ranked = [...index.modules].sort((a, b) => relevant(b) - relevant(a) || a.id.localeCompare(b.id));
  const selected = ranked.filter((m) => relevant(m) > 0);
  const moduleIds = new Set((selected.length ? selected : ranked.slice(0, 3)).map((m) => m.id));
  const primaryIds = new Set(moduleIds);
  // Include direct neighbours so a relevant module is not presented in isolation.
  for (const edge of index.dependencies ?? []) {
    if (primaryIds.has(edge.from) || primaryIds.has(edge.to)) { moduleIds.add(edge.from); moduleIds.add(edge.to); }
  }
  const view: ArchitectureView = {
    schemaVersion: 1, revision: index.revision, repository: index.repository,
    moduleMap: [], modules: [], interfaces: [], capabilities: [], dependencies: [],
    constraints: [], decisions: [], unresolved: [], omitted: {},
  };
  const append = (key: keyof Pick<ArchitectureView, "moduleMap" | "modules" | "interfaces" | "capabilities" | "dependencies" | "constraints" | "decisions" | "unresolved">, values: unknown[]) => {
    let omitted = 0;
    for (const value of values) {
      (view[key] as unknown[]).push(value);
      if (contextUnits(view) > budget - 512) { (view[key] as unknown[]).pop(); omitted++; }
    }
    view.omitted[key] = omitted;
  };
  // Global invariants and decision rules receive priority over detailed module descriptions.
  append("constraints", index.constraints);
  append("moduleMap", index.modules.map(({ id, responsibility }) => ({ id, responsibility })));
  append("decisions", [...(index.decisions ?? [])].sort((a, b) => relevant(b) - relevant(a)));
  append("modules", ranked.filter((m) => moduleIds.has(m.id)));
  append("interfaces", index.interfaces.filter((i) => moduleIds.has(i.owner ?? "") || relevant(i) > 0));
  append("capabilities", [...index.capabilities].sort((a, b) => relevant(b) - relevant(a)));
  append("dependencies", (index.dependencies ?? []).filter((d) => moduleIds.has(d.from) || moduleIds.has(d.to)));
  append("unresolved", index.unresolved);
  if (contextUnits(view) > budget) throw new Error("Architecture metadata exceeds planner context budget");
  return view;
}
