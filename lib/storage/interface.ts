import type { AnalysisResult } from "@/types/graph";

/** The stored proof of who may delete an analysis: a hash, never the token. */
export type OwnerRecord = Readonly<{ tokenHash: string; createdAt: string }>;

const EXPIRY_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The YYYY-MM-DD part of an expiry timestamp, or null when malformed (it becomes a path segment). */
export function expiryDay(expiresAt: string): string | null {
  const day = expiresAt.slice(0, 10);
  return EXPIRY_DAY_PATTERN.test(day) ? day : null;
}

const ANALYSIS_ID_PATTERN = /^[a-f0-9-]{36}$/i;
export function isValidAnalysisId(id: string): boolean {
  return ANALYSIS_ID_PATTERN.test(id);
}

/**
 * Storage backend interface for Cartograph.
 *
 * Implementations persist analysis results and manage temporary upload
 * artifacts. The active backend is selected at startup via environment
 * configuration, making the rest of the application storage-agnostic.
 */
export interface StorageBackend {
  /** Persist a completed analysis result. */
  saveAnalysis(result: AnalysisResult): Promise<void>;

  /** Load a previously saved analysis by its UUID. Returns null if not found. */
  loadAnalysis(id: string): Promise<AnalysisResult | null>;

  /** Delete a temporary upload artifact (best-effort). */
  deleteUpload(ref: string): Promise<void>;

  /**
   * Load a cached AI explanation for an analysis. `key` is a 64-character hex
   * digest of the subject and prompt version. Returns null on a miss.
   */
  loadExplanation(analysisId: string, key: string): Promise<unknown | null>;

  /** Cache an AI explanation (best-effort; failures are swallowed). */
  saveExplanation(analysisId: string, key: string, value: unknown): Promise<void>;

  /** Persist the hash of an analysis's owner token. */
  saveOwner(id: string, record: OwnerRecord): Promise<void>;

  /** Load an owner record, or null when absent (for example, analyses made before ownership existed). */
  loadOwner(id: string): Promise<OwnerRecord | null>;

  /** Record that an analysis expires on this date, for the daily sweep. */
  markExpiry(id: string, expiresAt: string): Promise<void>;

  /** Ids whose expiry date is on or before `now`. */
  listExpiredIds(now: Date): Promise<string[]>;

  /** Remove an analysis and everything stored about it. Idempotent. */
  deleteAnalysis(id: string): Promise<void>;
}

const EXPLANATION_KEY = /^[a-f0-9]{64}$/;

/** Both parts become storage paths, so they are validated strictly. */
export function isValidExplanationRef(analysisId: string, key: string): boolean {
  return isValidAnalysisId(analysisId) && EXPLANATION_KEY.test(key);
}

/** Re-export the error class so consumers don't import from a specific backend. */
export class StorageError extends Error {}

/** Maximum upload size enforced across all backends. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
