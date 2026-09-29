/**
 * Loads an analysis only while it is meant to exist.
 *
 * Expiry is enforced here, at every read, so it holds even when the daily
 * sweep is not configured. An expired analysis is deleted in the background;
 * the caller answers "not found" without waiting for that.
 *
 * @module lib/storage/live
 */
import { after } from "next/server";
import { isExpired } from "@/lib/ownership";
import type { AnalysisResult } from "@/types/graph";
import type { StorageBackend } from "./interface";

export type Schedule = (task: () => Promise<void>) => void;

/**
 * Runs a task after the response, where the platform supports it. `after`
 * throws outside a request scope (tests, scripts), so fall back to running it.
 */
export const scheduleAfterResponse: Schedule = (task) => {
  try {
    after(task);
  } catch {
    void task().catch(() => undefined);
  }
};

export async function loadLiveAnalysis(
  storage: StorageBackend,
  id: string,
  now: Date = new Date(),
  schedule: Schedule = scheduleAfterResponse,
): Promise<AnalysisResult | null> {
  const result = await storage.loadAnalysis(id);
  if (!result) return null;
  if (isExpired(result.retention, now)) {
    schedule(() => storage.deleteAnalysis(id).catch(() => undefined));
    return null;
  }
  return result;
}
