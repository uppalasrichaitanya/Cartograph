/**
 * Places a diagram model with ELK's layered algorithm.
 *
 * Dependencies read left to right, containers wrap their units, and edges are
 * orthogonal polylines (the renderer rounds their corners). Shared parts sit
 * on the right edge as the foundation. Output coordinates are
 * absolute, so the renderer never needs to know ELK's relative conventions.
 *
 * @module lib/diagram/layout
 */
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import { monoWidth, TYPE_SCALE, unitBox } from "./metrics";
import type { Box, DiagramModel, DiagramOptions, Point, PositionedDiagram, PositionedEdge } from "./types";

const elk = new ELK();

function rootOptions(): Record<string, string> {
  return {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.spacing.nodeNodeBetweenLayers": "72",
    "elk.spacing.nodeNode": "28",
    "elk.spacing.edgeNode": "18",
    "elk.spacing.edgeEdge": "12",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "12",
    "elk.layered.spacing.edgeNodeBetweenLayers": "20",
    "elk.spacing.edgeLabel": "4",
    "elk.edgeLabels.placement": "CENTER",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.padding": "[top=20,left=20,bottom=20,right=20]",
  };
}

function groupOptions(titleSize: number): Record<string, string> {
  return { "elk.padding": `[top=${Math.round(titleSize * 2.6)},left=18,bottom=18,right=18]` };
}

export async function layoutDiagram(model: DiagramModel, options: DiagramOptions): Promise<PositionedDiagram> {
  const reserveCaption = options.annotations === "measured+ai";
  const type = TYPE_SCALE[options.preset];
  const sizes = new Map(model.units.map((unit) => [unit.id, unitBox(unit, options.preset, reserveCaption)]));

  const elkNodes = new Map<string, ElkNode>();
  for (const group of model.groups) {
    elkNodes.set(group.id, { id: group.id, layoutOptions: groupOptions(type.groupTitle), children: [] });
  }
  for (const unit of model.units) {
    const size = sizes.get(unit.id)!;
    const constraint = unit.side === "in" ? "FIRST" : unit.side === "out" || (unit.sharedBy && !unit.groupId) ? "LAST" : null;
    elkNodes.set(unit.id, {
      id: unit.id,
      width: size.width,
      height: size.height,
      ...(constraint ? { layoutOptions: { "elk.layered.layering.layerConstraint": constraint } } : {}),
    });
  }
  const root: ElkNode = { id: "root", layoutOptions: rootOptions(), children: [] };
  const parentOf = (id: string | null) => (id ? elkNodes.get(id)! : root);
  for (const group of model.groups) parentOf(group.parentId).children!.push(elkNodes.get(group.id)!);
  for (const unit of model.units) parentOf(unit.groupId).children!.push(elkNodes.get(unit.id)!);

  const labelHeight = Math.round(type.edgeLabel * 1.5);
  const edges: ElkExtendedEdge[] = model.edges.map((edge) => ({
    id: edge.id,
    sources: [edge.from],
    targets: [edge.to],
    ...(edge.count >= 2
      ? { labels: [{ id: `${edge.id}#label`, text: String(edge.count), width: Math.ceil(monoWidth(String(edge.count), type.edgeLabel) + 10), height: labelHeight }] }
      : {}),
  }));
  root.edges = edges;

  try {
    const result = await elk.layout(root);
    return toPositioned(model, result, reserveCaption);
  } catch {
    return gridFallback(model, sizes, reserveCaption);
  }
}

function toPositioned(model: DiagramModel, result: ElkNode, reserveCaption: boolean): PositionedDiagram {
  const origin = new Map<string, Point>([["root", { x: 0, y: 0 }]]);
  const boxes = new Map<string, Box>();
  const walk = (node: ElkNode, offset: Point) => {
    for (const child of node.children ?? []) {
      const x = offset.x + (child.x ?? 0);
      const y = offset.y + (child.y ?? 0);
      origin.set(child.id, { x, y });
      boxes.set(child.id, { x, y, width: child.width ?? 0, height: child.height ?? 0 });
      walk(child, { x, y });
    }
  };
  walk(result, { x: 0, y: 0 });
  // A missing box means ELK dropped a node: throw so layoutDiagram falls back to the grid.
  const boxOf = (id: string): Box => {
    const box = boxes.get(id);
    if (!box) throw new Error(`Layout returned no box for ${id}.`);
    return box;
  };

  const edgeById = new Map(model.edges.map((edge) => [edge.id, edge]));
  const positionedEdges: PositionedEdge[] = [];
  for (const elkEdge of (result.edges ?? []) as ElkExtendedEdge[]) {
    const edge = edgeById.get(elkEdge.id);
    const section = elkEdge.sections?.[0];
    if (!edge || !section) continue;
    // Sections and labels are relative to the edge's container, not the root.
    const base = origin.get(elkEdge.container ?? "root") ?? { x: 0, y: 0 };
    const shift = (point: { x: number; y: number }): Point => ({ x: base.x + point.x, y: base.y + point.y });
    const bends = section.bendPoints ?? [];
    const label = elkEdge.labels?.[0];
    positionedEdges.push({
      edge,
      points: [shift(section.startPoint), ...bends.map(shift), shift(section.endPoint)],
      curved: false, // ORTHOGONAL sections are straight segments through the bend points
      label: label && label.x !== undefined && label.y !== undefined
        ? { x: base.x + label.x, y: base.y + label.y, width: label.width ?? 0, height: label.height ?? 0 }
        : null,
    });
  }
  positionedEdges.sort((a, b) => a.edge.id.localeCompare(b.edge.id));

  return {
    model,
    width: Math.max(40, Math.ceil(result.width ?? 0)),
    height: Math.max(40, Math.ceil(result.height ?? 0)),
    units: new Map(model.units.map((unit) => [unit.id, boxOf(unit.id)])),
    groups: new Map(model.groups.map((group) => [group.id, boxOf(group.id)])),
    edges: positionedEdges,
    simplified: false,
    reserveCaption,
  };
}

/** If ELK fails, draw a plain grid with straight arrows, and say so on the figure. */
export function gridFallback(
  model: DiagramModel,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  reserveCaption: boolean,
): PositionedDiagram {
  const columns = Math.max(1, Math.ceil(Math.sqrt(model.units.length)));
  // Math.max of nothing is -Infinity, so an empty figure gets a plain minimum canvas.
  const cellWidth = Math.max(0, ...[...sizes.values()].map((size) => size.width)) + 60;
  const cellHeight = Math.max(0, ...[...sizes.values()].map((size) => size.height)) + 60;
  const units = new Map<string, Box>();
  model.units.forEach((unit, index) => {
    const size = sizes.get(unit.id)!;
    units.set(unit.id, { x: 20 + (index % columns) * cellWidth, y: 20 + Math.floor(index / columns) * cellHeight, ...size });
  });
  const center = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  return {
    model,
    width: Math.max(40, 40 + columns * cellWidth),
    height: Math.max(40, 40 + Math.ceil(model.units.length / columns) * cellHeight),
    units,
    groups: new Map(),
    edges: model.edges.map((edge) => ({
      edge,
      points: [center(units.get(edge.from)!), center(units.get(edge.to)!)],
      curved: false,
      label: null,
    })),
    simplified: true,
    reserveCaption,
  };
}
