import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalyzerRegistry,
  DuplicateAnalyzerError,
  InvalidAnalyzerDependencyError,
} from "@/lib/analysis/analyzers/registry";
import {
  createBuiltInAnalyzerRegistry,
  DEPENDENCY_GRAPH_ANALYZER_ID,
  FOLDER_CLUSTER_ANALYZER_ID,
} from "@/lib/analysis/analyzers/builtins";
import { IRBuilder } from "@/lib/analysis/ir/builder";
import type { Analyzer } from "@/lib/analysis/analyzers/interface";
import type { RawExtraction, RepositoryIR } from "@/lib/analysis/ir/types";
import type { SourceFileAnalysis } from "@/types/graph";

function buildIR(rawFiles: ReadonlyArray<RawExtraction>): RepositoryIR {
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");
  const files = rawFiles.map((raw) => builder.buildFileNode(raw, root));
  return builder.finalize(
    [root, ...files],
    files.map((file) => builder.buildContainmentEdge(file, root)),
    [root],
  );
}

const legacyFiles: SourceFileAnalysis[] = [
  { filePath: "src/a.ts", lineCount: 1, imports: ["src/b.ts"], externalImports: [] },
  { filePath: "src/b.ts", lineCount: 1, imports: [], externalImports: [] },
];

const cleanIR = buildIR([
  {
    path: "src/a.ts",
    lineCount: 1,
    internalImports: ["src/b.ts"],
    externalImports: [],
    parseErrors: [],
    capabilitiesUsed: ["imports", "declarations"],
  },
  {
    path: "src/b.ts",
    lineCount: 1,
    internalImports: [],
    externalImports: [],
    parseErrors: [],
    capabilitiesUsed: ["imports", "declarations"],
  },
]);

test("AnalyzerRegistry runs ordered tiers and exposes earlier results", async () => {
  const events: string[] = [];
  const registry = new AnalyzerRegistry();
  const second: Analyzer<string> = {
    id: "second",
    name: "Second",
    tier: 2,
    dependsOn: ["first"],
    analyze(context) {
      events.push("second");
      return `${context.getResult<string>("first")}:two`;
    },
  };
  const first: Analyzer<string> = {
    id: "first",
    name: "First",
    tier: 1,
    analyze() {
      events.push("first");
      return "one";
    },
  };
  registry.register(second);
  registry.register(first);

  const runs = await registry.run({ files: legacyFiles, repositoryIR: cleanIR });
  assert.deepEqual(events, ["first", "second"]);
  assert.equal(runs.find((run) => run.analyzerId === "second")?.result, "one:two");
  assert.deepEqual(runs.map((run) => run.tier), [1, 2]);
});

test("AnalyzerRegistry rejects duplicate stable IDs", () => {
  const registry = new AnalyzerRegistry();
  const analyzer: Analyzer = { id: "same", name: "Same", tier: 1, analyze: () => null };
  registry.register(analyzer);
  assert.throws(() => registry.register(analyzer), DuplicateAnalyzerError);
});

test("AnalyzerRegistry rejects missing and same-tier dependencies", async () => {
  const missing = new AnalyzerRegistry();
  missing.register({
    id: "consumer",
    name: "Consumer",
    tier: 2,
    dependsOn: ["absent"],
    analyze: () => null,
  });
  await assert.rejects(
    () => missing.run({ files: legacyFiles, repositoryIR: cleanIR }),
    InvalidAnalyzerDependencyError,
  );

  const sameTier = new AnalyzerRegistry();
  sameTier.register({ id: "first", name: "First", tier: 2, analyze: () => null });
  sameTier.register({
    id: "second",
    name: "Second",
    tier: 2,
    dependsOn: ["first"],
    analyze: () => null,
  });
  await assert.rejects(
    () => sameTier.run({ files: legacyFiles, repositoryIR: cleanIR }),
    InvalidAnalyzerDependencyError,
  );
});

test("capability gaps degrade built-ins and propagate to tier 2", async () => {
  const partialIR = buildIR([
    {
      path: "src/a.ts",
      lineCount: 1,
      internalImports: ["src/b.ts"],
      externalImports: [],
      parseErrors: [],
      capabilitiesUsed: ["imports"],
    },
    {
      path: "src/b.ts",
      lineCount: 1,
      internalImports: [],
      externalImports: [],
      parseErrors: [],
      capabilitiesUsed: ["declarations"],
    },
  ]);
  const runs = await createBuiltInAnalyzerRegistry().run({
    files: legacyFiles,
    repositoryIR: partialIR,
  });
  const graph = runs.find((run) => run.analyzerId === DEPENDENCY_GRAPH_ANALYZER_ID);
  const folders = runs.find((run) => run.analyzerId === FOLDER_CLUSTER_ANALYZER_ID);
  assert.equal(graph?.status, "degraded");
  assert.deepEqual(graph?.missingCapabilities, ["imports"]);
  assert.equal(folders?.status, "degraded");
  assert.equal(folders?.provenance.origin, "heuristic");
});

test("skip requirements do not execute and skip dependents", async () => {
  let executed = false;
  const registry = new AnalyzerRegistry();
  registry.register({
    id: "exports-only",
    name: "Exports Only",
    tier: 1,
    requires: [{ capability: "exports", onMissing: "skip" }],
    analyze() {
      executed = true;
      return "unexpected";
    },
  });
  registry.register({
    id: "consumer",
    name: "Consumer",
    tier: 2,
    dependsOn: ["exports-only"],
    analyze: () => "unexpected",
  });
  const runs = await registry.run({ files: legacyFiles, repositoryIR: cleanIR });
  assert.equal(executed, false);
  assert.equal(runs[0].status, "skipped");
  assert.equal(runs[1].status, "skipped");
  assert.equal(runs[0].result, undefined);
  assert.equal(runs[1].result, undefined);
});

test("clean built-in analyzer runs remain derived and deterministic", async () => {
  const registry = createBuiltInAnalyzerRegistry();
  const first = await registry.run({ files: legacyFiles, repositoryIR: cleanIR });
  const second = await createBuiltInAnalyzerRegistry().run({
    files: legacyFiles,
    repositoryIR: cleanIR,
  });
  assert.deepEqual(first, second);
  assert.ok(first.every((run) => run.status === "complete"));
  assert.ok(first.every((run) => run.provenance.origin === "derived"));
});
