/**
 * Cartograph Path Index — O(1) Lookup from Relative Path to NodeId
 *
 * Built once after all FileNodes are created, this index eliminates
 * O(N) scans during dependency resolution, ensuring overall O(N+E)
 * complexity for the entire import resolution pass.
 *
 * The PathIndex maps resolved relative paths (as produced by the file
 * discovery phase) to their deterministic NodeIds. Alias resolution
 * and extension probing remain in resolveAliases.ts — the PathIndex
 * only handles the final resolved-path → NodeId lookup.
 *
 * @module lib/analysis/ir/pathIndex
 */

import type { FileNode, NodeId } from "./types";

export class PathIndex {
  private readonly index: Map<string, NodeId>;

  /**
   * Build the index from an array of FileNodes.
   *
   * @param fileNodes - All FileNodes in the repository. Each node's `path`
   *   field (relative to repo root, forward-slash separated) is used as the
   *   lookup key.
   */
  constructor(fileNodes: ReadonlyArray<FileNode>) {
    this.index = new Map();
    for (const node of fileNodes) {
      this.index.set(node.path, node.id);
    }
  }

  /**
   * Look up the NodeId for a resolved relative path.
   *
   * @param relativePath - File path relative to the repository root,
   *   using forward slashes (e.g., "src/lib/helper.ts").
   * @returns The deterministic NodeId, or null if the path was not indexed.
   */
  resolve(relativePath: string): NodeId | null {
    return this.index.get(relativePath) ?? null;
  }

  /** Check whether a relative path exists in the index. */
  has(relativePath: string): boolean {
    return this.index.has(relativePath);
  }

  /** Number of files in the index. */
  get size(): number {
    return this.index.size;
  }
}
