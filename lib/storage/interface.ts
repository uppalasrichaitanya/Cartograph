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
}

/** Re-export the error class so consumers don't import from a specific backend. */
export class StorageError extends Error {}

/** Maximum upload size enforced across all backends. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
