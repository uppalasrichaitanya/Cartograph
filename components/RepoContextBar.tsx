"use client";

import type { RepoMeta } from "@/types/graph";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      + " · "
      + date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "Unknown";
  }
}

export function RepoContextBar({ meta }: { meta: RepoMeta }) {
  return (
    <div className="repo-context-bar" aria-label="Repository metadata">
      <span className="repo-context-name">{meta.repoName}</span>

      {meta.language && (
        <>
          <span className="repo-context-dot" aria-hidden="true">·</span>
          <span className="repo-context-badge">{meta.language}</span>
        </>
      )}

      {meta.framework && (
        <>
          <span className="repo-context-dot" aria-hidden="true">·</span>
          <span className="repo-context-badge is-framework">{meta.framework}</span>
        </>
      )}

      <span className="repo-context-dot" aria-hidden="true">·</span>
      <span>{meta.fileCount} files</span>

      <span className="repo-context-dot" aria-hidden="true">·</span>
      <span>{meta.folderCount} folders</span>

      <span className="repo-context-dot" aria-hidden="true">·</span>
      <span>{meta.dependencyCount} deps</span>

      {meta.repoSizeBytes != null && (
        <>
          <span className="repo-context-dot" aria-hidden="true">·</span>
          <span>{formatBytes(meta.repoSizeBytes)}</span>
        </>
      )}

      <span className="repo-context-dot" aria-hidden="true">·</span>
      <span>{formatTime(meta.analysisTimestamp)}</span>
    </div>
  );
}
