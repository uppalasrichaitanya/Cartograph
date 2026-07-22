/**
 * Cartograph Parser Registry — Extension Dispatch & Lifecycle Management
 *
 * Implements the parser registry specified in the approved Milestone 2
 * implementation plan (Phase 2).
 *
 * Responsibility:
 *   - Extension → parser dispatch table.
 *   - Extension collision detection at registration time.
 *   - Parser lifecycle management: initialize() and dispose().
 *
 * Design:
 *   - Single-instance per analysis run.
 *   - Parsers are registered eagerly (at import time) but their heavy
 *     initialization (initialize()) is deferred until the first analysis
 *     run that actually encounters files of that language.
 *   - Extension collisions are detected at registration time and throw,
 *     not at runtime dispatch — fail fast, fail loud.
 *   - Registry owns parser lifecycle: initializeAll() and disposeAll().
 *
 * Threading model:
 *   - The registry is not thread-safe. It is designed for single-threaded
 *     usage within one analysis run, consistent with the LanguageParser
 *     contract.
 *
 * @module lib/analysis/parsers/registry
 */

import type { LanguageParser, ParserInitContext } from "./interface";

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

/**
 * Thrown when a parser attempts to register an extension that is already
 * claimed by another parser. This is a programming error (misconfiguration),
 * not a user input error — it should never be silently swallowed.
 */
export class ExtensionCollisionError extends Error {
  constructor(
    public readonly extension: string,
    public readonly existingParserId: string,
    public readonly newParserId: string,
  ) {
    super(
      `Extension collision: ".${extension}" is already registered by parser "${existingParserId}". ` +
        `Parser "${newParserId}" cannot also claim it.`,
    );
    this.name = "ExtensionCollisionError";
  }
}

/**
 * Thrown when a parser with the same id is registered more than once.
 * This is a programming error — each parser id must be unique.
 */
export class DuplicateParserError extends Error {
  constructor(public readonly parserId: string) {
    super(`Duplicate parser: a parser with id "${parserId}" is already registered.`);
    this.name = "DuplicateParserError";
  }
}

// ---------------------------------------------------------------------------
// Parser Registry
// ---------------------------------------------------------------------------

/**
 * Lazy-loaded parser registry.
 *
 * Extension → parser dispatch table. Parsers are registered eagerly
 * (at import time) but their heavy initialization (initialize()) is
 * deferred until initializeAll() is called at the start of an analysis run.
 *
 * Usage:
 *   const registry = new ParserRegistry();
 *   registry.register(new TypeScriptParser());
 *   // ... later, during analysis:
 *   await registry.initializeAll({ projectRoot, discoveredFiles });
 *   const parser = registry.getParserForExtension("ts");
 *   // ... after analysis:
 *   registry.disposeAll();
 */
export class ParserRegistry {
  /**
   * Extension → parser mapping. Extensions are stored without leading dots,
   * in lowercase. Built incrementally during register() calls.
   */
  private readonly extensionMap = new Map<string, LanguageParser>();

  /**
   * Parser id → parser instance. Used for deduplication detection
   * and ordered lifecycle management.
   *
   * Insertion order is preserved (Map guarantees this), which means
   * initializeAll() and disposeAll() process parsers in registration order.
   * This is deterministic.
   */
  private readonly parsers = new Map<string, LanguageParser>();

  // ---- Registration ----

  /**
   * Register a parser with the registry.
   *
   * All extensions declared by the parser are claimed. Extension
   * collisions with previously registered parsers throw immediately —
   * fail fast, fail loud.
   *
   * @param parser - The parser to register
   * @throws ExtensionCollisionError if any extension is already claimed
   * @throws DuplicateParserError if a parser with the same id is already registered
   */
  register(parser: LanguageParser): void {
    // Guard: duplicate parser id
    if (this.parsers.has(parser.id)) {
      throw new DuplicateParserError(parser.id);
    }

    // Guard: extension collisions — check ALL extensions before committing any
    for (const ext of parser.extensions) {
      const normalized = ext.toLowerCase();
      const existing = this.extensionMap.get(normalized);
      if (existing) {
        throw new ExtensionCollisionError(normalized, existing.id, parser.id);
      }
    }

    // Commit: all extensions are safe, register them atomically
    for (const ext of parser.extensions) {
      this.extensionMap.set(ext.toLowerCase(), parser);
    }
    this.parsers.set(parser.id, parser);
  }

  // ---- Dispatch ----

  /**
   * Look up the parser that handles a given file extension.
   *
   * The extension is normalized to lowercase before lookup.
   * Returns null if no parser handles the given extension.
   *
   * @param extension - File extension without leading dot (e.g., "ts", "py")
   * @returns The parser that handles this extension, or null
   */
  getParserForExtension(extension: string): LanguageParser | null {
    return this.extensionMap.get(extension.toLowerCase()) ?? null;
  }

  /**
   * Get the set of all file extensions handled by registered parsers.
   *
   * Used by file discovery to know which extensions to scan for,
   * replacing the hardcoded SOURCE_EXTENSIONS constant.
   *
   * Extensions are returned without leading dots, in lowercase.
   */
  getRegisteredExtensions(): ReadonlySet<string> {
    return new Set(this.extensionMap.keys());
  }

  // ---- Lifecycle ----

  /**
   * Initialize all registered parsers for an analysis run.
   *
   * Called once after file discovery, before any parseFile() calls.
   * Parsers are initialized in registration order (deterministic).
   *
   * If any parser's initialize() throws, the error propagates immediately.
   * Already-initialized parsers are NOT rolled back — the caller
   * (orchestrator) should call disposeAll() in its finally block.
   *
   * @param context - Project context (root path, all discovered files)
   */
  async initializeAll(context: ParserInitContext): Promise<void> {
    for (const parser of this.parsers.values()) {
      await parser.initialize(context);
    }
  }

  /**
   * Dispose all registered parsers after an analysis run.
   *
   * Called once after all parsing and resolution is complete.
   * Parsers are disposed in registration order (deterministic).
   *
   * Never throws — individual parser dispose() failures are silently
   * swallowed. This matches the LanguageParser contract where dispose()
   * never throws.
   */
  disposeAll(): void {
    for (const parser of this.parsers.values()) {
      try {
        parser.dispose();
      } catch {
        // Silently swallow — per the LanguageParser contract,
        // dispose() should never throw. If it does, the analysis
        // is already complete and there's nothing useful to do.
      }
    }
  }
}
