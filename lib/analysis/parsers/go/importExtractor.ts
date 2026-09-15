import type { IRParseError } from "../interface";
import type { Node, Tree } from "./treeSitter";

export interface GoImportExtraction { readonly specifiers: string[]; readonly parseErrors: IRParseError[]; }

function quoted(text: string): string | null {
  const match = text.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/);
  return match ? match[1] : null;
}

export function extractImports(tree: Tree): GoImportExtraction {
  const specifiers: string[] = [];
  const seen = new Set<string>();
  const visit = (node: Node) => {
    if (node.type === "import_spec" || node.type === "import_declaration") {
      const value = quoted(node.text);
      if (value && !seen.has(value)) { seen.add(value); specifiers.push(value); }
      if (node.type === "import_declaration") {
        for (const child of node.namedChildren) if (child) visit(child);
      }
      return;
    }
    for (const child of node.namedChildren) if (child) visit(child);
  };
  visit(tree.rootNode);
  const parseErrors: IRParseError[] = [];
  const walkErrors = (node: Node) => {
    if (node.isError) {
      parseErrors.push({
        message: `Syntax error at line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}`,
        line: node.startPosition.row + 1, column: node.startPosition.column + 1,
        severity: "partial", reason: "syntax",
      });
      return;
    }
    if (node.hasError) for (const child of node.children) if (child) walkErrors(child);
  };
  walkErrors(tree.rootNode);
  return { specifiers, parseErrors };
}
