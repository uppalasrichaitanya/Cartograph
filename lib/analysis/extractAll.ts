/**
 * Cartograph Language-Agnostic Extraction Orchestrator
 *
 * Replaces the TS-specific `extractImports.ts` with a general orchestrator
 * that dispatches files to parsers via the ParserRegistry. This module
 * knows nothing about any specific language — only the registry and the
 * LanguageParser interface.
 *
 * Created as part of Milestone 2, Phase 4 (extractAll Orchestrator).
 *
 * Data flow:
 *   1. For each discovered file, find parser via registry (by extension)
 *   2. Read file content from disk
 *   3. Call parser.parseFile() → RawExtraction (specifiers unresolved)
 *   4. After all files are parsed, call parser.resolveImport() for each
 *      specifier to classify as internal or external
 *   5. Produce resolved RawExtractions with correct internal/external split
 *   6. Return ExtractionResult with resolved extractions and skipped files
 *
 * Legacy adapter:
 *   For backward compatibility during the transition, this module provides
 *   `toLegacyResult()` which converts resolved RawExtraction[] into the
 *   legacy SourceFileAnalysis[] + ParseError[] shape consumed by
 *   buildGraph(), clusterByFolder(), detectAnomalies(), and
 *   prepareRenderData(). This adapter is temporary — it will be removed
 *   when the legacy graph is replaced by IR-derived queries (Milestone 7).
 *
 * @module lib/analysis/extractAll
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ParserRegistry } from "./parsers/registry";
import type { ParseFileInput, RawExtraction } from "./parsers/interface";
import type { ParseError, SourceFileAnalysis } from "@/types/graph";

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/**
 * Result of the extraction orchestrator.
 *
 * Contains the resolved RawExtractions (one per successfully dispatched
 * file) and files that were skipped because no parser handles their
 * extension.
 */
export interface ExtractionResult {
  /** Resolved extractions from all parsers, one per file. */
  readonly extractions: ReadonlyArray<RawExtraction>;
  /** Files skipped because no parser handles their extension. */
  readonly skippedFiles: ReadonlyArray<ParseFileInput>;
}

/**
 * Legacy-compatible result shape, matching the shape returned by
 * the legacy `extractImports()` function.
 *
 * Used during the transition period so that the existing
 * buildGraph(), clusterByFolder(), detectAnomalies(), and
 * prepareRenderData() pipeline can consume the same data shape.
 */
export interface LegacyExtractionResult {
  readonly files: SourceFileAnalysis[];
  readonly parseErrors: ParseError[];
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Language-agnostic extraction orchestrator.
 *
 * Dispatches files to parsers via the registry, reads content, parses,
 * resolves import specifiers, and returns resolved RawExtractions.
 *
 * This function does NOT call registry.initializeAll() or
 * registry.disposeAll() — that is the caller's responsibility.
 * The registry must be initialized before calling extractAll().
 *
 * Files are processed in the order they appear in discoveredFiles
 * (deterministic, since discoverSourceFiles sorts alphabetically).
 *
 * @param projectRoot     - Absolute path to the project root
 * @param discoveredFiles - All discovered source files
 * @param registry        - Initialized ParserRegistry with parsers registered
 * @returns ExtractionResult with resolved extractions and skipped files
 */
export async function extractAll(
  projectRoot: string,
  discoveredFiles: ReadonlyArray<ParseFileInput>,
  registry: ParserRegistry,
): Promise<ExtractionResult> {
  const skippedFiles: ParseFileInput[] = [];

  // Phase 1: Parse all files — collect raw (unresolved) extractions
  // Each extraction has specifiers in internalImports that are not yet
  // classified as internal or external.
  const rawExtractions: Array<{
    file: ParseFileInput;
    extraction: RawExtraction;
    parser: import("./parsers/interface").LanguageParser;
  }> = [];

  for (const file of discoveredFiles) {
    // Determine the file extension for dispatch
    const ext = path.extname(file.absolutePath).toLowerCase();
    const extensionWithoutDot = ext.startsWith(".") ? ext.slice(1) : ext;

    // Find parser for this extension
    const parser = registry.getParserForExtension(extensionWithoutDot);
    if (!parser) {
      skippedFiles.push(file);
      continue;
    }

    // Read file content
    let content: string;
    try {
      content = await readFile(file.absolutePath, "utf8");
    } catch (error) {
      // File read failure — produce a failed extraction with error info
      // This matches the legacy behavior where readFile errors were caught
      // and pushed as parseErrors.
      rawExtractions.push({
        file,
        extraction: {
          path: file.relativePath,
          lineCount: 0,
          internalImports: [],
          externalImports: [],
          parseErrors: [
            {
              message: error instanceof Error ? error.message : "Unable to read file",
              severity: "fatal",
              reason: "unreadable",
            },
          ],
          capabilitiesUsed: [],
        },
        parser,
      });
      continue;
    }

    // Parse the file
    const extraction = parser.parseFile(file, content);
    rawExtractions.push({ file, extraction, parser });
  }

  // Phase 2: Resolve import specifiers
  // After all files are parsed, resolve each specifier to classify
  // it as internal (project file) or external (npm package, etc.).
  //
  // This two-pass design matches the LanguageParser lifecycle:
  //   1. parseFile() for all files (phase 1 above)
  //   2. resolveImport() for all specifiers (this phase)
  const resolvedExtractions: RawExtraction[] = [];

  for (const { file, extraction, parser } of rawExtractions) {
    // Files with parse errors have empty import lists — no resolution needed
    if (extraction.parseErrors.length > 0) {
      resolvedExtractions.push(extraction);
      continue;
    }

    // Resolve each specifier from internalImports
    const internalImports = new Set<string>();
    const externalImports = new Set<string>();
    const unresolvedInternalImports = new Set<string>();

    for (const specifier of extraction.internalImports) {
      const resolved = parser.resolveImport(specifier, file, discoveredFiles);
      if (resolved.resolved !== null) {
        internalImports.add(resolved.resolved);
      } else if (resolved.unresolvedKind === "unresolved-internal") {
        unresolvedInternalImports.add(specifier);
      } else {
        externalImports.add(specifier);
      }
    }

    // Produce the resolved extraction with correct internal/external split
    resolvedExtractions.push({
      path: extraction.path,
      lineCount: extraction.lineCount,
      internalImports: [...internalImports].sort(),
      externalImports: [...externalImports].sort(),
      unresolvedInternalImports: [...unresolvedInternalImports].sort(),
      parseErrors: extraction.parseErrors,
      capabilitiesUsed: extraction.capabilitiesUsed,
    });
  }

  return {
    extractions: resolvedExtractions,
    skippedFiles,
  };
}

// ---------------------------------------------------------------------------
// Legacy Adapter
// ---------------------------------------------------------------------------

/**
 * Convert an ExtractionResult to the legacy shape consumed by
 * the existing pipeline (buildGraph, clusterByFolder, etc.).
 *
 * This adapter maps:
 *   - Successfully parsed RawExtractions → SourceFileAnalysis[]
 *   - Failed RawExtractions (with parseErrors) → ParseError[]
 *
 * The conversion is deterministic and produces output identical to
 * the legacy extractImports() function for the same input.
 *
 * Sorting:
 *   - imports are sorted alphabetically (matching legacy behavior)
 *   - externalImports are sorted alphabetically (matching legacy behavior)
 *   - parseErrors messages are joined with "; " (matching legacy behavior)
 *
 * @param result - The ExtractionResult from extractAll()
 * @returns Legacy-compatible result for the existing pipeline
 */
export function toLegacyResult(result: ExtractionResult): LegacyExtractionResult {
  const files: SourceFileAnalysis[] = [];
  const parseErrors: ParseError[] = [];

  for (const extraction of result.extractions) {
    if (extraction.parseErrors.length > 0) {
      // Files with parse errors → legacy ParseError entries
      // The legacy pipeline joined all diagnostic messages with "; "
      parseErrors.push({
        filePath: extraction.path,
        message: extraction.parseErrors.map((e) => e.message).join("; "),
      });
    } else {
      // Successfully parsed files → SourceFileAnalysis entries
      files.push({
        filePath: extraction.path,
        lineCount: extraction.lineCount,
        imports: [...extraction.internalImports],
        externalImports: [...extraction.externalImports],
      });
    }
  }

  return { files, parseErrors };
}
