/**
 * Cartograph Extraction Safety — Public API
 *
 * Re-exports the safety subsystem's public interfaces.
 *
 * Components in this module:
 *   - pathValidation: zip-slip / path traversal protection (Phase 5)
 *   - contentSniff:   binary/encoding detection before parser invocation (Phase 5)
 *   - safeUnzip:      hardened zip extraction with path/symlink/content checks (Phase 6 wiring)
 *   - workerPool:     managed worker_threads pool for parse isolation (Phase 6)
 *   - resourceGuard:  per-file resource budget enforcement (Phase 6)
 *   - eventLog:       structured safety event logging (Phase 6)
 *
 * @module lib/safety
 */

export {
  validateExtractionPath,
  isSymlinkEntry,
  type PathValidationResult,
} from "./pathValidation";

export {
  sniffContent,
  type ContentSniffResult,
} from "./contentSniff";

export {
  safeUnzip,
  UnsafeZipError,
  MAX_UNCOMPRESSED_BYTES,
  type ExtractionResult,
  type ExtractedEntry,
} from "./safeUnzip";

export {
  WorkerPool,
  type WorkerTaskResult,
} from "./workerPool";

export {
  runWithResourceGuard,
  DEFAULT_BUDGET,
  type ResourceBudget,
  type GuardedParseResult,
} from "./resourceGuard";

export {
  SafetyEventLog,
  safetyEventToParseReason,
  type SafetyEvent,
} from "./eventLog";
