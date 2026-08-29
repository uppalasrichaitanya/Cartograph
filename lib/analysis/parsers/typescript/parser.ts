/**
 * TypeScript/JavaScript Parser Plugin — LanguageParser Implementation
 *
 * Implements the `LanguageParser` interface for TypeScript and JavaScript
 * source files (.ts, .tsx, .js, .jsx).
 *
 * Extracted as part of Milestone 2, Phase 3 (TypeScript Parser Extraction).
 * The parsing and resolution behavior is identical to the legacy
 * `extractImports.ts` + `resolveAliases.ts` implementation.
 *
 * Key differences from the legacy implementation:
 *   - Returns `RawExtraction` directly (not `SourceFileAnalysis`)
 *   - Produces real `IRParseError` with line, column, and severity
 *     (instead of flat `{ filePath, message }`)
 *   - Resolution is internal (via resolveImport()) rather than
 *     interleaved with parsing
 *   - Lifecycle-managed: initialize() reads config, dispose() clears cache
 *
 * Design:
 *   - parseFile() NEVER throws — parse failures become RawExtractions
 *     with populated parseErrors and empty import lists.
 *   - resolveImport() NEVER throws — unresolvable imports return
 *     { resolved: null, raw: specifier }.
 *   - Initialize reads tsconfig.json/jsconfig.json once per analysis run.
 *   - The TS compiler API is used for parsing (createSourceFile) and
 *     diagnostics (transpileModule), same as the legacy pipeline.
 *
 * @module lib/analysis/parsers/typescript/parser
 */

import ts from "typescript";
import type {
  LanguageParser,
  ParseFileInput,
  ParserInitContext,
  ResolvedSpecifier,
  RawExtraction,
  IRParseError,
} from "../interface";
import {
  readAliasConfig,
  resolveSpecifier,
  buildFileLookupMap,
  type AliasConfig,
} from "./resolve";

// ---------------------------------------------------------------------------
// AST Walking
// ---------------------------------------------------------------------------

/**
 * Collect all import/export module specifiers from a TypeScript AST.
 *
 * Walks the AST and extracts string literal specifiers from:
 *   - import declarations: `import { x } from "y"`
 *   - export declarations: `export { x } from "y"`
 *
 * Uses a Set to deduplicate specifiers (same file may import from
 * the same module multiple times with different bindings).
 *
 * Logic is identical to the legacy `extractImports.collectModuleSpecifiers()`.
 *
 * @param sourceFile - The parsed TypeScript source file AST
 * @returns Array of unique module specifier strings
 */
function collectModuleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers = new Set<string>();
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers];
}

// ---------------------------------------------------------------------------
// Diagnostic Conversion
// ---------------------------------------------------------------------------

/**
 * Convert TypeScript diagnostics into IRParseError entries.
 *
 * This is new in the parser plugin — the legacy pipeline captured
 * diagnostics as flat `{ filePath, message }` strings. The parser
 * plugin produces richer structured errors with:
 *   - line/column (from the diagnostic's position in the source file)
 *   - severity: 'fatal' (since TS transpileModule diagnostics indicate
 *     the file cannot be reliably parsed)
 *   - reason: 'syntax' (these are TS syntax/semantic errors)
 *
 * @param diagnostics - TS diagnostics from transpileModule
 * @param sourceFile - The source file for position resolution
 * @returns Array of IRParseError entries
 */
function diagnosticsToParseErrors(
  diagnostics: readonly ts.Diagnostic[],
  sourceFile: ts.SourceFile,
): IRParseError[] {
  return diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");

    // Extract line/column if the diagnostic has a position
    let line: number | undefined;
    let column: number | undefined;
    if (diagnostic.start !== undefined) {
      const pos = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
      line = pos.line + 1;       // TS uses 0-based lines
      column = pos.character + 1; // TS uses 0-based characters
    }

    return {
      message,
      line,
      column,
      severity: "fatal" as const,
      reason: "syntax" as const,
    };
  });
}

// ---------------------------------------------------------------------------
// TypeScript Parser
// ---------------------------------------------------------------------------

/**
 * TypeScript/JavaScript parser plugin.
 *
 * Handles .ts, .tsx, .js, and .jsx files. Uses the TypeScript compiler
 * API for parsing and diagnostics, and tsconfig.json/jsconfig.json
 * path aliases for import resolution.
 */
export class TypeScriptParser implements LanguageParser {
  readonly id = "typescript";
  readonly name = "TypeScript/JavaScript";
  readonly language = "typescript" as const;
  readonly extensions = ["ts", "tsx", "js", "jsx"] as const;
  readonly capabilities = ["imports"] as const;

  /** Alias config read during initialize(). Cleared on dispose(). */
  private aliasConfig: AliasConfig | null = null;

  /** Project root cached during initialize(). */
  private projectRoot: string | null = null;

  /** File lookup map built from known files during resolution. */
  private fileLookupMap: Map<string, ParseFileInput> | null = null;

  // ---- Interface Methods ----

  canHandle(extension: string): boolean {
    return (this.extensions as readonly string[]).includes(extension);
  }

  async initialize(context: ParserInitContext): Promise<void> {
    this.projectRoot = context.projectRoot;
    this.aliasConfig = readAliasConfig(context.projectRoot);
    this.fileLookupMap = buildFileLookupMap(context.discoveredFiles);
  }

  parseFile(file: ParseFileInput, content: string): RawExtraction {
    try {
      // Parse the file into an AST
      const sourceFile = ts.createSourceFile(
        file.absolutePath,
        content,
        ts.ScriptTarget.Latest,
        true,
      );

      // Check for diagnostics — matches legacy behavior where
      // transpileModule diagnostics cause the file to be skipped
      const diagnostics = ts.transpileModule(content, {
        compilerOptions: { allowJs: true, target: ts.ScriptTarget.Latest },
        fileName: file.absolutePath,
        reportDiagnostics: true,
      }).diagnostics ?? [];

      if (diagnostics.length > 0) {
        // File has errors — return extraction with parseErrors and
        // empty imports (matches legacy behavior: `continue` on errors)
        return {
          path: file.relativePath,
          lineCount: content.split(/\r?\n/).length,
          internalImports: [],
          externalImports: [],
          parseErrors: diagnosticsToParseErrors(diagnostics, sourceFile),
          capabilitiesUsed: ["imports"],
        };
      }

      // Collect all import/export specifiers from the AST
      const specifiers = collectModuleSpecifiers(sourceFile);

      return {
        path: file.relativePath,
        lineCount: content.split(/\r?\n/).length,
        internalImports: specifiers,
        externalImports: [],
        capabilitiesUsed: ["imports"],
        parseErrors: [],
      };
    } catch (error) {
      // Unexpected error — return extraction with error info
      // Matches legacy behavior: catch block produces a parse error
      return {
        path: file.relativePath,
        lineCount: content.split(/\r?\n/).length,
        internalImports: [],
        externalImports: [],
        parseErrors: [
          {
            message: error instanceof Error ? error.message : "Unable to parse file",
            severity: "fatal",
            reason: "unknown",
          },
        ],
        capabilitiesUsed: ["imports"],
      };
    }
  }

  resolveImport(
    specifier: string,
    fromFile: ParseFileInput,
    knownFiles: ReadonlyArray<ParseFileInput>,
  ): ResolvedSpecifier {
    void knownFiles;
    if (!this.aliasConfig || !this.projectRoot || !this.fileLookupMap) {
      // Not initialized — cannot resolve. This should never happen
      // if the lifecycle is followed correctly.
      return { resolved: null, raw: specifier };
    }

    return resolveSpecifier(
      specifier,
      fromFile,
      this.aliasConfig,
      this.fileLookupMap,
      this.projectRoot,
    );
  }

  dispose(): void {
    this.aliasConfig = null;
    this.projectRoot = null;
    this.fileLookupMap = null;
  }
}
