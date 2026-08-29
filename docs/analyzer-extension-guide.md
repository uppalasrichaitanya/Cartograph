# Analyzer Extension Guide

Analyzers consume the shared parser output and canonical IR. They do not parse source files
or reinterpret repository facts independently.

## Contract

Implement `Analyzer<T>` from `lib/analysis/analyzers/interface.ts`:

- `id` is stable and unique.
- `tier` is `1` for direct analysis of repository facts or `2` for analysis that consumes a
  tier-1 result.
- `dependsOn` lists earlier-tier analyzer IDs read through `context.getResult()`.
- `requires` lists parser capabilities and whether missing coverage should `skip` or
  `degrade` the analyzer.
- `analyze(context)` returns deterministic output and must not mutate parser or IR data.

Register the analyzer in `createBuiltInAnalyzerRegistry()`. The registry rejects duplicate
IDs, missing dependencies, and dependencies from the same or a later tier.

## Evidence Rules

The registry persists an execution summary for every analyzer. Missing capabilities and
reduced parser provenance produce heuristic output; that state propagates to dependent
analyzers. An analyzer must never replace a skipped or uncertain fact with an asserted
absence.

Analyzer output may describe verified or deterministically derived structure. Heuristic
architecture concepts belong in later explicitly heuristic analyzers and must retain
heuristic provenance. AI interpretation never becomes graph geometry.

## Tests

Every analyzer should have:

- a deterministic repeated-run test;
- a capability-gap test for its declared `skip` or `degrade` behavior;
- a provenance propagation test;
- an equivalence test when replacing an existing computation;
- a fixture proving every referenced node or edge ID exists in the canonical IR.
