"use client";

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
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

type FlowNode = Node<RenderNodeData, "architecture">;

function ArchitectureNode({ data }: NodeProps<FlowNode>) {
  return (
    <div className={`architecture-node architecture-node-${data.kind} ${data.variant === "warning" ? "is-warning" : ""}`}>
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

function graphToFlow(graph: RenderGraph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, type: "architecture" })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      type: "smoothstep",
      markerEnd: { type: "arrowclosed" },
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

export function DiagramView({ result }: { result: AnalysisResult }) {
  const [folder, setFolder] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<GraphNode | null>(null);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const renderGraph = folder ? result.renderData.fileViewByFolder[folder] : result.renderData.folderView;
  const initial = useMemo(() => graphToFlow(renderGraph), [renderGraph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);

  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    setSelectedFile(null);
  }, [initial, setEdges, setNodes]);

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

  const onNodeClick: NodeMouseHandler<FlowNode> = useCallback(
    (_, node) => {
      if (node.data.kind === "folder" && node.data.folder) {
        setLayoutNotice(null);
        setFolder(node.data.folder);
      }
      if (node.data.kind === "file" && node.data.filePath) {
        setSelectedFile(result.graph.nodes.find((file) => file.id === node.data.filePath) ?? null);
      }
    },
    [result.graph.nodes],
  );

  const updateHighlight = useCallback(
    (nodeId: string | null) => {
      setEdges((current) =>
        current.map((edge) => ({
          ...edge,
          style: {
            ...edge.style,
            strokeWidth: nodeId && (edge.source === nodeId || edge.target === nodeId) ? 3 : 1.4,
            opacity: nodeId && edge.source !== nodeId && edge.target !== nodeId ? 0.2 : 1,
          },
        })),
      );
    },
    [setEdges],
  );

  const summary = [
    { label: "Files", value: result.graph.nodes.length },
    { label: "Dependencies", value: result.graph.edges.length },
    { label: "Cycles", value: result.anomalies.cycles.length },
    { label: "Warnings", value: result.anomalies.godModules.length + result.anomalies.orphans.length },
  ];

  return (
    <main className="diagram-page">
      <header className="diagram-header">
        <a className="brand" href="/" aria-label="Cartograph home"><span className="brand-mark" aria-hidden="true">⌘</span>Cartograph</a>
        <div className="diagram-meta">
          <span>Static import graph</span>
          <button type="button" className="share-button" onClick={() => navigator.clipboard.writeText(window.location.href)}>Copy share link</button>
        </div>
      </header>

      <section className="diagram-title-row">
        <div>
          <p className="eyebrow">REPOSITORY MAP</p>
          <h1>{folder ? folder : "Folder overview"}</h1>
          <p>{folder ? "Click a file to inspect its resolved imports." : "Click a folder to drill into its file-level map."}</p>
        </div>
        <div className="summary-grid" aria-label="Analysis summary">
          {summary.map((item) => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}
        </div>
      </section>

      {folder && <button type="button" className="back-button" onClick={() => setFolder(null)}>← Back to folder overview</button>}
      {layoutNotice && <p className="layout-notice" role="status">{layoutNotice}</p>}

      <section className="canvas-card" ref={canvas} aria-label="Interactive dependency diagram">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={(_, node) => updateHighlight(node.id)}
          onNodeMouseLeave={() => updateHighlight(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.15}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap nodeColor={(node) => node.data?.variant === "warning" ? "#f59e0b" : "#3851e8"} />
        </ReactFlow>
      </section>

      <section className="anomalies" aria-label="Detected anomalies">
        <article><h2>Circular dependencies <span>{result.anomalies.cycles.length}</span></h2><p>{result.anomalies.cycles.length ? result.anomalies.cycles.map((cycle) => cycle.join(" → ")).join(" · ") : "No cycles found."}</p></article>
        <article><h2>Dependency hubs <span>{result.anomalies.godModules.length}</span></h2><p>{result.anomalies.godModules.length ? result.anomalies.godModules.map((module) => `${module.filePath} (${module.inDegree})`).join(" · ") : "No high in-degree modules found."}</p></article>
        <article><h2>Orphans <span>{result.anomalies.orphans.length}</span></h2><p>{result.anomalies.orphans.length ? result.anomalies.orphans.join(" · ") : "No disconnected files found."}</p></article>
      </section>
      <FileDetailPanel file={selectedFile} graph={result.graph} onClose={() => setSelectedFile(null)} />
    </main>
  );
}
