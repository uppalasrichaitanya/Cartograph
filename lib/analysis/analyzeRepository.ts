import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildGraph } from "./buildGraph";
import { clusterByFolder } from "./clusterByFolder";
import { detectAnomalies } from "./detectAnomalies";
import { detectRepoMeta } from "./detectRepoMeta";
import { discoverSourceFiles, findProjectRoot } from "./discoverFiles";
import { extractAll, toLegacyResult } from "./extractAll";
import { prepareRenderData } from "./prepareRenderData";
import { ParserRegistry } from "./parsers/registry";
import { TypeScriptParser } from "./parsers/typescript/parser";
import { PythonParser } from "./parsers/python/parser";
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

    // --- Milestone 2: Parser Architecture ---
    // Create a per-run registry. Register language parsers, then use
    // registry-driven extensions for file discovery.
    const registry = new ParserRegistry();
    registry.register(new TypeScriptParser());
    registry.register(new PythonParser());

    const legacyDiscovered = await discoverSourceFiles(
      projectRoot,
      registry.getRegisteredExtensions(),
    );
    // Convert ProjectFile[] → ParseFileInput[] (filePath → relativePath)
    const discoveredFiles = legacyDiscovered.map((f) => ({
      absolutePath: f.absolutePath,
      relativePath: f.filePath,
    }));
    await report("parsing", `Parsing ${discoveredFiles.length} source files`);

    await registry.initializeAll({ projectRoot, discoveredFiles });
    let parserExtractionResult;
    try {
      parserExtractionResult = await extractAll(projectRoot, discoveredFiles, registry);
    } finally {
      registry.disposeAll();
    }

    const { files, parseErrors } = toLegacyResult(parserExtractionResult);
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

    // --- Milestone 2 integration: build RepositoryIR from RawExtraction[] ---
    // The IR is built directly from the extraction pipeline's RawExtraction[],
    // preserving real IRParseError data (line, column, severity, reason).
    // On failure, it returns null and the legacy pipeline continues unaffected.
    const repositoryIR = buildRepositoryIR(projectRoot, parserExtractionResult.extractions);

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
