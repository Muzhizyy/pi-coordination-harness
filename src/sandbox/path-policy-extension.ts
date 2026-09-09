import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { HarnessConfig } from "../types.js";
import { pathMatchesPattern, realRelative } from "./path-policy.js";

export function createPathPolicyExtension(workspace: string, config: HarnessConfig["sandbox"]): InlineExtension {
  return {
    name: "role-harness-path-policy",
    factory: (pi) => {
      pi.on("tool_call", async (event) => {
        if (!["read", "edit", "write", "grep", "find", "ls"].includes(event.toolName)) return undefined;
        const candidate = "path" in event.input && typeof event.input.path === "string"
          ? event.input.path
          : "directory" in event.input && typeof event.input.directory === "string"
            ? event.input.directory
            : undefined;
        if (!candidate) return undefined;
        const rel = await realRelative(workspace, candidate);
        if (rel === null) return { block: true, reason: `Path escapes isolated worker workspace (including symlinks): ${candidate}` };
        if ((event.toolName === "edit" || event.toolName === "write") && (rel === ".git" || rel.startsWith(".git/"))) {
          return { block: true, reason: "Direct writes to .git are not allowed." };
        }
        if ((event.toolName === "edit" || event.toolName === "write") && pathMatchesPattern(rel, config.denyWrite)) {
          return { block: true, reason: `Sensitive path is write-protected by harness policy: ${rel}` };
        }
        if (event.toolName === "read" && pathMatchesPattern(rel, config.denyRead)) {
          return { block: true, reason: `Sensitive path is read-protected by harness policy: ${rel}` };
        }
        return undefined;
      });
    },
  };
}
