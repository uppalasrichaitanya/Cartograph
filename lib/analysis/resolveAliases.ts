import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

export type AliasConfig = {
  baseUrl: string;
  paths: Record<string, string[]>;
};

export type ProjectFile = {
  absolutePath: string;
  filePath: string;
};

export function readAliasConfig(projectRoot: string): AliasConfig {
  const configPath = ["tsconfig.json", "jsconfig.json"]
    .map((file) => path.join(projectRoot, file))
    .find(existsSync);

  if (!configPath) return { baseUrl: projectRoot, paths: {} };

  const config = ts.readConfigFile(configPath, (fileName) => readFileSync(fileName, "utf8"));
  if (config.error) return { baseUrl: projectRoot, paths: {} };

  const compilerOptions = config.config.compilerOptions ?? {};
  return {
    baseUrl: path.resolve(projectRoot, compilerOptions.baseUrl ?? "."),
    paths: compilerOptions.paths ?? {},
  };
}

function candidatePaths(candidate: string): string[] {
  const hasSourceExtension = SOURCE_EXTENSIONS.some((extension) => candidate.endsWith(extension));
  return [
    candidate,
    ...(hasSourceExtension ? [] : SOURCE_EXTENSIONS.map((extension) => `${candidate}${extension}`)),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(candidate, `index${extension}`)),
  ];
}

function aliasMatches(specifier: string, alias: string): string | null {
  if (!alias.includes("*")) return specifier === alias ? "" : null;
  const [prefix, suffix] = alias.split("*");
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function lookupCandidate(candidate: string, projectFiles: Map<string, ProjectFile>): string | null {
  for (const possiblePath of candidatePaths(candidate)) {
    const normalized = path.normalize(possiblePath);
    const found = projectFiles.get(normalized);
    if (found) return found.filePath;
  }
  return null;
}

/** Resolves only files that were accepted by discovery; it never leaks excluded files into the graph. */
export function resolveProjectImport(
  specifier: string,
  importingFile: string,
  config: AliasConfig,
  projectFiles: Map<string, ProjectFile>,
  projectRoot: string,
): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const base = specifier.startsWith("/")
      ? path.resolve(projectRoot, `.${specifier}`)
      : path.resolve(path.dirname(importingFile), specifier);
    return lookupCandidate(base, projectFiles);
  }

  const matchingAliases = Object.keys(config.paths)
    .map((alias) => ({ alias, wildcard: aliasMatches(specifier, alias) }))
    .filter((match): match is { alias: string; wildcard: string } => match.wildcard !== null)
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { alias, wildcard } of matchingAliases) {
    for (const target of config.paths[alias] ?? []) {
      const replacement = target.includes("*") ? target.replace("*", wildcard) : target;
      const resolved = lookupCandidate(path.resolve(config.baseUrl, replacement), projectFiles);
      if (resolved) return resolved;
    }
  }

  return null;
}
