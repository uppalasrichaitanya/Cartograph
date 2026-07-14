"use client";

import { useReactFlow } from "@xyflow/react";

export function ZoomControls() {
  const { zoomIn, zoomOut, fitView, getZoom } = useReactFlow();

  return (
    <div className="zoom-controls" role="group" aria-label="Zoom controls">
      <button
        type="button"
        className="zoom-btn"
        onClick={() => zoomOut({ duration: 200 })}
        title="Zoom out (−)"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        className="zoom-btn"
        onClick={() => fitView({ padding: 0.12, duration: 300 })}
        title="Fit to view (F)"
        aria-label="Fit view"
      >
        ⊡
      </button>
      <button
        type="button"
        className="zoom-btn"
        onClick={() => zoomIn({ duration: 200 })}
        title="Zoom in (+)"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
