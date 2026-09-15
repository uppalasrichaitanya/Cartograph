import path from "node:path";
import { readFile } from "node:fs/promises";
import { Parser, Language, type Node, type Tree } from "web-tree-sitter";
export type { Node, Tree };

let cachedParser: Parser | null = null;
let cachedLanguage: Language | null = null;
let initPromise: Promise<void> | null = null;

function packageDir(entry: string): string {
  const nodeModule = process.getBuiltinModule("module") as typeof import("node:module");
  const runtimeRequire = nodeModule.createRequire(path.join(process.cwd(), "noop.js"));
  return path.dirname(runtimeRequire.resolve(entry));
}

export async function ensureGoRuntime(): Promise<void> {
  if (cachedParser && cachedLanguage) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      await Parser.init();
      const wasm = path.join(packageDir("tree-sitter-wasms/package.json"), "out", "tree-sitter-go.wasm");
      const language = await Language.load(new Uint8Array(await readFile(wasm)));
      const parser = new Parser();
      parser.setLanguage(language);
      cachedParser = parser;
      cachedLanguage = language;
    } catch (error) {
      initPromise = null;
      throw error;
    }
  })();
  return initPromise;
}

export function parseGoSourceSync(source: string): Tree {
  if (!cachedParser) throw new Error("Go tree-sitter runtime not initialized");
  const tree = cachedParser.parse(source);
  if (!tree) throw new Error("Go tree-sitter parser returned null");
  return tree;
}

export function disposeGoTreeSitterRuntime(): void {
  cachedParser?.delete();
  cachedParser = null;
  cachedLanguage = null;
  initPromise = null;
}
