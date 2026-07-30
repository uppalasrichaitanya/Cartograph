/**
 * Tree-sitter WASM Runtime — Singleton Initialization
 *
 * Manages the lifecycle of the web-tree-sitter WASM runtime and the
 * Python language grammar. Provides a shared, lazy-initialized parser
 * instance for all PythonParser instances.
 *
 * Design:
 *   - The WASM runtime and Python grammar are loaded ONCE per process
 *     (module-level singleton), not per PythonParser instance.
 *   - This avoids the ~100ms cold-start cost on every `initialize()`.
 *   - The singleton is safe because tree-sitter parsers are stateless
 *     between individual `parse()` calls — there's no cross-file leakage.
 *   - If loading fails, the error is thrown on every attempt — no silent
 *     degradation. The caller (PythonParser.parseFile) catches and
 *     converts to an IRParseError.
 *
 * Loading strategy (per §8 of the implementation plan):
 *   - Load the WASM runtime and Python grammar once per warm function
 *     instance; cache the compiled Language object at module scope.
 *   - Do not assume cross-invocation persistence is guaranteed (cold
 *     starts will re-load) — this is a performance optimization, not
 *     a correctness dependency.
 *
 * Lifecycle integration:
 *   - `ensureInitialized()` is called during PythonParser.initialize()
 *     (async), which runs before any parseFile() calls.
 *   - `parsePythonSourceSync()` is called during PythonParser.parseFile()
 *     (synchronous), which can only run after initialize() completes.
 *
 * @module lib/analysis/parsers/python/treeSitter
 */

import path from "node:path";
import { readFile } from "node:fs/promises";
import { Parser, Language, type Node, type Tree } from "web-tree-sitter";

// Re-export types that the import extractor needs
export type { Node, Tree };

// ---------------------------------------------------------------------------
// Singleton State
// ---------------------------------------------------------------------------

/** The initialized WASM parser, or null if not yet loaded. */
let cachedParser: Parser | null = null;

/** The loaded Python language, or null if not yet loaded. */
let cachedLanguage: Language | null = null;

/** Promise for in-flight initialization (prevents double-init races). */
let initPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// WASM File Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the directory of a dependency package at runtime.
 *
 * Why not a plain `createRequire(import.meta.url)` at module scope:
 *   Webpack statically recognizes `createRequire` imported from `node:module`
 *   and rewrites any `.resolve()` call on its result into an internal webpack
 *   module id. In the Next.js server build that produced either the string
 *   "web-tree-sitter?1b29" (dirname → "." → a bare relative wasm path resolved
 *   against process.cwd(), i.e. ENOENT) or the number 9711 (a TypeError from
 *   path.dirname). Both are module ids, never filesystem paths.
 *
 *   `process.getBuiltinModule` is a plain property access on `process`, so
 *   there is no import specifier for webpack to see and nothing to rewrite.
 *   It returns the real `node:module`, giving a `require.resolve` that
 *   performs genuine Node resolution against real node_modules on disk.
 *   Requires Node >= 22.3 (this app already requires the Node runtime).
 *
 * The base is cwd-anchored rather than derived from the compiled bundle's
 * location, because the bundle lives under .next/server/** while the
 * dependencies live in the project's node_modules.
 */
function resolvePackageDirectory(packageEntry: string): string {
  const nodeModule = process.getBuiltinModule("module") as typeof import("node:module");
  const runtimeRequire = nodeModule.createRequire(path.join(process.cwd(), "noop.js"));
  return path.dirname(runtimeRequire.resolve(packageEntry));
}

function getTreeSitterWasmsPath(): string {
  // tree-sitter-wasms has a broken "main" field ("bindings/node", which is not
  // published), but it has no exports map, so package.json resolves fine.
  return resolvePackageDirectory("tree-sitter-wasms/package.json");
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Ensure the tree-sitter WASM runtime and Python grammar are loaded.
 *
 * Must be called (and awaited) before any synchronous parse calls.
 * Safe to call multiple times — subsequent calls are no-ops if already
 * initialized, or await the in-flight initialization if one is running.
 *
 * @throws If the WASM files cannot be loaded (missing packages, corrupt
 *         WASM, ABI mismatch, etc.)
 */
export async function ensureInitialized(): Promise<void> {
  if (cachedParser && cachedLanguage) return;

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    try {
      // Load the core WASM runtime.
      // No `locateFile` override: web-tree-sitter is listed in
      // serverExternalPackages, so it is required as a real package at runtime
      // and its Emscripten glue sets scriptDirectory from its own __dirname,
      // finding the co-located tree-sitter.wasm on its own. Supplying a
      // locateFile computed here is what previously produced a bad path.
      await Parser.init();

      // Load the Python grammar from bytes rather than a path.
      // Language.load(string) internally calls require("fs/promises"), which
      // throws "Dynamic require of \"fs/promises\" is not supported" when the
      // ESM build is used. Passing a Uint8Array skips that branch entirely.
      const pythonWasm = path.join(getTreeSitterWasmsPath(), "out", "tree-sitter-python.wasm");
      const pythonLang = await Language.load(new Uint8Array(await readFile(pythonWasm)));

      // Create and configure the parser
      const parser = new Parser();
      parser.setLanguage(pythonLang);

      cachedParser = parser;
      cachedLanguage = pythonLang;
    } catch (error) {
      // Reset promise so a retry can be attempted
      initPromise = null;
      throw error;
    }
  })();

  await initPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse Python source code synchronously.
 *
 * MUST only be called after `ensureInitialized()` has completed.
 * The `parseFile()` contract is synchronous (returns `RawExtraction`,
 * not `Promise<RawExtraction>`), so this method must be synchronous too.
 *
 * @param source - Python source code as a UTF-8 string
 * @returns The parsed syntax tree
 * @throws If the runtime has not been initialized, or if parse returns null
 */
export function parsePythonSourceSync(source: string): Tree {
  if (!cachedParser) {
    throw new Error(
      "tree-sitter runtime not initialized. " +
      "Call ensureInitialized() during initialize() before parsing."
    );
  }

  const tree = cachedParser.parse(source);
  if (!tree) {
    throw new Error("tree-sitter parser returned null (language not set or cancelled)");
  }
  return tree;
}

/**
 * Dispose the singleton parser and language.
 *
 * Called during testing to reset state between test runs.
 * In production, this is never called — the singleton lives
 * for the lifetime of the process/function instance.
 */
export function disposeTreeSitterRuntime(): void {
  if (cachedParser) {
    cachedParser.delete();
    cachedParser = null;
  }
  cachedLanguage = null;
  initPromise = null;
}
