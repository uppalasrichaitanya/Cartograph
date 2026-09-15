import type { ParseFileInput, ResolvedSpecifier } from "../interface";
import type { GoPackageIndex } from "./packageIndex";

export function resolveGoImport(specifier: string, index: GoPackageIndex): ResolvedSpecifier {
  const entry = index.packages.get(specifier);
  if (entry) {
    const file = entry.files[0];
    return file
      ? { resolved: file, raw: specifier, approximate: entry.files.length > 1 }
      : { resolved: null, raw: specifier, unresolvedKind: "unresolved-internal" };
  }
  if (index.modulePath && (specifier === index.modulePath || specifier.startsWith(`${index.modulePath}/`))) {
    return { resolved: null, raw: specifier, unresolvedKind: "unresolved-internal" };
  }
  return { resolved: null, raw: specifier, unresolvedKind: "external" };
}

export function resolveGoImportFromFile(specifier: string, _fromFile: ParseFileInput, index: GoPackageIndex): ResolvedSpecifier {
  return resolveGoImport(specifier, index);
}
