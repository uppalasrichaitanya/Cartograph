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
import { SafetyEventLog } from "@/lib/safety/eventLog";
import { deleteUpload, saveAnalysis } from "@/lib/storage/local";
import { buildRepositoryIR } from "./ir/bridge";
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

  // --- Phase 6 integration: Safety Event Log ---
  // Create a per-run event log to capture all safety rejections.
  // Passed through to safeUnzip for path/symlink/content recording.
  // Drained after extraction to merge safety events into parseErrors.
  const eventLog = new SafetyEventLog();

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "cartograph-"));
  try {
    const extractionDirectory = path.join(temporaryDirectory, "repository");
    await report("unzipping", "Safely extracting the archive");

    // --- Phase 6 integration: pass event log to safeUnzip ---
    // safeUnzip now returns an ExtractionResult with per-entry details.
    // The event log captures path rejections, symlink rejections, and
    // content-unreadable events during extraction.
    const extractionResult = await safeUnzip(zipPath, extractionDirectory, undefined, eventLog);

    const projectRoot = await findProjectRoot(extractionDirectory);
    const discoveredFiles = await discoverSourceFiles(projectRoot);
    await report("parsing", `Parsing ${discoveredFiles.length} source files`);
    const { files, parseErrors } = await extractImports(projectRoot, discoveredFiles);
    if (files.length === 0) throw new AnalysisError("No source files could be parsed successfully.");

    // --- Phase 6 integration: merge safety events into parseErrors ---
    // Safety events from extraction (path rejections, binary files, etc.)
    // are converted to ParseError entries so they appear in the final
    // AnalysisResult. This ensures rejected files are visible in the
    // output rather than silently missing (per the IR spec's failure
    // handling model).
    const safetyEvents = eventLog.drain();
    const safetyParseErrors = safetyEvents.map((event) => ({
      filePath: event.path,
      message: event.detail,
    }));
    const allParseErrors = [...parseErrors, ...safetyParseErrors];

    const graph = buildGraph(files);
    await report("clustering", "Grouping files into folder layers");
    const clusters = clusterByFolder(graph);
    await report("detecting", "Detecting cycles, dependency hubs, and orphans");
    const anomalies = detectAnomalies(graph);
    await report("layout", "Computing a readable diagram layout");
    const renderData = await prepareRenderData(graph, clusters, anomalies);

    const repoMeta = await detectRepoMeta(projectRoot, graph, clusters, repoName, repoSizeBytes);

    // --- Phase 7 integration: build RepositoryIR alongside the legacy graph ---
    // The IR is built from the same SourceFileAnalysis data the legacy pipeline
    // uses. On success, it's attached to the AnalysisResult for persistence.
    // On failure, it returns null and the legacy pipeline continues unaffected.
    const repositoryIR = buildRepositoryIR(projectRoot, files);

    const id = randomUUID();
    const result: AnalysisResult = {
      id,
      createdAt: new Date().toISOString(),
      shareUrl: `/repo/${id}`,
      graph,
      clusters,
      anomalies,
      parseErrors: allParseErrors,
      renderData,
      repoMeta,
      // Attach validated IR if construction succeeded.
      // Old analyses without this field still load fine (field is optional).
      ...(repositoryIR ? { repositoryIR } : {}),
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
