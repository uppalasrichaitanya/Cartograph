import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import { validateExtractionPath, isSymlinkEntry } from "./pathValidation";
import { sniffContent } from "./contentSniff";
import type { SafetyEventLog } from "./eventLog";

export const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;

export class UnsafeZipError extends Error {}

/**
 * Result of extracting a single zip entry.
 *
 * When `skipped` is true, the entry was rejected by a safety check
 * (path traversal, symlink, or binary content) and a SafetyEvent
 * has been recorded — but extraction continues for remaining entries.
 *
 * When `skipped` is false, the entry was extracted successfully and
 * `absolutePath` / `relativePath` are available for downstream use.
 */
export interface ExtractedEntry {
  readonly skipped: boolean;
  readonly absolutePath?: string;
  readonly relativePath?: string;
  /** Present only when skipped=true: the reason the entry was skipped. */
  readonly skipReason?: string;
}

/**
 * Summary of the extraction result.
 *
 * Replaces the previous void return type so the caller can see
 * how many entries were extracted versus skipped.
 */
export interface ExtractionResult {
  /** Total entries processed (including skipped). */
  readonly totalEntries: number;
  /** Entries successfully extracted to disk. */
  readonly extractedCount: number;
  /** Entries skipped due to safety violations (logged, not thrown). */
  readonly skippedCount: number;
  /** Per-entry results for downstream processing. */
  readonly entries: ExtractedEntry[];
}

/**
 * Safely extract a zip archive with hardened path validation.
 *
 * Integrates the Phase 5 Path Containment Validator and Symlink
 * Detector into the extraction loop. Replaces the previous ad hoc
 * `isWithinDirectory` check with the spec-compliant
 * `validateExtractionPath` function.
 *
 * Per the Extraction Safety spec (Section 3, data flow step 2):
 *   "Per zip entry, the Path Containment Validator checks the resolved
 *    output path; failing entries are dropped and logged, never extracted."
 *
 * Safety violations on individual entries are now logged and skipped
 * rather than throwing — consistent with the IR spec's per-file failure
 * isolation model. Aggregate violations (total size) still throw, as
 * they indicate a fundamentally unsafe archive.
 *
 * @param zipPath - Path to the zip archive to extract
 * @param destinationDirectory - Target directory for extraction
 * @param maximumUncompressedBytes - Aggregate size ceiling (default: 250MB)
 * @param eventLog - Optional safety event log for recording rejections
 * @returns ExtractionResult with per-entry details
 */
export async function safeUnzip(
  zipPath: string,
  destinationDirectory: string,
  maximumUncompressedBytes = MAX_UNCOMPRESSED_BYTES,
  eventLog?: SafetyEventLog,
): Promise<ExtractionResult> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    throw new UnsafeZipError("The uploaded file is not a valid zip archive.");
  }

  const root = path.resolve(destinationDirectory);
  let totalUncompressedSize = 0;
  const entries: ExtractedEntry[] = [];

  for (const entry of zip.getEntries()) {
    const rawName = entry.entryName.replace(/\\/g, "/");
    if (!rawName || rawName.includes("\0")) {
      throw new UnsafeZipError("The archive contains an unsafe file path.");
    }

    // --- Phase 5 integration: symlink detection ---
    // Per spec Section 5: "Symlink entries within the zip are rejected
    // outright — Cartograph never needs symlink-following for static
    // import analysis."
    if (isSymlinkEntry(entry.header.attr)) {
      eventLog?.recordPathRejection(rawName, "symlink entry rejected");
      entries.push({ skipped: true, skipReason: "symlink" });
      continue;
    }

    // --- Phase 5 integration: path containment validation ---
    // Replaces the previous ad hoc isWithinDirectory check with the
    // spec-compliant validateExtractionPath function.
    const validation = validateExtractionPath(rawName, root);
    if (!validation.safe) {
      eventLog?.recordPathRejection(
        rawName,
        `${validation.reason}: path escapes extraction root`,
      );
      // Per spec: "failing entries are dropped and logged, never extracted"
      // Individual path violations are skipped, not thrown, consistent
      // with per-file failure isolation.
      entries.push({ skipped: true, skipReason: validation.reason });
      continue;
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

    // --- Phase 5 integration: content sniffing ---
    // Per spec Section 3, data flow step 4: "Before a parser processes
    // an extracted file, the Content Sniffer checks a bounded byte sample;
    // failing files become a ParseError{reason:'unreadable'} without
    // invoking the parser."
    //
    // We sniff here during extraction so that binary files are still
    // written to disk (for completeness) but flagged in the entry result.
    // The downstream parse loop can then skip them.
    const sniffResult = sniffContent(data);
    const destination = validation.resolvedPath!;

    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data);

    if (!sniffResult.readable) {
      eventLog?.recordContentUnreadable(rawName, sniffResult.reason!);
      entries.push({
        skipped: true,
        absolutePath: destination,
        relativePath: rawName,
        skipReason: `content-${sniffResult.reason}`,
      });
      continue;
    }

    entries.push({
      skipped: false,
      absolutePath: destination,
      relativePath: rawName,
    });
  }

  return {
    totalEntries: entries.length,
    extractedCount: entries.filter((e) => !e.skipped).length,
    skippedCount: entries.filter((e) => e.skipped).length,
    entries,
  };
}
