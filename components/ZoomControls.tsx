"use client";

import { useReactFlow } from "@xyflow/react";
import { cameraMotion } from "@/lib/workspace/motion";
import { FitIcon, ZoomInIcon, ZoomOutIcon } from "./Icons";

/**
 * Zoom and fit.
 *
 * All three are connective. The map's contents do not change, but the frame
 * does, and travelling to the new framing is what shows a person they are
 * looking at the same structure from a different distance rather than at
 * something new. A zoom that teleports has to be re-read from scratch.
 *
 * Fit shares that duration rather than taking longer for being a larger move:
 * distance travelled is not cognitive significance. Previously zoom ran at
 * 200ms and fit at 300ms, which taught that fitting was a more consequential
 * act than zooming. It is not — both reframe the same unchanged structure.
 *
 * The keyboard shortcut for fit (F, handled in DiagramView) makes the same
 * call with the same tier, so the key and the button cannot diverge.
 */
export function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="zoom-controls" role="group" aria-label="Zoom controls">
      <button
        type="button"
        className="zoom-btn"
        onClick={() => zoomOut(cameraMotion("connective"))}
        title="Zoom out"
        aria-label="Zoom out"
      >
        <ZoomOutIcon size={14} />
      </button>
      <button
        type="button"
        className="zoom-btn"
        onClick={() => fitView({ padding: 0.12, ...cameraMotion("connective") })}
        title="Fit to view (F)"
        aria-label="Fit view"
      >
        <FitIcon size={14} />
      </button>
      <button
        type="button"
        className="zoom-btn"
        onClick={() => zoomIn(cameraMotion("connective"))}
        title="Zoom in"
        aria-label="Zoom in"
      >
        <ZoomInIcon size={14} />
      </button>
    </div>
  );
}
