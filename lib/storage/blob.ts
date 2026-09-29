import { put, del, head, list } from "@vercel/blob";
import type { AnalysisResult } from "@/types/graph";
import type { OwnerRecord, StorageBackend } from "./interface";
import { StorageError, isValidAnalysisId, isValidExplanationRef } from "./interface";

/*
 * Vercel Blob API notes (@vercel/blob 2.8.0, checked against its typings and source):
 * - `del` accepts blob URLs or pathnames, singly or as an array, so deletion
 *   can work from pathnames alone.
 * - `list({ prefix, cursor, limit })` returns `{ blobs, cursor, hasMore }`;
 *   `cursor` is only meaningful while `hasMore` is true.
 * - `put` rejects a falsy body ("body is required"), so an empty string is not
 *   allowed. Marker blobs therefore carry a single byte, "1".
 * - `put` will not overwrite an existing pathname unless `allowOverwrite` is set.
 * - Deleting a blob does not purge edge or browser caches, and
 *   `cacheControlMaxAge` defaults to one month (minimum one minute), so a
 *   deleted analysis could keep being served from the CDN. Analyses are saved
 *   with a one hour max age so a deletion takes effect within the hour.
 */

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
        // A deleted analysis stops being served by the CDN within the hour.
        cacheControlMaxAge: 3600,
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

  async saveOwner(id: string, record: OwnerRecord): Promise<void> {
    if (!isValidAnalysisId(id)) return;
    await put(`owners/${id}.json`, JSON.stringify(record), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
  }

  async loadOwner(id: string): Promise<OwnerRecord | null> {
    if (!isValidAnalysisId(id)) return null;
    return (await readJson(`owners/${id}.json`)) as OwnerRecord | null;
  }

  async markExpiry(id: string, expiresAt: string): Promise<void> {
    if (!isValidAnalysisId(id)) return;
    try {
      // put() rejects an empty body, so the marker holds one byte.
      await put(`expiry/${expiresAt.slice(0, 10)}/${id}`, "1", { access: "public", addRandomSuffix: false });
    } catch {
      // The load-time check still enforces expiry; the marker only helps the sweep.
    }
  }

  async listExpiredIds(now: Date): Promise<string[]> {
    const today = now.toISOString().slice(0, 10);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "expiry/", cursor, limit: 1000 });
      for (const blob of page.blobs) {
        const [, day, id] = blob.pathname.split("/");
        if (day && id && day <= today && isValidAnalysisId(id)) ids.push(id);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return ids.sort();
  }

  async deleteAnalysis(id: string): Promise<void> {
    if (!isValidAnalysisId(id)) return;
    const pathnames = [`analyses/${id}.json`, `owners/${id}.json`];
    for (const prefix of [`explanations/${id}/`, "expiry/"]) {
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000 });
        for (const blob of page.blobs) {
          if (prefix !== "expiry/" || blob.pathname.endsWith(`/${id}`)) pathnames.push(blob.pathname);
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    }
    await del(pathnames);
  }
}
