import type { ProjectIrSnapshot } from "../project/project-ir.js";
import type { TaskContract } from "../types.js";
import { withinModule } from "../project/architecture.js";

export function workerProjectContext(ir: ProjectIrSnapshot, contract: TaskContract): string {
  const hintedPaths = new Set(contract.contextHints.files);
  const hintedCapabilities = new Set(contract.contextHints.capabilities);
  const modules = ir.index.modules.filter((m) => [...hintedPaths, ...contract.contextHints.tests].some((p) => withinModule(p, m.path)));
  const capabilities = ir.index.capabilities.filter((c) => hintedCapabilities.has(c.name) || hintedCapabilities.has(c.id));
  const constraints = ir.index.constraints;
  return [
    "# Project architecture slice",
    "\n# Relevant modules",
    JSON.stringify(modules, null, 2),
    "\n# Reusable capabilities",
    JSON.stringify(capabilities, null, 2),
    "\n# Project constraints",
    JSON.stringify(constraints, null, 2),
    "\n# Bound knowledge (fresh corroborated facts; hypotheses are not obligations)",
    JSON.stringify(ir.index.knowledge?.filter((k) => contract.knowledgeRefs?.some((r) => r.id === k.id)), null, 2),
  ].join("\n");
}
