import path from "node:path";
import type { ParseFileInput } from "../interface";
import type { GoModuleResult } from "./metadata";

export interface GoPackageEntry {
  readonly importPath: string;
  readonly directoryPath: string;
  readonly files: ReadonlyArray<string>;
}

export interface GoPackageIndex extends GoModuleResult {
  readonly packages: ReadonlyMap<string, GoPackageEntry>;
}

export function buildGoPackageIndex(
  module: GoModuleResult,
  files: ReadonlyArray<ParseFileInput>,
): GoPackageIndex {
  const grouped = new Map<string, string[]>();
  for (const file of files) {
    if (!file.relativePath.endsWith(".go") || file.relativePath.endsWith("_test.go")) continue;
    const parts = file.relativePath.split("/");
    if (parts.some((part) => part === "vendor" || part === "testdata" || part.startsWith("."))) continue;
    const directory = parts.slice(0, -1).join("/");
    const importPath = module.modulePath
      ? [module.modulePath, directory].filter(Boolean).join("/")
      : directory;
    const list = grouped.get(importPath) ?? [];
    list.push(file.relativePath);
    grouped.set(importPath, list);
  }
  const packages = new Map<string, GoPackageEntry>();
  for (const [importPath, packageFiles] of grouped) {
    const sorted = [...packageFiles].sort((a, b) => a.localeCompare(b));
    packages.set(importPath, {
      importPath,
      directoryPath: path.join(module.moduleRoot, path.dirname(sorted[0])).replace(/[\\/]\.$/, ""),
      files: sorted,
    });
  }
  return { ...module, packages };
}
