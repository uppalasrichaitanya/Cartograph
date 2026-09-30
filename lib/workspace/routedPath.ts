/**
 * The live map's routed edge path.
 *
 * ELK routes each file-view edge at analysis time, from the source node's
 * right-middle to the target's left-middle. On the client React Flow reports
 * where the handles actually are, a few pixels off the box edge, or somewhere
 * else entirely once the person drags a node. This module re-anchors the
 * stored route to the reported handles and draws it with the same rounded
 * corners as the exported figure, or returns null when the route no longer
 * describes the edge and the caller should draw its own.
 *
 * @module lib/workspace/routedPath
 */
import { roundedPath } from "@/lib/diagram/geometry";
import type { Point } from "@/lib/diagram/types";

/** How far a handle may sit from the route's end point before the route is stale. */
const SNAP_TOLERANCE = 8;
/** Coordinates closer than this are the same coordinate. */
const EPSILON = 0.01;

const same = (a: number, b: number) => Math.abs(a - b) < EPSILON;

/** Move the point after `end` along the axis the end segment ran on, so it stays orthogonal. */
function follow(points: Point[], endIndex: number, neighbourIndex: number, original: Point, originalNeighbour: Point) {
  const end = points[endIndex];
  const neighbour = points[neighbourIndex];
  if (same(original.y, originalNeighbour.y)) neighbour.y = end.y;
  else if (same(original.x, originalNeighbour.x)) neighbour.x = end.x;
}

/** Drop repeated points and points that lie on a straight run between their neighbours. */
function simplify(points: ReadonlyArray<Point>): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && same(last.x, point.x) && same(last.y, point.y)) continue;
    out.push(point);
  }
  return out.filter((point, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const [prev, next] = [out[i - 1], out[i + 1]];
    const horizontal = same(prev.y, point.y) && same(point.y, next.y);
    const vertical = same(prev.x, point.x) && same(point.x, next.x);
    return !(horizontal || vertical);
  });
}

/**
 * An SVG path along `route`, anchored at `source` and `target`.
 *
 * @returns null when the route has fewer than two points or either handle is
 *   more than 8px from the route's end point (a dragged node).
 */
export function routedEdgePath(
  route: ReadonlyArray<Point>,
  source: Point,
  target: Point,
  radius = 8,
): string | null {
  if (route.length < 2) return null;
  const first = route[0];
  const last = route[route.length - 1];
  if (Math.hypot(source.x - first.x, source.y - first.y) > SNAP_TOLERANCE) return null;
  if (Math.hypot(target.x - last.x, target.y - last.y) > SNAP_TOLERANCE) return null;

  const n = route.length;
  const points: Point[] = route.map((p) => ({ x: p.x, y: p.y }));
  points[0] = { x: source.x, y: source.y };
  points[n - 1] = { x: target.x, y: target.y };

  if (n === 2) {
    // A straight run between handles that no longer line up: jog at mid-length.
    if (same(first.y, last.y) && !same(source.y, target.y)) {
      const mid = (source.x + target.x) / 2;
      points.splice(1, 0, { x: mid, y: source.y }, { x: mid, y: target.y });
    } else if (same(first.x, last.x) && !same(source.x, target.x)) {
      const mid = (source.y + target.y) / 2;
      points.splice(1, 0, { x: source.x, y: mid }, { x: target.x, y: mid });
    }
  } else {
    follow(points, 0, 1, first, route[1]);
    follow(points, n - 1, n - 2, last, route[n - 2]);
  }

  return roundedPath(simplify(points), radius);
}
