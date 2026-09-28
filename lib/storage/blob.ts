import { put, del, head } from "@vercel/blob";
import type { AnalysisResult } from "@/types/graph";
import type { StorageBackend } from "./interface";
import { StorageError, isValidExplanationRef } from "./interface";

/**
 * Fetches a public blob's JSON by pathname.
 *
 * `head` is a simple Blob operation, where `list` is an advanced one with a
 * much smaller free quota. Loading every shared page through `list` spent
 * that quota on reads.
 */
async function readJson(pathname: string): Promise<unknown | null> {
  try {
    const { url } = await head(pathname);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    // BlobNotFoundError and network failures both mean "not available".
    return null;
  }
}

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
    return (await readJson(`analyses/${id}.json`)) as AnalysisResult | null;
  }

  async deleteUpload(blobUrl: string): Promise<void> {
    try {
      await del(blobUrl);
    } catch {
      // Best-effort cleanup; not critical.
    }
  }

  async loadExplanation(analysisId: string, key: string): Promise<unknown | null> {
    if (!isValidExplanationRef(analysisId, key)) return null;
    return readJson(`explanations/${analysisId}/${key}.json`);
  }

  async saveExplanation(analysisId: string, key: string, value: unknown): Promise<void> {
    if (!isValidExplanationRef(analysisId, key)) return;
    try {
      await put(`explanations/${analysisId}/${key}.json`, JSON.stringify(value), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        // "Refresh explanation" overwrites the entry, so keep CDN caching short.
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
    } catch {
      // A cache write failing must never fail the request that produced it.
    }
  }
}
