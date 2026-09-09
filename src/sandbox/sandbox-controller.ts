import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import type { HarnessConfig } from "../types.js";

export class SandboxController {
  private initialized = false;

  async initialize(workspace: string, config: HarnessConfig["sandbox"]): Promise<void> {
    if (!config.enabled) return;
    if (process.platform !== "linux" && process.platform !== "darwin") {
      throw new Error(`Sandbox runtime requires Linux or macOS; got ${process.platform}`);
    }
    if (this.initialized) await SandboxManager.reset();
    await SandboxManager.initialize({
      network: {
        allowedDomains: config.allowNetwork ? config.allowedDomains : [],
        deniedDomains: [],
      },
      filesystem: {
        denyRead: config.denyRead,
        allowWrite: [workspace, "/tmp"],
        denyWrite: config.denyWrite,
      },
    });
    this.initialized = true;
  }

  async wrap(command: string): Promise<string> {
    if (!this.initialized) return command;
    return SandboxManager.wrapWithSandbox(command);
  }

  bashOperations(): BashOperations {
    return {
      exec: async (command, cwd, { onData, signal, timeout }) => {
        if (!existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`);
        const wrapped = await this.wrap(command);
        return new Promise((resolvePromise, reject) => {
          const child = spawn("bash", ["-c", wrapped], {
            cwd,
            detached: true,
            stdio: ["ignore", "pipe", "pipe"],
          });
          let timedOut = false;
          const kill = () => {
            if (!child.pid) return;
            try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
          };
          const timer = timeout && timeout > 0 ? setTimeout(() => { timedOut = true; kill(); }, timeout * 1000) : undefined;
          child.stdout?.on("data", onData);
          child.stderr?.on("data", onData);
          child.on("error", reject);
          const onAbort = () => kill();
          signal?.addEventListener("abort", onAbort, { once: true });
          child.on("close", (code) => {
            if (timer) clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            if (signal?.aborted) reject(new Error("aborted"));
            else if (timedOut) reject(new Error(`timeout:${timeout}`));
            else resolvePromise({ exitCode: code });
          });
        });
      },
    };
  }

  async exec(command: string, cwd: string, timeoutMs = 120_000): Promise<{ exitCode: number; output: string }> {
    const wrapped = await this.wrap(command);
    return new Promise((resolvePromise, reject) => {
      const child = spawn("bash", ["-c", wrapped], { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += String(chunk); });
      child.stderr.on("data", (chunk) => { output += String(chunk); });
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("error", reject);
      child.on("close", (code) => { clearTimeout(timer); resolvePromise({ exitCode: code ?? 1, output }); });
    });
  }

  async dispose(): Promise<void> {
    if (this.initialized) {
      await SandboxManager.reset();
      this.initialized = false;
    }
  }
}
