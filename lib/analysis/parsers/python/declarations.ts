import type { Node, Tree } from "./treeSitter";
import type { RawDeclaration, SymbolKind } from "../interface";

function declarationRange(node: Node) {
  return {
    start: { line: node.startPosition.row + 1, column: node.startPosition.column + 1 },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column + 1 },
  };
}

/** Extract Python functions and classes using lexical containment. */
export function extractPythonDeclarations(tree: Tree): RawDeclaration[] {
  const declarations: RawDeclaration[] = [];

  const visit = (
    node: Node,
    parents: readonly string[],
    insideClass: boolean,
  ) => {
    let childParents = parents;
    let childInsideClass = insideClass;

    if (node.type === "class_definition") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const name = nameNode.text;
        declarations.push({
          name,
          qualifiedName: [...parents, name].join("."),
          kind: "class",
          range: declarationRange(node),
        });
        childParents = [...parents, name];
        childInsideClass = true;
      }
    } else if (node.type === "function_definition") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const name = nameNode.text;
        const kind: SymbolKind = insideClass
          ? name === "__init__" ? "constructor" : "method"
          : "function";
        declarations.push({
          name,
          qualifiedName: [...parents, name].join("."),
          kind,
          range: declarationRange(node),
        });
        childParents = [...parents, name];
        childInsideClass = false;
      }
    }

    for (const child of node.namedChildren) {
      if (child) visit(child, childParents, childInsideClass);
    }
  };

  visit(tree.rootNode, [], false);
  return declarations;
}
