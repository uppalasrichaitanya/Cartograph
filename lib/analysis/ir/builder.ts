/**
 * Cartograph IR Builder — Converts Raw Parser Output into Validated IR
 *
 * The builder is the single entry point for constructing IR structures.
 * It enforces:
 *   - Deterministic IDs via the Identity Service (no casts to branded types here)
 *   - Provenance propagation (heuristic never upgrades to verified)
 *   - Language inference from file extension
 *   - All-or-nothing validation via finalize()
 *
 * Design:
 *   - All build* methods are pure functions — no internal mutation.
 *   - buildFileNode never throws — invalid input becomes a heuristic-confidence node.
 *   - finalize() is the only path to a RepositoryIR. It delegates to
 *     validateRepositoryIR() for referential integrity, then stamps metadata.
 *
 * @module lib/analysis/ir/builder
 */

import {
  createEdgeId,
  createExternalDependencyId,
  createModuleRootId,
  createNodeId,
  createRootFingerprint,
} from "./identity";
import type {
  Edge,
  ExternalDependencyNode,
  FileNode,
  IRBuilderContract,
  IRNode,
  LanguageId,
  ModuleRoot,
  Provenance,
  RawExtraction,
  ResolvedImport,
  RepositoryIR,
} from "./types";
import { validateRepositoryIR } from "./validation";

// ---------------------------------------------------------------------------
// Language Inference
// ---------------------------------------------------------------------------

/**
 * Infer the language from a file's extension.
 *
 * Milestone 1 supports TypeScript and JavaScript only.
 * Python is included per the spec for forward compatibility but
 * no Python files will be discovered by the current pipeline.
 *
 * Falls back to 'javascript' for unknown extensions — this should
 * not happen with proper file discovery, but we never crash.
 */
export function languageFromPath(filePath: string): LanguageId {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return "javascript";
  const ext = filePath.slice(dotIndex).toLowerCase();
  if (ext === ".ts" || ext === ".tsx") return "typescript";
  if (ext === ".js" || ext === ".jsx") return "javascript";
  if (ext === ".py") return "python";
  return "javascript";
}

// ---------------------------------------------------------------------------
// IR Builder
// ---------------------------------------------------------------------------

export class IRBuilder implements IRBuilderContract {
  // ---- Module Root ----

  /**
   * Construct a ModuleRoot from discovery metadata.
   *
   * The fingerprint and ID are deterministically derived via the Identity
   * Service — no branded-type casts occur here.
   *
   * @param rootPath     - Relative to the repository root ("" for top-level)
   * @param language     - Primary language of this root
   * @param manifestFile - The file that signaled this root (e.g., "package.json")
   */
  buildModuleRoot(
    rootPath: string,
    language: LanguageId,
    manifestFile: string,
  ): ModuleRoot {
    const fingerprint = createRootFingerprint(rootPath, manifestFile);
    const id = createModuleRootId(fingerprint);
    return {
      id,
      kind: "ModuleRoot",
      rootPath,
      language,
      manifestFile,
      fingerprint,
    };
  }

  // ---- File Node ----

  /**
   * Convert a parser's RawExtraction into a FileNode.
   *
   * Never throws. If the extraction has parse errors:
   *   - confidence is set to 'heuristic'
   *   - provenance origin is 'heuristic' with a note
   *
   * If parsing succeeded without errors:
   *   - confidence is 'precise'
   *   - provenance origin is 'verified'
   */
  buildFileNode(raw: RawExtraction, ownerRoot: ModuleRoot): FileNode {
    const id = createNodeId(ownerRoot.fingerprint, raw.path);
    const hasErrors = raw.parseErrors.length > 0;
    const confidence: "precise" | "heuristic" = hasErrors
      ? "heuristic"
      : "precise";
    const provenance: Provenance = hasErrors
      ? {
          origin: "heuristic",
          note: "Parse errors encountered during extraction",
        }
      : { origin: "verified" };

    return {
      id,
      kind: "File",
      path: raw.path,
      language: languageFromPath(raw.path),
      lineCount: raw.lineCount,
      ownerRootId: ownerRoot.id,
      confidence,
      parseErrors: [...raw.parseErrors],
      capabilitiesUsed: [...raw.capabilitiesUsed],
      provenance,
    };
  }

  // ---- Containment Edge ----

  /**
   * Create a containment edge: ModuleRoot → File.
   *
   * Provenance is always 'derived' — containment is a structural fact
   * deterministically computed from file discovery.
   */
  buildContainmentEdge(file: FileNode, root: ModuleRoot): Edge {
    return {
      id: createEdgeId(root.id, "contains", file.id),
      kind: "contains",
      from: root.id,
      to: file.id,
      provenance: { origin: "derived" },
    };
  }

  // ---- Dependency Edges ----

  /**
   * Create import edges from a file to its resolved dependencies.
   *
   * Provenance propagation:
   *   - If the source file has heuristic confidence, all outgoing
   *     dependency edges inherit heuristic provenance.
   *   - If the source file is precise, edges are 'derived'.
   *   This enforces the spec's rule: provenance never silently upgrades.
   */
  buildDependencyEdges(
    file: FileNode,
    resolved: ReadonlyArray<ResolvedImport>,
  ): Edge[] {
    return resolved.map((imp) => {
      const provenance: Provenance =
        file.confidence === "heuristic"
          ? {
              origin: "heuristic",
              derivedFrom: [file.id],
              note: "Source file had parse errors",
            }
          : { origin: "derived", derivedFrom: [file.id] };

      return {
        id: createEdgeId(file.id, "imports", imp.targetId),
        kind: "imports" as const,
        from: file.id,
        to: imp.targetId,
        provenance,
      };
    });
  }

  // ---- External Dependency Node ----

  /**
   * Create an ExternalDependencyNode for a package/module referenced
   * in source but not part of the analyzed repository.
   *
   * Provenance is always 'heuristic' — we infer the dependency from
   * an import specifier without verifying against a package registry.
   *
   * Not part of the IRBuilderContract interface (which only covers
   * the core build methods), but essential for the pipeline.
   */
  buildExternalDependencyNode(
    rootFingerprint: string,
    name: string,
    language: LanguageId,
  ): ExternalDependencyNode {
    return {
      id: createExternalDependencyId(rootFingerprint, name),
      kind: "ExternalDependency",
      name,
      language,
      provenance: {
        origin: "heuristic",
        note: "Inferred from import specifier; not verified against registry",
      },
    };
  }

  // ---- Finalize ----

  /**
   * The only path to a RepositoryIR.
   *
   * Stamps irVersion and generatedAt, then delegates to
   * validateRepositoryIR() for full schema + referential integrity
   * validation. Returns the validated IR or throws IRValidationError.
   *
   * This is all-or-nothing: either the entire IR is valid, or the
   * call fails. No partial results are ever persisted.
   */
  finalize(
    nodes: ReadonlyArray<IRNode>,
    edges: ReadonlyArray<Edge>,
    roots: ReadonlyArray<ModuleRoot>,
  ): RepositoryIR {
    const candidate = {
      irVersion: 1 as const,
      generatedAt: new Date().toISOString(),
      nodes: [...nodes],
      edges: [...edges],
      roots: [...roots],
    };
    // validateRepositoryIR performs full schema + referential integrity checks.
    // It throws IRValidationError on any violation.
    return validateRepositoryIR(candidate);
  }
}
