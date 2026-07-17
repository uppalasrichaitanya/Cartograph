/**
 * Cartograph Pipeline Integration — IR Bridge
 *
 * Builds a validated RepositoryIR from the existing pipeline's intermediate
 * data (SourceFileAnalysis[], project root, discovery info). This module is
 * the bridge between the legacy pipeline and the new IR system.
 *
 * Design:
 *   - Pure function: takes pipeline data in, returns RepositoryIR out.
 *   - Never modifies the existing pipeline's data structures.
 *   - The legacy DependencyGraph continues to drive the UI unchanged.
 *   - The RepositoryIR is built in parallel and persisted alongside it.
 *   - On IR construction failure, returns null with logged errors rather
 *     than crashing the pipeline — the legacy path remains the primary.
 *
 * @module lib/analysis/ir/bridge
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { IRBuilder, languageFromPath } from "./builder";
import { PathIndex } from "./pathIndex";
import type {
  Edge,
  ExternalDependencyNode,
  FileNode,
  IRNode,
  LanguageId,
  ModuleRoot,
  RawExtraction,
  ResolvedImport,
  RepositoryIR,
} from "./types";
import type { SourceFileAnalysis } from "@/types/graph";

// ---------------------------------------------------------------------------
// Module Root Discovery
// ---------------------------------------------------------------------------

/**
 * Known manifest files and their associated languages.
 * Used to discover module roots in the extracted project.
 */
const MANIFEST_FILES: ReadonlyArray<{ file: string; language: LanguageId }> = [
  { file: "package.json", language: "typescript" },
  { file: "tsconfig.json", language: "typescript" },
  { file: "jsconfig.json", language: "javascript" },
];

/**
 * Discover module roots in the project directory.
 *
 * For Milestone 1, this is a simple single-root discovery:
 * look for a manifest file in the project root directory.
 * Multi-root discovery (monorepos, workspaces) is deferred
 * to Milestone 2 (Parser Plugin Architecture).
 *
 * If no manifest file is found, a synthetic root with
 * "package.json" is created — the pipeline must always have
 * at least one root to assign file ownership.
 */
function discoverModuleRoot(
  projectRoot: string,
  builder: IRBuilder,
): ModuleRoot {
  for (const { file, language } of MANIFEST_FILES) {
    const manifestPath = path.join(projectRoot, file);
    if (existsSync(manifestPath)) {
      return builder.buildModuleRoot("", language, file);
    }
  }

  // Fallback: no manifest found. Create a synthetic root.
  // This ensures every file has an ownerRootId.
  return builder.buildModuleRoot("", "javascript", "package.json");
}

// ---------------------------------------------------------------------------
// SourceFileAnalysis → RawExtraction Adapter
// ---------------------------------------------------------------------------

/**
 * Convert the legacy pipeline's SourceFileAnalysis into the IR's
 * RawExtraction format.
 *
 * This adapter bridges the two type systems without modifying
 * extractImports.ts. The legacy pipeline continues to produce
 * SourceFileAnalysis; this function translates it for the IR Builder.
 */
function toRawExtraction(file: SourceFileAnalysis): RawExtraction {
  return {
    path: file.filePath,
    lineCount: file.lineCount,
    internalImports: [...file.imports],
    externalImports: [...file.externalImports],
    parseErrors: [],
    capabilitiesUsed: ["imports"],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a validated RepositoryIR from the existing pipeline's data.
 *
 * This is the core integration point for Phase 7. It:
 *   1. Discovers the module root
 *   2. Converts each SourceFileAnalysis → RawExtraction → FileNode
 *   3. Builds a PathIndex for O(1) import resolution
 *   4. Resolves internal imports to NodeIds, creates ExternalDependencyNodes
 *   5. Builds containment and dependency edges
 *   6. Finalizes the IR via the all-or-nothing validation gate
 *
 * On success, returns the validated RepositoryIR.
 * On failure (IR validation error), returns null and logs the error.
 * The legacy pipeline is never affected by IR construction failures.
 *
 * @param projectRoot - Absolute path to the extracted project root
 * @param files - Successfully parsed files from extractImports()
 * @returns The validated RepositoryIR, or null on construction failure
 */
export function buildRepositoryIR(
  projectRoot: string,
  files: SourceFileAnalysis[],
): RepositoryIR | null {
  try {
    const builder = new IRBuilder();

    // 1. Discover module root
    const root = discoverModuleRoot(projectRoot, builder);

    // 2. Build FileNodes from legacy SourceFileAnalysis data
    const fileNodes: FileNode[] = [];
    const rawExtractions: Map<string, RawExtraction> = new Map();

    for (const file of files) {
      const raw = toRawExtraction(file);
      rawExtractions.set(file.filePath, raw);
      const fileNode = builder.buildFileNode(raw, root);
      fileNodes.push(fileNode);
    }

    // 3. Build PathIndex for O(1) import resolution
    const pathIndex = new PathIndex(fileNodes);

    // 4. Resolve imports and build edges
    const allNodes: IRNode[] = [root, ...fileNodes];
    const allEdges: Edge[] = [];
    const externalDeps = new Map<string, ExternalDependencyNode>();

    for (const fileNode of fileNodes) {
      // Containment edge: root → file
      allEdges.push(builder.buildContainmentEdge(fileNode, root));

      // Resolve imports to NodeIds
      const raw = rawExtractions.get(fileNode.path)!;
      const resolved: ResolvedImport[] = [];

      // Internal imports: resolve via PathIndex
      for (const importPath of raw.internalImports) {
        const targetId = pathIndex.resolve(importPath);
        if (targetId) {
          resolved.push({ targetId, raw: importPath });
        } else {
          // Import couldn't be resolved to a known file —
          // treat as external dependency
          if (!externalDeps.has(importPath)) {
            const extNode = builder.buildExternalDependencyNode(
              root.fingerprint,
              importPath,
              languageFromPath(fileNode.path),
            );
            externalDeps.set(importPath, extNode);
          }
          resolved.push({
            targetId: externalDeps.get(importPath)!.id,
            raw: importPath,
          });
        }
      }

      // External imports: always become ExternalDependencyNodes
      for (const extImport of raw.externalImports) {
        if (!externalDeps.has(extImport)) {
          const extNode = builder.buildExternalDependencyNode(
            root.fingerprint,
            extImport,
            languageFromPath(fileNode.path),
          );
          externalDeps.set(extImport, extNode);
        }
        resolved.push({
          targetId: externalDeps.get(extImport)!.id,
          raw: extImport,
        });
      }

      // Dependency edges
      const depEdges = builder.buildDependencyEdges(fileNode, resolved);
      allEdges.push(...depEdges);
    }

    // Add all external dependency nodes
    for (const extNode of externalDeps.values()) {
      allNodes.push(extNode);
    }

    // 5. Finalize — all-or-nothing validation gate
    return builder.finalize(allNodes, allEdges, [root]);
  } catch (error) {
    // IR construction failed. This is a builder/parser bug, not a user error.
    // Log and return null — the legacy pipeline continues unaffected.
    console.error(
      "[Cartograph IR Bridge] Failed to build RepositoryIR:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
