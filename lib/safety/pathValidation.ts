/**
 * Cartograph Path Containment Validator — Extraction Safety Layer
 *
 * Implements the Path Containment Validator specified in:
 *   specs/cartograph_extraction_safety_spec.md — Section 4 & Section 5
 *
 * Responsibility:
 *   Validate every extracted file path stays within the intended extraction
 *   root. Rejects zip-slip / path traversal attacks, absolute paths, symlink
 *   entries, and excessively long paths.
 *
 * Contract:
 *   - Never throws. Always returns a PathValidationResult.
 *   - Called synchronously in the hot path — must add negligible overhead.
 *   - Deterministic: the same adversarial input is rejected the same way
 *     on every run.
 *
 * Policy decisions (from spec):
 *   - Symlink entries within the zip are rejected outright — Cartograph
 *     never needs symlink-following for static import analysis.
 *   - Absolute paths are never valid within an extraction root.
 *   - Path length is capped at 4096 characters.
 *   - Fail closed — ambiguity is rejected, not accommodated.
 *
 * @module lib/safety/pathValidation
 */

import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of validating an extraction path.
 *
 * When safe=true, resolvedPath contains the validated absolute path that
 * is guaranteed to be within the extraction root.
 *
 * When safe=false, reason describes why the path was rejected.
 */
export interface PathValidationResult {
  readonly safe: boolean;
  /** Present only when safe=true: the fully resolved, validated path. */
  readonly resolvedPath?: string;
  /** Present only when safe=false: why the path was rejected. */
  readonly reason?: "traversal" | "symlink-escape" | "absolute-path" | "path-too-long";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum allowed path length for a zip entry.
 *
 * 4096 characters is well above any realistic repository depth while
 * blocking deeply-nested path-based attacks. Flagged in the spec
 * (Section 13) for recalibration once real benchmark data exists.
 */
const MAX_PATH_LENGTH = 4096;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Validate that an extracted file's path stays within the extraction root.
 *
 * Algorithm (from spec Section 5):
 *   1. Reject empty, null-containing, or excessively long paths.
 *   2. Reject absolute paths (both POSIX and Windows formats).
 *   3. Normalize separators to the platform convention.
 *   4. Resolve the entry path against the extraction root.
 *   5. Verify the resolved path starts with the extraction root at a
 *      path separator boundary (prevents /root2 matching /root).
 *
 * @param entryPath      - The raw path from the zip entry
 * @param extractionRoot - The absolute path to the extraction directory
 * @returns A PathValidationResult — never throws
 */
export function validateExtractionPath(
  entryPath: string,
  extractionRoot: string,
): PathValidationResult {
  // Guard: empty or null-byte-containing paths
  if (!entryPath || entryPath.includes("\0")) {
    return { safe: false, reason: "traversal" };
  }

  // Guard: path length ceiling (spec Section 6, edge case 4)
  if (entryPath.length > MAX_PATH_LENGTH) {
    return { safe: false, reason: "path-too-long" };
  }

  // Guard: reject absolute paths in both POSIX and Windows formats
  // This handles /etc/passwd, C:\Windows, \\UNC\paths, etc.
  // We normalize backslashes to forward slashes before checking POSIX,
  // and also check the raw entry for Windows-style absolute paths.
  const normalizedEntry = entryPath.replace(/\\/g, "/");
  if (
    path.posix.isAbsolute(normalizedEntry) ||
    path.win32.isAbsolute(entryPath)
  ) {
    return { safe: false, reason: "absolute-path" };
  }

  // Resolve both paths to absolute, platform-native form.
  // path.resolve handles .. normalization, mixed separators, etc.
  const resolvedRoot = path.resolve(extractionRoot);
  const resolvedPath = path.resolve(extractionRoot, normalizedEntry);

  // Separator-boundary containment check.
  // Append path.sep to the root to prevent prefix false-negatives:
  //   Without: "/extract/root2/file".startsWith("/extract/root") → true (WRONG)
  //   With:    "/extract/root2/file".startsWith("/extract/root/") → false (CORRECT)
  //
  // A zip entry should never resolve exactly to the extraction root itself.
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;

  if (!resolvedPath.startsWith(rootWithSep)) {
    return { safe: false, reason: "traversal" };
  }

  return { safe: true, resolvedPath };
}

/**
 * Check whether a zip entry represents a symbolic link.
 *
 * Per the spec (Section 5): "Symlink entries within the zip are rejected
 * outright — Cartograph never needs symlink-following for static import
 * analysis, so the simplest safe policy eliminates an entire bug class
 * rather than trying to validate 'safe' symlinks."
 *
 * This function is intended to be called with the raw zip entry attributes
 * before extraction. The exact mechanism for detecting symlinks depends
 * on the zip library (adm-zip stores Unix attributes in the external
 * file attributes field — bit 13 of the high word indicates a symlink).
 *
 * @param externalAttributes - The raw external file attributes from the
 *   zip entry header (as provided by adm-zip's entry.header.attr)
 * @returns true if the entry is a symlink and should be rejected
 */
export function isSymlinkEntry(externalAttributes: number): boolean {
  // Unix file type is stored in the upper 16 bits of external attributes.
  // Symlink file type in Unix is 0xA000 (0o120000).
  // Shift right by 16 to get the Unix mode, then mask with 0xF000 to
  // extract the file type bits.
  const unixMode = (externalAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0xf000;
  return fileType === 0xa000; // S_IFLNK
}
