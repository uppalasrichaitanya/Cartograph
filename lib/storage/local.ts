import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { AnalysisResult } from "@/types/graph";
import type { StorageBackend } from "./interface";
import { StorageError, isValidExplanationRef } from "./interface";

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
    if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
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
}

// --- Legacy named exports for backward compatibility ---
// These are used by existing code that imports { saveAnalysis } from "@/lib/storage/local".
// New code should import from "@/lib/storage" instead.
const _instance = new LocalStorage();
export const saveAnalysis = _instance.saveAnalysis.bind(_instance);
export const loadAnalysis = _instance.loadAnalysis.bind(_instance);
export const deleteUpload = _instance.deleteUpload.bind(_instance);
