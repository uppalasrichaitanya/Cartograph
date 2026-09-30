/**
 * Path geometry shared by the exported figure and the live map.
 *
 * Pure string-building over points, so the same routed polyline is rounded the
 * same way in both places.
 *
 * @module lib/diagram/geometry
 */
import type { Point } from "./types";

export const CORNER_RADIUS = 8;

const num = (value: number) => String(Math.round(value * 100) / 100);

/** A polyline with each bend rounded by a quadratic curve, at most half of either neighbouring segment. */
export function roundedPath(points: ReadonlyArray<Point>, cornerRadius: number = CORNER_RADIUS): string {
  let d = `M${num(points[0].x)} ${num(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [prev, at, next] = [points[i - 1], points[i], points[i + 1]];
    const before = Math.hypot(at.x - prev.x, at.y - prev.y);
    const after = Math.hypot(next.x - at.x, next.y - at.y);
    const radius = Math.min(cornerRadius, before / 2, after / 2);
    if (radius < 0.5) {
      d += `L${num(at.x)} ${num(at.y)}`;
      continue;
    }
    const entry = { x: at.x + ((prev.x - at.x) / before) * radius, y: at.y + ((prev.y - at.y) / before) * radius };
    const exit = { x: at.x + ((next.x - at.x) / after) * radius, y: at.y + ((next.y - at.y) / after) * radius };
    d += `L${num(entry.x)} ${num(entry.y)}Q${num(at.x)} ${num(at.y)} ${num(exit.x)} ${num(exit.y)}`;
  }
  const last = points[points.length - 1];
  return `${d}L${num(last.x)} ${num(last.y)}`;
}
