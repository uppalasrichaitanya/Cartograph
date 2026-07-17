/**
 * Phase 7 Determinism Test — Same Input → Identical RepositoryIR
 *
 * Verifies that the IR pipeline is fully deterministic: given the same
 * source files, two independent runs produce byte-identical RepositoryIR
 * output (excluding the `generatedAt` timestamp, which is isolated metadata).
 *
 * This is a core architectural invariant — determinism failures indicate
 * a bug in the identity service, builder, or resolution pipeline.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractImports } from "@/lib/analysis/extractImports";
import { buildRepositoryIR } from "@/lib/analysis/ir/bridge";
import type { ProjectFile } from "@/lib/analysis/resolveAliases";
import type { RepositoryIR } from "@/lib/analysis/ir/types";

/**
 * Strip the generatedAt timestamp for determinism comparison.
 * generatedAt is isolated metadata (ISO 8601 timestamp), not a
 * deterministic output of the pipeline.
 */
function stripTimestamp(ir: RepositoryIR): Omit<RepositoryIR, "generatedAt"> {
  const { generatedAt, ...rest } = ir;
  return rest;
}

test("Determinism — same input produces identical RepositoryIR", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-determinism-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "test-determinism" }),
    );
    await writeFile(
      path.join(root, "src", "a.ts"),
      'import { b } from "./b";\nexport const a = 1;',
    );
    await writeFile(
      path.join(root, "src", "b.ts"),
      'import lodash from "lodash";\nexport const b = 2;',
    );

    const files: ProjectFile[] = [
      { absolutePath: path.join(root, "src", "a.ts"), filePath: "src/a.ts" },
      { absolutePath: path.join(root, "src", "b.ts"), filePath: "src/b.ts" },
    ];

    // Run 1
    const extraction1 = await extractImports(root, files);
    const ir1 = buildRepositoryIR(root, extraction1.files) as RepositoryIR;
    assert.ok(ir1, "First run should produce IR");

    // Run 2 — identical input
    const extraction2 = await extractImports(root, files);
    const ir2 = buildRepositoryIR(root, extraction2.files) as RepositoryIR;
    assert.ok(ir2, "Second run should produce IR");

    // Strip timestamps and compare
    const stripped1 = stripTimestamp(ir1);
    const stripped2 = stripTimestamp(ir2);

    // Byte-identical JSON comparison (excluding generatedAt)
    const json1 = JSON.stringify(stripped1);
    const json2 = JSON.stringify(stripped2);
    assert.equal(json1, json2, "Two runs with identical input must produce byte-identical IR");

    // Verify specific ID stability
    assert.equal(ir1.roots[0].id, ir2.roots[0].id, "Root IDs must be stable");
    assert.equal(ir1.roots[0].fingerprint, ir2.roots[0].fingerprint, "Root fingerprints must be stable");

    const files1 = ir1.nodes.filter((n) => n.kind === "File");
    const files2 = ir2.nodes.filter((n) => n.kind === "File");
    assert.equal(files1.length, files2.length);

    for (let i = 0; i < files1.length; i++) {
      assert.equal(files1[i].id, files2[i].id, `File NodeId for ${files1[i].id} must be stable`);
    }

    // Edge ID stability
    for (let i = 0; i < ir1.edges.length; i++) {
      assert.equal(ir1.edges[i].id, ir2.edges[i].id, `EdgeId at index ${i} must be stable`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Determinism — legacy DependencyGraph output is unchanged by IR integration", async () => {
  // This test verifies that the legacy pipeline produces the same
  // DependencyGraph whether or not the IR is built alongside it.
  // Since buildRepositoryIR is a pure function that reads (not mutates)
  // the pipeline data, this should always hold.
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-compat-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "test-compat" }),
    );
    await writeFile(
      path.join(root, "src", "main.ts"),
      'import { util } from "./util";\nexport const main = 1;',
    );
    await writeFile(
      path.join(root, "src", "util.ts"),
      "export const util = 2;",
    );

    const projectFiles: ProjectFile[] = [
      { absolutePath: path.join(root, "src", "main.ts"), filePath: "src/main.ts" },
      { absolutePath: path.join(root, "src", "util.ts"), filePath: "src/util.ts" },
    ];

    const extraction = await extractImports(root, projectFiles);

    // Snapshot the legacy data BEFORE IR construction
    const filesBefore = JSON.stringify(extraction.files);
    const errorsBefore = JSON.stringify(extraction.parseErrors);

    // Build IR
    const ir = buildRepositoryIR(root, extraction.files);
    assert.ok(ir, "IR should be built");

    // Verify legacy data is NOT mutated
    const filesAfter = JSON.stringify(extraction.files);
    const errorsAfter = JSON.stringify(extraction.parseErrors);

    assert.equal(filesBefore, filesAfter, "extractImports output must not be mutated by IR construction");
    assert.equal(errorsBefore, errorsAfter, "parseErrors must not be mutated by IR construction");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
