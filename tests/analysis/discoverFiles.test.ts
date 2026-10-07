import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverSourceFiles } from "@/lib/analysis/discoverFiles";

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-discover-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

async function discovered(files: Record<string, string>): Promise<string[]> {
  const root = await project(files);
  try {
    return (await discoverSourceFiles(root)).map((file) => file.filePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("source directories named env, venv, build and dist deep in the tree are kept", async () => {
  const found = await discovered({
    "package.json": "{}",
    "src/env/data.ts": "export const d = 1;",
    "src/build/real.ts": "export const r = 1;",
    "src/dist/util.ts": "export const u = 1;",
    "lib/venv/index.js": "module.exports = 1;",
    "lib/env/data.js": "module.exports = 1;",
  });
  assert.deepEqual(found, ["lib/env/data.js", "lib/venv/index.js", "src/build/real.ts", "src/dist/util.ts", "src/env/data.ts"]);
});

test("dist and build directly under a package root are build output and are skipped", async () => {
  const found = await discovered({
    "package.json": "{}",
    "index.ts": "export {};",
    "dist/index.js": "module.exports = 1;",
    "build/out.js": "module.exports = 1;",
    "packages/a/package.json": "{}",
    "packages/a/src/a.ts": "export {};",
    "packages/a/dist/a.js": "module.exports = 1;",
  });
  assert.deepEqual(found, ["index.ts", "packages/a/src/a.ts"]);
});

test("a configured tsconfig outDir is skipped wherever it points", async () => {
  const found = await discovered({
    "package.json": "{}",
    "tsconfig.json": JSON.stringify({ compilerOptions: { outDir: "out/compiled" } }),
    "src/a.ts": "export {};",
    "out/compiled/a.js": "module.exports = 1;",
  });
  assert.deepEqual(found, ["src/a.ts"]);
});

test("a build directory without a package root above it is kept", async () => {
  const found = await discovered({
    "package.json": "{}",
    "tools/build/make.js": "module.exports = 1;",
  });
  assert.deepEqual(found, ["tools/build/make.js"]);
});

test("Python virtualenvs are detected by content, whatever they are named", async () => {
  const found = await discovered({
    "app/main.py": "import os",
    "env/pyvenv.cfg": "home = /usr/bin",
    "env/lib/python3.12/site-packages/dep/__init__.py": "",
    "myenv/bin/activate": "# activate",
    "myenv/lib/python3.11/site-packages/dep/__init__.py": "",
    "venv/Scripts/activate.bat": "",
    "venv/Lib/site-packages/dep/__init__.py": "",
    ".venv/lib/python3.12/site-packages/x/__init__.py": "",
  });
  assert.deepEqual(found, ["app/main.py"]);
});

test("a real package named env or venv with no virtualenv markers is kept", async () => {
  const found = await discovered({
    "pyproject.toml": "[project]\nname='x'\n",
    "x/env/settings.py": "A = 1",
    "x/venv/helpers.py": "B = 1",
  });
  assert.deepEqual(found, ["x/env/settings.py", "x/venv/helpers.py"]);
});
