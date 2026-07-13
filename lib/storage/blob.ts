import { del, head, list, put } from "@vercel/blob";
import type { AnalysisResult } from "@/types/graph";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class BlobValidationError extends Error {}

function validateBlobUrl(blobUrl: string): URL {
  let url: URL;
  try {
    url = new URL(blobUrl);
  } catch {
    throw new BlobValidationError("blobUrl must be a valid Vercel Blob URL.");
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".blob.vercel-storage.com")) {
    throw new BlobValidationError("Only files uploaded to this app's Vercel Blob store can be analyzed.");
  }
  return url;
}

export async function validateUploadBlob(blobUrl: string): Promise<void> {
  validateBlobUrl(blobUrl);
  let blob;
  try {
    blob = await head(blobUrl);
  } catch {
    throw new BlobValidationError("The uploaded Blob could not be found.");
  }
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new BlobValidationError("The zip is larger than the 25 MB upload limit.");
  }
  if (!blob.pathname.toLowerCase().endsWith(".zip")) {
    throw new BlobValidationError("Please upload a .zip file.");
  }
}

/** Uploaded archives are transient; only the resulting JSON is retained for sharing. */
export async function deleteUploadBlob(blobUrl: string): Promise<void> {
  await del(blobUrl);
}

export async function saveAnalysis(result: AnalysisResult): Promise<void> {
  await put(`analyses/${result.id}.json`, JSON.stringify(result), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });
}

export async function loadAnalysis(id: string): Promise<AnalysisResult | null> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  const pathname = `analyses/${id}.json`;
  const found = await list({ prefix: pathname, limit: 1 });
  const blob = found.blobs.find((candidate) => candidate.pathname === pathname);
  if (!blob) return null;
  const response = await fetch(blob.url, { cache: "no-store" });
  if (!response.ok) throw new Error("Saved analysis could not be read.");
  return (await response.json()) as AnalysisResult;
}
