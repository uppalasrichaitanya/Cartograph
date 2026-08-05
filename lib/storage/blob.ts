import { put, del, list } from "@vercel/blob";
import type { AnalysisResult } from "@/types/graph";
import type { StorageBackend } from "./interface";
import { StorageError } from "./interface";

/**
 * Vercel Blob storage backend.
 *
 * Persists analysis results as JSON blobs in Vercel Blob Storage and
 * manages temporary upload cleanup. Requires BLOB_READ_WRITE_TOKEN to
 * be set in the environment.
 */
export class BlobStorage implements StorageBackend {
  async saveAnalysis(result: AnalysisResult): Promise<void> {
    try {
      await put(`analyses/${result.id}.json`, JSON.stringify(result), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
      });
    } catch (error) {
      throw new StorageError(
        `Failed to save analysis: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  async loadAnalysis(id: string): Promise<AnalysisResult | null> {
    if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
    try {
      // List blobs matching the analysis path prefix to find the URL.
      const { blobs } = await list({ prefix: `analyses/${id}.json` });
      const blob = blobs[0];
      if (!blob) return null;

      const response = await fetch(blob.url);
      if (!response.ok) return null;

      return (await response.json()) as AnalysisResult;
    } catch {
      return null;
    }
  }

  async deleteUpload(blobUrl: string): Promise<void> {
    try {
      await del(blobUrl);
    } catch {
      // Best-effort cleanup; not critical.
    }
  }
}
