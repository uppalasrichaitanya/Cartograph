/**
 * Python Parser Plugin — LanguageParser Implementation
 *
 * Implements the `LanguageParser` interface for Python source files (.py).
 *
 * Created as part of Milestone 3, Phase 2 (PythonParser.initialize()).
 *
 * Lifecycle:
 *   - initialize(): reads pyproject.toml/setup.cfg, detects the import root
 *     (§3.1), and builds the PythonPackageIndex (§4.1) using the Phase 1
 *     modules (metadata.ts, packageIndex.ts).
 *   - parseFile(): stub — will be implemented in Phase 3 (tree-sitter-python).
 *   - resolveImport(): stub — will be implemented in Phase 4.
 *   - dispose(): releases the cached package index and parser state.
 *
 * Design:
 *   - parseFile() NEVER throws — parse failures become RawExtractions
 *     with populated parseErrors and empty import lists.
 *   - resolveImport() NEVER throws — unresolvable imports return
 *     { resolved: null, raw: specifier }.
 *   - initialize() reads config files as data (no execution), then
 *     builds the package index with a single deterministic directory walk.
 *   - All state is instance-level: multiple PythonParser instances
 *     operating on different project roots do not interfere.
 *
 * @module lib/analysis/parsers/python/parser
 */

import type {
  LanguageParser,
  ParseFileInput,
  ParserInitContext,
  ResolvedSpecifier,
  RawExtraction,
} from "../interface";
import { detectImportRoot, type ImportRootResult } from "./metadata";
import {
  buildPackageIndex,
  type PythonPackageIndex,
} from "./packageIndex";

// ---------------------------------------------------------------------------
// Python Parser
// ---------------------------------------------------------------------------

/**
 * Python parser plugin.
 *
 * Handles .py files. Uses pyproject.toml/setup.cfg metadata for
 * import-root detection and the PythonPackageIndex for import resolution.
 *
 * Phase 2 delivers: full initialize() + dispose() lifecycle.
 * Phase 3 will deliver: parseFile() (tree-sitter-python WASM integration).
 * Phase 4 will deliver: resolveImport() (absolute + relative resolution).
 */
export class PythonParser implements LanguageParser {
  readonly id = "python";
  readonly name = "Python";
  readonly language = "python" as const;
  readonly extensions = ["py"] as const;
  readonly capabilities = ["imports"] as const;

  // ---- Cached State (set by initialize, cleared by dispose) ----

  /** Absolute path to the project root. */
  private projectRoot: string | null = null;

  /** Result of the import-root detection heuristic (§3.1). */
  private importRootResult: ImportRootResult | null = null;

  /** The package index built during initialize() (§4.1). */
  private packageIndex: PythonPackageIndex | null = null;

  // ---- Read-only Accessors (for tests and future phases) ----

  /**
   * The detected import root, or null if not yet initialized.
   * Exposed for testing and diagnostic purposes.
   */
  get importRoot(): string | null {
    return this.importRootResult?.importRoot ?? null;
  }

  /**
   * Which heuristic step produced the import root.
   * Exposed for testing and diagnostic purposes.
   */
  get rootConfidence(): "declared" | "structural-heuristic" | null {
    return this.importRootResult?.rootConfidence ?? null;
  }

  /**
   * The declared package name from pyproject.toml, if any.
   * Exposed for testing and diagnostic purposes.
   */
  get declaredPackageName(): string | null {
    return this.importRootResult?.declaredPackageName ?? null;
  }

  /**
   * The cached package index, or null if not yet initialized.
   * Exposed for testing and for use by resolveImport() in Phase 4.
   */
  getPackageIndex(): PythonPackageIndex | null {
    return this.packageIndex;
  }

  // ---- Interface Methods ----

  canHandle(extension: string): boolean {
    return (this.extensions as readonly string[]).includes(extension);
  }

  /**
   * Initialize the Python parser for an analysis run.
   *
   * 1. Detect the import root via the deterministic heuristic (§3.1).
   * 2. Build the PythonPackageIndex via a single directory walk (§4.1).
   * 3. Cache all results for use by parseFile() and resolveImport().
   *
   * Safe to call multiple times — each call re-initializes from scratch
   * (previous state is discarded first via dispose()).
   *
   * @param context - Project context (root path, all discovered files)
   * @throws If the project root is invalid or unreadable
   */
  async initialize(context: ParserInitContext): Promise<void> {
    // Discard any previous state (idempotent re-initialization)
    this.dispose();

    this.projectRoot = context.projectRoot;

    // Step 1: Detect the import root
    this.importRootResult = await detectImportRoot(context.projectRoot);

    // Step 2: Build the package index
    this.packageIndex = await buildPackageIndex(
      this.importRootResult.importRoot,
      this.importRootResult.rootConfidence,
    );
  }

  /**
   * Parse a single Python source file.
   *
   * STUB — Phase 3 will implement full tree-sitter-python parsing.
   *
   * Current behavior: returns a valid RawExtraction with empty import
   * lists and no parse errors. This satisfies the LanguageParser contract
   * (parseFile NEVER throws, always returns a RawExtraction) and allows
   * the parser to participate in the pipeline without producing real
   * extraction data.
   *
   * @param file    - File identity (absolute + relative paths)
   * @param content - File content as UTF-8 string
   */
  parseFile(file: ParseFileInput, content: string): RawExtraction {
    // Phase 3 stub: return a valid but empty extraction.
    // This ensures the file appears in the graph (as a node with
    // no edges) rather than being silently dropped.
    return {
      path: file.relativePath,
      lineCount: content.split(/\r?\n/).length,
      internalImports: [],
      externalImports: [],
      parseErrors: [],
      capabilitiesUsed: ["imports"],
    };
  }

  /**
   * Resolve a raw Python import specifier.
   *
   * STUB — Phase 4 will implement full absolute + relative resolution
   * against the PythonPackageIndex.
   *
   * Current behavior: returns { resolved: null, raw: specifier },
   * classifying everything as external. This satisfies the LanguageParser
   * contract (resolveImport NEVER throws) and matches the existing
   * orchestrator behavior for unresolved imports.
   *
   * @param specifier  - Raw import specifier as written in source code
   * @param _fromFile  - The file containing the import (unused in stub)
   * @param _knownFiles - All discovered project files (unused in stub)
   */
  resolveImport(
    specifier: string,
    _fromFile: ParseFileInput,
    _knownFiles: ReadonlyArray<ParseFileInput>,
  ): ResolvedSpecifier {
    // Phase 4 stub: classify everything as external.
    return { resolved: null, raw: specifier };
  }

  /**
   * Clean up after an analysis run.
   *
   * Releases the cached package index and metadata. Safe to call
   * multiple times (idempotent) and safe to call before initialize().
   *
   * NEVER throws — per the LanguageParser contract.
   */
  dispose(): void {
    this.projectRoot = null;
    this.importRootResult = null;
    this.packageIndex = null;
  }
}
