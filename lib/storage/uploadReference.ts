import path from "node:path";
import { tmpdir } from "node:os";

export type UploadStorageMode = "local" | "blob";

const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const LOCAL_UPLOAD_DIR = path.resolve(tmpdir(), "cartograph-uploads");

function isLocalUploadReference(ref: string): boolean {
  if (!ref) return false;

  const candidate = path.resolve(ref);
  const relative = path.relative(LOCAL_UPLOAD_DIR, candidate);
  const staysInsideUploadDir =
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);

  return staysInsideUploadDir && candidate.toLowerCase().endsWith(".zip");
}

/**
 * The public host of the Blob store this deployment writes to, derived the
 * same way `@vercel/blob` does (`vercel_blob_rw_<storeId>_<secret>`).
 * Null when no token is configured.
 */
function ownBlobHost(): string | null {
  const storeId = process.env.BLOB_READ_WRITE_TOKEN?.split("_")[3];
  return storeId ? `${storeId.toLowerCase()}${BLOB_HOST_SUFFIX}` : null;
}

function isBlobUploadReference(ref: string): boolean {
  try {
    const url = new URL(ref);
    // With a token configured, only this deployment's own store is accepted;
    // otherwise the server could be asked to fetch archives from any store.
    const ownHost = ownBlobHost();
    return (
      url.protocol === "https:" &&
      (ownHost ? url.hostname === ownHost : url.hostname.endsWith(BLOB_HOST_SUFFIX)) &&
      url.pathname.startsWith("/uploads/") &&
      url.pathname.toLowerCase().endsWith(".zip")
    );
  } catch {
    return false;
  }
}

export function isValidUploadReference(ref: string, mode: UploadStorageMode): boolean {
  return mode === "blob"
    ? isBlobUploadReference(ref)
    : isLocalUploadReference(ref);
}
