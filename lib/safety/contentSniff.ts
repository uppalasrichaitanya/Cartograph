/**
 * Cartograph Content Sniffer — Extraction Safety Layer
 *
 * Implements the Content Sniffer specified in:
 *   specs/cartograph_extraction_safety_spec.md — Section 4 & Section 5
 *
 * Responsibility:
 *   Fast binary/encoding check before a parser receives file bytes.
 *   Operates on a bounded initial sample (first 8KB), not the full file —
 *   O(1) relative to file size.
 *
 * Contract:
 *   - Never throws. Always returns a ContentSniffResult.
 *   - Called synchronously in the hot path — must add negligible overhead.
 *   - Deterministic: the same content produces the same result on every run.
 *
 * Design rationale (from spec Section 5):
 *   Read a bounded initial sample (8KB), attempt UTF-8 decode, and check
 *   the null-byte / non-printable-character ratio (standard binary-detection
 *   heuristic). The 8KB sample means a file valid for its sample but corrupted
 *   later would not be caught here — but it will still be caught by the parser
 *   itself as a fatal ParseError, so no unsafe behavior results. This is an
 *   acceptable trade-off per the spec's design review (Section 13).
 *
 * Integration:
 *   Sits between extraction and parser invocation. Files failing this check
 *   produce a ParseError{reason:'unreadable'} without invoking the parser,
 *   per the IR spec's failure handling model.
 *
 * @module lib/safety/contentSniff
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of sniffing a file's content for readability.
 *
 * When readable=true, the content is suitable for parser consumption.
 * When readable=false, reason describes why it was rejected.
 */
export interface ContentSniffResult {
  readonly readable: boolean;
  /** Present only when readable=false: why the content was rejected. */
  readonly reason?: "binary" | "invalid-encoding" | "empty";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum sample size in bytes. The sniffer never reads beyond this,
 * ensuring O(1) time relative to file size.
 *
 * 8KB is sufficient to detect binary content with high confidence
 * while keeping the check negligible in the common case.
 */
const MAX_SAMPLE_BYTES = 8192;

/**
 * Threshold for the ratio of non-printable control characters to total
 * sample bytes. If exceeded, the file is classified as binary.
 *
 * 10% is a standard heuristic (used by Git, file(1), etc.) that handles
 * edge cases like minified code with unusual characters while still
 * catching actual binary content.
 */
const NON_PRINTABLE_RATIO_THRESHOLD = 0.10;

/**
 * Maximum allowed ratio of UTF-8 replacement characters (U+FFFD) to
 * total decoded string length. Beyond this, the file is classified as
 * having an invalid encoding.
 *
 * A small number of replacements (up to 3) are tolerated because cutting
 * the buffer at the 8KB boundary may split a multi-byte UTF-8 character.
 */
const REPLACEMENT_CHAR_RATIO_THRESHOLD = 0.05;

/**
 * Minimum replacement character count before the ratio check activates.
 * This prevents a single split multi-byte character at the boundary
 * from triggering a false positive.
 */
const REPLACEMENT_CHAR_MIN_COUNT = 4;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Sniff a file's content to determine if it's readable source text.
 *
 * Algorithm (from spec Section 5):
 *   1. Reject empty buffers.
 *   2. Take a bounded 8KB sample from the start of the buffer.
 *   3. Scan for null bytes — any null byte strongly indicates binary.
 *   4. Count non-printable ASCII control characters (excluding common
 *      whitespace: tab, newline, carriage return). If > 10% of the
 *      sample, classify as binary.
 *   5. Decode the sample as UTF-8 and count replacement characters
 *      (U+FFFD). If count >= 4 AND ratio > 5%, classify as
 *      invalid-encoding.
 *
 * @param buffer - The raw file content (or the first portion of it).
 *   The sniffer will only examine the first 8KB regardless of total size.
 * @returns A ContentSniffResult — never throws
 */
export function sniffContent(buffer: Buffer): ContentSniffResult {
  // Edge case (spec Section 6, case 7): empty files
  if (!buffer || buffer.length === 0) {
    return { readable: false, reason: "empty" };
  }

  // Take bounded sample — never scan the whole file
  const sampleSize = Math.min(buffer.length, MAX_SAMPLE_BYTES);
  const sample = buffer.subarray(0, sampleSize);

  // Pass 1: scan for null bytes and non-printable control characters
  let nullCount = 0;
  let nonPrintableCount = 0;

  for (let i = 0; i < sample.length; i++) {
    const byte = sample[i];

    if (byte === 0x00) {
      // Null bytes are a very strong binary indicator — a single one
      // in a text file is almost certainly wrong.
      nullCount++;
    } else if (
      // Non-printable ASCII control characters, excluding common whitespace:
      //   0x09 = tab (HT)
      //   0x0A = newline (LF)
      //   0x0D = carriage return (CR)
      // Also include DEL (0x7F) as non-printable.
      (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) ||
      byte === 0x7f
    ) {
      nonPrintableCount++;
    }
  }

  // A single null byte is a very strong binary indicator
  if (nullCount > 0) {
    return { readable: false, reason: "binary" };
  }

  // If > 10% non-printable control characters, classify as binary
  if (nonPrintableCount / sample.length > NON_PRINTABLE_RATIO_THRESHOLD) {
    return { readable: false, reason: "binary" };
  }

  // Pass 2: UTF-8 validity check
  // Use TextDecoder in non-fatal mode — it replaces invalid sequences
  // with U+FFFD (Replacement Character) rather than throwing.
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const text = decoder.decode(sample);

  let replacementCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) {
      replacementCount++;
    }
  }

  // Allow a small number of replacements (boundary-split multi-byte chars).
  // But if replacements are numerous AND make up > 5% of the decoded text,
  // classify as invalid encoding — very likely binary or wrong charset.
  if (
    replacementCount >= REPLACEMENT_CHAR_MIN_COUNT &&
    replacementCount / text.length > REPLACEMENT_CHAR_RATIO_THRESHOLD
  ) {
    return { readable: false, reason: "invalid-encoding" };
  }

  return { readable: true };
}
