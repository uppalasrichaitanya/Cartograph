"use client";

/**
 * A file-view edge drawn along the route ELK computed at analysis time.
 *
 * The route is anchored to where React Flow reports the handles. When a node
 * has been dragged away from it (or the analysis predates routing), the edge
 * falls back to the smoothstep path it used before, so it is never wrong,
 * only less tidy.
 *
 * @module components/RoutedEdge
 */
import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import { routedEdgePath } from "@/lib/workspace/routedPath";

export type RoutedEdgeData = {
  route?: ReadonlyArray<{ x: number; y: number }>;
  [key: string]: unknown;
};

export function RoutedEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  interactionWidth,
  data,
}: EdgeProps<Edge<RoutedEdgeData>>) {
  const routed = data?.route
    ? routedEdgePath(data.route, { x: sourceX, y: sourceY }, { x: targetX, y: targetY })
    : null;
  const path =
    routed ??
    getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })[0];
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />;
}
