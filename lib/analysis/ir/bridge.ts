
/**
 * Cartograph Pipeline Integration — IR Bridge
 *
 * Builds a validated RepositoryIR from the extraction pipeline's
 * RawExtraction[] output. This module is the bridge between the
 * extraction orchestrator and the IR system.
 *
 * Design:
 *   - Pure function: takes pipeline data in, returns RepositoryIR out.
 *   - Never modifies the extraction pipeline's data structures.
 *   - The legacy DependencyGraph continues to drive the UI unchanged.
 *   - The RepositoryIR is built in parallel and persisted alongside it.
 *   - On IR construction failure, returns null with logged errors rather
 *     than crashing the pipeline — the legacy path remains the primary.
 *
 * History:
 *   - Milestone 1: Accepted SourceFileAnalysis[] and adapted via toRawExtraction().
 *   - Milestone 2 Phase 5: Now accepts RawExtraction[] directly from extractAll(),
 *     eliminating the lossy adapter. IRParseError data (line, column, severity)
 *     is now preserved through the full pipeline.
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
  RootConfidence,
  UnresolvedImportNode,
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
  { file: "pyproject.toml", language: "python" },
  { file: "setup.cfg", language: "python" },
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
 *
 * Root confidence:
 *   - A manifest was found on disk        → 'declared'
 *   - No manifest; synthetic root invented → 'structural-heuristic'
 *
 * The caller may override this with a parser-supplied confidence via
 * `rootConfidenceOverride` — see buildRepositoryIR. An override only ever
 * weakens confidence, never strengthens it: a parser reporting that it
 * guessed its own import root is evidence the root is heuristic even when
 * a manifest happened to exist.
 */
function discoverModuleRoot(
  projectRoot: string,
  builder: IRBuilder,
  rootConfidenceOverride?: RootConfidence,
): ModuleRoot {
  const weaken = (found: RootConfidence): RootConfidence =>
    found === "declared" && rootConfidenceOverride === "structural-heuristic"
      ? "structural-heuristic"
      : found;

  for (const { file, language } of MANIFEST_FILES) {
    const manifestPath = path.join(projectRoot, file);
    if (existsSync(manifestPath)) {
      return builder.buildModuleRoot("", language, file, weaken("declared"));
    }
  }

  // Fallback: no manifest found. Create a synthetic root.
  // This ensures every file has an ownerRootId. The root's location was
  // not declared anywhere — it was assumed — so it is never 'declared'.
  return builder.buildModuleRoot(
    "",
    "javascript",
    "package.json",
    "structural-heuristic",
  );
}

// ---------------------------------------------------------------------------
// Legacy Adapter (Temporary — removed in Phase 6)
// ---------------------------------------------------------------------------

/**
 * Convert a legacy SourceFileAnalysis into the IR's RawExtraction format.
 *
 * This adapter exists solely for backward compatibility with existing
 * tests that call buildRepositoryIR(root, extractImports().files).
 * It will be removed in Phase 6 when tests are migrated to extractAll().
 */
function adaptLegacyInput(file: SourceFileAnalysis): RawExtraction {
  return {
    path: file.filePath,
    lineCount: file.lineCount,
    internalImports: [...file.imports],
    externalImports: [...file.externalImports],
    parseErrors: [],
    capabilitiesUsed: ["imports"],
  };
}

/**
 * Type guard: returns true if the input array contains RawExtraction
 * items (which have a `path` property) rather than SourceFileAnalysis
 * items (which have a `filePath` property).
 */
function isRawExtractionArray(
  input: ReadonlyArray<RawExtraction | SourceFileAnalysis>,
): input is ReadonlyArray<RawExtraction> {
  if (input.length === 0) return true;
  return "path" in input[0] && !("filePath" in input[0]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a validated RepositoryIR from extraction pipeline data.
 *
 * This is the core integration point. It:
 *   1. Discovers the module root
 *   2. Converts each RawExtraction → FileNode
 *   3. Builds a PathIndex for O(1) import resolution
 *   4. Resolves internal imports to NodeIds, creates ExternalDependencyNodes
 *   5. Builds containment and dependency edges
 *   6. Finalizes the IR via the all-or-nothing validation gate
 *
 * On success, returns the validated RepositoryIR.
 * On failure (IR validation error), returns null and logs the error.
 * The legacy pipeline is never affected by IR construction failures.
 *
 * Accepts either:
 *   - RawExtraction[] from extractAll() (primary, Milestone 2+)
 *   - SourceFileAnalysis[] from extractImports() (legacy, removed in Phase 6)
 *
 * @param projectRoot - Absolute path to the extracted project root
 * @param input - Resolved RawExtractions or legacy SourceFileAnalysis[]
 * @param rootConfidenceOverride - Optional parser-reported root confidence.
 *   The Python parser detects its own import root and reports whether that
 *   came from a declared layout or a structural guess; passing it here keeps
 *   that judgement in the IR instead of discarding it. Only ever weakens.
 * @returns The validated RepositoryIR, or null on construction failure
 */
export function buildRepositoryIR(
  projectRoot: string,
  input: ReadonlyArray<RawExtraction>,
  rootConfidenceOverride?: RootConfidence,
): RepositoryIR | null;
export function buildRepositoryIR(
  projectRoot: string,
  input: SourceFileAnalysis[],
  rootConfidenceOverride?: RootConfidence,
): RepositoryIR | null;
export function buildRepositoryIR(
  projectRoot: string,
  input: ReadonlyArray<RawExtraction> | SourceFileAnalysis[],
  rootConfidenceOverride?: RootConfidence,
): RepositoryIR | null {
  // Normalize input: adapt legacy SourceFileAnalysis[] to RawExtraction[]
  const extractions: ReadonlyArray<RawExtraction> = isRawExtractionArray(
    input as ReadonlyArray<RawExtraction | SourceFileAnalysis>,
  )
    ? (input as ReadonlyArray<RawExtraction>)
    : (input as SourceFileAnalysis[]).map(adaptLegacyInput);
  try {
    const builder = new IRBuilder();

    // 1. Discover module root
    const root = discoverModuleRoot(projectRoot, builder, rootConfidenceOverride);

    // 2. Build FileNodes from RawExtraction data
    const fileNodes: FileNode[] = [];
    const rawExtractionMap: Map<string, RawExtraction> = new Map();

    for (const extraction of extractions) {
      rawExtractionMap.set(extraction.path, extraction);
      const fileNode = builder.buildFileNode(extraction, root);
      fileNodes.push(fileNode);
    }

    // 3. Build PathIndex for O(1) import resolution
    const pathIndex = new PathIndex(fileNodes);

    // 4. Resolve imports and build edges
    const allNodes: IRNode[] = [root, ...fileNodes];
    const allEdges: Edge[] = [];
    const externalDeps = new Map<string, ExternalDependencyNode>();
    // Keyed by "<referencing file path> <specifier>" — identical specifiers
    // in different files denote different unknown targets and must stay
    // distinct. The space separator is safe: neither component contains one.
    const unresolvedImports = new Map<string, UnresolvedImportNode>();

    for (const fileNode of fileNodes) {
      // Containment edge: root → file
      allEdges.push(builder.buildContainmentEdge(fileNode, root));

      // Resolve imports to NodeIds
      const raw = rawExtractionMap.get(fileNode.path)!;
      const resolved: ResolvedImport[] = [];

      // Internal imports: resolve via PathIndex.
      //
      // A specifier that reaches this loop was classified as internal by
      // the parser. If the PathIndex cannot resolve it, that is a known
      // unknown — the import exists in source, its target could not be
      // determined — and it becomes an UnresolvedImportNode.
      //
      // It must NOT become an ExternalDependencyNode: doing so made
      // `import "./missing"` indistinguishable from `import "react"`,
      // erasing the distinction downstream consumers need in order to
      // tell a real package from a broken reference.
      for (const importPath of raw.internalImports) {
        const targetId = pathIndex.resolve(importPath);
        if (targetId) {
          resolved.push({ targetId, raw: importPath });
        } else {
          const key = `${fileNode.path} ${importPath}`;
          if (!unresolvedImports.has(key)) {
            unresolvedImports.set(
              key,
              builder.buildUnresolvedImportNode(
                root.fingerprint,
                fileNode.path,
                importPath,
                languageFromPath(fileNode.path),
              ),
            );
          }
          resolved.push({
            targetId: unresolvedImports.get(key)!.id,
            raw: importPath,
          });
        }
      }

      // Explicitly unresolved internal imports.
      //
      // extractAll() already classifies these (unresolvedKind ===
      // 'unresolved-internal') and carries them on RawExtraction. Until
      // now the field was computed and then never read, so this evidence
      // was discarded at the pipeline boundary. It is preserved here.
      for (const specifier of raw.unresolvedInternalImports ?? []) {
        const key = `${fileNode.path} ${specifier}`;
        if (!unresolvedImports.has(key)) {
          unresolvedImports.set(
            key,
            builder.buildUnresolvedImportNode(
              root.fingerprint,
              fileNode.path,
              specifier,
              languageFromPath(fileNode.path),
            ),
          );
        }
        resolved.push({
          targetId: unresolvedImports.get(key)!.id,
          raw: specifier,
        });
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

    // Add all unresolved import nodes
    for (const unresolvedNode of unresolvedImports.values()) {
      allNodes.push(unresolvedNode);
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
