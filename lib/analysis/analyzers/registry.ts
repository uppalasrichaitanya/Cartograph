import type { FileNode, ParserCapability, Provenance } from "../ir/types";
import type {
  AnalysisContext,
  AnalysisView,
  Analyzer,
  AnalyzerRunResult,
  CapabilityCoverage,
} from "./interface";
import type { ArchitectureModelData } from "../architecture-model/types";
import type { RepositoryIR } from "../ir/types";
import type { SourceFileAnalysis } from "@/types/graph";

export class DuplicateAnalyzerError extends Error {
  constructor(public readonly analyzerId: string) {
    super(`Duplicate analyzer: an analyzer with id "${analyzerId}" is already registered.`);
    this.name = "DuplicateAnalyzerError";
  }
}

export class InvalidAnalyzerDependencyError extends Error {
  constructor(analyzerId: string, dependencyId: string, detail: string) {
    super(`Invalid dependency '${dependencyId}' for analyzer '${analyzerId}': ${detail}`);
    this.name = "InvalidAnalyzerDependencyError";
  }
}

export interface AnalyzerRunOptions {
  readonly files: ReadonlyArray<SourceFileAnalysis>;
  readonly repositoryIR?: RepositoryIR | null;
  readonly architectureModel?: ArchitectureModelData | null;
}

function fileNodes(ir: RepositoryIR | null): FileNode[] {
  return ir?.nodes.filter((node): node is FileNode => node.kind === "File") ?? [];
}

function coverageFor(
  ir: RepositoryIR | null,
  capability: ParserCapability,
  legacyFileCount: number,
): CapabilityCoverage {
  const files = fileNodes(ir);
  if (!ir) {
    return {
      capability,
      totalFiles: legacyFileCount,
      supportedFileIds: [],
      missingFileIds: Array.from({ length: legacyFileCount }, (_, index) => `legacy:${index}`),
      complete: legacyFileCount === 0,
    };
  }
  const supportedFileIds = files
    .filter((file) => file.capabilitiesUsed.includes(capability))
    .map((file) => file.id);
  const missingFileIds = files
    .filter((file) => !file.capabilitiesUsed.includes(capability))
    .map((file) => file.id);
  return {
    capability,
    totalFiles: files.length,
    supportedFileIds,
    missingFileIds,
    complete: missingFileIds.length === 0,
  };
}

function outputProvenance(
  ir: RepositoryIR | null,
  degraded: boolean,
  missingCapabilities: ReadonlyArray<ParserCapability>,
): Provenance {
  const files = fileNodes(ir);
  const hasReducedInput = files.some(
    (file) => file.provenance.origin !== "verified" && file.provenance.origin !== "derived",
  );
  if (degraded || hasReducedInput || !ir) {
    const reasons = [
      degraded && missingCapabilities.length > 0
        ? `Missing capabilities: ${missingCapabilities.join(", ")}`
        : null,
      degraded && missingCapabilities.length === 0
        ? "An upstream analyzer had reduced provenance"
        : null,
      hasReducedInput ? "One or more parser inputs had reduced provenance" : null,
      !ir ? "Validated IR was unavailable" : null,
    ].filter((reason): reason is string => reason !== null);
    return {
      origin: "heuristic",
      derivedFrom: files.map((file) => file.id),
      note: reasons.join("; "),
    };
  }
  return { origin: "derived", derivedFrom: files.map((file) => file.id) };
}

export function toAnalysisView(run: AnalyzerRunResult): AnalysisView {
  return {
    analyzerId: run.analyzerId,
    tier: run.tier,
    status: run.status,
    missingCapabilities: run.missingCapabilities,
    provenance: run.provenance,
  };
}

export class AnalyzerRegistry {
  private readonly analyzers = new Map<string, Analyzer>();

  register(analyzer: Analyzer): void {
    if (this.analyzers.has(analyzer.id)) throw new DuplicateAnalyzerError(analyzer.id);
    this.analyzers.set(analyzer.id, analyzer);
  }

  async run(options: AnalyzerRunOptions): Promise<ReadonlyArray<AnalyzerRunResult>> {
    const repositoryIR = options.repositoryIR ?? null;
    const architectureModel = options.architectureModel ?? null;
    const results = new Map<string, AnalyzerRunResult>();
    const ordered = [...this.analyzers.values()].sort((a, b) => a.tier - b.tier);
    for (const analyzer of ordered) {
      for (const dependencyId of analyzer.dependsOn ?? []) {
        const dependency = this.analyzers.get(dependencyId);
        if (!dependency) {
          throw new InvalidAnalyzerDependencyError(
            analyzer.id,
            dependencyId,
            "the dependency is not registered",
          );
        }
        if (dependency.tier >= analyzer.tier) {
          throw new InvalidAnalyzerDependencyError(
            analyzer.id,
            dependencyId,
            "dependencies must come from an earlier tier",
          );
        }
      }
    }

    const context: AnalysisContext = {
      files: options.files,
      repositoryIR,
      architectureModel,
      getCapabilityCoverage: (capability) =>
        coverageFor(repositoryIR, capability, options.files.length),
      getResult: <T>(analyzerId: string) => results.get(analyzerId)?.result as T | undefined,
      getView: (analyzerId: string): AnalysisView | undefined => {
        const run = results.get(analyzerId);
        return run ? toAnalysisView(run) : undefined;
      },
    };

    for (const analyzer of ordered) {
      const requirements = analyzer.requires ?? [];
      const dependencyViews = (analyzer.dependsOn ?? [])
        .map((id) => results.get(id))
        .filter((run): run is AnalyzerRunResult => run !== undefined);
      const missing = [
        ...requirements
        .filter((requirement) => !context.getCapabilityCoverage(requirement.capability).complete)
        .map((requirement) => requirement.capability),
        ...dependencyViews.flatMap((view) => view.missingCapabilities),
      ];
      const shouldSkip = dependencyViews.some((view) => view.status === "skipped")
        || requirements.some(
          (requirement) =>
            requirement.onMissing === "skip" &&
            !context.getCapabilityCoverage(requirement.capability).complete,
        );
      const hasDegradedDependency = dependencyViews.some(
        (view) => view.status === "degraded" || view.provenance.origin === "heuristic",
      );
      const status = shouldSkip ? "skipped" : missing.length > 0 ? "degraded" : "complete";
      const effectiveStatus = status === "complete" && hasDegradedDependency
        ? "degraded"
        : status;
      const uniqueMissing = [...new Set(missing)];
      const provenance = outputProvenance(
        repositoryIR,
        effectiveStatus !== "complete",
        uniqueMissing,
      );
      const result = shouldSkip ? undefined : await analyzer.analyze(context);
      results.set(analyzer.id, {
        analyzerId: analyzer.id,
        tier: analyzer.tier,
        status: effectiveStatus,
        missingCapabilities: uniqueMissing,
        provenance,
        ...(result === undefined ? {} : { result }),
      });
    }

    return [...results.values()];
  }
}
