import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { analyzeRepository } from "@/lib/analysis/analyzeRepository";
import { getStorage } from "@/lib/storage";

function fixtureZip(files: Record<string, string>) {
  return async (_source: unknown, destinationPath: string) => {
    const zip = new AdmZip();
    for (const [name, text] of Object.entries(files)) zip.addFile(`demo-HEAD/${name}`, Buffer.from(text));
    zip.writeZip(destinationPath);
    return { bytes: 1 };
  };
}

async function analyse(files: Record<string, string>) {
  return analyzeRepository(
    { github: { owner: "o", repo: "demo", ref: null }, retention: "7d" },
    () => {},
    { downloadGithubArchive: fixtureZip(files) },
  );
}

test("analysis attaches reachability computed from a fixture repository", async () => {
  const result = await analyse({
    "package.json": JSON.stringify({ name: "demo", main: "src/index.ts", dependencies: {} }),
    "src/index.ts": 'import { used } from "./used";\nexport const x = used;\n',
    "src/used.ts": 'import { deep } from "./deep";\nexport const used = deep;\n',
    "src/deep.ts": "export const deep = 1;\n",
    "src/island.ts": 'import { deep } from "./deep";\nexport const island = deep;\n',
    "src/helper.test.ts": 'import { used } from "./used";\nexport const t = used;\n',
    "vitest.config.ts": "export default {};\n",
  });
  try {
    const reach = result.reachability;
    assert.ok(reach, "reachability is attached");
    assert.equal(reach.version, 1);
    assert.deepEqual(reach.unreachable, ["src/island.ts"]);
    const entries = Object.fromEntries(reach.entryPoints.map((e) => [e.path, e.reason]));
    assert.equal(entries["src/index.ts"], 'package.json "main"');
    assert.equal(entries["src/helper.test.ts"], "test file");
    assert.equal(entries["vitest.config.ts"], "config file");
    assert.deepEqual(reach.caveats, []);
    // It is persisted with the analysis.
    const stored = await getStorage().loadAnalysis(result.id);
    assert.deepEqual(stored?.reachability, reach);
  } finally {
    await getStorage().deleteAnalysis(result.id);
  }
});

test("dynamic imports and unresolved internal imports add caveats; no entry points reports nothing", async () => {
  const result = await analyse({
    "lib/a.ts": 'import "./missing";\nexport const load = (n: string) => import("./plugins/" + n);\n',
    "lib/b.ts": "export const b = 1;\n",
  });
  try {
    const reach = result.reachability!;
    assert.deepEqual(reach.entryPoints, []);
    assert.deepEqual(reach.unreachable, []);
    assert.ok(reach.caveats.includes("No entry points recognised, so reachability was not computed"));
  } finally {
    await getStorage().deleteAnalysis(result.id);
  }

  const withEntry = await analyse({
    "index.ts": 'import "./missing";\nexport const load = (n: string) => import("./plugins/" + n);\n',
    "other.ts": "export const b = 1;\n",
  });
  try {
    const reach = withEntry.reachability!;
    assert.deepEqual(reach.unreachable, ["other.ts"]);
    assert.ok(reach.caveats.some((c) => /1 file uses dynamic or non-literal imports/.test(c)));
    assert.ok(reach.caveats.some((c) => /1 internal import could not be resolved/.test(c)));
  } finally {
    await getStorage().deleteAnalysis(withEntry.id);
  }
});

test("Python and Go conventions feed the entry points", async () => {
  const result = await analyse({
    "tool.py": 'from pkg import mod\nif __name__ == "__main__":\n    mod.run()\n',
    "pkg/__init__.py": "",
    "pkg/mod.py": "def run():\n    pass\n",
    "pkg/stale.py": "x = 1\n",
  });
  try {
    const reach = result.reachability!;
    assert.deepEqual(reach.unreachable, ["pkg/stale.py"]);
    assert.equal(reach.entryPoints.find((e) => e.path === "tool.py")?.reason, "Python __main__ guard");
  } finally {
    await getStorage().deleteAnalysis(result.id);
  }
});
