/**
 * Search Items — what the workspace can be searched over
 *
 * Three kinds:
 *
 *   files     every source file in the repository
 *   packages  external dependencies, read from the IR
 *   symbols   named declarations, read from FileNodes in the IR
 *
 * Packages are included because "who uses react?" is a question the IR can
 * already answer from directly observed import statements, and the workspace
 * previously could not. Search covered file paths and folder names only.
 *
 * Symbols remain embedded in files rather than becoming graph nodes. Their
 * structured targets carry both the owning file and declaration identity.
 *
 * @module lib/workspace/searchItems
 */

import type { RepositoryIR } from "@/lib/analysis/ir/types";
import type { DependencyGraph } from "@/types/graph";
import type { SearchItem } from "./search";

/** Basename of a path. */
function basename(filePath: string): string {
  const segments = filePath.split("/");
  return segments[segments.length - 1] || filePath;
}

/**
 * Build the searchable set.
 *
 * File items are labelled by basename with the full path as context: people
 * search for what a file is called, and the path is what disambiguates two
 * files with the same name.
 *
 * Package items are emitted once per (package, importing file) pair rather
 * than once per package. A package has no location in the map, so a single
 * result would have nowhere to go; one result per importer means every row has
 * a real destination, and the answer to "where is this used?" is the set of
 * rows itself. Ranking keeps file-name matches above package matches, so this
 * does not drown out a query that was about a file.
 *
 * @param graph  The dependency graph — source of file items and in-degree.
 * @param ir     Validated IR, or null/undefined. Without it, packages are
 *               simply absent: no IR means no verified record of what is
 *               imported, and inventing the list would be fabrication.
 */
export function buildSearchItems(
  graph: DependencyGraph,
  ir: RepositoryIR | null | undefined,
): ReadonlyArray<SearchItem> {
  // In-degree: how many files import each file. A verified count, used only to
  // order results of equal match quality.
  const inDegree = new Map<string, number>();
  for (const edge of graph.edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const items: SearchItem[] = graph.nodes.map((node) => ({
    id: `file:${node.id}`,
    label: basename(node.path),
    context: node.path,
    target: { kind: "file" as const, fileId: node.id },
    kind: "file" as const,
    weight: inDegree.get(node.id) ?? 0,
  }));

  if (!ir) return items;

  const filePathById = new Map<string, string>();
  const packageNameById = new Map<string, string>();
  for (const node of ir.nodes) {
    if (node.kind === "File") filePathById.set(node.id, node.path);
    else if (node.kind === "ExternalDependency") {
      packageNameById.set(node.id, node.name);
    }
  }

  for (const node of ir.nodes) {
    if (node.kind !== "File" || node.declarations === undefined) continue;
    const weight = inDegree.get(node.path) ?? 0;
    for (const declaration of node.declarations) {
      items.push({
        id: `symbol:${declaration.id}`,
        label: declaration.name,
        context: `${declaration.qualifiedName} in ${node.path}`,
        target: {
          kind: "symbol",
          fileId: node.path,
          symbolId: declaration.id,
        },
        kind: "symbol",
        weight,
      });
    }
  }

  for (const edge of ir.edges) {
    if (edge.kind !== "imports") continue;
    const packageName = packageNameById.get(edge.to);
    if (packageName === undefined) continue;
    const importerPath = filePathById.get(edge.from);
    if (importerPath === undefined) continue;

    items.push({
      id: `package:${packageName}:${importerPath}`,
      label: packageName,
      context: importerPath,
      // The destination is the importing file: that is the thing in the map a
      // person can actually be taken to.
      target: { kind: "package", fileId: importerPath },
      kind: "package",
      // Weighted by how depended-upon the IMPORTER is, keeping the tiebreaker
      // consistent across both kinds — it always means "how much of this
      // repository leans on the thing you would land on".
      weight: inDegree.get(importerPath) ?? 0,
    });
  }

  return items;
}
