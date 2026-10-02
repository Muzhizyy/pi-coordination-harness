import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ProjectIrIndex } from "../types.js";
import { projectArchitecture } from "../project/architecture.js";
import { EvidenceResolver, PlannerContextBudget } from "../project/evidence.js";

export function createArchitectureTools(index: ProjectIrIndex, budget: PlannerContextBudget, resolver: EvidenceResolver) {
  const query = (name: string, description: string, inspect: (id: string) => unknown) => defineTool({
    name, label: name, description, parameters: Type.Object({ id: Type.String() }),
    execute: async (_call, { id }) => {
      const result = inspect(id);
      budget.semantic(result);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
    },
  });
  return [
    query("inspect_architecture", "Get a bounded architecture projection for a decision topic (id). Omitted counts indicate missing context.", (topic) => projectArchitecture(index, topic, Math.max(1024, budget.limits.architectureTokens - budget.architectureUnits))),
    query("inspect_module", "Inspect one module's responsibilities, exclusions, public surfaces and dependencies.", (id) => ({
      module: index.modules.find((m) => m.id === id), dependencies: (index.dependencies ?? []).filter((e) => e.from === id || e.to === id),
      interfaces: index.interfaces.filter((i) => i.owner === id),
    })),
    query("inspect_interface", "Inspect an interface by name/id, without implementation bodies.", (id) => index.interfaces.filter((i) => i.id === id || i.name === id)),
    query("inspect_capability", "Find existing reusable capabilities by id, name or topic.", (id) => index.capabilities.filter((c) => c.id === id || c.name.toLowerCase().includes(id.toLowerCase()))),
    query("inspect_impact", "Find transitive dependent modules affected by a module change.", (id) => {
      const impacted = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const edge of index.dependencies ?? []) if (impacted.has(edge.to) && !impacted.has(edge.from)) { impacted.add(edge.from); changed = true; }
      }
      return { moduleIds: [...impacted], limitation: "Indexed dependencies; dynamic calls and unindexed imports may be missing." };
    }),
    defineTool({
      name: "inspect_project_constraints", label: "Project constraints", description: "Inspect global architectural invariants and durable decisions.", parameters: Type.Object({}),
      execute: async () => {
        const result = { constraints: index.constraints, decisions: index.decisions ?? [], unresolved: index.unresolved };
        budget.semantic(result);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: {} };
      },
    }),
    defineTool({
      name: "request_evidence", label: "Request Evidence", description: "Ask a scoped, decision-relevant question. Prefer semantic facts; excerpts require a named ambiguity and 1–80 lines within the raw-source budget.",
      parameters: Type.Object({
        question: Type.String({ maxLength: 1000 }), decision: Type.String({ maxLength: 1000 }),
        scope: Type.Object({ modules: Type.Array(Type.String(), { maxItems: 8 }), symbols: Type.Array(Type.String(), { maxItems: 8 }), files: Type.Array(Type.String(), { maxItems: 8 }) }),
        types: Type.Array(Type.Union([Type.Literal("interfaces"), Type.Literal("dependencies"), Type.Literal("callers"), Type.Literal("tests"), Type.Literal("behavior"), Type.Literal("excerpt")]), { minItems: 1 }),
        excerpt: Type.Optional(Type.Object({ file: Type.String(), startLine: Type.Integer({ minimum: 1 }), endLine: Type.Integer({ minimum: 1 }), ambiguity: Type.String({ minLength: 1, maxLength: 1000 }) })),
      }),
      execute: async (_call, request) => {
        const packet = await resolver.resolve(request);
        return { content: [{ type: "text", text: JSON.stringify(packet) }], details: { evidenceId: packet.id } };
      },
    }),
  ];
}
