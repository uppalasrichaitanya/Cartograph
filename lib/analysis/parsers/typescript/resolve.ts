/**
 * TypeScript-Specific Import Resolution — Internal to the TS Parser
 *
 * Contains the resolution logic extracted from the legacy
 * `resolveAliases.ts` module. This is internal to the TypeScript
 * parser plugin — not exported from the parser's public surface.
 *
 * Extracted as part of Milestone 2, Phase 3 (TypeScript Parser Extraction).
 * The behavior is identical to the legacy implementation.
 *
 * Responsibilities:
 *   - Read tsconfig.json/jsconfig.json to discover path aliases
 *   - Resolve import specifiers against the alias map and known project files
 *   - Probe extension candidates (.ts, .tsx, .js, .jsx) and index files
 *
 * @module lib/analysis/parsers/typescript/resolve
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { ParseFileInput, ResolvedSpecifier } from "../interface";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Source extensions the TS resolver probes when an import specifier
 * lacks an explicit extension. Order matters for resolution priority.
 */
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Alias configuration read from tsconfig.json / jsconfig.json.
 * Contains the baseUrl and paths mapping used for path alias resolution.
 */
export interface AliasConfig {
  readonly baseUrl: string;
  readonly paths: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Configuration Reading
// ---------------------------------------------------------------------------

/**
 * Read the path alias configuration from tsconfig.json or jsconfig.json.
 *
 * Logic is identical to the legacy `resolveAliases.readAliasConfig()`.
 * Falls back to an empty config if no config file is found or if
 * the config file has errors.
 *
 * @param projectRoot - Absolute path to the project root
 * @returns The alias configuration
 */
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

// ---------------------------------------------------------------------------
// Candidate Path Generation
// ---------------------------------------------------------------------------

/**
 * Generate candidate filesystem paths for a given import target.
 *
 * Probes the target path with source extensions appended (if it doesn't
 * already have one) and as a directory with index files.
 *
 * Logic is identical to the legacy `resolveAliases.candidatePaths()`.
 *
 * @param candidate - The base path to probe
 * @returns An array of candidate paths to check against known files
 */
function candidatePaths(candidate: string): string[] {
  const hasSourceExtension = SOURCE_EXTENSIONS.some((extension) => candidate.endsWith(extension));
  return [
    candidate,
    ...(hasSourceExtension ? [] : SOURCE_EXTENSIONS.map((extension) => `${candidate}${extension}`)),
    ...SOURCE_EXTENSIONS.map((extension) => path.join(candidate, `index${extension}`)),
  ];
}

// ---------------------------------------------------------------------------
// Alias Matching
// ---------------------------------------------------------------------------

/**
 * Match a specifier against a tsconfig path alias pattern.
 *
 * Returns the wildcard match (the part that replaces `*` in the alias)
 * or null if the specifier doesn't match the alias.
 *
 * Logic is identical to the legacy `resolveAliases.aliasMatches()`.
 *
 * @param specifier - The import specifier to match
 * @param alias - The alias pattern (e.g., "@/*")
 * @returns The wildcard match or null
 */
function aliasMatches(specifier: string, alias: string): string | null {
  if (!alias.includes("*")) return specifier === alias ? "" : null;
  const [prefix, suffix] = alias.split("*");
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

// ---------------------------------------------------------------------------
// File Lookup
// ---------------------------------------------------------------------------

/**
 * Look up a candidate path in the set of known project files.
 *
 * Probes all candidate paths (with extension and index variants)
 * against the known files map.
 *
 * Logic is identical to the legacy `resolveAliases.lookupCandidate()`.
 *
 * @param candidate - The base path to probe
 * @param knownFilesMap - Map from normalized absolute paths to ParseFileInput
 * @returns The relative path of the matched file, or null
 */
function lookupCandidate(
  candidate: string,
  knownFilesMap: Map<string, ParseFileInput>,
): string | null {
  for (const possiblePath of candidatePaths(candidate)) {
    const normalized = path.normalize(possiblePath);
    const found = knownFilesMap.get(normalized);
    if (found) return found.relativePath;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API — Resolution
// ---------------------------------------------------------------------------

/**
 * Build a lookup map from known files for efficient resolution.
 *
 * Keys are normalized absolute paths. This matches the legacy
 * `extractImports.ts` pattern where `projectFiles` was keyed by
 * `path.normalize(file.absolutePath)`.
 *
 * @param knownFiles - All discovered project files
 * @returns A map from normalized absolute paths to ParseFileInput
 */
export function buildFileLookupMap(
  knownFiles: ReadonlyArray<ParseFileInput>,
): Map<string, ParseFileInput> {
  return new Map(knownFiles.map((file) => [path.normalize(file.absolutePath), file]));
}

/**
 * Resolve a single import specifier using TS/JS resolution semantics.
 *
 * Resolution order (identical to the legacy `resolveProjectImport()`):
 *   1. Relative specifiers (./ or ../) — resolve relative to the importing file
 *   2. Absolute specifiers (/) — resolve relative to the project root
 *   3. Alias specifiers — match against tsconfig path aliases
 *   4. If nothing matches → external import (resolved: null)
 *
 * Classification of failures (`unresolvedKind`):
 *   A specifier starting with '.' or '/' is syntactically incapable of naming
 *   an npm package, so a failed lookup means "internal reference whose target
 *   is unknown" — reported as 'unresolved-internal'. Every other failed
 *   specifier is reported as 'external'.
 *
 *   Alias-shaped specifiers are deliberately NOT reclassified: a tsconfig
 *   `paths` entry may legitimately point into node_modules, so a failed alias
 *   lookup is not evidence of an internal target. This distinction is read
 *   directly off the specifier's syntax — nothing is inferred or guessed.
 *
 * @param specifier - Raw import specifier as written in source code
 * @param fromFile - The file containing the import
 * @param config - Alias configuration from tsconfig/jsconfig
 * @param knownFilesMap - Map from normalized absolute paths to ParseFileInput
 * @param projectRoot - Absolute path to the project root
 * @returns ResolvedSpecifier with resolved path or null for external
 */
export function resolveSpecifier(
  specifier: string,
  fromFile: ParseFileInput,
  config: AliasConfig,
  knownFilesMap: Map<string, ParseFileInput>,
  projectRoot: string,
): ResolvedSpecifier {
  // Relative or absolute specifiers
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const base = specifier.startsWith("/")
      ? path.resolve(projectRoot, `.${specifier}`)
      : path.resolve(path.dirname(fromFile.absolutePath), specifier);
    const resolved = lookupCandidate(base, knownFilesMap);
    if (resolved) return { resolved, raw: specifier };
    // Syntactically internal but no such file — a broken internal reference,
    // not a third-party package.
    return {
      resolved: null,
      raw: specifier,
      unresolvedKind: "unresolved-internal",
    };
  }

  // Alias specifiers — match against tsconfig paths
  const matchingAliases = Object.keys(config.paths)
    .map((alias) => ({ alias, wildcard: aliasMatches(specifier, alias) }))
    .filter((match): match is { alias: string; wildcard: string } => match.wildcard !== null)
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { alias, wildcard } of matchingAliases) {
    for (const target of config.paths[alias] ?? []) {
      const replacement = target.includes("*") ? target.replace("*", wildcard) : target;
      const resolved = lookupCandidate(path.resolve(config.baseUrl, replacement), knownFilesMap);
      if (resolved) return { resolved, raw: specifier };
    }
  }

  // No match — external import
  return { resolved: null, raw: specifier, unresolvedKind: "external" };
}
