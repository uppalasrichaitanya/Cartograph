import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { AnalysisResult } from "@/types/graph";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Local data directory, relative to project root. */
const DATA_DIR = path.join(process.cwd(), ".data", "analyses");

export class StorageError extends Error {}

/** Ensure the data directory exists. */
async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

/** Persist an analysis result as a JSON file on disk. */
export async function saveAnalysis(result: AnalysisResult): Promise<void> {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, `${result.id}.json`);
  await writeFile(filePath, JSON.stringify(result), "utf8");
}

/** Load a previously saved analysis by its UUID. Returns null if not found. */
export async function loadAnalysis(id: string): Promise<AnalysisResult | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const filePath = path.join(DATA_DIR, `${id}.json`);
  try {
    const data = await readFile(filePath, "utf8");
    return JSON.parse(data) as AnalysisResult;
  } catch {
    return null;
  }
}

/** Delete a temporary upload file from disk. */
export async function deleteUpload(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Best-effort cleanup; not critical.
  }
}
