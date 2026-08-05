"use client";

import type { FileEvidence } from "@/lib/analysis/projectConfidence";
import type { GraphNode, DependencyGraph } from "@/types/graph";
import { CloseIcon } from "./Icons";

export function FileDetailPanel({
  file,
  graph,
  evidence,
  interpretation,
  onClose,
  onNavigateToFile,
  onHoverFile,
}: {
  file: GraphNode | null;
  graph: DependencyGraph;
  /**
   * Evidence behind this file, read from the IR. `null` means no evidence
   * record was available — which is not the same as "everything is fine", so
   * the panel stays silent rather than implying full confidence.
   */
  evidence: FileEvidence | null;
  /**
   * Generated interpretation, when one exists. Nothing produces this yet.
   * Typed and threaded now so the surface that displays it is established
   * before the first AI feature rather than after.
   */
  interpretation?: string;
  onClose: () => void;
  onNavigateToFile: (fileId: string) => void;
  onHoverFile: (fileId: string | null) => void;
}) {
  if (!file) return null;

  const importers = graph.edges
    .filter((edge) => edge.to === file.id)
    .map((edge) => graph.nodes.find((node) => node.id === edge.from)?.path)
    .filter((path): path is string => Boolean(path));

  return (
    <aside className="detail-panel is-entering" aria-label={`Details for ${file.path}`}>
      <div className="detail-panel-heading">
        <div>
          <p className="eyebrow">FILE</p>
          <h2>{file.path}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close file details"><CloseIcon size={14} /></button>
      </div>

      {/* Copy Path and Copy Name are gone: they operated the tool rather than
          advancing understanding, and occupied the most valuable space in the
          panel to do it. The path above remains selectable, which is enough.

          Reveal in Graph stays — it returns attention to the map, which is
          where understanding is built — minus its emoji. */}
      <div className="quick-actions">
        <button
          type="button"
          className="quick-action"
          onClick={() => onNavigateToFile(file.id)}
          title="Center this node in the graph"
        >
          Reveal in graph
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

      {/* Unresolved imports — what could not be determined.
          Listed before the confidence note because the specifiers themselves
          are the actionable part; the explanation supports them. */}
      {evidence && evidence.unresolvedImports.length > 0 && (
        <section>
          <h3>
            Unresolved imports <span>{evidence.unresolvedImports.length}</span>
          </h3>
          <p className="evidence-copy">
            These imports exist in the source. Their targets could not be found
            in this repository.
          </p>
          <ul>
            {evidence.unresolvedImports.map((item) => (
              <li key={item}>
                <span className="file-ref is-unresolved" style={{ cursor: "default" }}>
                  <code>{item}</code>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Confidence — stated plainly, and only when it is not full.
          A verified file says nothing here: announcing full confidence on
          every file would make the statement meaningless where it matters. */}
      {evidence && evidence.reducedBecause.length > 0 && (
        <section className="evidence-section">
          <h3>Confidence</h3>
          <p className="evidence-copy">
            Reduced for this file.
          </p>
          <ul className="evidence-reasons">
            {evidence.reducedBecause.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Generated interpretation.
          Nothing produces this today — `interpretation` is always undefined.
          The slot exists so the first AI feature inherits a surface that is
          already visually and structurally separate from every fact above,
          rather than being fitted into one under delivery pressure. */}
      {interpretation && (
        <div className="assisted-note">
          <span className="assisted-label">Generated interpretation</span>
          <p>{interpretation}</p>
        </div>
      )}
    </aside>
  );
}
