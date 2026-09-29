/**
 * Loads an analysis only while it is meant to exist.
 *
 * Expiry is enforced here, at every read, so it holds even when the daily
 * sweep is not configured. An expired analysis is deleted in the background;
 * the caller answers "not found" without waiting for that.
 *
 * @module lib/storage/live
 */
import { isExpired } from "@/lib/ownership";
import type { AnalysisResult } from "@/types/graph";
import type { StorageBackend } from "./interface";

export async function loadLiveAnalysis(
  storage: StorageBackend,
  id: string,
  now: Date = new Date(),
): Promise<AnalysisResult | null> {
  const result = await storage.loadAnalysis(id);
  if (!result) return null;
  if (isExpired(result.retention, now)) {
    void storage.deleteAnalysis(id).catch(() => undefined);
    return null;
  }
  return result;
}
