import type { EdgeId, NodeId, Provenance } from "../ir/types";

export function deriveProvenance(
  inputs: ReadonlyArray<Provenance>,
  derivedFrom: ReadonlyArray<NodeId | EdgeId>,
  note = "One or more inputs had reduced provenance",
): Provenance {
  const reduced = inputs.some(
    (input) => input.origin !== "verified" && input.origin !== "derived",
  );
  return reduced
    ? { origin: "heuristic", derivedFrom: [...derivedFrom], note }
    : { origin: "derived", derivedFrom: [...derivedFrom] };
}
