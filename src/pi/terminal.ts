import type { InlineExtension } from "@earendil-works/pi-coding-agent";

/** A captured artifact is terminal even if the model emits more tool calls. */
export function terminalExtension(terminalTool: string, committed: () => boolean, maxToolCalls = 64): InlineExtension {
  return {
    name: `terminal-${terminalTool}`,
    factory: (pi) => {
      let calls = 0;
      pi.on("before_agent_start", () => { calls = 0; });
      pi.on("tool_call", (_event, ctx) => {
        if (committed() || ++calls > maxToolCalls) {
          ctx.abort();
          return { block: true, reason: "Role turn is terminal or its tool-call budget is exhausted" };
        }
        return undefined;
      });
      pi.on("tool_result", (event, ctx) => {
        if (event.toolName === terminalTool && !event.isError && committed()) ctx.abort();
      });
    },
  };
}
