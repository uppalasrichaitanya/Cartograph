# Milestone 10 — Heuristic Architecture Views

Heuristic views are an additive projection over the canonical IR. The inference engine groups
files into `layer` and `domain` records using path conventions and import-edge lineage. These
records never replace verified nodes, edges, or Architecture Model boundaries.

Each inferred group is tagged `heuristic`, includes `derivedFrom` node/edge IDs, and carries a
note that the result may be wrong. Explicit node-to-group assignments are accepted through the
override schema and are tagged `user-defined`; they take precedence only for the assigned node.

The client renders heuristic views in a separate dashed control and popover with an uncertainty
disclaimer. They are intentionally not mixed into confidence geometry or deterministic
observation lenses.
