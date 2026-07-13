"use client";

import type { GraphNode, DependencyGraph } from "@/types/graph";

export function FileDetailPanel({
  file,
  graph,
  onClose,
}: {
  file: GraphNode | null;
  graph: DependencyGraph;
  onClose: () => void;
}) {
  if (!file) return null;
  const importers = graph.edges
    .filter((edge) => edge.to === file.id)
    .map((edge) => graph.nodes.find((node) => node.id === edge.from)?.path)
    .filter((path): path is string => Boolean(path));

  return (
    <aside className="detail-panel" aria-label={`Details for ${file.path}`}>
      <div className="detail-panel-heading">
        <div>
          <p className="eyebrow">FILE</p>
          <h2>{file.path}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close file details">×</button>
      </div>
      <dl className="file-stats">
        <div><dt>Lines</dt><dd>{file.lineCount.toLocaleString()}</dd></div>
        <div><dt>Folder</dt><dd>{file.folder}</dd></div>
        <div><dt>External packages</dt><dd>{file.externalImports.length}</dd></div>
      </dl>
      <section>
        <h3>Resolved imports <span>{file.imports.length}</span></h3>
        {file.imports.length ? <ul>{file.imports.map((item) => <li key={item}><code>{item}</code></li>)}</ul> : <p className="empty-copy">No project-file imports.</p>}
      </section>
      <section>
        <h3>Imported by <span>{importers.length}</span></h3>
        {importers.length ? <ul>{importers.map((item) => <li key={item}><code>{item}</code></li>)}</ul> : <p className="empty-copy">No project files import this file.</p>}
      </section>
      {file.externalImports.length > 0 && (
        <section>
          <h3>External imports <span>{file.externalImports.length}</span></h3>
          <ul>{file.externalImports.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
        </section>
      )}
    </aside>
  );
}
