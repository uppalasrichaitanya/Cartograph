import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { ParseError, SourceFileAnalysis } from "@/types/graph";
import { readAliasConfig, resolveProjectImport, type ProjectFile } from "./resolveAliases";

export type ExtractionResult = {
  files: SourceFileAnalysis[];
  parseErrors: ParseError[];
};

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

export async function extractImports(
  projectRoot: string,
  discoveredFiles: ProjectFile[],
): Promise<ExtractionResult> {
  const projectFiles = new Map(discoveredFiles.map((file) => [path.normalize(file.absolutePath), file]));
  const config = readAliasConfig(projectRoot);
  const files: SourceFileAnalysis[] = [];
  const parseErrors: ParseError[] = [];

  for (const file of discoveredFiles) {
    try {
      const contents = await readFile(file.absolutePath, "utf8");
      const sourceFile = ts.createSourceFile(file.absolutePath, contents, ts.ScriptTarget.Latest, true);
      const diagnostics = ts.transpileModule(contents, {
        compilerOptions: { allowJs: true, target: ts.ScriptTarget.Latest },
        fileName: file.absolutePath,
        reportDiagnostics: true,
      }).diagnostics ?? [];
      if (diagnostics.length > 0) {
        parseErrors.push({
          filePath: file.filePath,
          message: diagnostics
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))
            .join("; "),
        });
        continue;
      }

      const imports = new Set<string>();
      const externalImports = new Set<string>();
      for (const specifier of collectModuleSpecifiers(sourceFile)) {
        const resolved = resolveProjectImport(
          specifier,
          file.absolutePath,
          config,
          projectFiles,
          projectRoot,
        );
        if (resolved) imports.add(resolved);
        else externalImports.add(specifier);
      }

      files.push({
        filePath: file.filePath,
        lineCount: contents.split(/\r?\n/).length,
        imports: [...imports].sort(),
        externalImports: [...externalImports].sort(),
      });
    } catch (error) {
      parseErrors.push({
        filePath: file.filePath,
        message: error instanceof Error ? error.message : "Unable to parse file",
      });
    }
  }

  return { files, parseErrors };
}
