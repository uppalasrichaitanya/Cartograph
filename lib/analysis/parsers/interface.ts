/**
 * Cartograph Parser Plugin Interface — LanguageParser Contract
 *
 * This file defines the core contract that every language-specific parser
 * must implement. It is the abstraction seam that makes Cartograph's
 * multi-language architecture possible.
 *
 * Designed spec-first (Milestone 2, Phase 1) before any parser implementation
 * exists, following the roadmap's risk mitigation:
 *   "Write the interface spec first, implement against it second; resist
 *    letting existing TS code dictate the interface."
 *
 * Design principles:
 *   - Language-agnostic: no TS-specific concepts (tsconfig, path aliases).
 *   - Lifecycle-aware: initialize → parseFile → resolveImport → dispose.
 *   - Never throws from parseFile: failures become RawExtractions with
 *     populated parseErrors and empty import lists.
 *   - Resolution is parser-internal: different languages have fundamentally
 *     different resolution semantics (TS path aliases, Python namespace
 *     packages, Go modules) — the interface doesn't prescribe how.
 *
 * Depends on:
 *   - IR types (LanguageId, ParserCapability, RawExtraction, IRParseError)
 *     from lib/analysis/ir/types.ts — the canonical schema.
 *
 * @module lib/analysis/parsers/interface
 */

// ---------------------------------------------------------------------------
// Re-exports from IR types — parser implementations import from here
// ---------------------------------------------------------------------------

/**
 * Re-export IR types that parser implementations need.
 * This avoids parser code importing directly from ir/types.ts,
 * keeping the dependency one-directional: parsers → interface → ir/types.
 */
import type {
  LanguageId,
  ParserCapability,
  RawExtraction,
  IRParseError,
  RawDeclaration,
  SymbolKind,
} from "../ir/types";

export type { LanguageId, ParserCapability, RawExtraction, IRParseError, RawDeclaration, SymbolKind };

// ---------------------------------------------------------------------------
// Parser Initialization Context
// ---------------------------------------------------------------------------

/**
 * Context provided to a parser's initialize() method.
 *
 * Contains project-wide information needed for one-time setup:
 *   - TS: read tsconfig.json, build alias map
 *   - Python: detect pyproject.toml, discover namespace packages
 *   - Go: read go.mod
 *
 * The discoveredFiles list is read-only — parsers never modify discovery.
 */
export interface ParserInitContext {
  /** Absolute path to the project root directory. */
  readonly projectRoot: string;
  /** All discovered source files, across all languages. */
  readonly discoveredFiles: ReadonlyArray<ParseFileInput>;
}

// ---------------------------------------------------------------------------
// Parse File Input
// ---------------------------------------------------------------------------

/**
 * Identifies a source file for parser consumption.
 *
 * This is the general-purpose equivalent of the legacy ProjectFile type
 * from resolveAliases.ts. When resolveAliases.ts is moved inside the TS
 * parser (Phase 5), ProjectFile will be replaced by this type.
 *
 * Both paths are always present:
 *   - absolutePath: for reading content and passing to language tooling
 *   - relativePath: for IR identity (NodeId derivation) and graph storage
 */
export interface ParseFileInput {
  /** Absolute filesystem path to the file. */
  readonly absolutePath: string;
  /**
   * Path relative to the project root, using forward slashes.
   * Used for deterministic identity (NodeId derivation) and storage.
   */
  readonly relativePath: string;
}

// ---------------------------------------------------------------------------
// Import Resolution
// ---------------------------------------------------------------------------

/**
 * Result of resolving a single import specifier.
 *
 * The raw specifier is always retained for diagnostics. When resolved
 * to a project file, `resolved` contains the project-relative path
 * (matching the target file's ParseFileInput.relativePath). When the
 * import is external (npm package, stdlib, etc.), `resolved` is null.
 */
export interface ResolvedSpecifier {
  /** Resolved project-relative path, or null for external imports. */
  readonly resolved: string | null;
  /** Original raw specifier as written in source code. */
  readonly raw: string;
  /**
   * Classification of unresolved imports (only meaningful when resolved is null).
   *
   * - 'external': the import is external (stdlib, third-party). Also the
   *   assumed default when the field is omitted, so a parser that does not
   *   classify its failures keeps its previous behavior.
   * - 'unresolved-internal': the import is syntactically incapable of being
   *   external (relative imports, or absolute imports whose first segment
   *   matches a known project package), but the full path does not resolve
   *   to a real file. These should NOT become graph edges or be reclassified
   *   as external — they represent broken internal references.
   *
   * Added in Milestone 3 (§4.1) for Python's three-outcome resolution.
   * Pre-approved additive change — backward-compatible with all existing parsers.
   *
   * Set by both the Python and TypeScript parsers. TypeScript gained it in
   * Phase 0.5 so that a repository does not present different confidence
   * semantics purely because of the language it is written in; before that,
   * only Python repositories could produce the Unknown state.
   *
   * ---
   * DEVELOPER NOTE — Unknown-state frequency is not comparable across languages.
   *
   * Both parsers classify their failures, so confidence *semantics* are aligned:
   * 'unresolved-internal' means the same thing in either language, and a fact
   * labelled Unknown is equally trustworthy whichever parser produced it.
   *
   * The *rate* at which Unknown appears is not comparable, because the two
   * languages disagree — legitimately — about which specifiers are even
   * eligible for that classification:
   *
   *   - TypeScript: only specifiers starting with '.' or '/' can be
   *     'unresolved-internal'. Alias-shaped specifiers are deliberately left
   *     'external', because a tsconfig `paths` entry may legitimately resolve
   *     into node_modules, so a failed alias lookup is not evidence of an
   *     internal target.
   *   - Python: internality is decided by the detected import root and the
   *     package index, so a dotted specifier whose first segment names a known
   *     project package is eligible even though it looks nothing like a
   *     relative path.
   *
   * Consequence: a Python repository and a TypeScript repository of comparable
   * health can show materially different Unknown counts. That difference
   * measures each language's resolution semantics, not the quality of the code
   * or the thoroughness of the analysis. Do not treat Unknown frequency as a
   * cross-language metric, and do not "normalize" the two classifications to
   * make the numbers converge — the asymmetry is truthful.
   */
  readonly unresolvedKind?: "external" | "unresolved-internal";
}

// ---------------------------------------------------------------------------
// LanguageParser Interface
// ---------------------------------------------------------------------------

/**
 * Core contract for language-specific source code analysis.
 *
 * Every language parser (TypeScript, Python, Go, etc.) implements this
 * interface. The registry dispatches files to parsers based on extension
 * matching via canHandle().
 *
 * Lifecycle (managed by the registry and orchestrator):
 *   1. Registry calls canHandle(extension) for dispatch
 *   2. Registry calls initialize(context) once per analysis run
 *   3. Orchestrator calls parseFile() for each discovered file
 *   4. Orchestrator calls resolveImport() after all files are parsed
 *   5. Registry calls dispose() for cleanup
 *
 * Threading model:
 *   - initialize() and dispose() are called once, sequentially.
 *   - parseFile() is called sequentially for each file (no concurrent calls).
 *   - resolveImport() is called sequentially after all parseFile() calls.
 *   - Parsers may assume single-threaded usage within one analysis run.
 *
 * Error handling:
 *   - parseFile() NEVER throws. Parse failures become RawExtractions with
 *     populated parseErrors and empty import lists.
 *   - initialize() MAY throw if the project root is invalid or unreadable.
 *     The orchestrator catches this and fails the analysis gracefully.
 *   - resolveImport() NEVER throws. Unresolvable imports return
 *     { resolved: null, raw: specifier }.
 *   - dispose() NEVER throws. Cleanup failures are silently swallowed
 *     (the analysis is already complete).
 */
export interface LanguageParser {
  /**
   * Unique, stable identifier for this parser.
   * Used for logging, diagnostics, and registry deduplication.
   * Convention: lowercase, no spaces (e.g., "typescript", "python", "go").
   */
  readonly id: string;

  /**
   * Human-readable name for diagnostics and user-facing messages.
   * Example: "TypeScript/JavaScript", "Python", "Go".
   */
  readonly name: string;

  /**
   * The primary language this parser handles.
   * Must be a valid LanguageId from the IR type system.
   */
  readonly language: LanguageId;

  /**
   * File extensions this parser can handle, without leading dots.
   * Used by the registry for extension → parser dispatch.
   *
   * Extensions must be lowercase. The registry normalizes input
   * extensions to lowercase before matching.
   *
   * Example: ["ts", "tsx", "js", "jsx"]
   *
   * A parser may handle extensions for multiple LanguageIds
   * (e.g., TypeScript handles both .ts and .js files).
   */
  readonly extensions: ReadonlyArray<string>;

  /**
   * Capabilities this parser declares it can extract.
   * Used by downstream analyzers for capability-aware degradation.
   *
   * A parser MUST honestly declare its capabilities. If a parser
   * cannot extract exports, it must not list "exports" here — even
   * if it can sometimes infer them heuristically.
   *
   * The RawExtraction.capabilitiesUsed field records which capabilities
   * were actually exercised for each file (may be a subset of this list).
   */
  readonly capabilities: ReadonlyArray<ParserCapability>;

  /**
   * Can this parser handle the given file extension?
   *
   * Called by the registry during dispatch. The extension is provided
   * without a leading dot, in lowercase.
   *
   * This method exists so parsers can perform more nuanced checks
   * beyond simple extension matching if needed (e.g., checking file
   * content patterns). For most parsers, this is a simple
   * this.extensions.includes(ext) check.
   *
   * @param extension - File extension without dot, lowercase (e.g., "ts")
   */
  canHandle(extension: string): boolean;

  /**
   * One-time initialization per analysis run.
   *
   * Called after file discovery, before any parseFile() calls.
   * Use for project-wide setup that should happen once:
   *   - TS: read tsconfig.json, build path alias map
   *   - Python: detect pyproject.toml, discover namespace packages
   *   - Go: read go.mod, resolve module paths
   *
   * The context provides the project root and the full list of
   * discovered files across all languages. Parsers should only
   * inspect files relevant to their language.
   *
   * @param context - Project context (root path, all discovered files)
   * @throws May throw if project root is invalid or config is unreadable.
   *   The orchestrator catches this and fails gracefully.
   */
  initialize(context: ParserInitContext): Promise<void>;

  /**
   * Parse a single source file and return raw extraction data.
   *
   * NEVER throws. Parse failures become a RawExtraction with:
   *   - parseErrors populated (with line, column, severity, reason)
   *   - empty internalImports and externalImports arrays
   *   - confidence-relevant data so the IR Builder can set 'heuristic'
   *
   * The content is provided as a UTF-8 string. Content sniffing
   * (binary detection) is performed by the orchestrator before calling
   * this method — parsers can assume the content is valid text.
   *
   * @param file    - File identity (absolute + relative paths)
   * @param content - File content as UTF-8 string (pre-validated)
   */
  parseFile(file: ParseFileInput, content: string): RawExtraction;

  /**
   * Resolve a raw import specifier to a project-relative file path.
   *
   * Called after all files are parsed, so the parser has full
   * knowledge of which files exist in the project. This two-pass
   * design (parse all files first, resolve second) maps directly
   * to the resolution needs of multiple languages:
   *   - TS: needs the full file list for extension probing
   *   - Python: needs namespace package discovery from all files
   *   - Go: needs the full module graph for internal package resolution
   *
   * NEVER throws. Unresolvable imports return { resolved: null, raw }.
   * These become ExternalDependencyNodes in the IR.
   *
   * @param specifier  - Raw import specifier as written in source code
   * @param fromFile   - The file containing the import
   * @param knownFiles - All discovered project files (for resolution lookup)
   */
  resolveImport(
    specifier: string,
    fromFile: ParseFileInput,
    knownFiles: ReadonlyArray<ParseFileInput>,
  ): ResolvedSpecifier;

  /**
   * Cleanup after an analysis run.
   *
   * Called once after all parsing and resolution is complete.
   * Release any cached data (alias maps, AST caches, config objects).
   *
   * NEVER throws. The analysis is already complete at this point;
   * cleanup failures should be silently swallowed.
   */
  dispose(): void;
}
