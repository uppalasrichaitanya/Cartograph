import test from "node:test";
import assert from "node:assert/strict";
import { IRBuilder } from "@/lib/analysis/ir/builder";
import { inferArchitectureViews } from "@/lib/analysis/architecture-model/inference";
import type { RawExtraction } from "@/lib/analysis/ir/types";

function makeIR() {
  const builder = new IRBuilder();
  const root = builder.buildModuleRoot("", "typescript", "package.json");
  const raws: RawExtraction[] = [
    { path: "src/orders/service.ts", lineCount: 1, internalImports: [], externalImports: [], parseErrors: [], capabilitiesUsed: ["imports"] },
    { path: "src/orders/ui.ts", lineCount: 1, internalImports: [], externalImports: [], parseErrors: [], capabilitiesUsed: ["imports"] },
    { path: "src/shared/logger.ts", lineCount: 1, internalImports: [], externalImports: [], parseErrors: [], capabilitiesUsed: ["imports"] },
  ];
  const files = raws.map((raw) => builder.buildFileNode(raw, root));
  return { ir: builder.finalize([root, ...files], files.map((file) => builder.buildContainmentEdge(file, root)), [root]), files };
}

test("heuristic architecture views are deterministic and provenance-marked", () => {
  const { ir } = makeIR();
  const first = inferArchitectureViews(ir);
  const second = inferArchitectureViews(ir);
  assert.deepEqual(first, second);
  assert.ok(first.groups.length > 0);
  assert.ok(first.groups.every((group) => group.provenance.origin === "heuristic"));
  assert.ok(first.groups.every((group) => /may be wrong/.test(group.provenance.note ?? "")));
});

test("explicit overrides are user-defined and take precedence", () => {
  const { ir, files } = makeIR();
  const target = files[0].id;
  const inferred = inferArchitectureViews(ir, { layerByNodeId: { [target]: "custom-layer" } });
  const group = inferred.groups.find((item) => item.name === "custom-layer");
  assert.ok(group);
  assert.equal(group.provenance.origin, "user-defined");
  assert.ok(group.memberNodeIds.includes(target));
});
