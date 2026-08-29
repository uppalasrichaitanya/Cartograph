/**
 * Python Parser Plugin — LanguageParser Implementation
 *
 * Implements the `LanguageParser` interface for Python source files (.py).
 *
 * Created as part of Milestone 3, Phase 2 (PythonParser.initialize()).
 * Updated in Phase 3 to integrate tree-sitter-python WASM parsing.
 * Updated in Phase 4 to implement resolveImport() with three-outcome classification.
 *
 * Lifecycle:
 *   - initialize(): reads pyproject.toml/setup.cfg, detects the import root
 *     (§3.1), builds the PythonPackageIndex (§4.1), and loads the
 *     tree-sitter WASM runtime.
 *   - parseFile(): uses tree-sitter-python to parse source and extract
 *     import specifiers from the AST. Returns RawExtraction with
 *     unresolved specifiers in internalImports.
 *   - resolveImport(): resolves specifiers against the PythonPackageIndex
 *     with three-outcome classification (§4.1): resolved-internal,
 *     unresolved-internal, or external.
 *   - dispose(): releases the cached package index and parser state.
 *
 * Design:
 *   - parseFile() NEVER throws — parse failures become RawExtractions
 *     with populated parseErrors and empty import lists.
 *   - resolveImport() NEVER throws — unresolvable imports return
 *     { resolved: null, raw: specifier }.
 *   - initialize() reads config files as data (no execution), then
 *     builds the package index with a single deterministic directory walk,
 *     then loads the tree-sitter WASM runtime.
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
import { ensureInitialized, parsePythonSourceSync } from "./treeSitter";
import { extractImports } from "./importExtractor";
import { resolveImport as resolveImportImpl } from "./importResolver";

// ---------------------------------------------------------------------------
// Python Parser
// ---------------------------------------------------------------------------

/**
 * Python parser plugin.
 *
 * Handles .py files. Uses pyproject.toml/setup.cfg metadata for
 * import-root detection, tree-sitter-python for AST-based import
 * extraction, and the PythonPackageIndex for import resolution.
 *
 * Phase 2 delivered: full initialize() + dispose() lifecycle.
 * Phase 3 delivers: parseFile() (tree-sitter-python WASM integration).
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
   * 3. Load the tree-sitter WASM runtime and Python grammar.
   * 4. Cache all results for use by parseFile() and resolveImport().
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

    // Step 3: Ensure tree-sitter WASM runtime is loaded
    // This is a singleton — the WASM is loaded once per process,
    // subsequent calls are no-ops. Must complete before parseFile()
    // can be called (parseFile is synchronous).
    await ensureInitialized();
  }

  /**
   * Parse a single Python source file.
   *
   * Uses tree-sitter-python (WASM) to build a syntax tree and extract
   * all import specifiers. Returns a RawExtraction with unresolved
   * specifiers in `internalImports` (resolution is deferred to Phase 4).
   *
   * NEVER throws — parse failures become RawExtractions with
   * populated parseErrors and empty import lists.
   *
   * @param file    - File identity (absolute + relative paths)
   * @param content - File content as UTF-8 string
   */
  parseFile(file: ParseFileInput, content: string): RawExtraction {
    const lineCount = content.split(/\r?\n/).length;

    try {
      // Parse the source into a tree-sitter syntax tree
      const tree = parsePythonSourceSync(content);

      try {
        // Extract imports from the AST
        const result = extractImports(tree);

        return {
          path: file.relativePath,
          lineCount,
          internalImports: result.specifiers,
          externalImports: [],
          parseErrors: result.parseErrors,
          capabilitiesUsed: ["imports"],
        };
      } finally {
        // Always free the tree to prevent WASM memory leaks
        tree.delete();
      }
    } catch (error) {
      // Unexpected error (WASM not loaded, out of memory, etc.)
      // Return a valid but empty extraction with a fatal parse error
      return {
        path: file.relativePath,
        lineCount,
        internalImports: [],
        externalImports: [],
        parseErrors: [
          {
            message: error instanceof Error ? error.message : "Unable to parse file",
            severity: "fatal",
            reason: "unknown",
          },
        ],
        capabilitiesUsed: ["imports"],
      };
    }
  }

  /**
   * Resolve a raw Python import specifier.
   *
   * Implements the three-outcome classification from §4.1:
   *   1. Resolved-internal: specifier lands on a real file in the project.
   *      Returns { resolved: "path/to/file.py", raw }.
   *   2. Unresolved-internal: relative import or absolute import matching
   *      a known package, but no file found. Returns
   *      { resolved: null, raw, unresolvedKind: "unresolved-internal" }.
   *   3. External: stdlib or third-party. Returns
   *      { resolved: null, raw, unresolvedKind: "external" }.
   *
   * NEVER throws — per the LanguageParser contract.
   *
   * @param specifier  - Raw import specifier as written in source code
   * @param fromFile   - The file containing the import
   */
  resolveImport(
    specifier: string,
    fromFile: ParseFileInput,
    knownFiles: ReadonlyArray<ParseFileInput>,
  ): ResolvedSpecifier {
    void knownFiles;
    if (!this.packageIndex || !this.projectRoot) {
      // Not initialized — classify everything as external.
      // This should never happen if the lifecycle is followed correctly.
      return { resolved: null, raw: specifier };
    }

    return resolveImportImpl(
      specifier,
      fromFile,
      this.packageIndex,
      this.projectRoot,
    );
  }

  /**
   * Clean up after an analysis run.
   *
   * Releases the cached package index and metadata. Safe to call
   * multiple times (idempotent) and safe to call before initialize().
   *
   * Note: The tree-sitter WASM runtime is NOT disposed here — it's
   * a process-level singleton that persists across analysis runs
   * for performance (avoiding repeated ~100ms cold-start loads).
   *
   * NEVER throws — per the LanguageParser contract.
   */
  dispose(): void {
    this.projectRoot = null;
    this.importRootResult = null;
    this.packageIndex = null;
  }
}
