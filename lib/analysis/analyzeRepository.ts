import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildGraph } from "./buildGraph";
import { clusterByFolder } from "./clusterByFolder";
import { detectAnomalies } from "./detectAnomalies";
import { discoverSourceFiles, findProjectRoot } from "./discoverFiles";
import { extractImports } from "./extractImports";
import { prepareRenderData } from "./prepareRenderData";
import { safeUnzip } from "@/lib/safety/safeUnzip";
import { deleteUploadBlob, saveAnalysis, validateUploadBlob } from "@/lib/storage/blob";
import type { AnalysisResult } from "@/types/graph";

export type ProgressPhase = "validating" | "unzipping" | "parsing" | "clustering" | "detecting" | "layout" | "persisting";
export type ProgressReporter = (phase: ProgressPhase, detail: string) => void | Promise<void>;

export class AnalysisError extends Error {}

async function downloadZip(blobUrl: string, outputPath: string): Promise<void> {
  const response = await fetch(blobUrl, { cache: "no-store" });
  if (!response.ok) throw new AnalysisError("The uploaded zip could not be downloaded.");
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

export async function analyzeRepository(blobUrl: string, report: ProgressReporter = () => {}): Promise<AnalysisResult> {
  await report("validating", "Checking the uploaded archive");
  await validateUploadBlob(blobUrl);

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "cartograph-"));
  try {
    const zipPath = path.join(temporaryDirectory, "repository.zip");
    const extractionDirectory = path.join(temporaryDirectory, "repository");
    await report("unzipping", "Downloading and safely extracting the archive");
    await downloadZip(blobUrl, zipPath);
    await safeUnzip(zipPath, extractionDirectory);

    const projectRoot = await findProjectRoot(extractionDirectory);
    const discoveredFiles = await discoverSourceFiles(projectRoot);
    await report("parsing", `Parsing ${discoveredFiles.length} source files`);
    const { files, parseErrors } = await extractImports(projectRoot, discoveredFiles);
    if (files.length === 0) throw new AnalysisError("No source files could be parsed successfully.");

    const graph = buildGraph(files);
    await report("clustering", "Grouping files into folder layers");
    const clusters = clusterByFolder(graph);
    await report("detecting", "Detecting cycles, dependency hubs, and orphans");
    const anomalies = detectAnomalies(graph);
    await report("layout", "Computing a readable diagram layout");
    const renderData = await prepareRenderData(graph, clusters, anomalies);

    const id = randomUUID();
    const result: AnalysisResult = {
      id,
      createdAt: new Date().toISOString(),
      shareUrl: `/repo/${id}`,
      graph,
      clusters,
      anomalies,
      parseErrors,
      renderData,
    };
    await report("persisting", "Saving the shareable diagram");
    await saveAnalysis(result);
    return result;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    // A one-time Blob upload is not part of the shareable artifact and should not linger in storage.
    await deleteUploadBlob(blobUrl).catch(() => undefined);
  }
}
