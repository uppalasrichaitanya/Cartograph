import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { buildGraph } from "@/lib/analysis/buildGraph";
import { clusterByFolder } from "@/lib/analysis/clusterByFolder";
import { detectAnomalies } from "@/lib/analysis/detectAnomalies";
import { extractImports } from "@/lib/analysis/extractImports";
import type { ProjectFile } from "@/lib/analysis/resolveAliases";
import { safeUnzip, UnsafeZipError } from "@/lib/safety/safeUnzip";

test("extractImports resolves tsconfig aliases and re-exports", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-test-"));
  try {
    await mkdir(path.join(root, "src", "lib"), { recursive: true });
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }));
    await writeFile(path.join(root, "src", "entry.ts"), 'import { helper } from "@/lib/helper"; export { helper } from "@/lib/helper";');
    await writeFile(path.join(root, "src", "lib", "helper.ts"), "export const helper = 1;");
    const files: ProjectFile[] = [
      { absolutePath: path.join(root, "src", "entry.ts"), filePath: "src/entry.ts" },
      { absolutePath: path.join(root, "src", "lib", "helper.ts"), filePath: "src/lib/helper.ts" },
    ];
    const result = await extractImports(root, files);
    assert.deepEqual(result.parseErrors, []);
    assert.deepEqual(result.files.find((file) => file.filePath === "src/entry.ts")?.imports, ["src/lib/helper.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detectAnomalies finds a directed cycle and an orphan", () => {
  const graph = buildGraph([
    { filePath: "src/a.ts", lineCount: 1, imports: ["src/b.ts"], externalImports: [] },
    { filePath: "src/b.ts", lineCount: 1, imports: ["src/a.ts"], externalImports: [] },
    { filePath: "src/lonely.ts", lineCount: 1, imports: [], externalImports: [] },
  ]);
  clusterByFolder(graph);
  const anomalies = detectAnomalies(graph);
  assert.deepEqual(anomalies.cycles, [["src/a.ts", "src/b.ts", "src/a.ts"]]);
  assert.deepEqual(anomalies.orphans, ["src/lonely.ts"]);
});

test("safeUnzip rejects an archive that exceeds the uncompressed limit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-zip-test-"));
  try {
    const zipPath = path.join(root, "large.zip");
    const zip = new AdmZip();
    zip.addFile("source.ts", Buffer.from("0123456789"));
    zip.writeZip(zipPath);
    await assert.rejects(() => safeUnzip(zipPath, path.join(root, "out"), 9), UnsafeZipError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
