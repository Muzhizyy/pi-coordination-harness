import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "./utils/fs.js";

const here = dirname(fileURLToPath(import.meta.url));
const promptDir = join(here, "..", "prompts");

export function loadPrompt(name: string): Promise<string> {
  return readText(join(promptDir, name));
}

export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}
