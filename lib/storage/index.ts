import type { StorageBackend } from "./interface";
export type { StorageBackend } from "./interface";
export { StorageError, MAX_UPLOAD_BYTES } from "./interface";

/**
 * Storage backend factory.
 *
 * Selects the active storage backend based on the environment:
 *
 *   - If BLOB_READ_WRITE_TOKEN is set, use Vercel Blob storage.
 *     (This is always the case on Vercel deployments.)
 *   - Otherwise, fall back to the local filesystem backend.
 *     (Suitable for `npm run dev` without external services.)
 *
 * The singleton is lazily created on first call and cached for the
 * lifetime of the process.
 */
let _backend: StorageBackend | null = null;

export function getStorage(): StorageBackend {
  if (_backend) return _backend;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    // Dynamic import would be cleaner but top-level await is not
    // available in all Next.js contexts. Since @vercel/blob is a
    // production dependency, the synchronous require is safe here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BlobStorage } = require("./blob") as typeof import("./blob");
    _backend = new BlobStorage();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LocalStorage } = require("./local") as typeof import("./local");
    _backend = new LocalStorage();
  }

  return _backend;
}

/**
 * Whether the active backend is Vercel Blob.
 * Used by the frontend to decide between local upload and client-side
 * Blob upload.
 */
export function isUsingBlobStorage(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}
