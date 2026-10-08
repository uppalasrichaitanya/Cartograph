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
import { extractTypeScriptDeclarations } from "./declarations";

// ---------------------------------------------------------------------------
// Scope Analysis for `require`
// ---------------------------------------------------------------------------

/** Find `name` among the identifiers a binding name introduces. */
function bindingOf(binding: ts.BindingName, name: string): ts.Node | undefined {
  if (ts.isIdentifier(binding)) return binding.text === name ? binding : undefined;
  for (const element of binding.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const found = bindingOf(element.name, name);
    if (found) return found;
  }
  return undefined;
}

/** The declaration of `name` made by one statement, if it makes one. */
function declarationInStatement(statement: ts.Node, name: string): ts.Node | undefined {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.find((d) => bindingOf(d.name, name));
  }
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) {
    return statement;
  }
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause?.name?.text === name) return clause;
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) return bindings;
    if (bindings && ts.isNamedImports(bindings)) return bindings.elements.find((e) => e.name.text === name);
  }
  if (ts.isImportEqualsDeclaration(statement) && statement.name.text === name) return statement;
  return undefined;
}

/** `var` declarations hoist to the enclosing function: search nested blocks, not nested functions. */
function hoistedVarIn(node: ts.Node, name: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (child: ts.Node) => {
    if (found || ts.isFunctionLike(child) || ts.isClassLike(child)) return;
    if (ts.isVariableDeclaration(child) && ts.isVariableDeclarationList(child.parent)) {
      const list = child.parent;
      if (!(list.flags & ts.NodeFlags.BlockScoped) && bindingOf(child.name, name)) {
        found = child;
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/**
 * The nearest declaration of `name` visible from `from`, or undefined when
 * the name is not bound in this file (a free variable: for `require`, the
 * CommonJS loader).
 */
function findBinding(from: ts.Node, name: string): ts.Node | undefined {
  for (let scope: ts.Node | undefined = from.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        if (bindingOf(parameter.name, name)) return parameter;
      }
      if (ts.isFunctionExpression(scope) && scope.name?.text === name) return scope;
      const body = (scope as ts.FunctionLikeDeclaration).body;
      if (body) {
        const hoisted = hoistedVarIn(body, name);
        if (hoisted) return hoisted;
      }
    }
    if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope)) {
      for (const statement of scope.statements) {
        const declared = declarationInStatement(statement, name);
        if (declared) return declared;
      }
      if (ts.isSourceFile(scope)) {
        const hoisted = hoistedVarIn(scope, name);
        if (hoisted) return hoisted;
      }
    }
    if (ts.isCaseBlock(scope)) {
      for (const clause of scope.clauses) {
        for (const statement of clause.statements) {
          const declared = declarationInStatement(statement, name);
          if (declared) return declared;
        }
      }
    }
    if (
      (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
      scope.initializer &&
      ts.isVariableDeclarationList(scope.initializer)
    ) {
      const declared = scope.initializer.declarations.find((d) => bindingOf(d.name, name));
      if (declared) return declared;
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration && bindingOf(scope.variableDeclaration.name, name)) {
      return scope.variableDeclaration;
    }
  }
  return undefined;
}

/** `createRequire(...)` or `module.createRequire(...)`: a genuine require factory. */
function isCreateRequireCall(node: ts.Expression | undefined): boolean {
  if (!node || !ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === "createRequire";
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "createRequire";
}

/**
 * Is this call a genuine CommonJS require?
 *
 *   - `require(...)` with `require` unbound in the file: the module loader.
 *   - `X(...)` where X is declared as `const X = createRequire(...)`: a
 *     require function created for ESM (including the idiomatic
 *     `const require = createRequire(import.meta.url)`).
 *
 * A `require` bound any other way (parameter, local variable, function,
 * import) is some other function, as in webpack/UMD wrappers, so it names no
 * file. `module.require(...)` is deliberately not captured.
 */
function isRequireCall(call: ts.CallExpression): boolean {
  if (!ts.isIdentifier(call.expression)) return false;
  const name = call.expression.text;
  const binding = findBinding(call, name);
  if (binding === undefined) return name === "require";
  return ts.isVariableDeclaration(binding) && isCreateRequireCall(binding.initializer);
}

// ---------------------------------------------------------------------------
// AST Walking
// ---------------------------------------------------------------------------

/**
 * Collect all import/export module specifiers from a TypeScript AST.
 *
 * Walks the AST and extracts string literal specifiers from:
 *   - import declarations: `import { x } from "y"`
 *   - export declarations: `export { x } from "y"`, `export * from "y"`
 *   - TS import-equals: `import x = require("y")`
 *   - CommonJS require calls with a literal argument: `require("y")`
 *     in any position (`const x = require(..)`, destructuring,
 *     `module.exports = require(..)`, a bare side-effect statement), and
 *     calls through a `createRequire(..)` alias
 *   - dynamic `import("y")` with a literal first argument (an optional
 *     second argument, import attributes, is ignored)
 *
 * An argument that is not a literal (a variable, a concatenation, a template
 * with substitutions) names no file the source can prove, so it contributes
 * nothing: never a guessed edge. `require.resolve(..)` is a property access,
 * not a require call, and is likewise ignored. Comments and string contents
 * are never AST call nodes, so text like "require('./x')" in them is ignored.
 *
 * Uses a Set to deduplicate specifiers (same file may import from
 * the same module multiple times with different bindings).
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
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.add(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1 && ts.isStringLiteralLike(node.arguments[0])) {
      // isStringLiteralLike admits only 'x', "x" and a template with no
      // substitutions; a template with ${} is a TemplateExpression.
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if (isDynamicImport || (node.arguments.length === 1 && isRequireCall(node))) {
        specifiers.add(node.arguments[0].text);
      }
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
 * Handles .ts, .tsx, .js, .jsx and the explicit-module-format variants
 * .mjs, .cjs, .mts and .cts files. Uses the TypeScript compiler
 * API for parsing and diagnostics, and tsconfig.json/jsconfig.json
 * path aliases for import resolution.
 */
export class TypeScriptParser implements LanguageParser {
  readonly id = "typescript";
  readonly name = "TypeScript/JavaScript";
  readonly language = "typescript" as const;
  readonly extensions = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"] as const;
  readonly capabilities = ["imports", "declarations"] as const;

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
          capabilitiesUsed: ["imports", "declarations"],
          declarations: extractTypeScriptDeclarations(sourceFile),
        };
      }

      // Collect all import/export specifiers from the AST
      const specifiers = collectModuleSpecifiers(sourceFile);

      return {
        path: file.relativePath,
        lineCount: content.split(/\r?\n/).length,
        internalImports: specifiers,
        externalImports: [],
        capabilitiesUsed: ["imports", "declarations"],
        declarations: extractTypeScriptDeclarations(sourceFile),
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
        capabilitiesUsed: ["imports", "declarations"],
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
