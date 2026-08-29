import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { detectRepoMeta } from "./detectRepoMeta";
import { discoverSourceFiles, findProjectRoot } from "./discoverFiles";
import { extractAll, toLegacyResult } from "./extractAll";
import { prepareRenderData } from "./prepareRenderData";
import { ParserRegistry } from "./parsers/registry";
import { TypeScriptParser } from "./parsers/typescript/parser";
import { PythonParser } from "./parsers/python/parser";
import { safeUnzip } from "@/lib/safety/safeUnzip";
import { SafetyEventLog } from "@/lib/safety/eventLog";
import { getStorage, isUsingBlobStorage, StorageError } from "@/lib/storage";
import { isValidUploadReference } from "@/lib/storage/uploadReference";
import { buildRepositoryIR } from "./ir/bridge";
import { buildArchitectureModel } from "./architecture-model/model";
import {
  ANOMALY_ANALYZER_ID,
  createBuiltInAnalyzerRegistry,
  DEPENDENCY_GRAPH_ANALYZER_ID,
  FOLDER_CLUSTER_ANALYZER_ID,
} from "./analyzers/builtins";
import { toAnalysisView } from "./analyzers/registry";
import type { RootConfidence } from "./ir/types";
import type {
  AnalysisResult,
  Anomalies,
  Cluster,
  DependencyGraph,
} from "@/types/graph";

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

  const storageMode = isUsingBlobStorage() ? "blob" : "local";
  if (!isValidUploadReference(zipPath, storageMode)) {
    throw new StorageError("The upload reference is invalid or is not owned by Cartograph.");
  }

  const storage = getStorage();

  await report("validating", "Checking the uploaded archive");

  // --- Phase 6 integration: Safety Event Log ---
  // Create a per-run event log to capture all safety rejections.
  // Passed through to safeUnzip for path/symlink/content recording.
  // Drained after extraction to merge safety events into parseErrors.
  const eventLog = new SafetyEventLog();

  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "cartograph-"));
  try {
    // If zipPath is a remote URL (Vercel Blob), download it to a local
    // temp file first. The rest of the pipeline operates on local paths.
    let localZipPath = zipPath;
    if (zipPath.startsWith("http://") || zipPath.startsWith("https://")) {
      await report("validating", "Downloading the archive from storage");
      const response = await fetch(zipPath);
      if (!response.ok) throw new AnalysisError("Failed to download the uploaded archive.");
      const buffer = Buffer.from(await response.arrayBuffer());
      localZipPath = path.join(temporaryDirectory, "upload.zip");
      await writeFile(localZipPath, buffer);
    }

    const extractionDirectory = path.join(temporaryDirectory, "repository");
    await report("unzipping", "Safely extracting the archive");

    // --- Phase 6 integration: pass event log to safeUnzip ---
    // safeUnzip now returns an ExtractionResult with per-entry details.
    // The event log captures path rejections, symlink rejections, and
    // content-unreadable events during extraction.
    await safeUnzip(localZipPath, extractionDirectory, undefined, eventLog);

    const projectRoot = await findProjectRoot(extractionDirectory);

    // --- Milestone 2: Parser Architecture ---
    // Create a per-run registry. Register language parsers, then use
    // registry-driven extensions for file discovery.
    const registry = new ParserRegistry();
    const pythonParser = new PythonParser();
    registry.register(new TypeScriptParser());
    registry.register(pythonParser);

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
    // The Python parser detects its own import root and reports whether that
    // came from a declared layout (pyproject.toml / setup.cfg) or a structural
    // guess. Captured here because disposeAll() clears it, and preserved into
    // the IR so a guessed root is not later mistaken for a declared one.
    let pythonRootConfidence: RootConfidence | undefined;
    try {
      parserExtractionResult = await extractAll(projectRoot, discoveredFiles, registry);
      pythonRootConfidence = pythonParser.rootConfidence ?? undefined;
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

    // Build the verified knowledge base before analyzers. Both the analyzer
    // capability checks and Architecture Model consume this canonical input.
    // The IR is built directly from the extraction pipeline's RawExtraction[],
    // preserving real IRParseError data (line, column, severity, reason).
    // On failure, it returns null and the legacy pipeline continues unaffected.
    //
    // Built BEFORE layout because render data is now stamped with the
    // per-file confidence the IR carries.
    //
    // The Python parser's root confidence is applied only when the repository
    // actually contains Python. Its detection runs unconditionally, so for a
    // TypeScript-only project it would report a structural guess about a
    // Python root that does not exist — which must not weaken confidence in a
    // root that package.json genuinely declared.
    const hasPythonFiles = discoveredFiles.some((file) =>
      file.relativePath.endsWith(".py"),
    );
    const repositoryIR = buildRepositoryIR(
      projectRoot,
      parserExtractionResult.extractions,
      hasPythonFiles ? pythonRootConfidence : undefined,
    );
    const architectureModel = repositoryIR
      ? buildArchitectureModel(repositoryIR)
      : null;

    await report("clustering", "Building deterministic architecture boundaries");
    await report("detecting", "Running capability-aware architecture analyzers");
    const analyzerRuns = await createBuiltInAnalyzerRegistry().run({
      files,
      repositoryIR,
      architectureModel,
    });
    const resultOf = <T,>(id: string): T | undefined =>
      analyzerRuns.find((run) => run.analyzerId === id)?.result as T | undefined;
    const graph = resultOf<DependencyGraph>(DEPENDENCY_GRAPH_ANALYZER_ID);
    const clusters = resultOf<Cluster[]>(FOLDER_CLUSTER_ANALYZER_ID);
    const anomalies = resultOf<Anomalies>(ANOMALY_ANALYZER_ID);
    if (!graph || !clusters || !anomalies) {
      throw new AnalysisError("Required built-in analyzers did not produce output.");
    }
    const analysisViews = analyzerRuns.map(toAnalysisView);

    await report("layout", "Computing a readable diagram layout");
    const renderData = await prepareRenderData(
      graph,
      clusters,
      repositoryIR,
      allParseErrors,
      architectureModel,
    );

    const repoMeta = await detectRepoMeta(projectRoot, graph, clusters, repoName, repoSizeBytes);

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
      analysisViews,
      ...(architectureModel ? { architectureModel } : {}),
    };
    await report("persisting", "Saving the shareable diagram");
    await storage.saveAnalysis(result);
    return result;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    // Clean up the uploaded zip/blob.
    await storage.deleteUpload(zipPath);
  }
}
