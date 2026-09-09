import type { RoleMetrics, RunMetrics } from "../types.js";

export function emptyRoleMetrics(): RoleMetrics {
  return {
    calls: 0,
    toolCalls: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

export function emptyRunMetrics(): RunMetrics {
  return {
    planner: emptyRoleMetrics(),
    worker: emptyRoleMetrics(),
    strongWorker: emptyRoleMetrics(),
    plannerWakeups: [],
    taskAttempts: {},
  };
}

export function addRoleMetrics(target: RoleMetrics, incoming: RoleMetrics): void {
  target.calls += incoming.calls;
  target.toolCalls += incoming.toolCalls;
  target.tokens.input += incoming.tokens.input;
  target.tokens.output += incoming.tokens.output;
  target.tokens.cacheRead += incoming.tokens.cacheRead;
  target.tokens.cacheWrite += incoming.tokens.cacheWrite;
  target.tokens.total += incoming.tokens.total;
  target.cost += incoming.cost;
}
