import { Type } from "typebox";
export const EvidenceRefSchema = Type.Object({ id: Type.String(), kind: Type.Union([Type.Literal("source"), Type.Literal("test"), Type.Literal("command"), Type.Literal("diagnostic"), Type.Literal("decision"), Type.Literal("diff")]), locator: Type.String(), summary: Type.String({ maxLength: 600 }), revision: Type.Optional(Type.String()) });
export const ObligationSchema = Type.Object({
  id: Type.String(), requirementId: Type.String(), description: Type.String(),
  category: Type.Union([Type.Literal("behavior"), Type.Literal("interface"), Type.Literal("invariant")]), mandatory: Type.Boolean(), covers: Type.Array(Type.String()),
  check: Type.Union([
    Type.Object({ kind: Type.Literal("command"), command: Type.String({ minLength: 1 }) }),
    Type.Object({ kind: Type.Literal("source"), file: Type.String(), contains: Type.Array(Type.String()), notContains: Type.Array(Type.String()) }),
    Type.Object({ kind: Type.Literal("review"), question: Type.String(), files: Type.Array(Type.String(), { minItems: 1 }) }),
  ]),
});
export const DecisionSchema = Type.Object({ id: Type.String(), area: Type.String(), summary: Type.String(), rationale: Type.String(), rejectedAlternatives: Type.Array(Type.String()), evidence: Type.Array(Type.String()), taskIds: Type.Array(Type.String(), { minItems: 1 }) });
