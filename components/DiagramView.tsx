"use client";

import {
  Background,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult, GraphNode, RenderGraph, RenderNodeData } from "@/types/graph";
import { FileDetailPanel } from "./FileDetailPanel";
import { BreadcrumbNav } from "./BreadcrumbNav";
import { RepoContextBar } from "./RepoContextBar";
import { ConfirmDialog } from "./ConfirmDialog";
import { SearchOverlay } from "./SearchOverlay";
import { ZoomControls } from "./ZoomControls";

/* ─── Types ─── */
type FlowNode = Node<RenderNodeData, "architecture">;
type HighlightMode = "cycles" | "hubs" | "orphans" | "warnings" | "dependencies" | null;

/* ─── Architecture Node ─── */
function ArchitectureNode({ data, id, selected }: NodeProps<FlowNode>) {
  return (
    <div
      className={[
        "architecture-node",
        `architecture-node-${data.kind}`,
        data.variant === "warning" ? "is-warning" : "",
      ].filter(Boolean).join(" ")}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-kicker">{data.kind === "folder" ? "FOLDER" : "FILE"}</div>
      <strong>{data.label}</strong>
      {data.kind === "folder" && <span>{data.fileIds?.length ?? 0} files</span>}
      {data.kind === "file" && <span>{data.filePath}</span>}
      {data.warningCount ? <em>{data.warningCount} warning{data.warningCount === 1 ? "" : "s"}</em> : null}
      <Handle type="source" position={Position.Right} className="node-handle" />
    </div>
  );
}

const nodeTypes = { architecture: ArchitectureNode };

/* ─── Helpers ─── */
function graphToFlow(graph: RenderGraph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, type: "architecture" })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      type: "smoothstep",
      markerEnd: { type: "arrowclosed" as const },
      style: { strokeWidth: 1.4 },
    })),
  };
}


function haveOverlaps(container: HTMLElement): boolean {
  const rectangles = [...container.querySelectorAll<HTMLElement>(".react-flow__node")].map((node) => node.getBoundingClientRect());
  for (let i = 0; i < rectangles.length; i += 1) {
    for (let j = i + 1; j < rectangles.length; j += 1) {
      const a = rectangles[i];
      const b = rectangles[j];
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) return true;
    }
  }
  return false;
}

/** Get all node IDs connected to a given node. */
function getConnectedIds(nodeId: string, edges: Edge[]): Set<string> {
  const connected = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (edge.source === nodeId) connected.add(edge.target);
    if (edge.target === nodeId) connected.add(edge.source);
  }
  return connected;
}

/** Animated count-up hook. */
function useCountUp(target: number, duration = 600, delay = 0): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const timeout = setTimeout(() => {
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // easeOut
        setValue(Math.round(eased * target));
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, duration, delay]);
  return value;
}

/* ─── Animated Stat Component ─── */
function AnimatedStat({ label, value, delay, isActive, onClick }: { label: string; value: number; delay: number; isActive: boolean; onClick: () => void }) {
  const displayed = useCountUp(value, 600, delay);
  return (
    <button type="button" className={`summary-grid-item ${isActive ? "is-active" : ""}`} onClick={onClick} title={`Click to highlight ${label.toLowerCase()}`}>
      <strong>{displayed}</strong>
      <span>{label}</span>
    </button>
  );
}

/* ─── Inner Diagram (inside ReactFlowProvider) ─── */
function DiagramInner({ result }: { result: AnalysisResult }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<GraphNode | null>(null);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>(null);
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);
  const [isFading, setIsFading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [pulsingNodeId, setPulsingNodeId] = useState<string | null>(null);

  const canvas = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useReactFlow();

  const renderGraph = folder ? result.renderData.fileViewByFolder[folder] : result.renderData.folderView;
  const initial = useMemo(() => graphToFlow(renderGraph), [renderGraph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);

  // Sync nodes/edges when view changes.
  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setSelectedFile(null);
    setHighlightMode(null);
    setFocusMode(false);
    setHoveredFileId(null);
  }, [initial, setEdges, setNodes]);

  // Overlap detection on folder drill-down.
  useEffect(() => {
    if (!folder || !canvas.current) return;
    const frame = requestAnimationFrame(() => {
      if (canvas.current && haveOverlaps(canvas.current)) {
        setLayoutNotice(`The ${folder} file view is too dense, so the folder overview is shown instead.`);
        setFolder(null);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [folder, nodes]);

  /* ─── Highlight Modes (Issue 3, 4) ─── */
  const getHighlightedNodeIds = useCallback((): Set<string> | null => {
    if (!highlightMode) return null;
    const ids = new Set<string>();
    switch (highlightMode) {
      case "cycles":
        for (const cycle of result.anomalies.cycles) {
          for (const nodeId of cycle) ids.add(nodeId);
        }
        break;
      case "hubs":
        for (const hub of result.anomalies.godModules) ids.add(hub.filePath);
        break;
      case "orphans":
        for (const orphan of result.anomalies.orphans) ids.add(orphan);
        break;
      case "warnings":
        for (const hub of result.anomalies.godModules) ids.add(hub.filePath);
        for (const orphan of result.anomalies.orphans) ids.add(orphan);
        for (const cycle of result.anomalies.cycles) {
          for (const nodeId of cycle) ids.add(nodeId);
        }
        break;
      case "dependencies":
        return null; // Dependencies highlights edges, not specific nodes.
    }
    return ids;
  }, [highlightMode, result.anomalies]);

  /* ─── Apply visual highlight to nodes and edges ─── */
  useEffect(() => {
    const highlightedIds = getHighlightedNodeIds();
    const hoverConnected = hoveredFileId ? getConnectedIds(hoveredFileId, edges) : null;
    const focusConnected = focusMode && selectedFile ? getConnectedIds(selectedFile.id, edges) : null;

    // Determine which set of IDs should be "active" (not dimmed).
    const activeIds = hoverConnected ?? focusConnected ?? highlightedIds;

    setNodes((current) =>
      current.map((node) => {
        const isDimmed = activeIds ? !activeIds.has(node.id) : false;
        const isHovered = node.id === hoveredFileId;
        // Neighbor = connected to hovered/focus node but not the node itself.
        const isNeighbor = !isHovered && hoverConnected != null && hoverConnected.has(node.id);
        const isSelected = selectedFile?.id === node.id || selectedFile?.id === node.data.filePath;
        const isPulsing = pulsingNodeId === node.id;

        const className = [
          isSelected ? "is-selected" : "",
          isPulsing ? "is-pulsing" : "",
          // Neighbor takes priority over dimmed.
          isDimmed && !isNeighbor ? "is-dimmed" : "",
          isNeighbor && !isSelected ? "is-neighbor" : "",
        ].filter(Boolean).join(" ");

        if (node.className === className) return node;
        return { ...node, className };
      }),
    );

    setEdges((current) =>
      current.map((edge) => {
        const isHighlighted = hoveredFileId
          ? (edge.source === hoveredFileId || edge.target === hoveredFileId)
          : highlightMode === "dependencies"
            ? true
            : activeIds
              ? (activeIds.has(edge.source) && activeIds.has(edge.target))
              : false;

        const strokeWidth = isHighlighted ? 2.5 : 1.4;
        const opacity = activeIds || hoveredFileId ? (isHighlighted ? 1 : 0.12) : 1;
        const stroke = isHighlighted ? "#3851e8" : undefined;

        return {
          ...edge,
          style: { ...edge.style, strokeWidth, opacity, stroke },
        };
      }),
    );
  }, [hoveredFileId, highlightMode, focusMode, selectedFile, pulsingNodeId, edges.length, getHighlightedNodeIds, setNodes, setEdges]);

  /* ─── Navigate to a node: pan camera, highlight, update panel (Issue 1, 2) ─── */
  const navigateToNode = useCallback(
    (nodeId: string) => {
      // Find the node in the current view.
      const flowNode = reactFlowInstance.getNode(nodeId);
      if (!flowNode) {
        // Node might be in a different folder view — check which folder.
        const graphNode = result.graph.nodes.find((n) => n.id === nodeId);
        if (graphNode && graphNode.folder !== folder) {
          // Switch folder first, then navigate after render.
          setFolder(graphNode.folder);
          // Delay navigation until the folder view loads.
          setTimeout(() => {
            const node = reactFlowInstance.getNode(nodeId);
            if (node) {
              reactFlowInstance.setCenter(
                (node.position.x ?? 0) + (node.measured?.width ?? 180) / 2,
                (node.position.y ?? 0) + (node.measured?.height ?? 60) / 2,
                { zoom: 1, duration: 300 },
              );
            }
          }, 400);
        }
        if (graphNode) setSelectedFile(graphNode);
        return;
      }

      const nodeX = (flowNode.position.x ?? 0) + (flowNode.measured?.width ?? 180) / 2;
      const nodeY = (flowNode.position.y ?? 0) + (flowNode.measured?.height ?? 60) / 2;

      // Issue 1: Offset camera if panel is open (avoids node hidden behind panel).
      const panelOffset = selectedFile ? 100 : 0;
      reactFlowInstance.setCenter(nodeX + panelOffset, nodeY, { zoom: 1, duration: 300 });

      // Update selection and pulse.
      const graphNode = result.graph.nodes.find((n) => n.id === nodeId);
      if (graphNode) {
        setSelectedFile(graphNode);
        setPulsingNodeId(nodeId);
        setTimeout(() => setPulsingNodeId(null), 800);
      }
    },
    [reactFlowInstance, result.graph.nodes, folder, selectedFile, setPulsingNodeId],
  );

  /* ─── Node Click Handler ─── */
  const onNodeClick: NodeMouseHandler<FlowNode> = useCallback(
    (_, node) => {
      if (node.data.kind === "folder" && node.data.folder) {
        setLayoutNotice(null);
        setIsFading(true);
        setTimeout(() => {
          setFolder(node.data.folder!);
          setIsFading(false);
        }, 150);
        return;
      }
      if (node.data.kind === "file" && node.data.filePath) {
        const graphNode = result.graph.nodes.find((file) => file.id === node.data.filePath) ?? null;
        setSelectedFile(graphNode);

        // After the CSS width transition fires, re-center on the node.
        // Using transitionend is more robust than a hardcoded timeout.
        if (graphNode && canvas.current) {
          const nodeX = (node.position.x ?? 0) + (node.measured?.width ?? 180) / 2;
          const nodeY = (node.position.y ?? 0) + (node.measured?.height ?? 60) / 2;

          const handleTransitionEnd = (e: TransitionEvent) => {
            if (e.propertyName !== "width") return;
            canvas.current?.removeEventListener("transitionend", handleTransitionEnd);
            reactFlowInstance.setCenter(nodeX, nodeY, { duration: 250 });
          };
          canvas.current.addEventListener("transitionend", handleTransitionEnd, { once: true });

          // Fallback: if the panel was already open (no width transition), re-center immediately.
          requestAnimationFrame(() => {
            // If the element already has has-panel-open, no transition will fire.
            if (!canvas.current?.classList.contains("has-panel-open")) {
              canvas.current?.removeEventListener("transitionend", handleTransitionEnd);
              reactFlowInstance.setCenter(nodeX + 100, nodeY, { duration: 250 });
            }
          });

          // Pulse the node.
          setPulsingNodeId(node.id);
          setTimeout(() => setPulsingNodeId(null), 800);
        }
      }
    },
    [result.graph.nodes, reactFlowInstance, setPulsingNodeId],
  );

  /* ─── Hover (graph nodes) ─── */
  const onNodeMouseEnter: NodeMouseHandler<FlowNode> = useCallback((_, node) => {
    setHoveredFileId(node.id);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoveredFileId(null);
  }, []);

  /* ─── Folder navigation ─── */
  const goToFolderOverview = useCallback(() => {
    setIsFading(true);
    setTimeout(() => {
      setFolder(null);
      setIsFading(false);
    }, 150);
  }, []);

  /* ─── Toggle highlight mode (Issue 3, 4) ─── */
  const toggleHighlight = useCallback((mode: HighlightMode) => {
    setHighlightMode((current) => (current === mode ? null : mode));
  }, []);

  /* ─── Search items ─── */
  const searchItems = useMemo(() =>
    result.graph.nodes.map((node) => ({
      id: node.id,
      label: node.path,
      folder: node.folder,
    })), [result.graph.nodes]);

  /* ─── Keyboard shortcuts (Issue 15) ─── */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle when typing in inputs.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "f")) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (searchOpen) { setSearchOpen(false); return; }
        if (selectedFile) { setSelectedFile(null); setFocusMode(false); return; }
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        reactFlowInstance.fitView({ padding: 0.12, duration: 300 });
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, selectedFile, reactFlowInstance]);

  /* ─── Close panel and restore viewport (Issue 1) ─── */
  const closePanel = useCallback(() => {
    setSelectedFile(null);
    setFocusMode(false);
  }, []);

  /* ─── Summary stats ─── */
  const HIGHLIGHT_NAMES: Partial<Record<NonNullable<HighlightMode>, string>> = {
    cycles: "Circular Dependencies",
    hubs: "Dependency Hubs",
    orphans: "Orphans",
    warnings: "Warnings",
    dependencies: "All Dependencies",
  };

  const summary: { label: string; value: number; mode: HighlightMode }[] = [
    { label: "Files", value: result.graph.nodes.length, mode: null },
    { label: "Dependencies", value: result.graph.edges.length, mode: "dependencies" },
    { label: "Cycles", value: result.anomalies.cycles.length, mode: "cycles" },
    { label: "Warnings", value: result.anomalies.godModules.length + result.anomalies.orphans.length, mode: "warnings" },
  ];

  return (
    <main className="diagram-page">
      {/* ─── Header ─── */}
      <header className="diagram-header">
        <button
          type="button"
          className="brand"
          onClick={() => setShowConfirm(true)}
          aria-label="Cartograph home"
        >
          <span className="brand-mark" aria-hidden="true">⌘</span>
          Cartograph
        </button>
        <div className="diagram-meta">
          <span>Static import graph</span>
          <button type="button" className="share-button" onClick={() => navigator.clipboard.writeText(window.location.href)}>
            Copy share link
          </button>
        </div>
      </header>

      {/* ─── Repo Context (Issue 6) ─── */}
      <RepoContextBar meta={result.repoMeta} />

      {/* ─── Title Row + Animated Stats (Issue 4, 26) ─── */}
      <section className="diagram-title-row">
        <div>
          <p className="eyebrow">REPOSITORY MAP</p>
          <h1>{folder ? folder : "Folder overview"}</h1>
          <p>{folder ? "Click a file to inspect its resolved imports." : "Click a folder to drill into its file-level map."}</p>
        </div>
        <div className="summary-grid" aria-label="Analysis summary">
          {summary.map((item, i) => (
            <AnimatedStat
              key={item.label}
              label={item.label}
              value={item.value}
              delay={i * 80}
              isActive={highlightMode === item.mode && item.mode !== null}
              onClick={() => {
                if (item.mode === null) {
                  // "Files" → fit view
                  reactFlowInstance.fitView({ padding: 0.12, duration: 300 });
                } else {
                  toggleHighlight(item.mode);
                }
              }}
            />
          ))}
        </div>
      </section>

      {/* ─── Breadcrumb (Issue 7) ─── */}
      <BreadcrumbNav
        folder={folder}
        selectedFileName={selectedFile?.path.split("/").pop() ?? null}
        onNavigateRoot={goToFolderOverview}
        onNavigateFolder={() => setSelectedFile(null)}
      />

      {layoutNotice && <p className="layout-notice" role="status">{layoutNotice}</p>}

      {/* ─── Active filter banner (inside canvas area, above the ReactFlow) ─── */}
      {highlightMode && (
        <div className="filter-banner" role="status">
          <span className="filter-banner-label">Highlighting:</span>
          <span className="filter-banner-name">{HIGHLIGHT_NAMES[highlightMode] ?? highlightMode}</span>
          <button
            type="button"
            className="filter-banner-clear"
            onClick={() => setHighlightMode(null)}
          >
            Clear
          </button>
        </div>
      )}

      {/* ─── Canvas (Issue 8, 18) ─── */}
      <section className={`canvas-card ${isFading ? "is-fading" : ""} ${selectedFile ? "has-panel-open" : ""}`} ref={canvas} aria-label="Interactive dependency diagram">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.05}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <ZoomControls />
          <MiniMap
            nodeColor={(node) => node.data?.variant === "warning" ? "#f59e0b" : "#3851e8"}
            zoomable
            pannable
          />
        </ReactFlow>

        {/* Keyboard hint */}
        <div className="kbd-hint">
          <kbd>⌘K</kbd> Search · <kbd>F</kbd> Fit · <kbd>Esc</kbd> Close
        </div>
      </section>

      {/* ─── Analytics Cards (Issue 3) ─── */}
      <section className="anomalies" aria-label="Detected anomalies">
        <button
          type="button"
          className={`anomaly-card ${highlightMode === "cycles" ? "is-active" : ""}`}
          onClick={() => toggleHighlight("cycles")}
        >
          <h2>Circular dependencies <span>{result.anomalies.cycles.length}</span></h2>
          {result.anomalies.cycles.length > 0 ? (
            <ul className="anomaly-items">
              {result.anomalies.cycles.slice(0, 3).map((cycle, i) => (
                <li key={i} className="anomaly-item" onClick={(e) => { e.stopPropagation(); navigateToNode(cycle[0]); }}>
                  {cycle.join(" → ")}
                </li>
              ))}
            </ul>
          ) : (
            <p>No cycles found.</p>
          )}
        </button>

        <button
          type="button"
          className={`anomaly-card ${highlightMode === "hubs" ? "is-active" : ""}`}
          onClick={() => toggleHighlight("hubs")}
        >
          <h2>Dependency hubs <span>{result.anomalies.godModules.length}</span></h2>
          {result.anomalies.godModules.length > 0 ? (
            <ul className="anomaly-items">
              {result.anomalies.godModules.slice(0, 3).map((mod) => (
                <li key={mod.filePath} className="anomaly-item" onClick={(e) => { e.stopPropagation(); navigateToNode(mod.filePath); }}>
                  {mod.filePath} ({mod.inDegree})
                </li>
              ))}
            </ul>
          ) : (
            <p>No high in-degree modules found.</p>
          )}
        </button>

        <button
          type="button"
          className={`anomaly-card ${highlightMode === "orphans" ? "is-active" : ""}`}
          onClick={() => toggleHighlight("orphans")}
        >
          <h2>Orphans <span>{result.anomalies.orphans.length}</span></h2>
          {result.anomalies.orphans.length > 0 ? (
            <ul className="anomaly-items">
              {result.anomalies.orphans.slice(0, 3).map((orphan) => (
                <li key={orphan} className="anomaly-item" onClick={(e) => { e.stopPropagation(); navigateToNode(orphan); }}>
                  {orphan}
                </li>
              ))}
            </ul>
          ) : (
            <p>No disconnected files found.</p>
          )}
        </button>
      </section>

      {/* ─── File Detail Panel (Issue 1, 2, 21, 25) ─── */}
      <FileDetailPanel
        file={selectedFile}
        graph={result.graph}
        onClose={closePanel}
        onNavigateToFile={navigateToNode}
        onHoverFile={setHoveredFileId}
      />

      {/* ─── Confirm Dialog (Issue 5) ─── */}
      {showConfirm && (
        <ConfirmDialog
          title="Leave current visualization?"
          message="Your current repository map will be closed."
          confirmLabel="Leave"
          cancelLabel="Cancel"
          onConfirm={() => { window.location.assign("/"); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {/* ─── Search Overlay (Issue 14) ─── */}
      {searchOpen && (
        <SearchOverlay
          items={searchItems}
          onSelect={(id) => {
            navigateToNode(id);
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </main>
  );
}

/* ─── Root export wraps in ReactFlowProvider ─── */
export function DiagramView({ result }: { result: AnalysisResult }) {
  return (
    <ReactFlowProvider>
      <DiagramInner result={result} />
    </ReactFlowProvider>
  );
}
