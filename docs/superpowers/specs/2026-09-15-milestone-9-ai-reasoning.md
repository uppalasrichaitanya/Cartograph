# Milestone 9 — AI Reasoning Layer

The AI boundary is read-only and model-provider neutral. It receives an indexed `GraphQuery`
plus an evidence catalog derived from the analysis result. Tools map 1:1 to the query API:
`getNode`, `getNeighbors`, `findCycles`, and `computeImpact`.

Every claim carries one or more citations. Citation kinds are `node`, `edge`, and
`analyzer-result`; the grounding validator resolves each ID against the catalog before a
response is accepted. Empty query results are represented as explicit uncertainty, never as a
positive architectural claim.

Results are memoized per query context for repeated questions without changing graph state.
No tool writes storage, mutates the IR, or reads persisted blobs directly.

Validation covers forged node and edge citations, analyzer-result citations, and uncertainty for
missing nodes, neighbors, cycles, and impact targets.
