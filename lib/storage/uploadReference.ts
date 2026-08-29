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

function isBlobUploadReference(ref: string): boolean {
  try {
    const url = new URL(ref);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(BLOB_HOST_SUFFIX) &&
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
