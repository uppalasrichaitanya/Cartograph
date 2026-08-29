/**
 * Cartograph IR Schema Validator — Runtime Shape & Referential Integrity Checks
 *
 * Validates that constructed IR structures conform to the schema defined in
 * lib/analysis/ir/types.ts. This is the final gate before persistence —
 * called by IRBuilder.finalize() to enforce all-or-nothing correctness.
 *
 * Design:
 *   - Pure validation: never mutates input, never has side effects.
 *   - Throws IRValidationError with a structured path to the violation.
 *   - Composed from small assertion helpers for clarity and testability.
 *   - No external dependencies (no zod, ajv, etc.).
 *
 * @module lib/analysis/ir/validation
 */

import type {
  Edge,
  Declaration,
  EdgeKind,
  ExternalDependencyNode,
  FileNode,
  IRNode,
  IRParseError,
  LanguageId,
  ModuleRoot,
  ParserCapability,
  Provenance,
  ProvenanceOrigin,
  RepositoryIR,
  RootConfidence,
  SymbolKind,
  UnresolvedImportNode,
} from "./types";

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/**
 * Thrown when IR validation fails. Indicates a builder or parser bug,
 * never user input error.
 */
export class IRValidationError extends Error {
  /** Dot-path to the failing field (e.g., "nodes[3].kind"). */
  public readonly path: string;
  /** Human-readable description of what was expected vs. found. */
  public readonly detail: string;

  constructor(path: string, detail: string) {
    super(`IR validation failed at '${path}': ${detail}`);
    this.name = "IRValidationError";
    this.path = path;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Primitive Assertions
// ---------------------------------------------------------------------------

const VALID_LANGUAGES: readonly LanguageId[] = [
  "typescript",
  "javascript",
  "python",
];
const VALID_EDGE_KINDS: readonly EdgeKind[] = ["contains", "imports"];
const VALID_PROVENANCE_ORIGINS: readonly ProvenanceOrigin[] = [
  "verified",
  "derived",
  "heuristic",
  "user-defined",
  "ai-interpretation",
];
const VALID_CAPABILITIES: readonly ParserCapability[] = ["imports", "exports", "declarations"];
const VALID_SYMBOL_KINDS: readonly SymbolKind[] = [
  "function", "method", "constructor", "class", "interface", "type", "enum",
];
const VALID_ROOT_CONFIDENCES: readonly RootConfidence[] = [
  "declared",
  "structural-heuristic",
];
const VALID_PARSE_ERROR_SEVERITIES = ["fatal", "partial"] as const;
const VALID_PARSE_ERROR_REASONS = [
  "syntax",
  "timeout",
  "unreadable",
  "unknown",
] as const;

function assertObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new IRValidationError(path, `expected an object, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new IRValidationError(path, `expected a string, got ${typeof value}`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, path: string): string {
  const s = assertString(value, path);
  if (s.length === 0) {
    throw new IRValidationError(path, "expected a non-empty string");
  }
  return s;
}

function assertNonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new IRValidationError(
      path,
      `expected a non-negative integer, got ${String(value)}`,
    );
  }
  return value;
}

function assertPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new IRValidationError(path, `expected a positive integer, got ${String(value)}`);
  }
  return value;
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new IRValidationError(path, `expected an array, got ${typeof value}`);
  }
  return value;
}

function assertEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  const s = assertString(value, path);
  if (!allowed.includes(s as T)) {
    throw new IRValidationError(
      path,
      `expected one of [${allowed.join(", ")}], got '${s}'`,
    );
  }
  return s as T;
}

function assertOptionalNumber(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new IRValidationError(
      path,
      `expected an integer or undefined, got ${String(value)}`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Composite Validators
// ---------------------------------------------------------------------------

/** Validate a Provenance structure. */
export function validateProvenance(
  value: unknown,
  path: string,
): Provenance {
  const obj = assertObject(value, path);
  const origin = assertEnum(obj.origin, `${path}.origin`, VALID_PROVENANCE_ORIGINS);

  let derivedFrom: (string)[] | undefined;
  if (obj.derivedFrom !== undefined) {
    const arr = assertArray(obj.derivedFrom, `${path}.derivedFrom`);
    derivedFrom = arr.map((item, i) =>
      assertNonEmptyString(item, `${path}.derivedFrom[${i}]`),
    );
  }

  let note: string | undefined;
  if (obj.note !== undefined) {
    note = assertString(obj.note, `${path}.note`);
  }

  return { origin, derivedFrom, note } as Provenance;
}

/** Validate an IRParseError structure. */
export function validateParseError(
  value: unknown,
  path: string,
): IRParseError {
  const obj = assertObject(value, path);
  return {
    message: assertNonEmptyString(obj.message, `${path}.message`),
    line: assertOptionalNumber(obj.line, `${path}.line`),
    column: assertOptionalNumber(obj.column, `${path}.column`),
    severity: assertEnum(
      obj.severity,
      `${path}.severity`,
      VALID_PARSE_ERROR_SEVERITIES,
    ),
    reason: assertEnum(obj.reason, `${path}.reason`, VALID_PARSE_ERROR_REASONS),
  };
}

function validateDeclaration(value: unknown, path: string): Declaration {
  const obj = assertObject(value, path);
  const range = assertObject(obj.range, `${path}.range`);
  const start = assertObject(range.start, `${path}.range.start`);
  const end = assertObject(range.end, `${path}.range.end`);
  const startPosition = {
    line: assertPositiveInteger(start.line, `${path}.range.start.line`),
    column: assertPositiveInteger(start.column, `${path}.range.start.column`),
  };
  const endPosition = {
    line: assertPositiveInteger(end.line, `${path}.range.end.line`),
    column: assertPositiveInteger(end.column, `${path}.range.end.column`),
  };
  if (
    endPosition.line < startPosition.line ||
    (endPosition.line === startPosition.line && endPosition.column < startPosition.column)
  ) {
    throw new IRValidationError(`${path}.range`, "end must not precede start");
  }
  return {
    id: assertNonEmptyString(obj.id, `${path}.id`),
    name: assertNonEmptyString(obj.name, `${path}.name`),
    qualifiedName: assertNonEmptyString(obj.qualifiedName, `${path}.qualifiedName`),
    kind: assertEnum(obj.kind, `${path}.kind`, VALID_SYMBOL_KINDS),
    range: { start: startPosition, end: endPosition },
    provenance: validateProvenance(obj.provenance, `${path}.provenance`),
  } as Declaration;
}

/** Validate a FileNode structure. */
export function validateFileNode(
  value: unknown,
  path: string,
): FileNode {
  const obj = assertObject(value, path);
  const kind = assertEnum(obj.kind, `${path}.kind`, ["File"] as const);
  const lineCount = assertNonNegativeInteger(obj.lineCount, `${path}.lineCount`);
  const declarations = obj.declarations === undefined
    ? undefined
    : assertArray(obj.declarations, `${path}.declarations`).map((item, i) =>
        validateDeclaration(item, `${path}.declarations[${i}]`),
      );
  if (declarations) {
    const ids = new Set<string>();
    for (let i = 0; i < declarations.length; i++) {
      const declaration = declarations[i];
      if (ids.has(declaration.id)) {
        throw new IRValidationError(`${path}.declarations[${i}].id`, `duplicate symbol ID '${declaration.id}'`);
      }
      ids.add(declaration.id);
      if (declaration.range.end.line > lineCount) {
        throw new IRValidationError(
          `${path}.declarations[${i}].range.end.line`,
          `must not exceed file line count ${lineCount}`,
        );
      }
      if (i > 0) {
        const previous = declarations[i - 1];
        const outOfOrder = declaration.range.start.line < previous.range.start.line ||
          (declaration.range.start.line === previous.range.start.line &&
            declaration.range.start.column < previous.range.start.column);
        if (outOfOrder) {
          throw new IRValidationError(`${path}.declarations[${i}].range.start`, "declarations must be in source order");
        }
      }
    }
  }
  return {
    id: assertNonEmptyString(obj.id, `${path}.id`),
    kind,
    path: assertNonEmptyString(obj.path, `${path}.path`),
    language: assertEnum(obj.language, `${path}.language`, VALID_LANGUAGES),
    lineCount,
    ownerRootId: assertNonEmptyString(
      obj.ownerRootId,
      `${path}.ownerRootId`,
    ),
    confidence: assertEnum(obj.confidence, `${path}.confidence`, [
      "precise",
      "heuristic",
    ] as const),
    parseErrors: assertArray(obj.parseErrors, `${path}.parseErrors`).map(
      (item, i) => validateParseError(item, `${path}.parseErrors[${i}]`),
    ),
    capabilitiesUsed: assertArray(
      obj.capabilitiesUsed,
      `${path}.capabilitiesUsed`,
    ).map((item, i) =>
      assertEnum(
        item,
        `${path}.capabilitiesUsed[${i}]`,
        VALID_CAPABILITIES,
      ),
    ),
    declarations,
    provenance: validateProvenance(obj.provenance, `${path}.provenance`),
  } as unknown as FileNode;
}

/** Validate a ModuleRoot structure. */
export function validateModuleRoot(
  value: unknown,
  path: string,
): ModuleRoot {
  const obj = assertObject(value, path);
  const kind = assertEnum(obj.kind, `${path}.kind`, ["ModuleRoot"] as const);
  return {
    id: assertNonEmptyString(obj.id, `${path}.id`),
    kind,
    rootPath: assertString(obj.rootPath, `${path}.rootPath`), // Can be empty for top-level
    language: assertEnum(obj.language, `${path}.language`, VALID_LANGUAGES),
    manifestFile: assertNonEmptyString(
      obj.manifestFile,
      `${path}.manifestFile`,
    ),
    confidence: assertEnum(
      obj.confidence,
      `${path}.confidence`,
      VALID_ROOT_CONFIDENCES,
    ),
    fingerprint: assertNonEmptyString(
      obj.fingerprint,
      `${path}.fingerprint`,
    ),
  } as unknown as ModuleRoot;
}

/** Validate an ExternalDependencyNode structure. */
export function validateExternalDependencyNode(
  value: unknown,
  path: string,
): ExternalDependencyNode {
  const obj = assertObject(value, path);
  const kind = assertEnum(obj.kind, `${path}.kind`, [
    "ExternalDependency",
  ] as const);
  return {
    id: assertNonEmptyString(obj.id, `${path}.id`),
    kind,
    name: assertNonEmptyString(obj.name, `${path}.name`),
    language: assertEnum(obj.language, `${path}.language`, VALID_LANGUAGES),
    provenance: validateProvenance(obj.provenance, `${path}.provenance`),
  } as unknown as ExternalDependencyNode;
}

/** Validate an UnresolvedImportNode structure. */
export function validateUnresolvedImportNode(
  value: unknown,
  path: string,
): UnresolvedImportNode {
  const obj = assertObject(value, path);
  const kind = assertEnum(obj.kind, `${path}.kind`, [
    "UnresolvedImport",
  ] as const);
  return {
    id: assertNonEmptyString(obj.id, `${path}.id`),
    kind,
    specifier: assertNonEmptyString(obj.specifier, `${path}.specifier`),
    language: assertEnum(obj.language, `${path}.language`, VALID_LANGUAGES),
    provenance: validateProvenance(obj.provenance, `${path}.provenance`),
  } as unknown as UnresolvedImportNode;
}

/** Validate any IRNode by dispatching on `kind`. */
export function validateNode(value: unknown, path: string): IRNode {
  const obj = assertObject(value, path);
  const kind = assertString(obj.kind, `${path}.kind`);
  switch (kind) {
    case "File":
      return validateFileNode(value, path);
    case "ModuleRoot":
      return validateModuleRoot(value, path);
    case "ExternalDependency":
      return validateExternalDependencyNode(value, path);
    case "UnresolvedImport":
      return validateUnresolvedImportNode(value, path);
    default:
      throw new IRValidationError(
        `${path}.kind`,
        `expected one of [File, ModuleRoot, ExternalDependency, UnresolvedImport], got '${kind}'`,
      );
  }
}

/** Validate an Edge structure. */
export function validateEdge(value: unknown, path: string): Edge {
  const obj = assertObject(value, path);
  return {
    id: assertNonEmptyString(obj.id, `${path}.id`),
    kind: assertEnum(obj.kind, `${path}.kind`, VALID_EDGE_KINDS),
    from: assertNonEmptyString(obj.from, `${path}.from`),
    to: assertNonEmptyString(obj.to, `${path}.to`),
    provenance: validateProvenance(obj.provenance, `${path}.provenance`),
  } as unknown as Edge;
}

// ---------------------------------------------------------------------------
// Top-Level Validator with Referential Integrity
// ---------------------------------------------------------------------------

/**
 * Validate a complete RepositoryIR, including referential integrity.
 *
 * Referential integrity checks:
 *   1. No duplicate node IDs.
 *   2. No duplicate edge IDs.
 *   3. Every edge's `from` and `to` reference a node ID that exists in `nodes`.
 *   4. Every ModuleRoot in `roots` must appear in `nodes`.
 *   5. Every FileNode's `ownerRootId` must reference a ModuleRoot in `roots`.
 *   6. Containment edges: `from` must be a ModuleRoot, `to` must be a File.
 *   7. Import edges: `from` must be a File.
 *
 * @throws IRValidationError on any violation.
 */
export function validateRepositoryIR(value: unknown): RepositoryIR {
  const obj = assertObject(value, "ir");

  // -- Schema fields --

  const irVersion = obj.irVersion;
  if (irVersion !== 1) {
    throw new IRValidationError(
      "ir.irVersion",
      `expected 1, got ${String(irVersion)}`,
    );
  }
  const generatedAt = assertNonEmptyString(
    obj.generatedAt,
    "ir.generatedAt",
  );
  const rawNodes = assertArray(obj.nodes, "ir.nodes");
  const rawEdges = assertArray(obj.edges, "ir.edges");
  const rawRoots = assertArray(obj.roots, "ir.roots");

  // -- Validate each element --

  const nodes: IRNode[] = rawNodes.map((item, i) =>
    validateNode(item, `ir.nodes[${i}]`),
  );
  const edges: Edge[] = rawEdges.map((item, i) =>
    validateEdge(item, `ir.edges[${i}]`),
  );
  const roots: ModuleRoot[] = rawRoots.map((item, i) =>
    validateModuleRoot(item, `ir.roots[${i}]`),
  );

  // -- Referential integrity --

  // 1. No duplicate node IDs
  const nodeIdSet = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    if (nodeIdSet.has(nodes[i].id)) {
      throw new IRValidationError(
        `ir.nodes[${i}].id`,
        `duplicate node ID '${nodes[i].id}'`,
      );
    }
    nodeIdSet.add(nodes[i].id);
  }

  const symbolIdSet = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind !== "File") continue;
    for (let j = 0; j < (node.declarations?.length ?? 0); j++) {
      const symbol = node.declarations![j];
      if (symbolIdSet.has(symbol.id)) {
        throw new IRValidationError(
          `ir.nodes[${i}].declarations[${j}].id`,
          `duplicate symbol ID '${symbol.id}'`,
        );
      }
      symbolIdSet.add(symbol.id);
    }
  }

  // 2. No duplicate edge IDs
  const edgeIdSet = new Set<string>();
  for (let i = 0; i < edges.length; i++) {
    if (edgeIdSet.has(edges[i].id)) {
      throw new IRValidationError(
        `ir.edges[${i}].id`,
        `duplicate edge ID '${edges[i].id}'`,
      );
    }
    edgeIdSet.add(edges[i].id);
  }

  // Build lookup maps for integrity checks
  const nodeById = new Map<string, IRNode>();
  for (const node of nodes) nodeById.set(node.id, node);

  const rootIdSet = new Set<string>();
  for (const root of roots) rootIdSet.add(root.id);

  // 3. Every edge's from/to must reference an existing node
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!nodeById.has(edge.from)) {
      throw new IRValidationError(
        `ir.edges[${i}].from`,
        `references non-existent node '${edge.from}'`,
      );
    }
    if (!nodeById.has(edge.to)) {
      throw new IRValidationError(
        `ir.edges[${i}].to`,
        `references non-existent node '${edge.to}'`,
      );
    }
  }

  // 4. Every root in roots must appear in nodes
  for (let i = 0; i < roots.length; i++) {
    if (!nodeById.has(roots[i].id)) {
      throw new IRValidationError(
        `ir.roots[${i}].id`,
        `root '${roots[i].id}' not found in nodes`,
      );
    }
  }

  // 5. Every FileNode's ownerRootId must reference a root
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind === "File" && !rootIdSet.has(node.ownerRootId)) {
      throw new IRValidationError(
        `ir.nodes[${i}].ownerRootId`,
        `references non-existent root '${node.ownerRootId}'`,
      );
    }
  }

  // 6. Containment edges: from must be ModuleRoot, to must be File
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (edge.kind === "contains") {
      const fromNode = nodeById.get(edge.from)!;
      const toNode = nodeById.get(edge.to)!;
      if (fromNode.kind !== "ModuleRoot") {
        throw new IRValidationError(
          `ir.edges[${i}].from`,
          `containment edge 'from' must be a ModuleRoot, got '${fromNode.kind}'`,
        );
      }
      if (toNode.kind !== "File") {
        throw new IRValidationError(
          `ir.edges[${i}].to`,
          `containment edge 'to' must be a File, got '${toNode.kind}'`,
        );
      }
    }
  }

  // 7. Import edges: from must be a File
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (edge.kind === "imports") {
      const fromNode = nodeById.get(edge.from)!;
      if (fromNode.kind !== "File") {
        throw new IRValidationError(
          `ir.edges[${i}].from`,
          `import edge 'from' must be a File, got '${fromNode.kind}'`,
        );
      }
    }
  }

  return {
    irVersion: 1,
    generatedAt,
    nodes,
    edges,
    roots,
  };
}
