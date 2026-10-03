import { join } from "node:path";
import type { EvidencePacket, EvidenceRequest } from "../types.js";
import { readJson, writeJson } from "../utils/fs.js";
import { gitOk } from "../utils/exec.js";
import { hash } from "./knowledge.js";

/** Tree identity covers new callers and negative evidence; no unsafe cross-tree reuse. */
export class EvidenceCache {
  private readonly path: string;
  constructor(private readonly repo: string) { this.path = join(repo, ".agent-orch/project/evidence-cache.json"); }
  private async key(request: EvidenceRequest, revision: string): Promise<string> {
    return hash({ tree: await gitOk(this.repo, ["rev-parse", `${revision}^{tree}`]), question: request.question, scope: request.scope, types: request.types });
  }
  async get(request: EvidenceRequest, revision: string): Promise<EvidencePacket | undefined> {
    if (request.types.includes("excerpt")) return undefined;
    let cache: Record<string, EvidencePacket>;
    try { cache = await readJson(this.path); } catch { return undefined; }
    const packet = cache[await this.key(request, revision)];
    if (!packet) return undefined;
    return { ...packet, revision, claims: packet.claims.map((c) => ({ ...c, evidence: c.evidence.map((e) => ({ ...e, revision })) })) };
  }
  async put(request: EvidenceRequest, packet: EvidencePacket): Promise<void> {
    if (request.types.includes("excerpt")) return;
    let cache: Record<string, EvidencePacket>;
    try { cache = await readJson(this.path); } catch { cache = {}; }
    cache[await this.key(request, packet.revision)] = packet;
    const keys = Object.keys(cache);
    for (const key of keys.slice(0, Math.max(0, keys.length - 128))) delete cache[key];
    await writeJson(this.path, cache);
  }
}
