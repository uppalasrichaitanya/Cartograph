import ts from "typescript";
import type { RawDeclaration, SymbolKind } from "../interface";

function declarationRange(sourceFile: ts.SourceFile, node: ts.Node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    start: { line: start.line + 1, column: start.character + 1 },
    end: { line: end.line + 1, column: end.character + 1 },
  };
}

function named(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  kind: SymbolKind,
  parents: readonly string[],
): RawDeclaration {
  return {
    name,
    qualifiedName: [...parents, name].join("."),
    kind,
    range: declarationRange(sourceFile, node),
  };
}

/** Extract named declarations in deterministic source order. */
export function extractTypeScriptDeclarations(
  sourceFile: ts.SourceFile,
): RawDeclaration[] {
  const declarations: RawDeclaration[] = [];

  const visit = (node: ts.Node, parents: readonly string[]) => {
    let childParents = parents;

    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      declarations.push(named(sourceFile, node, name, "function", parents));
      childParents = [...parents, name];
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initializer = node.initializer;
      if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        const name = node.name.text;
        declarations.push(named(sourceFile, node, name, "function", parents));
        childParents = [...parents, name];
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      declarations.push(named(sourceFile, node, name, "class", parents));
      childParents = [...parents, name];
    } else if (ts.isInterfaceDeclaration(node)) {
      declarations.push(named(sourceFile, node, node.name.text, "interface", parents));
    } else if (ts.isTypeAliasDeclaration(node)) {
      declarations.push(named(sourceFile, node, node.name.text, "type", parents));
    } else if (ts.isEnumDeclaration(node)) {
      declarations.push(named(sourceFile, node, node.name.text, "enum", parents));
    } else if (ts.isConstructorDeclaration(node)) {
      declarations.push(named(sourceFile, node, "constructor", "constructor", parents));
      childParents = [...parents, "constructor"];
    } else if (ts.isMethodDeclaration(node) && node.name) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
        ? node.name.text
        : node.name.getText(sourceFile);
      declarations.push(named(sourceFile, node, name, "method", parents));
      childParents = [...parents, name];
    }

    ts.forEachChild(node, (child) => visit(child, childParents));
  };

  visit(sourceFile, []);
  return declarations;
}
