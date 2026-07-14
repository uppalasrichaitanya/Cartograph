import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildGraph } from "./buildGraph";
import { clusterByFolder } from "./clusterByFolder";
import { detectAnomalies } from "./detectAnomalies";
import { detectRepoMeta } from "./detectRepoMeta";
import { discoverSourceFiles, findProjectRoot } from "./discoverFiles";
import { extractImports } from "./extractImports";
import { prepareRenderData } from "./prepareRenderData";
import { safeUnzip } from "@/lib/safety/safeUnzip";
import { deleteUpload, saveAnalysis } from "@/lib/storage/local";
import type { AnalysisResult } from "@/types/graph";

export type ProgressPhase = "validating" | "unzipping" | "parsing" | "clustering" | "detecting" | "layout" | "persisting";
export type ProgressReporter = (phase: ProgressPhase, detail: string) => void | Promise<void>;

export class AnalysisError extends Error {}

export type AnalysisOptions = {
  zipPath: string;
  repoName?: string;
  repoSizeBytes?: number;
};

export async function analyzeRepository(
  optionsOrPath: string | AnalysisOptions,
  report: ProgressReporter = () => {},
): Promise<AnalysisResult> {
  const options: AnalysisOptions =
    typeof optionsOrPath === "string" ? { zipPath: optionsOrPath } : optionsOrPath;
  const { zipPath, repoName = "Untitled Repository", repoSizeBytes = null } = options;

  await report("validating", "Checking the uploaded archive");

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "cartograph-"));
  try {
    const extractionDirectory = path.join(temporaryDirectory, "repository");
    await report("unzipping", "Safely extracting the archive");
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

    const repoMeta = await detectRepoMeta(projectRoot, graph, clusters, repoName, repoSizeBytes);

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
      repoMeta,
    };
    await report("persisting", "Saving the shareable diagram");
    await saveAnalysis(result);
    return result;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    // Clean up the uploaded zip file.
    await deleteUpload(zipPath);
  }
}
