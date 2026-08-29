import type { ArchitectureModelData } from "../architecture-model/types";
import type {
  ParserCapability,
  Provenance,
  RepositoryIR,
} from "../ir/types";
import type { SourceFileAnalysis } from "@/types/graph";

export type AnalyzerTier = 1 | 2;
export type CapabilityGapBehavior = "skip" | "degrade";
export type AnalyzerStatus = "complete" | "degraded" | "skipped";

export interface AnalyzerCapabilityRequirement {
  readonly capability: ParserCapability;
  readonly onMissing: CapabilityGapBehavior;
}

export interface CapabilityCoverage {
  readonly capability: ParserCapability;
  readonly totalFiles: number;
  readonly supportedFileIds: ReadonlyArray<string>;
  readonly missingFileIds: ReadonlyArray<string>;
  readonly complete: boolean;
}

export interface AnalysisView {
  readonly analyzerId: string;
  readonly tier: AnalyzerTier;
  readonly status: AnalyzerStatus;
  readonly missingCapabilities: ReadonlyArray<ParserCapability>;
  readonly provenance: Provenance;
}

export interface AnalyzerRunResult<T = unknown> extends AnalysisView {
  readonly result?: T;
}

export interface AnalysisContext {
  readonly files: ReadonlyArray<SourceFileAnalysis>;
  readonly repositoryIR: RepositoryIR | null;
  readonly architectureModel: ArchitectureModelData | null;
  getCapabilityCoverage(capability: ParserCapability): CapabilityCoverage;
  getResult<T>(analyzerId: string): T | undefined;
  getView(analyzerId: string): AnalysisView | undefined;
}

export interface Analyzer<T = unknown> {
  readonly id: string;
  readonly name: string;
  readonly tier: AnalyzerTier;
  /** Earlier analyzer outputs consumed through context.getResult(). */
  readonly dependsOn?: ReadonlyArray<string>;
  readonly requires?: ReadonlyArray<AnalyzerCapabilityRequirement>;
  analyze(context: AnalysisContext): T | Promise<T>;
}
