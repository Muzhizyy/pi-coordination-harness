import { spawn } from "node:child_process";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function exec(
  command: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = { cwd: process.cwd() },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const timer = options.timeoutMs
      ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs)
      : undefined;
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

export async function git(cwd: string, args: string[], timeoutMs = 60_000): Promise<ExecResult> {
  return exec("git", args, { cwd, timeoutMs });
}

export async function gitOk(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}
