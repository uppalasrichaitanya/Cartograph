import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { AnalysisResult } from "@/types/graph";
import type { OwnerRecord, StorageBackend } from "./interface";
import { StorageError, expiryDay, isValidAnalysisId, isValidExplanationRef } from "./interface";

export { StorageError };
export { MAX_UPLOAD_BYTES } from "./interface";

/** Local data directory, relative to project root. */
const DEFAULT_DATA_DIR = path.join(process.cwd(), ".data", "analyses");

/**
 * Local filesystem storage backend.
 *
 * Persists analysis results as JSON files under `.data/analyses/` and
 * manages temporary upload cleanup. Intended for local development
 * where no external storage service is needed.
 */
export class LocalStorage implements StorageBackend {
  constructor(private readonly dataDir: string = DEFAULT_DATA_DIR) {}

  async saveAnalysis(result: AnalysisResult): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const filePath = path.join(this.dataDir, `${result.id}.json`);
    await writeFile(filePath, JSON.stringify(result), "utf8");
  }

  async loadAnalysis(id: string): Promise<AnalysisResult | null> {
    if (!isValidAnalysisId(id)) return null;
    const filePath = path.join(this.dataDir, `${id}.json`);
    try {
      const data = await readFile(filePath, "utf8");
      return JSON.parse(data) as AnalysisResult;
    } catch {
      return null;
    }
  }

  async deleteUpload(filePath: string): Promise<void> {
    try {
      await rm(filePath, { force: true });
    } catch {
      // Best-effort cleanup; not critical.
    }
  }

  private explanationPath(analysisId: string, key: string): string {
    return path.join(path.dirname(this.dataDir), "explanations", analysisId, `${key}.json`);
  }

  async loadExplanation(analysisId: string, key: string): Promise<unknown | null> {
    if (!isValidExplanationRef(analysisId, key)) return null;
    try {
      return JSON.parse(await readFile(this.explanationPath(analysisId, key), "utf8")) as unknown;
    } catch {
      return null;
    }
  }

  async saveExplanation(analysisId: string, key: string, value: unknown): Promise<void> {
    if (!isValidExplanationRef(analysisId, key)) return;
    const filePath = this.explanationPath(analysisId, key);
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(value), "utf8");
    } catch {
      // A cache write failing must never fail the request that produced it.
    }
  }

  /** Sibling folders (owners, expiry, explanations) live beside the analyses folder. */
  private sibling(...parts: string[]): string {
    return path.join(path.dirname(this.dataDir), ...parts);
  }

  async saveOwner(id: string, record: OwnerRecord): Promise<void> {
    if (!isValidAnalysisId(id)) return;
    await mkdir(this.sibling("owners"), { recursive: true });
    await writeFile(this.sibling("owners", `${id}.json`), JSON.stringify(record), "utf8");
  }

  async loadOwner(id: string): Promise<OwnerRecord | null> {
    if (!isValidAnalysisId(id)) return null;
    try {
      return JSON.parse(await readFile(this.sibling("owners", `${id}.json`), "utf8")) as OwnerRecord;
    } catch {
      return null;
    }
  }

  async markExpiry(id: string, expiresAt: string): Promise<void> {
    if (!isValidAnalysisId(id)) return;
    const day = expiryDay(expiresAt);
    if (!day) return;
    await mkdir(this.sibling("expiry", day), { recursive: true });
    await writeFile(this.sibling("expiry", day, id), "", "utf8");
  }

  async listExpiredIds(now: Date): Promise<string[]> {
    const today = now.toISOString().slice(0, 10);
    const ids: string[] = [];
    let days: string[];
    try {
      days = await readdir(this.sibling("expiry"));
    } catch {
      return [];
    }
    for (const day of days.sort()) {
      if (day > today) continue;
      ids.push(...(await readdir(this.sibling("expiry", day))).filter(isValidAnalysisId));
    }
    return ids.sort();
  }

  async deleteAnalysis(id: string): Promise<void> {
    if (!isValidAnalysisId(id)) return;
    await rm(path.join(this.dataDir, `${id}.json`), { force: true });
    await rm(this.sibling("explanations", id), { recursive: true, force: true });
    await rm(this.sibling("owners", `${id}.json`), { force: true });
    let days: string[] = [];
    try {
      days = await readdir(this.sibling("expiry"));
    } catch {
      // No markers were ever written.
    }
    for (const day of days) await rm(this.sibling("expiry", day, id), { force: true });
  }
}

// --- Legacy named exports for backward compatibility ---
// These are used by existing code that imports { saveAnalysis } from "@/lib/storage/local".
// New code should import from "@/lib/storage" instead.
const _instance = new LocalStorage();
export const saveAnalysis = _instance.saveAnalysis.bind(_instance);
export const loadAnalysis = _instance.loadAnalysis.bind(_instance);
export const deleteUpload = _instance.deleteUpload.bind(_instance);
