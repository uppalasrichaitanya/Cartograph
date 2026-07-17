/**
 * Cartograph IR & Identity Model — Type Definitions
 *
 * This file contains the canonical type definitions for Cartograph's
 * Intermediate Representation (IR). Every parser, analyzer, the Architecture
 * Model, the Query Engine, and eventually the AI layer read or write these
 * types. They are the single point where the many-languages-in, many-views-out
 * architecture becomes possible.
 *
 * These types are a direct transcription of the approved specification:
 *   specs/cartograph_ir_identity_model_spec.md — Section 4: Public Interfaces
 *
 * Design principles:
 *   - Additive-only schema evolution within a major irVersion.
 *   - Provenance is mandatory on every fact-bearing structure.
 *   - Identity is explicitly designed, never implicit (no filePath-as-ID).
 *   - Containment and dependency are structurally separate types.
 *   - No language-specific fields in the shared schema.
 *
 * @module lib/analysis/ir/types
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Opaque, stable identifier for graph nodes.
 * Always derived deterministically via SHA-256; never random.
 *
 * The branded intersection prevents accidental assignment of a plain string
 * where a NodeId is expected, enforced at compile time.
 */
export type NodeId = string & { readonly __brand: "NodeId" };

/**
 * Opaque, stable identifier for graph edges.
 * Derived deterministically from (from, kind, to); never random.
 */
export type EdgeId = string & { readonly __brand: "EdgeId" };

/**
 * Identifies a supported language. Extended additively per language —
 * adding a value here never removes or renames existing ones.
 *
 * Milestone 1 supports 'typescript' and 'javascript' only.
 * 'python' is included per the spec for forward compatibility.
 */
export type LanguageId = "typescript" | "javascript" | "python";

// ---------------------------------------------------------------------------
// Module Roots
// ---------------------------------------------------------------------------

/**
 * A discovered root governing a subtree of the repository.
 * Examples: a directory containing `package.json`, `go.mod`, `pyproject.toml`.
 *
 * The fingerprint is a stable hash used in NodeId derivation so that
 * identical relative paths under different roots produce distinct IDs.
 */
export interface ModuleRoot {
  readonly id: NodeId;
  readonly kind: "ModuleRoot";
  /** Relative to the repository root. */
  readonly rootPath: string;
  readonly language: LanguageId;
  /** The manifest file name that signaled this root (e.g. "package.json"). */
  readonly manifestFile: string;
  /**
   * Stable hash used in ID derivation.
   * Computed as SHA-256(rootPath + ':' + manifestFile), truncated to 128 bits,
   * base62-encoded. See specs/cartograph_ir_identity_model_spec.md Section 5.
   */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Classifies how a fact was obtained.
 *
 * Propagation rule (enforced, not just documented):
 *   A fact's provenance is only ever 'verified' or 'derived' if every input
 *   it was computed from is also 'verified' or 'derived'. The moment any
 *   upstream input is 'heuristic', the output is 'heuristic' too —
 *   permanently. Provenance never silently upgrades.
 */
export type ProvenanceOrigin =
  | "verified"          // directly observed static fact
  | "derived"           // deterministic computation over verified/derived facts only
  | "heuristic"         // best-effort inference; may be wrong
  | "user-defined"      // explicit user configuration/override
  | "ai-interpretation"; // natural-language explanation; never a graph fact

/**
 * Provenance metadata attached to every fact-bearing IR structure.
 * Mandatory — never optional on nodes or edges.
 */
export interface Provenance {
  readonly origin: ProvenanceOrigin;
  /**
   * Present only for 'derived' or 'heuristic': references to the facts
   * this was computed from, enabling lineage tracing.
   */
  readonly derivedFrom?: ReadonlyArray<NodeId | EdgeId>;
  /**
   * Free-text note. Present only for 'heuristic' or 'ai-interpretation';
   * omitted for 'verified' and 'derived'.
   */
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// Parser Capabilities
// ---------------------------------------------------------------------------

/**
 * Minimal capability flag set at launch.
 * Extended additively — adding a value here never removes existing ones.
 *
 * Used by parsers to honestly declare what they did and didn't extract,
 * and by downstream consumers to know what data is available.
 */
export type ParserCapability = "imports" | "exports";

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** Discriminant for the IRNode union. */
export type NodeKind = "File" | "ModuleRoot" | "ExternalDependency";

/**
 * Represents a single source file in the repository.
 *
 * A FileNode is always created for every discovered file, even if parsing
 * failed entirely — so the file remains visible in the graph. On fatal
 * parse failure, parseErrors will contain a severity:'fatal' entry and
 * the import lists will be empty.
 */
export interface FileNode {
  readonly id: NodeId;
  readonly kind: "File";
  /** Relative to the repository root, using forward slashes. */
  readonly path: string;
  readonly language: LanguageId;
  readonly lineCount: number;
  /** Which ModuleRoot this file belongs to (containment relationship). */
  readonly ownerRootId: NodeId;
  /**
   * 'precise' when the parser fully extracted all requested capabilities.
   * 'heuristic' when any data was salvaged from a partially failed parse,
   * or when the parser reported reduced confidence for other reasons.
   */
  readonly confidence: "precise" | "heuristic";
  /** Empty array when parsing succeeded without errors. */
  readonly parseErrors: ReadonlyArray<IRParseError>;
  /** Which capabilities the parser actually used for this file. */
  readonly capabilitiesUsed: ReadonlyArray<ParserCapability>;
  readonly provenance: Provenance;
}

/**
 * Represents an external dependency referenced in source but not part of
 * the analyzed repository (e.g., npm packages, stdlib modules).
 *
 * Unresolvable imports become ExternalDependencyNodes with a 'heuristic'
 * provenance note — never silently discarded.
 */
export interface ExternalDependencyNode {
  readonly id: NodeId;
  readonly kind: "ExternalDependency";
  /** Raw package/module name as referenced in source code. */
  readonly name: string;
  readonly language: LanguageId;
  readonly provenance: Provenance;
}

/**
 * Union of all node types in the IR.
 * Discriminated on the `kind` field.
 */
export type IRNode = FileNode | ModuleRoot | ExternalDependencyNode;

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * Discriminant for the Edge type.
 *
 * 'contains' — structural containment: a ModuleRoot contains a File.
 * 'imports'  — code dependency: a File imports another File or ExternalDependency.
 *
 * These two kinds must never be merged into a single undifferentiated list.
 * The type system enforces this separation.
 */
export type EdgeKind = "contains" | "imports";

/**
 * A directed relationship between two nodes.
 *
 * Containment edges: from=ModuleRoot, to=File
 * Dependency edges:  from=File, to=File|ExternalDependency
 */
export interface Edge {
  readonly id: EdgeId;
  readonly kind: EdgeKind;
  readonly from: NodeId;
  readonly to: NodeId;
  readonly provenance: Provenance;
}

// ---------------------------------------------------------------------------
// Parse Errors (IR version)
// ---------------------------------------------------------------------------

/**
 * Structured parse error attached to a FileNode.
 *
 * Named IRParseError to distinguish from the legacy ParseError in
 * types/graph.ts. The legacy type will be extended in Phase 7 to
 * include these richer fields while preserving backward compatibility.
 *
 * This type is consumed by the IR Builder and downstream analyzers.
 */
export interface IRParseError {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  /**
   * 'fatal':   the file's facts could not be extracted at all.
   * 'partial': some data was salvaged despite errors.
   */
  readonly severity: "fatal" | "partial";
  /**
   * Distinguishes pathological-input timeouts from genuine syntax errors.
   * 'syntax':     source code has syntax errors
   * 'timeout':    per-file resource budget exceeded
   * 'unreadable': binary or corrupted content
   * 'unknown':    catch-all for unexpected failures
   */
  readonly reason: "syntax" | "timeout" | "unreadable" | "unknown";
}

// ---------------------------------------------------------------------------
// Top-level Container
// ---------------------------------------------------------------------------

/**
 * The complete, immutable IR for a single repository analysis run.
 * This is the only object ever persisted to storage.
 *
 * irVersion uses a literal type — the schema evolves additively within
 * a major version. New optional fields are allowed; removal or rename
 * of existing fields requires a version bump.
 */
export interface RepositoryIR {
  readonly irVersion: 1;
  /** ISO 8601 timestamp. Isolated metadata, not embedded per-node. */
  readonly generatedAt: string;
  readonly nodes: ReadonlyArray<IRNode>;
  readonly edges: ReadonlyArray<Edge>;
  readonly roots: ReadonlyArray<ModuleRoot>;
}

// ---------------------------------------------------------------------------
// Parser-Facing Contract
// ---------------------------------------------------------------------------

/**
 * What every LanguageParser implementation returns per file.
 * This is a parser-internal shape, not yet canonical IR.
 * The IR Builder converts RawExtraction → FileNode.
 */
export interface RawExtraction {
  /** Relative path from the repository root, using forward slashes. */
  readonly path: string;
  readonly lineCount: number;
  /** Raw import specifiers, not yet resolved to NodeIds. */
  readonly internalImports: ReadonlyArray<string>;
  /** Imports determined to be external (npm packages, etc.). */
  readonly externalImports: ReadonlyArray<string>;
  readonly parseErrors: ReadonlyArray<IRParseError>;
  readonly capabilitiesUsed: ReadonlyArray<ParserCapability>;
}

/**
 * An import specifier that has been resolved to a target node.
 * The raw specifier is retained for diagnostics and debugging.
 */
export interface ResolvedImport {
  /** Resolved FileNode or ExternalDependencyNode id. */
  readonly targetId: NodeId;
  /** Original import specifier as written in source code. */
  readonly raw: string;
}

// ---------------------------------------------------------------------------
// Builder Contract
// ---------------------------------------------------------------------------

/**
 * Contract for the IR Builder, which assembles validated IR structures
 * from a parser's raw output.
 *
 * Input/output contracts:
 *   - buildFileNode never throws. Invalid or partial extraction becomes a
 *     FileNode with parseErrors populated and confidence:'heuristic'.
 *   - finalize throws IRValidationError on schema or referential-integrity
 *     violation. This indicates a builder or parser bug, never user input.
 */
export interface IRBuilderContract {
  buildFileNode(raw: RawExtraction, ownerRoot: ModuleRoot): FileNode;
  buildContainmentEdge(file: FileNode, root: ModuleRoot): Edge;
  buildDependencyEdges(
    file: FileNode,
    resolved: ReadonlyArray<ResolvedImport>,
  ): Edge[];
  /**
   * The only path to storage. Performs full referential-integrity validation.
   * Never produces a partial result — all-or-nothing.
   */
  finalize(
    nodes: ReadonlyArray<IRNode>,
    edges: ReadonlyArray<Edge>,
    roots: ReadonlyArray<ModuleRoot>,
  ): RepositoryIR;
}
