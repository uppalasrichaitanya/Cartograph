/**
 * Reachability: which files have an import path from a recognised entry point.
 *
 * A breadth-first search over the resolved file-to-file edges. The output is a
 * measurement of the import graph and nothing more: a file the search never
 * reaches may still be loaded by something the analysis cannot see (a dynamic
 * import, a framework convention, a build config), so the result carries the
 * caveats that apply and the interface words it as "no import path from any
 * recognised entry point", never as a verdict on the file.
 *
 * With no recognised entry point the search has no starting place and every
 * file would look unreachable, so nothing is reported at all.
 */
import type { DependencyGraph, ReachabilityResult } from "@/types/graph";
import type { EntryPoint } from "./entryPoints";

/** Things found while parsing that could hide real import paths. */
export type ReachabilitySignals = {
  /** Files containing import()/require() calls whose argument is not a literal. */
  dynamicImportFiles: number;
  /** Internal imports that could not be resolved to a file. */
  unresolvedInternalImports: number;
  /** File-routed frameworks in use whose conventions are not recognised. */
  unrecognisedFrameworks: string[];
};

const NO_SIGNALS: ReachabilitySignals = { dynamicImportFiles: 0, unresolvedInternalImports: 0, unrecognisedFrameworks: [] };

const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export function computeReachability(input: {
  graph: DependencyGraph;
  entryPoints: readonly EntryPoint[];
  signals?: ReachabilitySignals;
}): ReachabilityResult {
  const { graph } = input;
  const signals = input.signals ?? NO_SIGNALS;
  const known = new Set(graph.nodes.map((node) => node.id));
  const entryPoints = input.entryPoints.filter((entry) => known.has(entry.path)).map((entry) => ({ ...entry }));

  if (entryPoints.length === 0) {
    return { version: 1, entryPoints: [], unreachable: [], caveats: ["No entry points recognised, so reachability was not computed"] };
  }

  const imports = new Map(graph.nodes.map((node) => [node.id, node.imports]));
  // Languages where reaching one file loads others without an import edge:
  // a Go package is every file in its directory, and importing a Python module
  // runs the __init__.py of each package above it.
  const goByDir = new Map<string, string[]>();
  for (const id of known) {
    if (!id.endsWith(".go")) continue;
    const dir = dirOf(id);
    goByDir.set(dir, [...(goByDir.get(dir) ?? []), id]);
  }

  const reached = new Set<string>();
  const queue: string[] = [];
  const visit = (id: string) => {
    if (known.has(id) && !reached.has(id)) {
      reached.add(id);
      queue.push(id);
    }
  };
  for (const entry of entryPoints) visit(entry.path);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of imports.get(id) ?? []) visit(next);
    if (id.endsWith(".go")) for (const sibling of goByDir.get(dirOf(id)) ?? []) visit(sibling);
    if (id.endsWith(".py")) {
      for (let dir = dirOf(id); ; dir = dirOf(dir)) {
        visit(dir ? `${dir}/__init__.py` : "__init__.py");
        if (!dir) break;
      }
    }
  }

  const unreachable = graph.nodes
    .map((node) => node.path)
    .filter((path) => !reached.has(path) && !/\.d\.[cm]?ts$/.test(path))
    .sort();

  const caveats: string[] = [];
  if (signals.dynamicImportFiles > 0) {
    caveats.push(
      `${signals.dynamicImportFiles} ${signals.dynamicImportFiles === 1 ? "file uses" : "files use"} dynamic or non-literal imports, which name no file the analysis can follow, so some files listed may be loaded that way.`,
    );
  }
  if (signals.unresolvedInternalImports > 0) {
    const n = signals.unresolvedInternalImports;
    caveats.push(`${n} internal ${n === 1 ? "import" : "imports"} could not be resolved to a file, so a path through ${n === 1 ? "it" : "them"} may be missing.`);
  }
  if (signals.unrecognisedFrameworks.length > 0) {
    caveats.push(
      `This repository uses ${signals.unrecognisedFrameworks.join(", ")}, whose file conventions are not recognised, so files it loads by convention may be listed.`,
    );
  }
  return { version: 1, entryPoints, unreachable, caveats };
}
