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
import { createRequire } from "node:module";
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
 * Resolve the path to a WASM file.
 *
 * Uses `createRequire` from `node:module` to get an ESM-compatible
 * `require.resolve`, then navigates to the expected WASM file location.
 * This works regardless of hoisting, monorepo setups, or pnpm layouts.
 */
function resolveWasmPath(packageName: string, relativePath: string): string {
  const esmRequire = createRequire(import.meta.url);
  try {
    // Attempt to resolve package.json directly (works for packages without 'exports' restrictions)
    const packageJsonPath = esmRequire.resolve(`${packageName}/package.json`);
    return path.join(path.dirname(packageJsonPath), relativePath);
  } catch (err: any) {
    if (err.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      // Fallback: resolve the main package entry point and use its directory.
      // This assumes the main entry point is at the package root (true for web-tree-sitter).
      const mainPath = esmRequire.resolve(packageName);
      return path.join(path.dirname(mainPath), relativePath);
    }
    throw err;
  }
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
      // Load the core WASM runtime
      const runtimeWasm = resolveWasmPath("web-tree-sitter", "tree-sitter.wasm");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- EmscriptenModule type is not
      // declared in web-tree-sitter 0.25.x without @types/emscripten installed.
      // locateFile is a valid Emscripten config option that helps find the .wasm file.
      await Parser.init({ locateFile: () => runtimeWasm } as any);

      // Load the Python grammar
      const pythonWasm = resolveWasmPath("tree-sitter-wasms", "out/tree-sitter-python.wasm");
      const pythonLang = await Language.load(pythonWasm);

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
