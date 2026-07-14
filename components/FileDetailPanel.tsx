"use client";

import { useState, useCallback } from "react";
import type { GraphNode, DependencyGraph } from "@/types/graph";

export function FileDetailPanel({
  file,
  graph,
  onClose,
  onNavigateToFile,
  onHoverFile,
}: {
  file: GraphNode | null;
  graph: DependencyGraph;
  onClose: () => void;
  onNavigateToFile: (fileId: string) => void;
  onHoverFile: (fileId: string | null) => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyText = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  }, []);

  if (!file) return null;

  const importers = graph.edges
    .filter((edge) => edge.to === file.id)
    .map((edge) => graph.nodes.find((node) => node.id === edge.from)?.path)
    .filter((path): path is string => Boolean(path));

  // Get the last segment as the relative name.
  const segments = file.path.split("/");
  const fileName = segments[segments.length - 1];

  return (
    <aside className="detail-panel is-entering" aria-label={`Details for ${file.path}`}>
      <div className="detail-panel-heading">
        <div>
          <p className="eyebrow">FILE</p>
          <h2>{file.path}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close file details">×</button>
      </div>

      {/* Quick Actions (Issue 25) */}
      <div className="quick-actions">
        <button
          type="button"
          className={`quick-action ${copiedField === "path" ? "is-copied" : ""}`}
          onClick={() => copyText(file.path, "path")}
          title="Copy file path"
        >
          {copiedField === "path" ? "✓ Copied" : "📋 Copy Path"}
        </button>
        <button
          type="button"
          className={`quick-action ${copiedField === "relative" ? "is-copied" : ""}`}
          onClick={() => copyText(fileName, "relative")}
          title="Copy file name"
        >
          {copiedField === "relative" ? "✓ Copied" : "📄 Copy Name"}
        </button>
        <button
          type="button"
          className="quick-action"
          onClick={() => onNavigateToFile(file.id)}
          title="Center this node in the graph"
        >
          🎯 Reveal in Graph
        </button>
      </div>

      <dl className="file-stats">
        <div><dt>Lines</dt><dd>{file.lineCount.toLocaleString()}</dd></div>
        <div><dt>Folder</dt><dd>{file.folder}</dd></div>
        <div><dt>External packages</dt><dd>{file.externalImports.length}</dd></div>
      </dl>

      {/* Resolved Imports — now interactive (Issue 2) */}
      <section>
        <h3>Resolved imports <span>{file.imports.length}</span></h3>
        {file.imports.length ? (
          <ul>
            {file.imports.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  className="file-ref"
                  onClick={() => onNavigateToFile(item)}
                  onMouseEnter={() => onHoverFile(item)}
                  onMouseLeave={() => onHoverFile(null)}
                  title={`Navigate to ${item}`}
                >
                  <code>{item}</code>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-copy">No project-file imports.</p>
        )}
      </section>

      {/* Imported By — now interactive (Issue 2) */}
      <section>
        <h3>Imported by <span>{importers.length}</span></h3>
        {importers.length ? (
          <ul>
            {importers.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  className="file-ref"
                  onClick={() => onNavigateToFile(item)}
                  onMouseEnter={() => onHoverFile(item)}
                  onMouseLeave={() => onHoverFile(null)}
                  title={`Navigate to ${item}`}
                >
                  <code>{item}</code>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-copy">No project files import this file.</p>
        )}
      </section>

      {/* External Imports — read-only, not navigable */}
      {file.externalImports.length > 0 && (
        <section>
          <h3>External imports <span>{file.externalImports.length}</span></h3>
          <ul>
            {file.externalImports.map((item) => (
              <li key={item}>
                <span className="file-ref" style={{ cursor: "default" }}>
                  <code>{item}</code>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
