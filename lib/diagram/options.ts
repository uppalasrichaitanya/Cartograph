/**
 * Diagram options and their URL form. Client-safe.
 *
 * The same query string drives the export dialog's preview, the downloads,
 * and the embed URL a README uses, so it is parsed strictly: an unknown value
 * is an error, never a silently different figure.
 *
 * @module lib/diagram/options
 */
import type { DiagramFormat, DiagramOptions, DiagramPreset } from "./types";

export class DiagramOptionsError extends Error {}

export function defaultDiagramOptions(preset: DiagramPreset = "document"): DiagramOptions {
  return {
    scope: { kind: "repository" },
    preset,
    detail: "standard",
    theme: "light",
    background: "solid",
    includeTests: false,
    showExternal: preset === "document",
    annotations: "measured",
  };
}

function pick<T extends string>(params: URLSearchParams, name: string, allowed: ReadonlyArray<T>, fallback: T): T {
  const value = params.get(name);
  if (value === null) return fallback;
  if ((allowed as ReadonlyArray<string>).includes(value)) return value as T;
  throw new DiagramOptionsError(`${name} must be one of: ${allowed.join(", ")}`);
}

function flag(params: URLSearchParams, name: string, fallback: boolean): boolean {
  return pick(params, name, ["0", "1"] as const, fallback ? "1" : "0") === "1";
}

const NOTES = { none: "none", measured: "measured", ai: "measured+ai" } as const;

export function parseDiagramOptions(params: URLSearchParams): {
  options: DiagramOptions;
  format: DiagramFormat;
  download: boolean;
} {
  const preset = pick(params, "preset", ["document", "slide"] as const, "document");
  const defaults = defaultDiagramOptions(preset);
  const rawScope = params.get("scope") ?? "repo";
  let scope: DiagramOptions["scope"];
  if (rawScope === "repo") {
    scope = { kind: "repository" };
  } else if (rawScope.startsWith("region:")) {
    const id = rawScope.slice("region:".length);
    if (!id || id.length > 1_000) throw new DiagramOptionsError("scope must be repo or region:<name> (name 1-1000 characters)");
    scope = { kind: "region", id };
  } else {
    throw new DiagramOptionsError("scope must be repo or region:<name>");
  }
  return {
    options: {
      scope,
      preset,
      detail: pick(params, "detail", ["overview", "standard"] as const, defaults.detail),
      theme: pick(params, "theme", ["light", "dark", "print"] as const, defaults.theme),
      background: pick(params, "bg", ["solid", "transparent"] as const, defaults.background),
      includeTests: flag(params, "tests", defaults.includeTests),
      showExternal: flag(params, "external", defaults.showExternal),
      annotations: NOTES[pick(params, "notes", ["none", "measured", "ai"] as const, "measured")],
    },
    format: pick(params, "format", ["svg", "mermaid"] as const, "svg"),
    download: flag(params, "download", false),
  };
}

export function diagramQuery(options: DiagramOptions, format: DiagramFormat, download = false): string {
  const notes = options.annotations === "measured+ai" ? "ai" : options.annotations;
  const params = new URLSearchParams({
    scope: options.scope.kind === "repository" ? "repo" : `region:${options.scope.id}`,
    preset: options.preset,
    detail: options.detail,
    theme: options.theme,
    bg: options.background,
    tests: options.includeTests ? "1" : "0",
    external: options.showExternal ? "1" : "0",
    notes,
    format,
  });
  if (download) params.set("download", "1");
  return params.toString();
}

export function diagramFilename(repoName: string, extension: string): string {
  const slug = repoName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "repository"}-architecture.${extension}`;
}
