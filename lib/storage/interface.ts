import type { AnalysisResult } from "@/types/graph";

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
}

const ANALYSIS_ID = /^[a-f0-9-]{36}$/i;
const EXPLANATION_KEY = /^[a-f0-9]{64}$/;

/** Both parts become storage paths, so they are validated strictly. */
export function isValidExplanationRef(analysisId: string, key: string): boolean {
  return ANALYSIS_ID.test(analysisId) && EXPLANATION_KEY.test(key);
}

/** Re-export the error class so consumers don't import from a specific backend. */
export class StorageError extends Error {}

/** Maximum upload size enforced across all backends. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
