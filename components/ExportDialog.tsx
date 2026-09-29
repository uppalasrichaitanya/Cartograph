"use client";

/**
 * Export dialog: a live preview of the real exported figure, and the
 * choices that shape it. The preview IS the file: the same URL the download
 * and the README embed use.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadBlob, rasterizeSvg } from "@/lib/diagram/browser";
import { defaultDiagramOptions, diagramFilename, diagramQuery } from "@/lib/diagram/options";
import type { DiagramOptions } from "@/lib/diagram/types";
import { copyShareLink } from "@/lib/workspace/share";
import { CloseIcon, DownloadIcon } from "./Icons";

const STORAGE_KEY = "cartograph:export-options";

type Stored = Omit<DiagramOptions, "scope">;

function loadStored(): Partial<Stored> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Stored>) : {};
  } catch {
    return {};
  }
}

function saveStored(options: DiagramOptions): void {
  try {
    const stored: Record<string, unknown> = { ...options };
    delete stored.scope;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Per-viewer convenience only; nothing depends on it.
  }
}

type Choice<T extends string> = Readonly<{ value: T; label: string }>;

function Segmented<T extends string>({ label, value, choices, onChange }: {
  label: string; value: T; choices: ReadonlyArray<Choice<T>>; onChange: (value: T) => void;
}) {
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = choices.findIndex((choice) => choice.value === value);
    const next = choices[(index + (event.key === "ArrowRight" ? 1 : choices.length - 1)) % choices.length];
    onChange(next.value);
  };
  return (
    <div className="export-field">
      <span className="export-field-label" id={`export-${label}`}>{label}</span>
      <div className="export-segmented" role="radiogroup" aria-labelledby={`export-${label}`} onKeyDown={onKeyDown}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={choice.value === value}
            tabIndex={choice.value === value ? 0 : -1}
            className={choice.value === value ? "is-on" : ""}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ExportDialog({ analysisId, repoName, region, onClose }: {
  analysisId: string;
  repoName: string;
  region: string | null;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<DiagramOptions>(() => ({
    ...defaultDiagramOptions("document"),
    ...loadStored(),
    scope: region ? { kind: "region", id: region } : { kind: "repository" },
  }));
  const [svg, setSvg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scale, setScale] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const update = useCallback((patch: Partial<DiagramOptions>) => {
    setOptions((current) => {
      const next = { ...current, ...patch };
      saveStored(next);
      return next;
    });
  }, []);

  const apiUrl = useCallback(
    (format: "svg" | "mermaid", download = false) => `/api/diagram/${analysisId}?${diagramQuery(options, format, download)}`,
    [analysisId, options],
  );

  // Debounced preview: the previous image stays (dimmed) until the next is ready.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(apiUrl("svg"), { signal: controller.signal });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "The diagram could not be created.");
        }
        const text = await response.text();
        setSvg(text);
        setScale(Number(response.headers.get("X-Cartograph-Scale")) || null);
        setPreviewUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
        });
        setError(null);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "The diagram could not be created.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [apiUrl]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("[role=radio][aria-checked=true]")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const trapFocus = (event: React.KeyboardEvent) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input, [tabindex='0']")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const flash = (message: string) => { setStatus(message); setTimeout(() => setStatus(null), 2_000); };
  const shareUrl = useMemo(() => (typeof window === "undefined" ? "" : `${window.location.origin}/repo/${analysisId}`), [analysisId]);

  const downloadSvg = () => svg && downloadBlob(new Blob([svg], { type: "image/svg+xml" }), diagramFilename(repoName, "svg"));
  const downloadPng = async () => {
    if (!svg) return;
    try {
      const { blob, scale: used } = await rasterizeSvg(svg, 2);
      downloadBlob(blob, diagramFilename(repoName, "png").replace(".png", used >= 2 ? "@2x.png" : ".png"));
      if (used < 2) flash("Saved at 1x: this browser could not make a larger image.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PNG export failed.");
    }
  };
  const fetchMermaid = async () => {
    const response = await fetch(apiUrl("mermaid"));
    if (!response.ok) throw new Error("Mermaid export failed.");
    return response.text();
  };
  const downloadMermaid = async () => {
    try { downloadBlob(new Blob([await fetchMermaid()], { type: "text/plain" }), diagramFilename(repoName, "mmd")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Mermaid export failed."); }
  };
  const copyMarkdown = async () => {
    try {
      const markdown = `\`\`\`mermaid\n${(await fetchMermaid()).trimEnd()}\n\`\`\`\n\n<sub>Generated by [Cartograph](${shareUrl}) · verified from import statements</sub>\n`;
      flash((await copyShareLink(markdown)) ? "Markdown copied" : "Copy failed");
    } catch { flash("Copy failed"); }
  };
  const copyEmbed = async () => {
    const embed = `![${repoName} architecture](${window.location.origin}${apiUrl("svg")})`;
    flash((await copyShareLink(embed)) ? "Embed link copied" : "Copy failed");
  };

  const findingsNote = scale !== null && options.preset === "slide" && scale < 0.6
    ? "Too detailed to read on a slide. Switch Detail to Overview."
    : null;

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <header className="export-head">
          <h2 id="export-title">Export diagram</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close export"><CloseIcon size={14} /></button>
        </header>

        <div className="export-body">
          <figure className={`export-preview ${loading ? "is-loading" : ""}`}>
            {/* A blob: URL of the exported SVG; next/image cannot optimise it. */}
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={`${repoName} architecture preview`} />
            ) : <div className="export-preview-empty">Preparing the figure...</div>}
            {findingsNote && <figcaption className="export-warning">{findingsNote}</figcaption>}
            {error && <figcaption className="export-error" role="alert">{error}</figcaption>}
          </figure>

          <div className="export-controls">
            {region && (
              <Segmented
                label="Scope"
                value={options.scope.kind === "repository" ? "repository" : "region"}
                choices={[{ value: "repository", label: "Repository" }, { value: "region", label: `Region: ${region}` }]}
                onChange={(value) => update({ scope: value === "repository" ? { kind: "repository" } : { kind: "region", id: region } })}
              />
            )}
            <Segmented label="Format for" value={options.preset} choices={[{ value: "document", label: "Document" }, { value: "slide", label: "Slide" }]}
              onChange={(preset) => update({ preset, showExternal: preset === "document" })} />
            {options.scope.kind === "repository" && (
              <Segmented label="Detail" value={options.detail} choices={[{ value: "overview", label: "Overview" }, { value: "standard", label: "Standard" }]}
                onChange={(detail) => update({ detail })} />
            )}
            <Segmented label="Theme" value={options.theme} choices={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "print", label: "Print" }]}
              onChange={(theme) => update({ theme })} />
            <Segmented label="Notes" value={options.annotations} choices={[{ value: "none", label: "None" }, { value: "measured", label: "Measured" }]}
              onChange={(annotations) => update({ annotations })} />
            <label className="export-check"><input type="checkbox" checked={options.background === "transparent"} onChange={(event) => update({ background: event.target.checked ? "transparent" : "solid" })} /> Transparent background</label>
            <label className="export-check"><input type="checkbox" checked={options.includeTests} onChange={(event) => update({ includeTests: event.target.checked })} /> Include tests</label>
            <label className="export-check"><input type="checkbox" checked={options.showExternal} onChange={(event) => update({ showExternal: event.target.checked })} /> Show external packages</label>
          </div>
        </div>

        <footer className="export-actions">
          <span className="export-status" aria-live="polite">{status}</span>
          <button type="button" className="button button-secondary" onClick={copyMarkdown}>Copy Markdown</button>
          <button type="button" className="button button-secondary" onClick={copyEmbed}>Copy embed link</button>
          <button type="button" className="button button-secondary" onClick={downloadMermaid}>Mermaid</button>
          <button type="button" className="button button-secondary" onClick={downloadPng} disabled={!svg}>PNG</button>
          <button type="button" className="button button-primary" onClick={downloadSvg} disabled={!svg}><DownloadIcon size={13} /> SVG</button>
        </footer>
      </div>
    </div>
  );
}
