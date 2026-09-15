# Milestone 8 — Query Layer & Storage Evolution

## Decision

Persisted analysis blobs remain unchanged. Consumers receive a stable `GraphQuery`
interface and construct an ephemeral indexed view for point lookups and traversals.

The contract supports both the legacy `DependencyGraph` (file-level import edges) and
the canonical `RepositoryIR` (opaque IDs, provenance, and separate `contains`/`imports`
edges). Query results are deterministic: node IDs and neighbor lists are lexicographically
ordered, and cycle signatures are canonicalized.

## Contract

- `getNode(id)` returns one node or `undefined`.
- `getNeighbors(id, direction, edgeKinds?)` returns unique adjacent nodes; direction is
  outgoing, incoming, or both. IR callers can restrict to containment or imports.
- `findCycles()` returns canonical directed cycles over import edges.
- `computeImpact(id)` returns all transitive importers of a node, excluding the subject.

`LinearGraphQuery` is retained as a reference implementation for contract tests and future
backend comparisons. `IndexedGraphQuery` is the production prototype. Storage backends do
not yet persist indexes, avoiding a migration while query semantics are validated.

## Validation

Contract tests compare indexed and linear outputs, verify IR edge-kind separation, and cover
cycles, impact, unknown IDs, and deterministic ordering. An 800-file benchmark smoke test
checks point-query latency against the 200ms budget and ensures indexing beats a linear scan
on the same fixture.

Sample run on the development environment (2026-09-15):

| Nodes | Linear point lookups | Indexed point lookups | Impact | Cycles |
|---:|---:|---:|---:|---:|
| 100 | 0.91 ms | 0.12 ms | 7.57 ms | 0.35 ms |
| 800 | 2.45 ms | 0.07 ms | 0.85 ms | 0.48 ms |
| 5,000 | 29.96 ms | 0.51 ms | 5.02 ms | 5.83 ms |
