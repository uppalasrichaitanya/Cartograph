/**
 * Cartograph Identity Service — Deterministic ID Derivation
 *
 * Implements the identity scheme specified in:
 *   specs/cartograph_ir_identity_model_spec.md — Section 5: Internal Models
 *
 * Identity derivation:
 *   rootFingerprint = SHA-256(rootPath + ':' + manifestFile), truncated 128-bit, base62
 *   nodeId(file)    = SHA-256(rootFingerprint + ':' + relativePath), truncated 128-bit, base62
 *
 * This is a committed decision — changing the hash function or encoding
 * later changes every ID in every stored analysis. The choice of SHA-256
 * truncated to 128 bits provides:
 *   - Determinism: identical input always produces identical output
 *   - Collision resistance: 2^64 expected inputs before a birthday collision
 *   - Compactness: 22-character base62 strings vs 64-character hex
 *
 * @module lib/analysis/ir/identity
 */

import { createHash } from "node:crypto";
import type { EdgeId, EdgeKind, NodeId, SymbolId, SymbolKind } from "./types";

// ---------------------------------------------------------------------------
// Base62 Encoding
// ---------------------------------------------------------------------------

/** Base62 alphabet: digits, uppercase, lowercase. Deterministic ordering. */
const BASE62_CHARS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Encode a Buffer as a base62 string.
 *
 * Converts the buffer to a BigInt, then repeatedly divides by 62 to
 * extract base62 digits. The result is a fixed-width representation:
 * 128 bits → at most 22 base62 characters.
 */
function base62Encode(buffer: Buffer): string {
  let value = BigInt("0x" + buffer.toString("hex"));
  if (value === 0n) return "0";

  const chars: string[] = [];
  while (value > 0n) {
    const remainder = Number(value % 62n);
    chars.push(BASE62_CHARS[remainder]);
    value = value / 62n;
  }
  return chars.reverse().join("");
}

// ---------------------------------------------------------------------------
// Core Hash Function
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 of the input string, truncated to the first 128 bits (16 bytes),
 * then base62-encode the result.
 *
 * This is the single hash function used for all identity derivation.
 * It is intentionally not configurable — stability is more important than flexibility.
 */
function deriveId(input: string): string {
  const fullHash = createHash("sha256").update(input, "utf8").digest();
  const truncated = fullHash.subarray(0, 16); // 128 bits
  return base62Encode(truncated);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive a stable fingerprint for a module root.
 *
 * Formula: SHA-256(rootPath + ':' + manifestFile), truncated 128-bit, base62.
 *
 * The fingerprint is incorporated into every NodeId under this root,
 * ensuring that identical relative paths under different roots produce
 * distinct IDs.
 *
 * @param rootPath     - Path relative to the repository root (e.g., "" for top-level, "packages/core")
 * @param manifestFile - The manifest file name (e.g., "package.json", "go.mod")
 */
export function createRootFingerprint(
  rootPath: string,
  manifestFile: string,
): string {
  return deriveId(rootPath + ":" + manifestFile);
}

/**
 * Derive a deterministic NodeId for a file within a module root.
 *
 * Formula: SHA-256(rootFingerprint + ':' + relativePath), truncated 128-bit, base62.
 *
 * @param rootFingerprint - The owning root's fingerprint (from createRootFingerprint)
 * @param relativePath    - File path relative to the repository root, using forward slashes
 */
export function createNodeId(
  rootFingerprint: string,
  relativePath: string,
): NodeId {
  return deriveId(rootFingerprint + ":" + relativePath) as NodeId;
}

/**
 * Derive symbol identity without source positions so inserting lines does not
 * rename a declaration. The ordinal distinguishes repeated declarations with
 * the same kind and qualified name in deterministic source order.
 */
export function createSymbolId(
  fileId: NodeId,
  kind: SymbolKind,
  qualifiedName: string,
  sameNameOrdinal: number,
): SymbolId {
  return deriveId(
    `${fileId}:symbol:${kind}:${qualifiedName}:${sameNameOrdinal}`,
  ) as SymbolId;
}

/**
 * Derive a deterministic EdgeId from the edge's endpoints and kind.
 *
 * Formula: SHA-256(from + ':' + kind + ':' + to), truncated 128-bit, base62.
 *
 * @param from - Source node's NodeId
 * @param kind - Edge kind ('contains' or 'imports')
 * @param to   - Target node's NodeId
 */
export function createEdgeId(
  from: NodeId,
  kind: EdgeKind,
  to: NodeId,
): EdgeId {
  return deriveId(from + ":" + kind + ":" + to) as EdgeId;
}

/**
 * Derive a deterministic NodeId for an external dependency.
 *
 * Uses a distinct namespace prefix ('external:') to prevent collisions
 * with file-based NodeIds under the same root.
 *
 * @param rootFingerprint - The root context where the dependency was referenced
 * @param name            - Raw package/module name as referenced in source code
 */
export function createExternalDependencyId(
  rootFingerprint: string,
  name: string,
): NodeId {
  return deriveId(rootFingerprint + ":external:" + name) as NodeId;
}

/**
 * Derive a deterministic NodeId for a ModuleRoot itself.
 *
 * Uses a distinct namespace prefix ('root:') to prevent collisions
 * with file-based NodeIds.
 *
 * @param rootFingerprint - The root's own fingerprint
 */
export function createModuleRootId(rootFingerprint: string): NodeId {
  return deriveId("root:" + rootFingerprint) as NodeId;
}

/**
 * Derive a deterministic NodeId for an unresolved import.
 *
 * Uses a distinct namespace prefix ('unresolved:') to prevent collisions
 * with file-based and external-dependency NodeIds.
 *
 * The referencing file's path is part of the derivation because an
 * unresolved specifier's meaning is relative to where it was written:
 * './missing' in a/x.ts and './missing' in b/y.ts denote different
 * unknown targets and must not be merged into one node. Merging would
 * assert an identity the evidence does not support.
 *
 * @param rootFingerprint - The root context where the import was referenced
 * @param fromPath        - Path of the file containing the import specifier
 * @param specifier       - Raw specifier exactly as written in source
 */
export function createUnresolvedImportId(
  rootFingerprint: string,
  fromPath: string,
  specifier: string,
): NodeId {
  return deriveId(
    rootFingerprint + ":unresolved:" + fromPath + ":" + specifier,
  ) as NodeId;
}
