import type { RawDeclaration, SymbolKind } from "../interface";
import type { Node, Tree } from "./treeSitter";

function range(node: Node) {
  return { start: { line: node.startPosition.row + 1, column: node.startPosition.column + 1 }, end: { line: node.endPosition.row + 1, column: node.endPosition.column + 1 } };
}
function name(node: Node, field: string): string | null { return node.childForFieldName(field)?.text ?? null; }

export function extractGoDeclarations(tree: Tree): RawDeclaration[] {
  const result: RawDeclaration[] = [];
  const visit = (node: Node) => {
    let declaration: { name: string; kind: SymbolKind; qualifiedName?: string } | null = null;
    if (node.type === "function_declaration") {
      const value = name(node, "name"); if (value) declaration = { name: value, kind: "function" };
    } else if (node.type === "method_declaration") {
      const value = name(node, "name");
      const receiver = node.childForFieldName("receiver")?.text.replace(/[()]/g, "").trim().split(/\s+/).pop();
      if (value) declaration = { name: value, kind: "method", qualifiedName: receiver ? `${receiver}.${value}` : value };
    } else if (node.type === "type_declaration") {
      for (const child of node.namedChildren) {
        if (!child) continue;
        if (child.type !== "type_spec") continue;
        const value = name(child, "name"); const typeNode = child.childForFieldName("type");
        if (!value) continue;
        const kind: SymbolKind = typeNode?.type === "struct_type" ? "class" : typeNode?.type === "interface_type" ? "interface" : "type";
        result.push({ name: value, qualifiedName: value, kind, range: range(child) });
      }
    }
    if (declaration) result.push({ name: declaration.name, qualifiedName: declaration.qualifiedName ?? declaration.name, kind: declaration.kind, range: range(node) });
    for (const child of node.namedChildren) if (child) visit(child);
  };
  visit(tree.rootNode);
  return result;
}
