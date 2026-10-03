#!/usr/bin/env node
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { ProjectRuntime } from "./runtime/project-runtime.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.length < 3) {
    console.log(`pi-coordination-harness run --repo <path> --config <file> (--requirement <text> | --requirement-file <file>)\npi-coordination-harness resume --repo <path> --config <file> --run-id <id>`);
    return;
  }
  const command = process.argv[2];
  if (!["run", "resume"].includes(command!)) throw new Error(`Unknown command: ${command}`);
  const repo = resolve(arg("--repo") ?? process.cwd());
  const configPath = resolve(arg("--config") ?? "pi-coordination.config.json");
  const requirement = arg("--requirement") ?? (arg("--requirement-file") ? await readFile(resolve(arg("--requirement-file")!), "utf8") : undefined);
  const config = await loadConfig(configPath);
  const runtime = new ProjectRuntime(repo, config);
  if (command === "run" && !requirement) throw new Error("Provide --requirement or --requirement-file");
  if (command === "resume" && !arg("--run-id")) throw new Error("Provide --run-id");
  const result = command === "resume" ? await runtime.resume(arg("--run-id")!) : await runtime.run(requirement!);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
