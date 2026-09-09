import type { ProjectIrSnapshot } from "../project/project-ir.js";
import type { TaskContract } from "../types.js";

export function workerProjectContext(ir: ProjectIrSnapshot, contract: TaskContract): string {
  const hintedPaths = new Set(contract.contextHints.files);
  const hintedCapabilities = new Set(contract.contextHints.capabilities);
  const modules = ir.index.modules.filter((m) => [...hintedPaths].some((p) => p.startsWith(m.path) || m.path.startsWith(p.split("/")[0] ?? p)));
  const capabilities = ir.index.capabilities.filter((c) => hintedCapabilities.has(c.name) || hintedCapabilities.has(c.id));
  const constraints = ir.index.constraints;
  return [
    "# Project architecture slice",
    ir.architecture,
    "\n# Relevant modules",
    JSON.stringify(modules, null, 2),
    "\n# Reusable capabilities",
    JSON.stringify(capabilities, null, 2),
    "\n# Project constraints",
    JSON.stringify(constraints, null, 2),
  ].join("\n");
}
