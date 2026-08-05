import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { AnalysisResult } from "@/types/graph";
import type { StorageBackend } from "./interface";
import { StorageError } from "./interface";

export { StorageError };
export { MAX_UPLOAD_BYTES } from "./interface";

/** Local data directory, relative to project root. */
const DATA_DIR = path.join(process.cwd(), ".data", "analyses");

/** Ensure the data directory exists. */
async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

/**
 * Local filesystem storage backend.
 *
 * Persists analysis results as JSON files under `.data/analyses/` and
 * manages temporary upload cleanup. Intended for local development
 * where no external storage service is needed.
 */
export class LocalStorage implements StorageBackend {
  async saveAnalysis(result: AnalysisResult): Promise<void> {
    await ensureDataDir();
    const filePath = path.join(DATA_DIR, `${result.id}.json`);
    await writeFile(filePath, JSON.stringify(result), "utf8");
  }

  async loadAnalysis(id: string): Promise<AnalysisResult | null> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
    const filePath = path.join(DATA_DIR, `${id}.json`);
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
}

// --- Legacy named exports for backward compatibility ---
// These are used by existing code that imports { saveAnalysis } from "@/lib/storage/local".
// New code should import from "@/lib/storage" instead.
const _instance = new LocalStorage();
export const saveAnalysis = _instance.saveAnalysis.bind(_instance);
export const loadAnalysis = _instance.loadAnalysis.bind(_instance);
export const deleteUpload = _instance.deleteUpload.bind(_instance);
