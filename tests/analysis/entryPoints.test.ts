import assert from "node:assert/strict";
import test from "node:test";
import { findEntryPoints, findEntryPointsDetailed } from "@/lib/analysis/entryPoints";

/** Builds the input from a map of path -> contents. Manifests are the
 *  package.json / pyproject.toml entries; everything else is a source file. */
function run(tree: Record<string, string>) {
  const manifestPaths = Object.keys(tree).filter((p) => /(^|\/)(package\.json|pyproject\.toml|go\.mod)$/.test(p));
  const files = Object.keys(tree).filter((p) => !manifestPaths.includes(p));
  return findEntryPoints({ files, manifestPaths, read: (p) => tree[p] });
}
const paths = (tree: Record<string, string>) => run(tree).map((e) => e.path);
const reasonOf = (tree: Record<string, string>, file: string) => run(tree).find((e) => e.path === file)?.reason;

test("package.json main, module and types map to files; .d.ts targets are skipped", () => {
  const tree = {
    "package.json": JSON.stringify({ main: "./lib/a.js", module: "lib/b.js", types: "lib/c.d.ts" }),
    "lib/a.js": "", "lib/b.js": "", "lib/c.d.ts": "", "lib/other.js": "",
  };
  assert.deepEqual(paths(tree), ["lib/a.js", "lib/b.js"]);
  assert.equal(reasonOf(tree, "lib/a.js"), 'package.json "main"');
  assert.equal(reasonOf(tree, "lib/b.js"), 'package.json "module"');
});

test("package.json types pointing at a real source file is an entry", () => {
  const tree = { "package.json": JSON.stringify({ types: "src/types.ts" }), "src/types.ts": "" };
  assert.deepEqual(paths(tree), ["src/types.ts"]);
  assert.equal(reasonOf(tree, "src/types.ts"), 'package.json "types"');
});

test("package.json bin accepts a string or an object", () => {
  assert.deepEqual(paths({ "package.json": JSON.stringify({ bin: "bin/cli.js" }), "bin/cli.js": "" }), ["bin/cli.js"]);
  const tree = {
    "package.json": JSON.stringify({ bin: { a: "tools/a.js", b: "tools/b.js" } }),
    "tools/a.js": "", "tools/b.js": "", "tools/c.js": "",
  };
  assert.deepEqual(paths(tree), ["tools/a.js", "tools/b.js"]);
  assert.equal(reasonOf(tree, "tools/a.js"), 'package.json "bin"');
});

test("package.json exports: every string leaf, any condition, nested", () => {
  const tree = {
    "package.json": JSON.stringify({
      exports: { ".": { import: "./esm/index.js", require: { default: "./cjs/index.js" } }, "./x": "./x.js" },
    }),
    "esm/index.js": "", "cjs/index.js": "", "x.js": "", "y.js": "",
  };
  assert.deepEqual(paths(tree), ["cjs/index.js", "esm/index.js", "x.js"]);
  assert.equal(reasonOf(tree, "x.js"), 'package.json "exports" ("./x")');
});

test("exports wildcards seed nothing: a pattern is reported, never expanded", () => {
  const tree = { "package.json": JSON.stringify({ exports: { "./*": "./src/*.js" } }), "src/a.js": "", "src/b.js": "", "other.js": "" };
  assert.deepEqual(paths(tree), []);
  const detailed = findEntryPointsDetailed({ files: ["src/a.js", "src/b.js", "other.js"], manifestPaths: ["package.json"], read: () => tree["package.json"] });
  assert.deepEqual(detailed.wildcardExports, [{ key: "./*", target: "src/*.js" }]);
});

test("dist/build targets map back to a source twin; unmatched targets are ignored", () => {
  const tree = {
    "package.json": JSON.stringify({ main: "dist/index.js", bin: "build/cli.js", module: "dist/missing.js" }),
    "src/index.ts": "", "src/cli.tsx": "", "src/other.ts": "",
  };
  assert.deepEqual(paths(tree), ["src/cli.tsx", "src/index.ts"]);
});

test("a built target with the same stem next to the source maps to the .ts twin", () => {
  const tree = { "package.json": JSON.stringify({ main: "lib/index.js" }), "lib/index.ts": "" };
  assert.deepEqual(paths(tree), ["lib/index.ts"]);
});

test("nested package roots resolve targets relative to their package.json", () => {
  const tree = {
    "packages/core/package.json": JSON.stringify({ main: "src/index.ts" }),
    "packages/core/src/index.ts": "",
    "src/index.ts": "",
  };
  const got = run(tree);
  assert.ok(got.find((e) => e.path === "packages/core/src/index.ts" && e.reason === 'packages/core/package.json "main"'));
});

test("a malformed package.json is ignored rather than fatal", () => {
  assert.deepEqual(paths({ "package.json": "{nope", "lib/a.js": "" }), []);
});

test("Next.js app router special files are entries, ordinary files are not", () => {
  const tree = {
    "package.json": "{}",
    "app/page.tsx": "", "app/layout.tsx": "", "app/blog/[slug]/page.tsx": "", "app/api/x/route.ts": "",
    "app/not-found.tsx": "", "app/sitemap.ts": "", "app/opengraph-image.tsx": "",
    "app/components/Button.tsx": "", "app/lib/util.ts": "",
  };
  const got = paths(tree);
  for (const p of ["app/page.tsx", "app/layout.tsx", "app/blog/[slug]/page.tsx", "app/api/x/route.ts", "app/not-found.tsx", "app/sitemap.ts", "app/opengraph-image.tsx"]) {
    assert.ok(got.includes(p), p);
  }
  assert.ok(!got.includes("app/components/Button.tsx"));
  assert.ok(!got.includes("app/lib/util.ts"));
  assert.equal(reasonOf(tree, "app/page.tsx"), "Next.js route (app/page.tsx)");
});

test("Next.js under src/ and in a workspace package; an app folder elsewhere is not a route", () => {
  const tree = {
    "package.json": "{}", "apps/web/package.json": "{}",
    "src/app/page.tsx": "", "apps/web/app/page.tsx": "", "apps/web/pages/index.tsx": "",
    "lib/app/page.ts": "",
  };
  const got = paths(tree);
  assert.ok(got.includes("src/app/page.tsx") && got.includes("apps/web/app/page.tsx") && got.includes("apps/web/pages/index.tsx"));
  assert.ok(!got.includes("lib/app/page.ts"));
});

test("Next.js pages router and middleware/proxy/instrumentation", () => {
  const tree = {
    "package.json": "{}", "pages/index.tsx": "", "pages/api/hello.ts": "", "pages/_app.tsx": "",
    "middleware.ts": "", "src/proxy.ts": "", "instrumentation.ts": "", "lib/middleware.ts": "",
  };
  const got = paths(tree);
  for (const p of ["pages/index.tsx", "pages/api/hello.ts", "pages/_app.tsx", "middleware.ts", "src/proxy.ts", "instrumentation.ts"]) assert.ok(got.includes(p), p);
  assert.ok(!got.includes("lib/middleware.ts"));
  assert.equal(reasonOf(tree, "middleware.ts"), "Next.js middleware (middleware.ts)");
});

test("config files at a package root", () => {
  const tree = {
    "package.json": "{}", "next.config.ts": "", "vite.config.mjs": "", "eslint.config.js": "", "playwright.config.ts": "",
    "foo.config.cjs": "", "src/foo.config.ts": "", "src/regular.ts": "",
  };
  const got = paths(tree);
  for (const p of ["next.config.ts", "vite.config.mjs", "eslint.config.js", "playwright.config.ts", "foo.config.cjs"]) assert.ok(got.includes(p), p);
  assert.ok(!got.includes("src/foo.config.ts"));
  assert.equal(reasonOf(tree, "next.config.ts"), "config file");
});

test("tests, specs, __tests__, top-level test dirs, stories", () => {
  const tree = {
    "src/a.test.ts": "", "src/b.spec.tsx": "", "src/__tests__/c.ts": "", "test/d.js": "", "tests/e/f.ts": "",
    "src/x.stories.tsx": "", "src/testing.ts": "", "src/latest/util.ts": "", "lib/test/sub.ts": "",
  };
  const got = paths(tree);
  for (const p of ["src/a.test.ts", "src/b.spec.tsx", "src/__tests__/c.ts", "test/d.js", "tests/e/f.ts", "src/x.stories.tsx"]) assert.ok(got.includes(p), p);
  assert.ok(!got.includes("src/testing.ts"));
  assert.ok(!got.includes("src/latest/util.ts"));
  assert.ok(!got.includes("lib/test/sub.ts"));
  assert.equal(reasonOf(tree, "src/a.test.ts"), "test file");
  assert.equal(reasonOf(tree, "src/x.stories.tsx"), "Storybook story");
});

test("Python and Go test files", () => {
  const got = paths({ "pkg/test_a.py": "", "pkg/b_test.py": "", "pkg/conftest.py": "", "svc/x_test.go": "", "pkg/attest.py": "", "svc/x.go": "package svc" });
  for (const p of ["pkg/test_a.py", "pkg/b_test.py", "pkg/conftest.py", "svc/x_test.go"]) assert.ok(got.includes(p), p);
  assert.ok(!got.includes("pkg/attest.py") && !got.includes("svc/x.go"));
});

test("scripts/ and bin/ at the top level, conventional roots at the root or src/", () => {
  const tree = {
    "package.json": "{}",
    "scripts/build.ts": "", "bin/run.js": "", "lib/scripts/x.ts": "",
    "index.js": "", "src/main.ts": "", "server.js": "", "src/cli.ts": "", "src/worker.ts": "", "sw.js": "", "src/app.ts": "",
    "src/deep/index.ts": "", "src/utils.ts": "",
  };
  const got = paths(tree);
  for (const p of ["scripts/build.ts", "bin/run.js", "index.js", "src/main.ts", "server.js", "src/cli.ts", "src/worker.ts", "sw.js", "src/app.ts"]) assert.ok(got.includes(p), p);
  for (const p of ["lib/scripts/x.ts", "src/deep/index.ts", "src/utils.ts"]) assert.ok(!got.includes(p), p);
  assert.equal(reasonOf(tree, "scripts/build.ts"), "script (scripts/)");
  assert.equal(reasonOf(tree, "src/main.ts"), "conventional root file");
});

test("Python entry modules: __main__, manage.py, wsgi, and the __main__ guard", () => {
  const tree = {
    "pkg/__main__.py": "", "manage.py": "", "setup.py": "", "site/wsgi.py": "", "site/asgi.py": "",
    "tool.py": 'import sys\nif __name__ == "__main__":\n    main()\n',
    "single.py": "if __name__ == '__main__':\n    pass\n",
    "lib.py": "# mentions the guard only in a comment: if __name__ == '__main__'\nx = 1\n",
    "plain.py": "x = 1\n",
  };
  const got = paths(tree);
  for (const p of ["pkg/__main__.py", "manage.py", "setup.py", "site/wsgi.py", "site/asgi.py", "tool.py", "single.py"]) assert.ok(got.includes(p), p);
  assert.ok(!got.includes("plain.py"));
  assert.ok(!got.includes("lib.py"), "a commented guard is not a guard");
  assert.equal(reasonOf(tree, "tool.py"), "Python __main__ guard");
});

test("pyproject script targets map to module files", () => {
  const tree = {
    "pyproject.toml": '[project]\nname="x"\n[project.scripts]\nx-cli = "x.cli:main"\ny = "x.pkg:run"\n[tool.poetry.scripts]\nz = "x.z:go"\n',
    "src/x/cli.py": "", "src/x/pkg/__init__.py": "", "x/z.py": "", "src/x/other.py": "",
  };
  const got = paths(tree);
  assert.deepEqual(got, ["src/x/cli.py", "src/x/pkg/__init__.py", "x/z.py"]);
  assert.equal(reasonOf(tree, "src/x/cli.py"), "pyproject.toml script");
});

test("Go: files declaring package main", () => {
  const tree = {
    "cmd/app/main.go": "// Package main\npackage main\n\nfunc main() {}\n",
    "lib/lib.go": "package lib\n",
    "lib/note.go": "// package main is elsewhere\npackage lib\n",
  };
  const got = paths(tree);
  assert.deepEqual(got, ["cmd/app/main.go"]);
  assert.equal(reasonOf(tree, "cmd/app/main.go"), "Go package main");
});

test("results are sorted, de-duplicated and keep the first reason", () => {
  const got = run({ "package.json": JSON.stringify({ main: "index.js" }), "index.js": "", "a.test.js": "" });
  assert.deepEqual(got.map((e) => e.path), ["a.test.js", "index.js"]);
  assert.equal(got.find((e) => e.path === "index.js")?.reason, 'package.json "main"');
});

test("runnable examples, demos, sandboxes and benchmarks are entries; same names deeper in are not", () => {
  const tree = {
    "package.json": "{}",
    "examples/mvc/db.js": "", "example/a.js": "", "demo/b.ts": "", "sandbox/server.js": "", "benchmarks/run.ts": "", "playground/p.ts": "",
    "lib/examples/x.js": "",
  };
  const got = paths(tree);
  for (const p of ["examples/mvc/db.js", "example/a.js", "demo/b.ts", "sandbox/server.js", "benchmarks/run.ts", "playground/p.ts"]) assert.ok(got.includes(p), p);
  assert.ok(!got.includes("lib/examples/x.js"));
  assert.equal(reasonOf(tree, "examples/mvc/db.js"), "example or demo (examples/)");
  assert.equal(reasonOf(tree, "benchmarks/run.ts"), "benchmark (benchmarks/)");
});

test("e2e, cypress and __mocks__ are test entries", () => {
  const got = paths({ "e2e/a.ts": "", "cypress/b.ts": "", "src/__mocks__/c.ts": "", "src/e2e/d.ts": "" });
  for (const p of ["e2e/a.ts", "cypress/b.ts", "src/__mocks__/c.ts"]) assert.ok(got.includes(p), p);
  assert.ok(!got.includes("src/e2e/d.ts"));
});

test("task runner and tool config files at a package root", () => {
  const tree = {
    "package.json": "{}", "gulpfile.js": "", "Gruntfile.js": "", "karma.conf.js": "", "gatsby-config.js": "", "gatsby-node.js": "", "jest.setup.ts": "",
    "src/gulpfile.js": "",
  };
  const got = paths(tree);
  for (const p of ["gulpfile.js", "Gruntfile.js", "karma.conf.js", "gatsby-config.js", "gatsby-node.js", "jest.setup.ts"]) assert.ok(got.includes(p), p);
  assert.ok(!got.includes("src/gulpfile.js"));
});


test("a literal export beside a wildcard is still seeded, and a null key excludes", () => {
  const tree = {
    "package.json": JSON.stringify({ exports: { ".": "./lib/index.js", "./unsafe/*": "./lib/*", "./internal/x": null, "./internal/*": null } }),
    "lib/index.js": "", "lib/other.js": "",
  };
  assert.deepEqual(paths(tree), ["lib/index.js"]);
  const detailed = findEntryPointsDetailed({ files: Object.keys(tree).filter((p) => p !== "package.json"), manifestPaths: ["package.json"], read: (p) => tree[p as keyof typeof tree] });
  assert.deepEqual(detailed.wildcardExports, [{ key: "./unsafe/*", target: "lib/*" }]);
});

test("a literal subpath that a null pattern excludes is not seeded", () => {
  const tree = { "package.json": JSON.stringify({ exports: { "./internal/*": null, "./internal/secret": "./lib/secret.js", "./ok": "./lib/ok.js" } }), "lib/secret.js": "", "lib/ok.js": "" };
  assert.deepEqual(paths(tree), ["lib/ok.js"]);
});

test("package.json browser: a string, or an object map with keys and values", () => {
  assert.deepEqual(paths({ "package.json": JSON.stringify({ browser: "lib/web.js" }), "lib/web.js": "" }), ["lib/web.js"]);
  const tree = {
    "package.json": JSON.stringify({ browser: { "./lib/node.js": "./lib/browser.js", "./lib/other.js": false, "fs": false, "./lib/x.js": "./lib/null.js" } }),
    "lib/node.js": "", "lib/browser.js": "", "lib/other.js": "", "lib/x.js": "", "lib/null.js": "", "lib/unrelated.js": "",
  };
  assert.deepEqual(paths(tree), ["lib/browser.js", "lib/node.js", "lib/null.js", "lib/other.js", "lib/x.js"]);
  assert.equal(reasonOf(tree, "lib/browser.js"), 'package.json "browser" map');
});

test("extensionless and directory targets resolve to source files", () => {
  const tree = { "package.json": JSON.stringify({ main: "lib/index", module: "./esm", bin: "tools/cli" }), "lib/index.ts": "", "esm/index.js": "", "tools/cli.mjs": "", "lib/zzz.ts": "" };
  assert.deepEqual(paths(tree), ["esm/index.js", "lib/index.ts", "tools/cli.mjs"]);
});
