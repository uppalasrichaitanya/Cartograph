import assert from "node:assert/strict";
import test from "node:test";
import { buildFolderTree, findFolder, isTestPath } from "@/lib/analysis/folderTree";

test("buildFolderTree nests folders, sorts children, and separates own files", () => {
  const tree = buildFolderTree(["lib/b/x.ts", "lib/a/y.ts", "lib/z.ts", "README.ts"]);
  assert.equal(tree.path, "");
  assert.deepEqual(tree.ownFiles, ["README.ts"]);
  assert.deepEqual(tree.children.map((child) => child.path), ["lib"]);
  const lib = tree.children[0];
  assert.deepEqual(lib.ownFiles, ["lib/z.ts"]);
  assert.deepEqual(lib.children.map((child) => child.path), ["lib/a", "lib/b"]);
  assert.deepEqual(lib.allFiles, ["lib/a/y.ts", "lib/b/x.ts", "lib/z.ts"]);
});

test("buildFolderTree compresses single-child chains with no own files", () => {
  const tree = buildFolderTree([
    "src/main/java/com/acme/App.java",
    "src/main/java/com/acme/util/Strings.java",
  ]);
  assert.equal(tree.children.length, 1);
  const chain = tree.children[0];
  assert.equal(chain.path, "src/main/java/com/acme");
  assert.equal(chain.name, "src/main/java/com/acme");
  assert.deepEqual(chain.children.map((child) => [child.path, child.name]), [["src/main/java/com/acme/util", "util"]]);
});

test("findFolder resolves exact and chain-compressed paths", () => {
  const tree = buildFolderTree(["lib/core/a.ts", "lib/core/b.ts"]);
  assert.equal(findFolder(tree, "lib/core")?.path, "lib/core");
  // `lib` itself was compressed into `lib/core`; asking for it returns the compressed node.
  assert.equal(findFolder(tree, "lib")?.path, "lib/core");
  assert.equal(findFolder(tree, "missing"), null);
  assert.equal(findFolder(tree, "root"), null);
});

test("buildFolderTree is deterministic regardless of input order", () => {
  const paths = ["b/1.ts", "a/2.ts", "a/1.ts", "c.ts"];
  assert.deepEqual(buildFolderTree(paths), buildFolderTree([...paths].reverse()));
});

test("isTestPath matches the conventions the AI evidence already used", () => {
  for (const path of ["tests/a.ts", "src/__tests__/a.ts", "a.test.ts", "a.spec.tsx", "pkg/test_x.py", "x_test.go", "e2e/run.ts"]) {
    assert.equal(isTestPath(path), true, path);
  }
  for (const path of ["src/testing.ts", "lib/contest/a.ts", "latest.ts"]) {
    assert.equal(isTestPath(path), false, path);
  }
});
