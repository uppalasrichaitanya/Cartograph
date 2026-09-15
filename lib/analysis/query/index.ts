import type { EdgeKind, IRNode, RepositoryIR } from "@/lib/analysis/ir/types";
import type { DependencyGraph, GraphNode } from "@/types/graph";

export type NeighborDirection = "outgoing" | "incoming" | "both";
export type QueryEdgeKind = EdgeKind;
export type QueryNode = GraphNode | IRNode;

export interface GraphQuery<TNode extends QueryNode = QueryNode> {
  getNode(id: string): TNode | undefined;
  getEdge(id: string): QueryEdge | undefined;
  getNeighbors(
    id: string,
    direction?: NeighborDirection,
    edgeKinds?: ReadonlyArray<QueryEdgeKind>,
  ): ReadonlyArray<TNode>;
  findCycles(): ReadonlyArray<ReadonlyArray<string>>;
  computeImpact(id: string): ReadonlyArray<TNode>;
}

export type QueryEdge = Readonly<{ id?: string; from: string; to: string; kind: QueryEdgeKind }>;
type QuerySource<TNode extends QueryNode> = Readonly<{
  nodes: ReadonlyArray<TNode>;
  edges: ReadonlyArray<QueryEdge>;
}>;

function sourceFromGraph(graph: DependencyGraph): QuerySource<GraphNode> {
  return {
    nodes: graph.nodes,
    edges: graph.edges.map((edge) => ({ ...edge, kind: "imports" as const })),
  };
}

function sourceFromIR(ir: RepositoryIR): QuerySource<IRNode> {
  return { nodes: ir.nodes, edges: ir.edges };
}

function canonicalCycle(cycle: string[]): string {
  const open = cycle.slice(0, -1);
  const rotations = open.map((_, index) => [...open.slice(index), ...open.slice(0, index)]);
  return rotations.map((rotation) => rotation.join("\u0000")).sort()[0] ?? "";
}

function findCycles(
  nodeIds: ReadonlyArray<string>,
  outgoing: (id: string) => ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<string>> {
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const known = new Set<string>();
  const visit = (nodeId: string) => {
    state.set(nodeId, "visiting");
    stack.push(nodeId);
    for (const next of outgoing(nodeId)) {
      if (state.get(next) === "visiting") {
        const cycle = [...stack.slice(stack.indexOf(next)), next];
        const signature = canonicalCycle(cycle);
        if (!known.has(signature)) {
          known.add(signature);
          cycles.push(cycle);
        }
      } else if (!state.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(nodeId, "visited");
  };
  for (const id of [...nodeIds].sort((a, b) => a.localeCompare(b))) {
    if (!state.has(id)) visit(id);
  }
  return cycles;
}

function computeImpact<TNode extends QueryNode>(
  id: string,
  getNode: (nodeId: string) => TNode | undefined,
  incoming: (nodeId: string) => ReadonlyArray<string>,
): ReadonlyArray<TNode> {
  if (!getNode(id)) return [];
  const seen = new Set<string>();
  const queue = [...incoming(id)];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === id || seen.has(current)) continue;
    seen.add(current);
    queue.push(...incoming(current));
  }
  return [...seen]
    .sort((a, b) => a.localeCompare(b))
    .map(getNode)
    .filter((node): node is TNode => Boolean(node));
}

function accepts(kind: QueryEdgeKind, edgeKinds?: ReadonlyArray<QueryEdgeKind>): boolean {
  return edgeKinds === undefined || edgeKinds.includes(kind);
}

/** Baseline adapter that scans the deserialized graph for every query. */
export class LinearGraphQuery<TNode extends QueryNode> implements GraphQuery<TNode> {
  constructor(private readonly source: QuerySource<TNode>) {}

  getNode(id: string): TNode | undefined {
    return this.source.nodes.find((node) => node.id === id);
  }

  getEdge(id: string): QueryEdge | undefined {
    return this.source.edges.find((edge) => edge.id === id);
  }

  getNeighbors(
    id: string,
    direction: NeighborDirection = "outgoing",
    edgeKinds?: ReadonlyArray<QueryEdgeKind>,
  ): ReadonlyArray<TNode> {
    const ids = new Set<string>();
    for (const edge of this.source.edges) {
      if (!accepts(edge.kind, edgeKinds)) continue;
      if ((direction === "outgoing" || direction === "both") && edge.from === id) ids.add(edge.to);
      if ((direction === "incoming" || direction === "both") && edge.to === id) ids.add(edge.from);
    }
    return [...ids]
      .sort((a, b) => a.localeCompare(b))
      .map((nodeId) => this.getNode(nodeId))
      .filter((node): node is TNode => Boolean(node));
  }

  findCycles(): ReadonlyArray<ReadonlyArray<string>> {
    return findCycles(
      this.source.nodes.map((node) => node.id),
      (id) => this.getNeighbors(id, "outgoing", ["imports"]).map((node) => node.id),
    );
  }

  computeImpact(id: string): ReadonlyArray<TNode> {
    return computeImpact(
      id,
      (nodeId) => this.getNode(nodeId),
      (nodeId) => this.getNeighbors(nodeId, "incoming", ["imports"]).map((node) => node.id),
    );
  }
}

/** Ephemeral indexed backend; persisted blob/local storage remains unchanged. */
export class IndexedGraphQuery<TNode extends QueryNode> implements GraphQuery<TNode> {
  private readonly nodesById: ReadonlyMap<string, TNode>;
  private readonly edgesById: ReadonlyMap<string, QueryEdge>;
  private readonly outgoing: ReadonlyMap<string, ReadonlyArray<QueryEdge>>;
  private readonly incoming: ReadonlyMap<string, ReadonlyArray<QueryEdge>>;

  constructor(source: QuerySource<TNode>) {
    const nodes = new Map(source.nodes.map((node) => [node.id, node]));
    const out = new Map<string, QueryEdge[]>();
    const inbound = new Map<string, QueryEdge[]>();
    const byId = new Map<string, QueryEdge>();
    for (const node of source.nodes) {
      out.set(node.id, []);
      inbound.set(node.id, []);
    }
    for (const edge of source.edges) {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
      if (edge.id) byId.set(edge.id, edge);
      out.get(edge.from)?.push(edge);
      inbound.get(edge.to)?.push(edge);
    }
    for (const values of out.values()) values.sort((a, b) => a.to.localeCompare(b.to));
    for (const values of inbound.values()) values.sort((a, b) => a.from.localeCompare(b.from));
    this.nodesById = nodes;
    this.edgesById = byId;
    this.outgoing = out;
    this.incoming = inbound;
  }

  getNode(id: string): TNode | undefined {
    return this.nodesById.get(id);
  }

  getEdge(id: string): QueryEdge | undefined {
    return this.edgesById.get(id);
  }

  getNeighbors(
    id: string,
    direction: NeighborDirection = "outgoing",
    edgeKinds?: ReadonlyArray<QueryEdgeKind>,
  ): ReadonlyArray<TNode> {
    const ids = new Set<string>();
    if (direction === "outgoing" || direction === "both") {
      for (const edge of this.outgoing.get(id) ?? []) if (accepts(edge.kind, edgeKinds)) ids.add(edge.to);
    }
    if (direction === "incoming" || direction === "both") {
      for (const edge of this.incoming.get(id) ?? []) if (accepts(edge.kind, edgeKinds)) ids.add(edge.from);
    }
    return [...ids]
      .sort((a, b) => a.localeCompare(b))
      .map((nodeId) => this.nodesById.get(nodeId))
      .filter((node): node is TNode => Boolean(node));
  }

  findCycles(): ReadonlyArray<ReadonlyArray<string>> {
    return findCycles([...this.nodesById.keys()], (id) =>
      (this.outgoing.get(id) ?? [])
        .filter((edge) => edge.kind === "imports")
        .map((edge) => edge.to),
    );
  }

  computeImpact(id: string): ReadonlyArray<TNode> {
    return computeImpact(
      id,
      (nodeId) => this.nodesById.get(nodeId),
      (nodeId) => (this.incoming.get(nodeId) ?? [])
        .filter((edge) => edge.kind === "imports")
        .map((edge) => edge.from),
    );
  }
}

export function createGraphQuery(graph: DependencyGraph): GraphQuery<GraphNode>;
export function createGraphQuery(ir: RepositoryIR): GraphQuery<IRNode>;
export function createGraphQuery(source: DependencyGraph | RepositoryIR): GraphQuery {
  const querySource: QuerySource<QueryNode> = "irVersion" in source
    ? sourceFromIR(source)
    : sourceFromGraph(source);
  return new IndexedGraphQuery(querySource);
}

export function createLinearGraphQuery(graph: DependencyGraph): GraphQuery<GraphNode>;
export function createLinearGraphQuery(ir: RepositoryIR): GraphQuery<IRNode>;
export function createLinearGraphQuery(source: DependencyGraph | RepositoryIR): GraphQuery {
  const querySource: QuerySource<QueryNode> = "irVersion" in source
    ? sourceFromIR(source)
    : sourceFromGraph(source);
  return new LinearGraphQuery(querySource);
}
