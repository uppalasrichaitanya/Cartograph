import assert from "node:assert/strict";
import test from "node:test";
import {
  ArchitectureModel,
  buildArchitectureModel,
  clustersFromArchitectureModel,
} from "@/lib/analysis/architecture-model/model";
import { validateArchitectureModel } from "@/lib/analysis/architecture-model/validation";
import { buildGraph } from "@/lib/analysis/buildGraph";
import { clusterByFolder } from "@/lib/analysis/clusterByFolder";
import { IRBuilder } from "@/lib/analysis/ir/builder";
import type { RawExtraction, RepositoryIR } from "@/lib/analysis/ir/types";
import type { SourceFileAnalysis } from "@/types/graph";

function raw(path: string, withError = false): RawExtraction {
  return {
    path,
    lineCount: 3,
    internalImports: [],
    externalImports: [],
    parseErrors: withError
      ? [{ message: "partial", severity: "partial", reason: "syntax" }]
      : [],
    capabilitiesUsed: ["imports", "declarations"],
  };
}

function buildIR(rawFiles: ReadonlyArray<RawExtraction>): RepositoryIR {
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");
  const files = rawFiles.map((file) => builder.buildFileNode(file, root));
  return builder.finalize(
    [root, ...files],
    files.map((file) => builder.buildContainmentEdge(file, root)),
    [root],
  );
}

const paths = [
  "src/components/a.ts",
  "src/components/b.ts",
  "src/components/c.ts",
  "lib/only.ts",
];
const legacyFiles: SourceFileAnalysis[] = paths.map((filePath) => ({
  filePath,
  lineCount: 3,
  imports: [],
  externalImports: [],
}));

test("Architecture Model indexes roots, folder hierarchy, and display regions", () => {
  const ir = buildIR(paths.map((filePath) => raw(filePath)));
  const data = buildArchitectureModel(ir);
  const model = new ArchitectureModel(data);
  assert.equal(data.modelVersion, 1);
  assert.equal(model.getBoundariesByKind("module-root").length, 1);
  assert.deepEqual(
    model.getBoundariesByKind("folder").map((boundary) => boundary.path),
    ["lib", "src", "src/components"],
  );
  assert.deepEqual(
    model.getBoundariesByKind("region").map((boundary) => boundary.name),
    ["other", "src/components"],
  );
  const componentFile = ir.nodes.find(
    (node) => node.kind === "File" && node.path === "src/components/a.ts",
  );
  assert.ok(componentFile && componentFile.kind === "File");
  assert.deepEqual(
    model.getContainingBoundaries(componentFile.id).map((boundary) => boundary.kind),
    ["module-root", "folder", "folder", "region"],
  );
  assert.equal(
    model.getBoundary(model.getBoundariesByKind("region")[0].id)?.name,
    "other",
  );
});

test("Architecture Model regions reproduce legacy folder grouping", () => {
  const ir = buildIR(paths.map((filePath) => raw(filePath)));
  const oldGraph = buildGraph(legacyFiles);
  const expected = clusterByFolder(oldGraph);
  const newGraph = buildGraph(legacyFiles);
  const actual = clustersFromArchitectureModel(
    buildArchitectureModel(ir),
    newGraph,
    ir,
  );
  assert.deepEqual(actual, expected);
  assert.deepEqual(
    newGraph.nodes.map((node) => [node.path, node.folder]),
    oldGraph.nodes.map((node) => [node.path, node.folder]),
  );
});

test("Architecture Model output is byte-identical across repeated builds", () => {
  const ir = buildIR(paths.map((filePath) => raw(filePath)));
  assert.equal(
    JSON.stringify(buildArchitectureModel(ir)),
    JSON.stringify(buildArchitectureModel(ir)),
  );
});

test("boundary provenance never upgrades a heuristic file", () => {
  const ir = buildIR([
    raw("src/components/a.ts", true),
    raw("src/components/b.ts"),
    raw("src/components/c.ts"),
  ]);
  const model = buildArchitectureModel(ir);
  const folder = model.boundaries.find(
    (boundary) => boundary.kind === "folder" && boundary.path === "src/components",
  );
  const region = model.boundaries.find(
    (boundary) => boundary.kind === "region" && boundary.path === "src/components",
  );
  assert.equal(folder?.provenance.origin, "heuristic");
  assert.equal(region?.provenance.origin, "heuristic");
  assert.match(folder?.provenance.note ?? "", /reduced provenance/);
});

test("Architecture Model validation rejects unknown contained node IDs", () => {
  const ir = buildIR([raw("src/a.ts")]);
  const model = buildArchitectureModel(ir);
  const corrupted = {
    ...model,
    boundaries: model.boundaries.map((boundary, index) =>
      index === 0
        ? { ...boundary, containedNodeIds: ["not-a-node"] }
        : boundary,
    ),
  };
  assert.throws(() => validateArchitectureModel(corrupted as never, ir), /unknown file node/);
});
