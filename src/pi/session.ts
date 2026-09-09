import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import type { ModelProfile, RoleMetrics } from "../types.js";

export class PiRuntime {
  readonly modelRuntimePromise = ModelRuntime.create();

  async resolveModel(profile: ModelProfile): Promise<{ runtime: ModelRuntime; model: NonNullable<ReturnType<ModelRuntime["getModel"]>> }> {
    const runtime = await this.modelRuntimePromise;
    const model = runtime.getModel(profile.provider, profile.model);
    if (!model) throw new Error(`Pi model not found: ${profile.provider}/${profile.model}`);
    return { runtime, model };
  }

  async createRoleSession(options: {
    cwd: string;
    profile: ModelProfile;
    systemPrompt: string;
    tools: string[];
    customTools?: ToolDefinition[];
    extensionFactories?: InlineExtension[];
    persistent?: boolean;
  }) {
    const { runtime, model } = await this.resolveModel(options.profile);
    const settingsManager = SettingsManager.inMemory({
      retry: { enabled: true, maxRetries: 2 },
      compaction: { enabled: true },
    });
    const loader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: getAgentDir(),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: options.extensionFactories ?? [],
      systemPromptOverride: () => options.systemPrompt,
    });
    await loader.reload();
    const { session } = await createAgentSession({
      cwd: options.cwd,
      model,
      thinkingLevel: options.profile.thinkingLevel ?? "medium",
      modelRuntime: runtime,
      tools: options.tools,
      customTools: options.customTools,
      resourceLoader: loader,
      settingsManager,
      sessionManager: options.persistent
        ? SessionManager.create(options.cwd)
        : SessionManager.inMemory(options.cwd),
    });
    return session;
  }
}

export function roleMetrics(session: { getSessionStats(): { toolCalls: number; tokens: RoleMetrics["tokens"]; cost: number } }): RoleMetrics {
  const stats = session.getSessionStats();
  return { calls: 1, toolCalls: stats.toolCalls, tokens: stats.tokens, cost: stats.cost };
}
