# Milestones 5-6: Analyzer Framework and Architecture Model

**Status:** Complete.

## Delivered

- Added a minimal `Analyzer` contract with stable IDs, two ordered tiers, explicit
  earlier-tier dependencies, and `AnalysisContext.getResult()` lookup.
- Added capability requirements with explicit `skip` or `degrade` behavior.
- Propagated reduced capability/provenance through dependent analyzers so downstream output
  never silently appears stronger than its inputs.
- Migrated dependency graph construction, folder clustering, and dependency observations to
  built-in analyzer plugins without changing their existing public helper functions.
- Persisted optional analyzer execution summaries; older stored analyses remain valid.
- Added a deterministic Architecture Model over canonical IR node IDs.
- Indexed module roots, folder hierarchy, and the existing display-region grouping with
  stable boundary IDs, parent relationships, provenance, and query methods.
- Migrated the folder analyzer and render pipeline to Architecture Model regions while
  preserving the previous grouping output exactly.
- Persisted the optional Architecture Model; older analyses fall back to their stored
  clusters and render data.

## Verification

- Analyzer contract tests cover tier ordering, earlier-result lookup, duplicate IDs, invalid
  dependencies, capability degradation, skipping, dependency propagation, and determinism.
- Architecture Model tests cover canonical-ID queries, folder hierarchy, legacy grouping
  equivalence, byte-identical repeated builds, runtime validation, and provenance propagation.
- Existing parser, IR, safety, workspace, and browser-facing behavior remains covered by the
  full suite.

## Explicit Non-Goals

- No analyzer DAG scheduler or third-party plugin sandbox.
- No heuristic layers, domains, services, or inferred architecture boundaries.
- No call graph or symbol-reference edges.
- No change to dependency geometry: it remains file-level and import-based.

Milestone 7, Third Language and Capability Stress Test, is next. It should add a structurally
different language without changing the parser interface, analyzer interface, IR schema, or
Architecture Model contract.
