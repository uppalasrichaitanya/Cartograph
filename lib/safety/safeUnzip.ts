import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";

export const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;

export class UnsafeZipError extends Error {}

function isWithinDirectory(root: string, destination: string): boolean {
  const relative = path.relative(root, destination);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function safeUnzip(
  zipPath: string,
  destinationDirectory: string,
  maximumUncompressedBytes = MAX_UNCOMPRESSED_BYTES,
): Promise<void> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    throw new UnsafeZipError("The uploaded file is not a valid zip archive.");
  }

  const root = path.resolve(destinationDirectory);
  let totalUncompressedSize = 0;
  for (const entry of zip.getEntries()) {
    const rawName = entry.entryName.replace(/\\/g, "/");
    if (!rawName || rawName.includes("\0")) throw new UnsafeZipError("The archive contains an unsafe file path.");
    const destination = path.resolve(root, rawName);
    if (!isWithinDirectory(root, destination)) {
      throw new UnsafeZipError("The archive contains a path that escapes the extraction directory.");
    }
    if (entry.isDirectory) continue;

    const declaredSize = Number(entry.header.size);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
      throw new UnsafeZipError("The archive contains an invalid entry size.");
    }
    totalUncompressedSize += declaredSize;
    if (totalUncompressedSize > maximumUncompressedBytes) {
      throw new UnsafeZipError("The archive expands beyond the configured safety limit.");
    }
    let data: Buffer;
    try {
      data = entry.getData();
    } catch {
      throw new UnsafeZipError("The archive could not be safely extracted.");
    }
    if (data.byteLength !== declaredSize) {
      throw new UnsafeZipError("The archive contains an inconsistent entry size.");
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }
}
