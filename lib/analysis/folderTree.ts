// lib/analysis/folderTree.ts
/**
 * The repository's folder hierarchy, as a pure value.
 *
 * Regions and exported diagrams both group files by folder. Building the tree
 * once, with one rule for compression and ordering, keeps those two views
 * from disagreeing about what the repository's folders are.
 *
 * @module lib/analysis/folderTree
 */

export type FolderTreeNode = Readonly<{
  /** Repository-relative folder path; "" for the root. Chain-compressed. */
  path: string;
  /** Path relative to the parent node, e.g. "main/java/com/acme". Empty for the root. */
  name: string;
  children: ReadonlyArray<FolderTreeNode>;
  /** Files directly in this folder, sorted. */
  ownFiles: ReadonlyArray<string>;
  /** Every file under this folder, sorted. */
  allFiles: ReadonlyArray<string>;
}>;

const TEST_PATH = /(^|\/)(tests?|__tests__|specs?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i;

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path);
}

type MutableFolder = { path: string; children: Map<string, MutableFolder>; ownFiles: string[] };

const byPath = (a: string, b: string) => a.localeCompare(b);

export function buildFolderTree(filePaths: ReadonlyArray<string>): FolderTreeNode {
  const root: MutableFolder = { path: "", children: new Map(), ownFiles: [] };
  for (const filePath of filePaths) {
    const segments = filePath.split("/").slice(0, -1).filter((segment) => segment && segment !== ".");
    let folder = root;
    for (const segment of segments) {
      let child = folder.children.get(segment);
      if (!child) {
        child = { path: folder.path ? `${folder.path}/${segment}` : segment, children: new Map(), ownFiles: [] };
        folder.children.set(segment, child);
      }
      folder = child;
    }
    folder.ownFiles.push(filePath);
  }
  return freeze(root, "");
}

function freeze(folder: MutableFolder, parentPath: string): FolderTreeNode {
  let current = folder;
  // A folder holding nothing but one sub-folder is one box, not a stack of
  // empty ones. The root is never compressed: it is the frame, not a folder.
  while (current.path !== "" && current.ownFiles.length === 0 && current.children.size === 1) {
    current = [...current.children.values()][0];
  }
  const children = [...current.children.values()]
    .map((child) => freeze(child, current.path))
    .sort((a, b) => byPath(a.path, b.path));
  const ownFiles = [...current.ownFiles].sort(byPath);
  return {
    path: current.path,
    name: parentPath ? current.path.slice(parentPath.length + 1) : current.path,
    children,
    ownFiles,
    allFiles: [...ownFiles, ...children.flatMap((child) => child.allFiles)].sort(byPath),
  };
}

/**
 * The node for `folderPath`, or the chain-compressed node that swallowed it.
 * Null when no folder with that path exists.
 */
export function findFolder(tree: FolderTreeNode, folderPath: string): FolderTreeNode | null {
  if (!folderPath) return null;
  if (tree.path === folderPath || tree.path.startsWith(`${folderPath}/`)) return tree;
  for (const child of tree.children) {
    const related = child.path === folderPath
      || folderPath.startsWith(`${child.path}/`)
      || child.path.startsWith(`${folderPath}/`);
    if (related) return findFolder(child, folderPath);
  }
  return null;
}
