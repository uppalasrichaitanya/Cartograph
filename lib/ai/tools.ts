import type { NeighborDirection, QueryEdgeKind } from "@/lib/analysis/query";
import type { AiQueryContext, AiToolResult, GroundedClaim } from "./types";

const cache = new WeakMap<object, Map<string, unknown>>();
function memo<T>(context: AiQueryContext, key: string, compute: () => T): T {
  let values = cache.get(context);
  if (!values) { values = new Map(); cache.set(context, values); }
  if (values.has(key)) return values.get(key) as T;
  const value = compute(); values.set(key, value); return value;
}

export function getNode(context: AiQueryContext, id: string): AiToolResult<ReturnType<AiQueryContext["query"]["getNode"]>> {
  const value = memo(context, `node:${id}`, () => context.query.getNode(id));
  const claims: GroundedClaim[] = value ? [{ text: `Node '${id}' exists in the repository graph.`, citations: [{ kind: "node", id }] }] : [];
  return value ? { value, claims, uncertain: false } : { value, claims, uncertain: true, uncertainty: `No verified node found for '${id}'.` };
}

export function getNeighbors(context: AiQueryContext, id: string, direction: NeighborDirection = "outgoing", edgeKinds?: ReadonlyArray<QueryEdgeKind>) {
  const value = memo(context, `neighbors:${id}:${direction}:${edgeKinds?.join(",") ?? "*"}`, () => context.query.getNeighbors(id, direction, edgeKinds));
  const claims: GroundedClaim[] = value.length
    ? [{
        text: `Node '${id}' has ${value.length} ${direction} neighbor(s).`,
        citations: [{ kind: "node", id }, ...value.map((node) => ({ kind: "node" as const, id: node.id }))],
      }]
    : [];
  return value.length ? { value, claims, uncertain: false } : { value, claims, uncertain: true, uncertainty: `No verified neighbors found for '${id}'.` };
}

export function findCycles(context: AiQueryContext) {
  const value = memo(context, "cycles", () => context.query.findCycles());
  const claims: GroundedClaim[] = value.map((cycle) => ({ text: `Dependency cycle: ${cycle.join(" -> ")}`, citations: cycle.slice(0, -1).map((id) => ({ kind: "node" as const, id })) }));
  return value.length ? { value, claims, uncertain: false } : { value, claims, uncertain: true, uncertainty: "No verified dependency cycles were found." };
}

export function computeImpact(context: AiQueryContext, id: string) {
  const value = memo(context, `impact:${id}`, () => context.query.computeImpact(id));
  const claims: GroundedClaim[] = value.length
    ? [{
        text: `Changing '${id}' may affect ${value.length} transitive importer(s).`,
        citations: [{ kind: "node", id }, ...value.map((node) => ({ kind: "node" as const, id: node.id }))],
      }]
    : [];
  return value.length ? { value, claims, uncertain: false } : { value, claims, uncertain: true, uncertainty: `No verified impact data found for '${id}'.` };
}
