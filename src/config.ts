import { resolve } from "node:path";
import { readJson } from "./utils/fs.js";
import type { HarnessConfig, ModelProfile } from "./types.js";

const DEFAULTS: Omit<HarnessConfig, "planner" | "worker"> = {
  plannerContext: { architectureTokens: 12000, rawCodeTokens: 2000, evidenceRequests: 6 },
  sandbox: {
    enabled: true,
    allowNetwork: false,
    allowedDomains: [],
    denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],
    denyWrite: [".env", ".env.*", "*.pem", "*.key"],
  },
  budgets: {
    workerVerificationRetries: 2,
    fastWorkerAttempts: 2,
  },
  verification: { finalCommands: [] },
};

type ConfigInput = Partial<HarnessConfig> & {
  pro?: ModelProfile;
  flash?: ModelProfile;
  proWorker?: ModelProfile;
};

export async function loadConfig(path: string): Promise<HarnessConfig> {
  const raw = await readJson<ConfigInput>(resolve(path));
  if (!raw || typeof raw !== "object" || !(raw.pro ?? raw.planner) || !(raw.flash ?? raw.worker)) {
    throw new Error("Config must define pro and flash model profiles.");
  }
  const config: HarnessConfig = {
    planner: (raw.pro ?? raw.planner)!,
    worker: (raw.flash ?? raw.worker)!,
    strongWorker: raw.proWorker ?? raw.strongWorker,
    scout: raw.scout,
    plannerContext: { ...DEFAULTS.plannerContext, ...raw.plannerContext },
    sandbox: { ...DEFAULTS.sandbox, ...raw.sandbox },
    budgets: { ...DEFAULTS.budgets, ...raw.budgets },
    verification: { ...DEFAULTS.verification, ...raw.verification },
  };
  for (const [role, profile] of Object.entries({ pro: config.planner, flash: config.worker, proWorker: config.strongWorker, scout: config.scout })) {
    if (profile === undefined && (role === "proWorker" || role === "scout")) continue;
    if (!profile || typeof profile.provider !== "string" || !profile.provider.trim() || typeof profile.model !== "string" || !profile.model.trim()) {
      throw new Error(`${role} must specify non-empty provider and model strings`);
    }
    if (profile.thinkingLevel !== undefined && !["off", "low", "medium", "high"].includes(profile.thinkingLevel)) {
      throw new Error(`${role}.thinkingLevel must be off, low, medium, or high`);
    }
  }
  for (const [key, minimum] of [["architectureTokens", 1024], ["rawCodeTokens", 0], ["evidenceRequests", 0]] as const) {
    if (!Number.isSafeInteger(config.plannerContext[key]) || config.plannerContext[key] < minimum) {
      throw new Error(`plannerContext.${key} must be an integer >= ${minimum}`);
    }
  }
  for (const [key, minimum] of [["fastWorkerAttempts", 1], ["workerVerificationRetries", 0]] as const) {
    if (!Number.isSafeInteger(config.budgets[key]) || config.budgets[key] < minimum) {
      throw new Error(`budgets.${key} must be an integer >= ${minimum}`);
    }
  }
  for (const key of ["enabled", "allowNetwork"] as const) {
    if (typeof config.sandbox[key] !== "boolean") throw new Error(`sandbox.${key} must be boolean`);
  }
  for (const [label, value] of Object.entries({
    allowedDomains: config.sandbox.allowedDomains,
    denyRead: config.sandbox.denyRead,
    denyWrite: config.sandbox.denyWrite,
    finalCommands: config.verification.finalCommands,
  })) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${label} must be a string array`);
  }
  return config;
}
