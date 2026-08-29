"use client";

import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisResult,
  GeometryConfidence,
  GraphNode,
  RenderGraph,
  RenderNodeData,
} from "@/types/graph";
import { fileEvidence } from "@/lib/analysis/projectConfidence";
import {
  isNavigation,
  parsePosition,
  samePosition,
  serializePosition,
  type WorkspacePosition,
} from "@/lib/workspace/position";
import { cameraMotion, structuralLegDuration } from "@/lib/workspace/motion";
import { buildSearchItems } from "@/lib/workspace/searchItems";
import {
  appendToTrail,
  fileLabel,
  type TrailEntry,
} from "@/lib/workspace/trail";
import { FileDetailPanel } from "./FileDetailPanel";
import { BreadcrumbNav } from "./BreadcrumbNav";
import { ConfirmDialog } from "./ConfirmDialog";
import { SearchOverlay } from "./SearchOverlay";
import { ZoomControls } from "./ZoomControls";
import { MarkIcon, SearchIcon } from "./Icons";

/* ─── Types ─── */
type FlowNode = Node<RenderNodeData, "architecture">;
/**
 * Which observation the map is currently weighted by.
 *
 * 'warnings' was removed. It bundled hubs, unimported files, and cycles into a
 * single set under a word that calls all three faults — the exact conflation
 * this reframe exists to undo. Two of the three are frequently not faults at
 * all, and a lens whose name asserts otherwise cannot report honestly.
 *
 * 'dependencies' remains: it weights edges rather than nodes, and describes
 * what it shows without judging it. It is not currently offered in the lens
 * list, but a link minted while it was still reachable should still resolve.
 */
type HighlightMode = "cycles" | "hubs" | "orphans" | "dependencies" | null;

/* ─── Architecture Node ─── */
/**
 * Marker text for a confidence state.
 *
 * Returns null for verified and derived — deliberately. Marking the common
 * case would turn the mark into wallpaper; absence of a marker is itself the
 * signal that evidence is full. Marks are spent only where confidence
 * departs from that.
 *
 * Derived is unmarked in the map but carries lineage in the inspector: both
 * states are deterministic and equally reliable, so giving them different
 * visual authority here would misrepresent them.
 */
function confidenceMarker(confidence: GeometryConfidence): string | null {
  switch (confidence) {
    case "heuristic":
      return "partial read";
    case "unknown":
      return "unresolved";
    default:
      return null;
  }
}

/**
 * Node body.
 *
 * Confidence is carried on two channels at minimum — form (border style,
 * and for unknown an unclosed shape) and ink (text and border colour) —
 * plus a word-marker for the two reduced states. No state depends on colour
 * alone.
 */
function ArchitectureNode({ data }: NodeProps<FlowNode>) {
  const marker = confidenceMarker(data.confidence);
  const isUnresolved = data.kind === "unresolved";

  return (
    <div
      className={[
        "architecture-node",
        `confidence-${data.confidence}`,
        data.isBoundary ? "is-boundary" : "",
      ].filter(Boolean).join(" ")}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <div className="node-kicker">
        {data.kind === "folder" ? "FOLDER" : data.kind === "file" ? "FILE" : "IMPORT"}
      </div>
      <strong>{data.label}</strong>
      {/* A boundary stub reports its region's size and that it is collapsed.
          It deliberately reuses the FOLDER kicker: it IS that region, drawn
          collapsed, and inventing a second word for the same concept would
          teach a distinction that does not exist. */}
      {data.kind === "folder" && (
        <span>
          {data.fileIds?.length ?? 0} files
          {data.isBoundary ? " · collapsed" : ""}
        </span>
      )}
      {data.kind === "file" && <span>{data.filePath}</span>}
      {marker && <em className="confidence-marker">{marker}</em>}
      {data.reducedConfidenceCount ? (
        <span className="confidence-contains">
          {data.reducedConfidenceCount} file
          {data.reducedConfidenceCount === 1 ? "" : "s"} partially read
        </span>
      ) : null}
      {/* An unresolved stub has no outgoing dependency — nothing is known to
          follow it. Rendering a source handle would imply otherwise. */}
      {!isUnresolved && (
        <Handle type="source" position={Position.Right} className="node-handle" />
      )}
    </div>
  );
}

const nodeTypes = { architecture: ArchitectureNode };

/**
 * Base opacity for an edge at rest, by confidence.
 *
 * Reduced evidence reads quieter. This is the resting value; the highlight
 * effect scales it rather than replacing it, so a dimmed heuristic edge never
 * ends up more prominent than a dimmed verified one.
 */
function edgeRestOpacity(confidence: GeometryConfidence | undefined): number {
  switch (confidence) {
    case "heuristic":
      return 0.75;
    case "unknown":
      return 0.55;
    default:
      return 1;
  }
}

/**
 * Width the inspector occupies, in screen pixels.
 *
 * Read from the same custom property the panel is sized by, so the camera and
 * the panel can never disagree about how much of the map is covered. Clamped
 * the same way the panel clamps itself on narrow viewports.
 */
function inspectorWidth(): number {
  if (typeof window === "undefined") return 0;
  const declared = getComputedStyle(document.documentElement)
    .getPropertyValue("--panel-width")
    .trim();
  const parsed = Number.parseFloat(declared);
  const width = Number.isFinite(parsed) ? parsed : 390;
  return Math.min(width, window.innerWidth - 32);
}

/**
 * World-space X that centres a node in the map area still visible beside the
 * inspector.
 *
 * The map is never resized. Node world-positions stay fixed and the camera
 * shifts instead, so nothing re-lays-out and no object has to be
 * re-recognised after the panel opens.
 *
 * Shifting the camera centre right by half the panel width moves the node
 * left on screen by the same amount — landing it in the middle of the
 * remaining visible area. Divided by zoom because the offset is a screen
 * distance and setCenter takes world coordinates.
 */
function centeredWithInspector(nodeX: number, zoom: number, isOpen: boolean): number {
  if (!isOpen) return nodeX;
  return nodeX + inspectorWidth() / 2 / Math.max(zoom, 0.01);
}

/* ─── Helpers ─── */
function graphToFlow(graph: RenderGraph): { nodes: FlowNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((node) => ({ ...node, type: "architecture" })),
    edges: graph.edges.map((edge) => {
      const confidence = edge.confidence ?? "derived";
      return {
        ...edge,
        type: "smoothstep",
        // An arrowhead asserts arrival at a known target. An unresolved
        // import has no known target, so it gets none.
        ...(confidence === "unknown"
          ? {}
          : { markerEnd: { type: "arrowclosed" as const } }),
        className: `confidence-${confidence}`,
        // Kept in data so the highlight effect can recompute styling from
        // confidence instead of overwriting it.
        data: { confidence },
        style: { strokeWidth: 1.4, opacity: edgeRestOpacity(confidence) },
      };
    }),
  };
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

/* ─── Inner Diagram (inside ReactFlowProvider) ─── */
function DiagramInner({ result }: { result: AnalysisResult }) {
  const router = useRouter();
  /* ─── What the address can refer to ───
   * Regions and files are validated against the repository before a URL value
   * becomes state, so a stale or edited link degrades to the nearest valid
   * position instead of rendering something that does not exist. */
  const knownRegions = useMemo(
    () => new Set(Object.keys(result.renderData.fileViewByFolder)),
    [result.renderData.fileViewByFolder],
  );
  const knownFiles = useMemo(
    () => new Set(result.graph.nodes.map((node) => node.id)),
    [result.graph.nodes],
  );

  /* ─── Initial position, read from the address ───
   * Computed once, before first paint, so arriving via a shared link lands
   * directly at the shared position rather than at the overview and then
   * jumping. */
  const initialPosition = useMemo(
    () =>
      parsePosition(
        typeof window === "undefined"
          ? null
          : new URLSearchParams(window.location.search),
        knownRegions,
        knownFiles,
      ),
    [knownRegions, knownFiles],
  );

  const [folder, setFolder] = useState<string | null>(initialPosition.region);
  const [selectedFile, setSelectedFile] = useState<GraphNode | null>(
    initialPosition.file
      ? result.graph.nodes.find((n) => n.id === initialPosition.file) ?? null
      : null,
  );
  const [highlightMode, setHighlightMode] = useState<HighlightMode>(
    initialPosition.lens,
  );
  const [hoveredFileId, setHoveredFileId] = useState<string | null>(null);
  const [isFading, setIsFading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lensMenuOpen, setLensMenuOpen] = useState(false);
  const [trail, setTrail] = useState<ReadonlyArray<TrailEntry>>([]);

  const canvas = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useReactFlow();

  /* ─── Changing region ───────────────────────────────────────────────────
   *
   * The one path by which the map's contents are replaced. Drilling into a
   * region, returning to the overview, following a boundary stub and jumping
   * from the trail all call this, which is what makes forward and reverse
   * symmetric: they are not two implementations that match, they are one
   * implementation used twice.
   *
   * Structural, in two legs — the outgoing region recedes, the incoming one
   * arrives — costing one structural duration in total.
   *
   * INTERRUPTIBLE. The pending swap is held in a ref and cleared on every
   * call, so a second region chosen mid-transition cancels the first and the
   * latest intent wins. Previously four separate call sites each set their own
   * 150ms timer with no handle on it: clicking two regions quickly ran both
   * timers to completion, and the map landed in whichever region's callback
   * happened to fire last — not necessarily the one most recently asked for.
   *
   * A duration of 0 (reduced motion) applies the change synchronously rather
   * than scheduling a zero-length wait, so no intermediate faded frame is ever
   * committed. */
  const pendingRegionChange = useRef<ReturnType<typeof setTimeout> | null>(null);
  const changeRegion = useCallback((next: string | null) => {
    if (pendingRegionChange.current !== null) {
      clearTimeout(pendingRegionChange.current);
      pendingRegionChange.current = null;
    }

    const leg = structuralLegDuration();
    setHoveredFileId(null);
    if (leg <= 0) {
      setIsFading(false);
      setFolder(next);
      return;
    }

    setIsFading(true);
    pendingRegionChange.current = setTimeout(() => {
      pendingRegionChange.current = null;
      setFolder(next);
      setIsFading(false);
    }, leg);
  }, []);

  // A transition in flight when this unmounts must not write state afterwards.
  useEffect(
    () => () => {
      if (pendingRegionChange.current !== null) {
        clearTimeout(pendingRegionChange.current);
      }
    },
    [],
  );

  /**
   * Where to land after a region change, when navigation asked for a specific
   * node in a region you were not in.
   *
   * Declared here; consumed by an effect below, once `nodes` exists.
   */
  const pendingFocus = useRef<string | null>(null);

  /**
   * Record an examined object on the trail.
   *
   * Called wherever attention actually lands — not on every state change, so
   * that adjusting the camera or toggling a lens does not masquerade as having
   * looked at something new.
   */
  const recordExamined = useCallback(
    (kind: TrailEntry["kind"], id: string) => {
      setTrail((current) =>
        appendToTrail(current, {
          id,
          kind,
          label: kind === "file" ? fileLabel(id) : id,
        }),
      );
    },
    [],
  );

  const renderGraph = folder ? result.renderData.fileViewByFolder[folder] : result.renderData.folderView;
  const initial = useMemo(() => graphToFlow(renderGraph), [renderGraph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);

  /* ─── Arriving at a node in a region you were not in ────────────────────
   *
   * Crossing a boundary and landing on a specific node is two events with a
   * dependency between them: the camera cannot frame a node until that node
   * has been laid out and measured. `pendingFocus` records which node is
   * wanted; this acts once the geometry to act on exists.
   *
   * This replaces a `setTimeout(…, 400)` that guessed when the new region
   * would have rendered. The guess raced in both directions: too short on a
   * large region or a slow machine and `getNode` returned undefined, so the
   * camera silently never moved and the person landed on the default framing
   * with no indication anything had failed; too long and it fought the
   * transition. It also hardcoded a duration bearing no relationship to the
   * region change it was waiting on.
   *
   * `useNodesInitialized` reports when React Flow has measured the current
   * node set, which is the real precondition. */
  const nodesInitialized = useNodesInitialized();
  useEffect(() => {
    const targetId = pendingFocus.current;
    if (!targetId || !nodesInitialized) return;

    const node = reactFlowInstance.getNode(targetId);
    if (!node) return;
    pendingFocus.current = null;

    // Connective, not structural. The structural part — the region being
    // replaced — has already happened and been paid for. This is the arrival
    // within the region now on screen: the same act as selecting a node that
    // was visible all along, and so the same duration.
    //
    // The inspector is open, because navigating to a node selects it.
    const zoom = reactFlowInstance.getZoom();
    reactFlowInstance.setCenter(
      centeredWithInspector(
        (node.position.x ?? 0) + (node.measured?.width ?? 180) / 2,
        zoom,
        true,
      ),
      (node.position.y ?? 0) + (node.measured?.height ?? 60) / 2,
      { zoom, ...cameraMotion("connective") },
    );
  }, [nodesInitialized, nodes, reactFlowInstance]);

  /* ─── Evidence behind the selected file ───
   * Read from the IR on selection. Null when no IR is available, which the
   * panel treats as "no record" rather than "nothing to report". */
  const selectedEvidence = useMemo(
    () =>
      selectedFile
        ? fileEvidence(result.repositoryIR, selectedFile.path)
        : null,
    [selectedFile, result.repositoryIR],
  );

  // Sync nodes/edges when the view changes.
  //
  // Selection and lens are cleared only when the REGION actually changes —
  // keyed on the region itself rather than on "has this effect run before".
  //
  // A mount-count guard was the obvious first attempt and is wrong: React
  // Strict Mode double-invokes effects in development, so the first pass set
  // the flag and the second pass cleared exactly the state a shared link had
  // just restored. Keying on the region is also simply more truthful about
  // the intent — a selection is invalid because it belongs to a region you
  // have left, not because some number of renders have happened.
  const syncedRegion = useRef<string | null>(initialPosition.region);
  useEffect(() => {
    setNodes(initial.nodes);
    setEdges(initial.edges);
    if (syncedRegion.current !== folder) {
      syncedRegion.current = folder;
      setHighlightMode(null);
      // A selection is dropped because it does not belong to the region now on
      // screen — not merely because the region changed.
      //
      // The difference matters for navigation that moves region and selects in
      // one act: crossing a boundary from search, from a boundary stub, or
      // from an inspector link batches setFolder and setSelectedFile into a
      // single update, and a blanket clear here discarded the selection the
      // navigation had just made. The person arrived in the right region with
      // nothing selected and no inspector — having asked for a specific file.
      setSelectedFile((current) =>
        current && folder !== null && current.folder === folder ? current : null,
      );
    }
  }, [initial, folder, setEdges, setNodes]);

  /* ─── The address follows the position ───
   *
   * Every reachable state becomes linkable, reload resumes instead of
   * restarting, and browser back/forward move through the investigation.
   *
   * push vs replace is the load-bearing distinction: moving to another region,
   * file, or lens is a step and belongs in history; panning and zooming is
   * adjusting the view of the step you are already on, and recording it would
   * fill history with camera nudges and make the back button useless.
   *
   * The camera is read at write time rather than tracked as state — it changes
   * continuously during a pan, and mirroring that into React state would
   * re-render the graph on every frame. */
  const lastWrittenPosition = useRef<WorkspacePosition>(initialPosition);
  const writePosition = useCallback(
    ({ includeCamera = true }: { includeCamera?: boolean } = {}) => {
      if (typeof window === "undefined") return;

      // Preserve any framing already in the address when not writing new
      // framing, so a state change does not silently discard a camera the
      // person chose or arrived with.
      let camera: WorkspacePosition["camera"] = includeCamera
        ? null
        : lastWrittenPosition.current.camera;

      if (includeCamera) {
        try {
          const { x, y, zoom } = reactFlowInstance.getViewport();
          // getViewport returns the pane translation; convert to the
          // world-space centre so the value survives a different viewport size.
          const bounds = canvas.current?.getBoundingClientRect();
          if (bounds && zoom > 0) {
            camera = {
              x: (bounds.width / 2 - x) / zoom,
              y: (bounds.height / 2 - y) / zoom,
              zoom,
            };
          }
        } catch {
          // The instance may not be ready during the first paint; a null
          // camera means "no opinion, fit the content", which is correct then.
        }
      }

      const next: WorkspacePosition = {
        region: folder,
        file: selectedFile?.id ?? null,
        lens: highlightMode,
        camera,
      };
      if (samePosition(next, lastWrittenPosition.current)) return;

      const method = isNavigation(lastWrittenPosition.current, next)
        ? "pushState"
        : "replaceState";
      lastWrittenPosition.current = next;
      window.history[method](
        null,
        "",
        `${window.location.pathname}${serializePosition(next)}`,
      );
    },
    [folder, selectedFile, highlightMode, reactFlowInstance],
  );

  // Write on every change of place.
  //
  // Camera framing is deliberately excluded from what this writes. fitView
  // runs on mount, so including framing here would stamp a camera onto a
  // first visit's address — the plain /repo/:id link would immediately
  // acquire a ?cam= nobody chose, and "the overview keeps a clean address"
  // would be false the instant the page loaded.
  //
  // Framing is written only when a person actually moves the camera
  // (onMoveEnd) or shares. Until then the absence of a camera correctly means
  // "no opinion, fit the content".
  useEffect(() => {
    writePosition({ includeCamera: false });
  }, [writePosition]);

  /* ─── Back and forward move through the investigation ───
   *
   * The address is the source of truth on popstate: whatever the browser
   * restores is applied to state, rather than the other way round. */
  useEffect(() => {
    const onPopState = () => {
      const position = parsePosition(
        new URLSearchParams(window.location.search),
        knownRegions,
        knownFiles,
      );
      lastWrittenPosition.current = position;

      // Whether this step crosses a region boundary decides the tier, and
      // must be read before the region state is written.
      const crossesRegion = position.region !== folder;

      // Reversal uses the same mechanism as the forward move. A region change
      // reached by Back therefore recedes and arrives exactly as one reached
      // by clicking a region does — Motion P8 asks for the same visual logic
      // in both directions, and sharing the implementation is the only way
      // that stays true as either side changes.
      if (crossesRegion) changeRegion(position.region);
      setSelectedFile(
        position.file
          ? result.graph.nodes.find((n) => n.id === position.file) ?? null
          : null,
      );
      setHighlightMode(position.lens);
      if (position.camera) {
        // Restored at the tier of the change being undone: structural when
        // the step crossed a region, connective when it moved within one.
        // A single hardcoded duration was symmetric with neither, so undoing
        // a move felt like a different kind of act from making it.
        reactFlowInstance.setCenter(position.camera.x, position.camera.y, {
          zoom: position.camera.zoom,
          ...cameraMotion(crossesRegion ? "structural" : "connective"),
        });
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [knownRegions, knownFiles, result.graph.nodes, reactFlowInstance, folder, changeRegion]);

  /* ─── Restore the shared camera once the graph has mounted ───
   *
   * Runs after the initial render so the instance exists. Only fires when the
   * address actually carried a camera; otherwise the map frames itself, which
   * is the right default for a first visit. */
  const cameraRestored = useRef(false);
  useEffect(() => {
    if (cameraRestored.current || !initialPosition.camera) return;
    cameraRestored.current = true;
    const frame = requestAnimationFrame(() => {
      // Immediate, and deliberately so. There is no previous state for this
      // movement to connect to — the person arrived here from another
      // application entirely — so travelling to the framing would be motion
      // explaining a change that never happened for this viewer. The shared
      // link's position is simply where the map starts.
      reactFlowInstance.setCenter(
        initialPosition.camera!.x,
        initialPosition.camera!.y,
        { zoom: initialPosition.camera!.zoom, ...cameraMotion("immediate") },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [initialPosition.camera, reactFlowInstance]);

  // Density is no longer policed by revoking navigation.
  //
  // This previously ran an O(n²) bounding-box scan after every drill-down and,
  // on ANY overlap, returned the user to the folder overview — taking away the
  // position they had just asked for, for a reason internal to the renderer.
  // A person who asks to see a region should arrive there. Dense views are
  // addressed by zoom and level-of-detail, not by refusing to show them.

  /* ─── Highlight Modes (Issue 3, 4) ─── */
  const getHighlightedNodeIds = useCallback((): Set<string> | null => {
    if (!highlightMode) return null;

    // Every observation names FILES. In the region overview the rendered nodes
    // are regions (`folder:lib`), so a file path matches nothing there.
    //
    // Left unmapped, a lens reporting nine unimported files dimmed every
    // region on screen — stating "none of these contain what you asked for"
    // while all of them did. A lens that reports a count must be able to show
    // where those files are, or it is asserting something the map contradicts.
    //
    // So matched files are lifted to the regions containing them. In the
    // overview a region is emphasised when it holds at least one match; in a
    // file view the file ids match directly and this adds nothing.
    const files = new Set<string>();
    switch (highlightMode) {
      case "cycles":
        for (const cycle of result.anomalies.cycles) {
          for (const nodeId of cycle) files.add(nodeId);
        }
        break;
      case "hubs":
        for (const hub of result.anomalies.godModules) files.add(hub.filePath);
        break;
      case "orphans":
        for (const orphan of result.anomalies.orphans) files.add(orphan);
        break;
      case "dependencies":
        return null; // Dependencies highlights edges, not specific nodes.
    }

    // Include the owning regions alongside the files themselves, so one set
    // serves both views without the caller needing to know which is rendered.
    const ids = new Set(files);
    for (const node of result.graph.nodes) {
      if (files.has(node.id)) ids.add(`folder:${node.folder}`);
    }
    return ids;
  }, [highlightMode, result.anomalies, result.graph.nodes]);

  /* ─── Apply visual highlight to nodes and edges ─── */
  useEffect(() => {
    const highlightedIds = getHighlightedNodeIds();

    // Hover and selection are the same act at different durations, so they
    // resolve to the same relationship set. Hover takes precedence: it is the
    // more immediate intent, and it must stay reversible without disturbing
    // what is selected.
    //
    // selectedFile.id is usable directly as a node id: in a file view a node's
    // id IS its file path, which is what selectedFile carries. Folder nodes
    // (id `folder:name`) never set selectedFile, so there is nothing to
    // resolve there. Deriving this from the `nodes` array instead would make
    // the effect depend on state it also writes — and since .map() always
    // returns a fresh array, that would loop forever.
    const subjectId = hoveredFileId ?? selectedFile?.id ?? null;
    const focusConnected = subjectId ? getConnectedIds(subjectId, initial.edges) : null;
    const activeIds = focusConnected ?? highlightedIds;

    setNodes((current) =>
      current.map((node) => {
        const isSubject = node.id === subjectId;
        // Guarded on selectedFile existing at all.
        //
        // Without the guard, `selectedFile?.id === node.data.filePath` is
        // `undefined === undefined` for any node that carries no filePath —
        // every folder node and every boundary stub — which marked all of them
        // selected whenever nothing was selected. Found in Phase 8's rendered
        // verification: two collapsed-region stubs were wearing the selection
        // treatment on a view where no file had been chosen. The old muted
        // blue hid it; rust made it obvious.
        const isSelected = selectedFile != null &&
          (selectedFile.id === node.id || selectedFile.id === node.data.filePath);
        const isHovered = node.id === hoveredFileId;
        const isNeighbor = !isSubject && focusConnected != null && focusConnected.has(node.id);
        const isDimmed = activeIds ? !activeIds.has(node.id) : false;

        const className = [
          isSelected ? "is-selected" : "",
          isHovered && !isSelected ? "is-hovered" : "",
          // Relations outrank recession: a neighbour is never dimmed.
          isDimmed && !isNeighbor ? "is-dimmed" : "",
          isNeighbor && !isSelected ? "is-neighbor" : "",
        ].filter(Boolean).join(" ");

        if (node.className === className) return node;
        return { ...node, className };
      }),
    );

    setEdges((current) =>
      current.map((edge) => {
        const isHighlighted = subjectId
          ? (edge.source === subjectId || edge.target === subjectId)
          : highlightMode === "dependencies"
            ? true
            : activeIds
              ? (activeIds.has(edge.source) && activeIds.has(edge.target))
              : false;

        // Confidence sets the resting appearance; highlight scales it.
        // Multiplying rather than overwriting keeps the encoding intact under
        // interaction — a highlighted heuristic edge stays visibly heuristic.
        const confidence = (edge.data?.confidence ?? "derived") as GeometryConfidence;
        const restOpacity = edgeRestOpacity(confidence);
        const strokeWidth = isHighlighted ? 2.5 : 1.4;
        // Receded, not removed — matching the node rule. The former 0.12
        // made an edge effectively invisible.
        const dimFactor = activeIds || subjectId ? (isHighlighted ? 1 : 0.35) : 1;
        // Rust: this edge is attached to the subject. Same token as every
        // other "you asked about this" in the product — the literal is here
        // rather than in CSS only because React Flow needs edge styling as an
        // inline object it can diff.
        const stroke = isHighlighted ? "#A84A26" : undefined;

        return {
          ...edge,
          style: {
            ...edge.style,
            strokeWidth,
            opacity: restOpacity * dimFactor,
            stroke,
          },
        };
      }),
    );
  }, [hoveredFileId, highlightMode, selectedFile, initial.edges, getHighlightedNodeIds, setNodes, setEdges]);

  /* ─── Navigate to a node: pan camera, highlight, update panel (Issue 1, 2) ─── */
  const navigateToNode = useCallback(
    (nodeId: string) => {
      // Find the node in the current view.
      const flowNode = reactFlowInstance.getNode(nodeId);
      if (!flowNode) {
        // Node might be in a different folder view — check which folder.
        const graphNode = result.graph.nodes.find((n) => n.id === nodeId);
        if (graphNode && graphNode.folder !== folder) {
          // Structural: this replaces everything on screen. Same helper as
          // every other region change, so arriving here from search reads
          // identically to arriving by clicking a region.
          changeRegion(graphNode.folder);
          // Where to land once the new region exists. Claimed rather than
          // timed — see the effect below.
          pendingFocus.current = nodeId;
        }
        if (graphNode) {
          setSelectedFile(graphNode);
          recordExamined("file", graphNode.id);
        }
        return;
      }

      const nodeX = (flowNode.position.x ?? 0) + (flowNode.measured?.width ?? 180) / 2;
      const nodeY = (flowNode.position.y ?? 0) + (flowNode.measured?.height ?? 60) / 2;

      // Offset for the inspector when it is open, so the target does not land
      // underneath it. Same helper the click handler uses — one rule for where
      // a node comes to rest, wherever navigation originated.
      //
      // Connective: the target is already on screen, so this links a selection
      // to its position rather than reorganizing anything.
      const zoom = reactFlowInstance.getZoom();
      reactFlowInstance.setCenter(
        centeredWithInspector(nodeX, zoom, Boolean(selectedFile)),
        nodeY,
        { zoom, ...cameraMotion("connective") },
      );

      const graphNode = result.graph.nodes.find((n) => n.id === nodeId);
      if (graphNode) {
        setSelectedFile(graphNode);
        recordExamined("file", graphNode.id);
      }
    },
    [reactFlowInstance, result.graph.nodes, folder, selectedFile, recordExamined, changeRegion],
  );

  /* ─── Node Click Handler ─── */
  const onNodeClick: NodeMouseHandler<FlowNode> = useCallback(
    (_, node) => {
      // Folder nodes navigate into their region. This covers boundary stubs
      // too: a stub carries kind 'folder' and its region's name, so clicking
      // the far end of a cross-boundary dependency takes you to it. The
      // relationship stays followable, not merely acknowledged.
      if (node.data.kind === "folder" && node.data.folder) {
        recordExamined("region", node.data.folder);
        changeRegion(node.data.folder);
        return;
      }
      if (node.data.kind === "file" && node.data.filePath) {
        const graphNode = result.graph.nodes.find((file) => file.id === node.data.filePath) ?? null;
        setSelectedFile(graphNode);
        if (graphNode) recordExamined("file", graphNode.id);

        // The map does not resize, so there is no layout transition to wait
        // for. The camera moves once, immediately, to land the node in the
        // area that will remain visible beside the inspector.
        //
        // Connective: the node was already on screen. This links the selection
        // to its position — the same act as navigateToNode for a visible node.
        if (graphNode) {
          const nodeX = (node.position.x ?? 0) + (node.measured?.width ?? 180) / 2;
          const nodeY = (node.position.y ?? 0) + (node.measured?.height ?? 60) / 2;
          const zoom = reactFlowInstance.getZoom();
          reactFlowInstance.setCenter(
            centeredWithInspector(nodeX, zoom, true),
            nodeY,
            { zoom, ...cameraMotion("connective") },
          );
        }
      }
    },
    [result.graph.nodes, reactFlowInstance, recordExamined, changeRegion],
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
    changeRegion(null);
  }, [changeRegion]);

  /* ─── Toggle highlight mode (Issue 3, 4) ─── */
  const toggleHighlight = useCallback((mode: HighlightMode) => {
    setHighlightMode((current) => (current === mode ? null : mode));
  }, []);

  /* ─── Search items ─── */
  /* ─── What can be searched ───
   * Files from the graph, plus external packages read from the IR. Symbols are
   * excluded: the IR carries no symbol nodes, so offering them would assert
   * beyond the evidence. */
  const searchItems = useMemo(
    () => buildSearchItems(result.graph, result.repositoryIR),
    [result.graph, result.repositoryIR],
  );

  /* ─── Closing the inspector ─────────────────────────────────────────────
   *
   * Reverses the camera offset that opening it applied.
   *
   * Selecting a node shifts the camera centre right by half the inspector's
   * width, so the node lands centred in the map area that remains visible.
   * Closing gives that space back — and until now the camera stayed put,
   * leaving the subject sitting left of centre in a map with no inspector
   * beside it any more. The offset was applied on open and never undone.
   *
   * Motion P8: "Undo should feel like returning." Same displacement, same
   * tier, opposite direction. Computed from the live viewport rather than a
   * remembered value, so it reverses the position the camera is actually at —
   * including one a person panned to while the panel was open. */
  const closePanel = useCallback(() => {
    const { x, y, zoom } = reactFlowInstance.getViewport();
    setSelectedFile(null);

    // Translated directly rather than re-centred.
    //
    // The offset to undo is a known screen distance — half the inspector's
    // width — so it can be applied to the viewport translation as-is. Going
    // via setCenter would mean converting screen coordinates to world
    // coordinates and back, which requires knowing the map container's size
    // and position.
    //
    // That conversion is what the first attempt got wrong: it used
    // window.innerWidth/innerHeight, but the container sits below the 56px
    // rail, so the assumed centre was half a rail too low. Rendered check
    // showed the camera drifting 28px vertically on every close — a
    // reversal that did not return. Shifting the translation cannot drift,
    // because y is untouched and x moves by exactly the distance that opening
    // introduced.
    reactFlowInstance.setViewport(
      { x: x + inspectorWidth() / 2, y, zoom },
      cameraMotion("connective"),
    );
  }, [reactFlowInstance]);

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
        // Routed through closePanel, not setSelectedFile: dismissing by key
        // and dismissing by button are the same act and must return the
        // camera the same way. Calling the setter directly here would have
        // made Escape the one path that left the offset in place.
        if (selectedFile) { closePanel(); return; }
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        reactFlowInstance.fitView({ padding: 0.12, ...cameraMotion("connective") });
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, selectedFile, reactFlowInstance, closePanel]);

  /* ─── Lens names, for the active-lens indicator ─── */
  /**
   * Names shown on the active-lens indicator.
   *
   * Kept identical to the lens labels: the indicator and the control must not
   * describe the same lens two different ways, or a person has to work out that
   * "Dependency Hubs" and "Most depended upon" were ever the same thing.
   */
  const HIGHLIGHT_NAMES: Partial<Record<NonNullable<HighlightMode>, string>> = {
    hubs: "Most depended upon",
    orphans: "Not imported anywhere",
    cycles: "Import cycles",
    dependencies: "All dependencies",
  };

  /* ─── Observation lenses ───
   *
   * Each lens re-weights the map to answer one question. The short list under
   * each is a way in, not the answer: the answer is where those files sit in
   * the structure, which only the map can show.
   *
   * The framing is deliberately descriptive. "God module" and "orphan" are
   * verdicts wearing the clothes of measurement — they name a fault, and both
   * are frequently wrong about one. A file everything depends on may be
   * excellent design; a file nothing imports may be an entry point doing
   * exactly its job. Cartograph's responsibility is ensuring truthful
   * conclusions remain possible, not delivering them.
   *
   * So each lens now states what was measured and lets the reader judge:
   *
   *   Most depended upon      ranked by in-degree, the count shown
   *   Not imported anywhere   nothing in this repository imports these
   *   Import cycles           keeps its name — a cycle is provable structure,
   *                           not an interpretation — minus the alarm colour
   */
  const LENSES: ReadonlyArray<{
    mode: NonNullable<HighlightMode>;
    label: string;
    /** What was measured, in plain language. Shown under the label. */
    note: string;
    empty: string;
    items: () => ReadonlyArray<{ id: string; label: string; target: string }>;
  }> = useMemo(
    () => [
      {
        mode: "hubs",
        label: "Most depended upon",
        note: "Ranked by how many files import each.",
        empty: "Nothing stands out by import count.",
        items: () =>
          result.anomalies.godModules.map((mod) => ({
            id: mod.filePath,
            // The count is the measurement. Showing it lets a reader see the
            // ranking rather than take the ordering on trust.
            label: `${mod.filePath} · ${mod.inDegree}`,
            target: mod.filePath,
          })),
      },
      {
        mode: "orphans",
        label: "Not imported anywhere",
        note: "Entry points and CLI roots legitimately appear here.",
        empty: "Every file is imported by something.",
        items: () =>
          result.anomalies.orphans.map((orphan) => ({
            id: orphan,
            label: orphan,
            target: orphan,
          })),
      },
      {
        mode: "cycles",
        label: "Import cycles",
        note: "Files that import each other, directly or indirectly.",
        empty: "No cycles found.",
        items: () =>
          result.anomalies.cycles.map((cycle, i) => ({
            id: `cycle-${i}`,
            label: cycle.join(" → "),
            target: cycle[0],
          })),
      },
    ],
    [result.anomalies],
  );

  /* No summed observation count.
   *
   * A single figure across the three lenses adds unlike measurements: hubs,
   * unimported files, and cycles answer different questions, and only one of
   * them describes something usually worth fixing. Summing them produced a
   * number that read as severity — on Cartograph's own source it would say
   * "12", of which seven are Next.js entry points and API routes doing exactly
   * their job.
   *
   * The per-lens counts remain in the popover, where each number counts one
   * measured thing and says what it measured. */

  return (
    <div className="workspace-frame">
      {/* ─── Rail ───
       * The repository name is the most prominent text in the frame. The
       * product mark sits quietly to its left: the project is the subject,
       * Cartograph is the instrument. */}
      <header className="rail">
        <button
          type="button"
          className="rail-mark"
          onClick={() => setShowConfirm(true)}
          aria-label="Cartograph home"
        >
          <MarkIcon size={15} />
          Cartograph
        </button>

        <div className="rail-identity">
          <span className="rail-repo-name">{result.repoMeta.repoName}</span>
          <span className="rail-repo-meta">
            {result.graph.nodes.length.toLocaleString()} files ·{" "}
            {result.graph.edges.length.toLocaleString()} dependencies
            {result.repoMeta.language ? ` · ${result.repoMeta.language}` : ""}
          </span>
        </div>

        {/* Search is now visible, not only known.
          *
          * It was previously reachable by ⌘K alone, discoverable only via a
          * caption inside the canvas — an instrument a person had to already
          * know existed. The shortcut is preserved for people who know it;
          * this is for everyone else. */}
        <button
          type="button"
          className="rail-search"
          onClick={() => setSearchOpen(true)}
          aria-label="Search files and packages"
        >
          <span className="rail-search-icon"><SearchIcon size={14} /></span>
          <span className="rail-search-label">Search</span>
          <kbd className="rail-search-kbd" aria-hidden="true">⌘K</kbd>
        </button>

        <div className="rail-controls">
          <button
            type="button"
            className={`rail-button ${lensMenuOpen ? "is-open" : ""}`}
            onClick={() => setLensMenuOpen((open) => !open)}
            aria-expanded={lensMenuOpen}
            aria-haspopup="true"
          >
            Observations
          </button>
          <button
            type="button"
            className="rail-button"
            // Writes the current position first, then copies. The address is
            // kept current by an effect, but framing is only written when a
            // pan settles — so a share issued immediately after a drag would
            // otherwise send the previous framing. Writing here makes the link
            // reflect what the sender is actually looking at, which was the
            // whole failure of the old share: it always sent the default
            // overview no matter where the sender was.
            onClick={() => {
              writePosition();
              navigator.clipboard.writeText(window.location.href);
            }}
          >
            Share
          </button>
        </div>
      </header>

      {/* ─── Map ───
       * Fills everything the rail does not. Never resized by the inspector —
       * the camera offsets instead. */}
      <section
        className={`map-region ${isFading ? "is-fading" : ""}`}
        ref={canvas}
        aria-label="Interactive dependency diagram"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          // Framing is written when a pan or zoom settles, not during it:
          // a URL rewrite per frame would be wasteful and would flood the
          // address bar with intermediate positions nobody chose to be at.
          //
          // Gated on a real interaction. fitView also fires onMoveEnd, so
          // without the guard a first visit would have a camera stamped onto
          // its address by a move the person never made — and the plain
          // /repo/:id link would stop meaning "fit the content".
          //
          // Wrapped rather than passed directly: onMoveEnd supplies the
          // originating event, which would otherwise be read as options.
          onMoveEnd={(event) => {
            if (!event) return;
            writePosition();
          }}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.05}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
        >
          {/* The graticule — two grids at a 1:5 ratio.
            *
            * Fine ticks locate; the heavier cross every fifth intersection
            * gives the eye something to count by, the way a ruler's longer
            * marks do. Both scale with the camera, so the mesh's density is a
            * continuous readout of zoom that needs no numeric display.
            *
            * Colours are passed rather than set in CSS because React Flow
            * renders these as SVG <pattern> fills, which a stylesheet rule on
            * the container cannot reach. */}
          <Background
            id="graticule-fine"
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="#DAD3C3"
          />
          <Background
            id="graticule-coarse"
            variant={BackgroundVariant.Cross}
            gap={120}
            size={5}
            lineWidth={0.7}
            color="#C4BBA6"
          />
          <ZoomControls />
        </ReactFlow>

        {/* Where you are. Small, quiet, always in the same place. */}
        <div className="context-cluster">
          <span className="context-region">
            {folder ?? "Repository overview"}
          </span>
          <span className="context-hint">
            {folder
              ? "Select a file to inspect its evidence"
              : "Select a region to see its files"}
          </span>
          <BreadcrumbNav
            folder={folder}
            selectedFileName={selectedFile?.path.split("/").pop() ?? null}
            onNavigateRoot={goToFolderOverview}
            onNavigateFolder={() => setSelectedFile(null)}
          />

          {/* The trail — how you got here.
            *
            * Distinct from the breadcrumb above it, which shows position in a
            * hierarchy and is derived entirely from where you currently are.
            * This is the path of inquiry, in the order things last mattered.
            * Both are needed: one answers "where am I", the other "what have
            * I been looking at". */}
          {trail.length > 1 && (
            <nav className="trail" aria-label="Examined in this session">
              {trail.map((entry, i) => (
                <button
                  key={`${entry.kind}:${entry.id}`}
                  type="button"
                  className={`trail-step ${i === trail.length - 1 ? "is-current" : ""}`}
                  title={entry.id}
                  onClick={() => {
                    if (entry.kind === "region") {
                      if (entry.id !== folder) changeRegion(entry.id);
                      return;
                    }
                    navigateToNode(entry.id);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </nav>
          )}
        </div>

        {highlightMode && (
          <div className="lens-active-bar" role="status">
            <span>{HIGHLIGHT_NAMES[highlightMode] ?? highlightMode}</span>
            <button
              type="button"
              className="lens-active-clear"
              onClick={() => setHighlightMode(null)}
            >
              Clear
            </button>
          </div>
        )}
      </section>

      {/* ─── Observations ───
       * Lenses applied to the map, not a surface beside it. Selecting one
       * re-weights the geometry already on screen; the answer appears in
       * the map, which is where a mental model can actually form. */}
      {lensMenuOpen && (
        <div className="lens-popover" role="dialog" aria-label="Observations">
          <p className="lens-popover-heading">OBSERVATIONS</p>
          {LENSES.map((lens) => {
            const items = lens.items();
            return (
              <button
                key={lens.mode}
                type="button"
                className={`lens-item ${highlightMode === lens.mode ? "is-active" : ""}`}
                onClick={() => toggleHighlight(lens.mode)}
              >
                <span className="lens-item-label">
                  {lens.label}
                  <span className="lens-item-count">{items.length}</span>
                </span>
                {/* What was measured. Present so the label reads as a
                    description of evidence rather than a claim about quality —
                    a reader can see the basis and disagree with the
                    conclusion. */}
                <span className="lens-item-note">{lens.note}</span>
                {items.length === 0 ? (
                  <p className="lens-item-empty">{lens.empty}</p>
                ) : (
                  <ul className="lens-observations">
                    {items.slice(0, 3).map((item) => (
                      <li key={item.id}>
                        <span
                          className="lens-observation"
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigateToNode(item.target);
                            setLensMenuOpen(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.stopPropagation();
                            e.preventDefault();
                            navigateToNode(item.target);
                            setLensMenuOpen(false);
                          }}
                        >
                          {item.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ─── Inspector ─── */}
      <FileDetailPanel
        file={selectedFile}
        graph={result.graph}
        evidence={selectedEvidence}
        onClose={closePanel}
        onNavigateToFile={navigateToNode}
        onHoverFile={setHoveredFileId}
      />

      {showConfirm && (
        <ConfirmDialog
          title="Leave current visualization?"
          message="Your current repository map will be closed."
          confirmLabel="Leave"
          cancelLabel="Cancel"
          onConfirm={() => router.push("/")}
          onCancel={() => setShowConfirm(false)}
        />
      )}

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
    </div>
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
