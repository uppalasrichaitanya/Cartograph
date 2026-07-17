/**
 * Cartograph Per-File Resource Guard — Extraction Safety Layer
 *
 * Implements the Per-File Resource Guard specified in:
 *   specs/cartograph_extraction_safety_spec.md — Section 4 & Section 5
 *
 * Responsibility:
 *   Wrap any parser's parseFile call in an enforced resource budget.
 *   Never throws — timeout and crash outcomes are captured as data
 *   (GuardedParseResult), matching the "never throw, capture as data"
 *   pattern established in the IR spec.
 *
 * Contract:
 *   - runWithResourceGuard never throws.
 *   - Timeout is enforced via worker.terminate() — a real, OS-enforced
 *     termination (spec Section 5).
 *   - Pre-parse checks (file size, line length) are performed before
 *     sending work to the worker pool, avoiding unnecessary worker use.
 *   - The guard provides one uniform safety envelope every parser's
 *     parseFile call runs inside, so no individual language parser has
 *     to reimplement protection (spec Section 1).
 *
 * @module lib/safety/resourceGuard
 */

import { readFile, stat } from "node:fs/promises";
import type { WorkerPool, WorkerTaskResult } from "./workerPool";

// ---------------------------------------------------------------------------
// Types (from spec Section 4)
// ---------------------------------------------------------------------------

/**
 * Per-file resource budget.
 *
 * Applied uniformly to every parser invocation regardless of language,
 * so no individual language parser has to reimplement protection.
 */
export interface ResourceBudget {
  /** Maximum wall-clock time for a single parse operation (ms). Default: 5000. */
  readonly timeoutMs: number;
  /** Maximum line length in characters before the file is rejected. Default: 200_000. */
  readonly maxLineLength: number;
  /** Per-file size ceiling in bytes, independent of aggregate zip limits. Default: 10MB. */
  readonly maxFileSizeBytes: number;
}

/**
 * Result of a guarded parse operation.
 *
 * Discriminated on `outcome`:
 *   - 'completed': the parse succeeded; `value` is present.
 *   - 'timeout': the parse exceeded the time budget and was terminated.
 *   - 'oversized': the file exceeded size or line-length limits.
 *   - 'crashed': the parser encountered an unrecoverable error.
 */
export interface GuardedParseResult<T> {
  readonly outcome: "completed" | "timeout" | "oversized" | "crashed";
  readonly value?: T;
  readonly errorDetail?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default resource budget values per the spec (Section 4).
 *
 * These are starting values flagged for recalibration once real
 * benchmark data exists (spec Section 13).
 */
export const DEFAULT_BUDGET: Readonly<ResourceBudget> = {
  timeoutMs: 5000,
  maxLineLength: 200_000,
  maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
};

// ---------------------------------------------------------------------------
// Pre-parse checks
// ---------------------------------------------------------------------------

/**
 * Check if a file exceeds the per-file size ceiling.
 *
 * Performed before sending work to the worker pool to avoid
 * wasting a worker on a file that will certainly be rejected.
 *
 * @param filePath - Absolute path to the file
 * @param budget - Resource budget to check against
 * @returns null if within limits, or a GuardedParseResult with 'oversized' outcome
 */
async function checkFileSize<T>(
  filePath: string,
  budget: ResourceBudget,
): Promise<GuardedParseResult<T> | null> {
  try {
    const stats = await stat(filePath);
    if (stats.size > budget.maxFileSizeBytes) {
      return {
        outcome: "oversized",
        errorDetail: `File size ${stats.size} bytes exceeds limit of ${budget.maxFileSizeBytes} bytes`,
      };
    }
    return null;
  } catch {
    return {
      outcome: "crashed",
      errorDetail: "Unable to read file stats",
    };
  }
}

/**
 * Check if any line in the file exceeds the maximum line length.
 *
 * Reads the file content and checks line lengths. This is a pre-parse
 * check that catches minified/obfuscated files with extreme line lengths
 * (spec Section 6, edge case 5).
 *
 * @param filePath - Absolute path to the file
 * @param budget - Resource budget to check against
 * @returns null if within limits, or a GuardedParseResult with 'oversized' outcome
 */
async function checkLineLength<T>(
  filePath: string,
  budget: ResourceBudget,
): Promise<GuardedParseResult<T> | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    // Check for extreme line lengths without splitting the entire file
    // into an array — scan for the first line exceeding the limit.
    let lineStart = 0;
    for (let i = 0; i <= content.length; i++) {
      if (i === content.length || content[i] === "\n") {
        const lineLength = i - lineStart;
        if (lineLength > budget.maxLineLength) {
          return {
            outcome: "oversized",
            errorDetail: `Line length ${lineLength} exceeds limit of ${budget.maxLineLength} characters`,
          };
        }
        lineStart = i + 1;
      }
    }
    return null;
  } catch {
    return {
      outcome: "crashed",
      errorDetail: "Unable to read file for line-length check",
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a parse operation inside the resource guard.
 *
 * This is the uniform safety envelope wrapping every parser's
 * parseFile call (spec Section 1). It performs pre-parse checks
 * (file size, line length) then delegates to the worker pool for
 * timeout-enforced execution.
 *
 * Never throws — all outcomes are captured as data.
 *
 * @param pool - The worker pool to execute the task in
 * @param filePath - Absolute path to the file being parsed
 * @param taskScript - The parse script to execute in the worker
 * @param taskData - Data passed to the worker (must be serializable)
 * @param budget - Resource budget (defaults to DEFAULT_BUDGET)
 * @returns A GuardedParseResult — never throws
 */
export async function runWithResourceGuard<T>(
  pool: WorkerPool,
  filePath: string,
  taskScript: string,
  taskData: unknown,
  budget: ResourceBudget = DEFAULT_BUDGET,
): Promise<GuardedParseResult<T>> {
  try {
    // Pre-parse check 1: file size
    const sizeResult = await checkFileSize<T>(filePath, budget);
    if (sizeResult) return sizeResult;

    // Pre-parse check 2: line length
    const lineLengthResult = await checkLineLength<T>(filePath, budget);
    if (lineLengthResult) return lineLengthResult;

    // Delegate to the worker pool with timeout enforcement
    const workerResult: WorkerTaskResult<T> = await pool.runTask<T>(
      taskScript,
      taskData,
      budget.timeoutMs,
    );

    // Map worker result to guarded parse result
    return {
      outcome: workerResult.outcome,
      value: workerResult.value,
      errorDetail: workerResult.errorDetail,
    };
  } catch (error) {
    // Catch-all — this should never happen per the contract, but
    // defense-in-depth means we handle it anyway.
    return {
      outcome: "crashed",
      errorDetail: error instanceof Error ? error.message : String(error),
    };
  }
}
