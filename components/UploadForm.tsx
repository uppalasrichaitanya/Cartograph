"use client";

import { useRef, useState, useCallback } from "react";
import { ProgressStream, type ProgressState } from "./ProgressStream";
import { LoadingSkeleton } from "./LoadingSkeleton";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type StreamMessage =
  | { type: "progress"; phase: string; detail: string }
  | { type: "result"; shareUrl: string }
  | { type: "error"; error: string };

async function consumeAnalysisStream(
  zipPath: string,
  repoName: string,
  repoSizeBytes: number,
  onProgress: (progress: ProgressState) => void,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/analyze/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ zipPath, repoName, repoSizeBytes }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not start analysis.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  while (true) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const events = buffered.split("\n\n");
    buffered = events.pop() ?? "";
    for (const event of events) {
      const line = event.split("\n").find((part) => part.startsWith("data: "));
      if (!line) continue;
      const message = JSON.parse(line.slice(6)) as StreamMessage;
      if (message.type === "progress") onProgress({ phase: message.phase, detail: message.detail });
      if (message.type === "result") return message.shareUrl;
      if (message.type === "error") throw new Error(message.error);
    }
    if (done) break;
  }
  throw new Error("The analysis stream ended before a result was returned.");
}

export function UploadForm() {
  const input = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);

  const resetState = useCallback(() => {
    setIsWorking(false);
    setProgress(null);
    setError(null);
    setShowSkeleton(false);
    setSelectedFileName(null);
    if (input.current) input.current.value = "";
  }, []);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resetState();
  }, [resetState]);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Choose a .zip archive of a JavaScript, TypeScript, or Python project.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("This zip is larger than the 25 MB limit.");
      return;
    }

    setError(null);
    setIsWorking(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setProgress({ phase: "validating", detail: "Uploading the archive to the server" });

      const formData = new FormData();
      formData.append("file", file);
      const uploadResponse = await fetch("/api/upload-local", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      if (!uploadResponse.ok) {
        const body = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Upload failed.");
      }
      const { tempPath } = (await uploadResponse.json()) as { tempPath: string };

      // Show skeleton once analysis begins.
      setShowSkeleton(true);

      // Derive repo name from filename (strip .zip extension).
      const repoName = file.name.replace(/\.zip$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled Repository";
      const repoSizeBytes = file.size;

      const shareUrl = await consumeAnalysisStream(tempPath, repoName, repoSizeBytes, setProgress, controller.signal);
      window.location.assign(shareUrl);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        // User cancelled — silent reset.
        return;
      }
      setError(caught instanceof Error ? caught.message : "Upload or analysis failed.");
      setProgress(null);
      setIsWorking(false);
      setShowSkeleton(false);
    }
  };

  /* ─── Drag and drop handlers (Issue 27) ─── */
  const onDragEnter = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && input.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.current.files = dt.files;
      setSelectedFileName(file.name);
    }
  };

  return (
    <>
      <form className="upload-form" onSubmit={onSubmit}>
        <label
          className={`file-drop ${isDragging ? "is-dragging" : ""} ${selectedFileName ? "is-file-selected" : ""}`}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={isWorking}
            onChange={(event) => setSelectedFileName(event.currentTarget.files?.[0]?.name ?? null)}
          />
          <span className="file-icon" aria-hidden="true">{selectedFileName ? "📁" : "↑"}</span>
          <span>{selectedFileName ?? "Drop a project zip here, or choose a file"}</span>
          <small>JavaScript, TypeScript &amp; Python · 25 MB max</small>
        </label>

        {/* Buttons row: Submit + Cancel (Issue 29) */}
        <div className="upload-actions">
          <button className="button button-primary" type="submit" disabled={isWorking}>
            {isWorking ? "Mapping repository…" : "Generate map"}
          </button>
          {isWorking && (
            <button className="button button-secondary" type="button" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>

        {/* Progress stepper (Issue 9) */}
        <ProgressStream progress={progress} />

        {/* Error display (Issue 28) */}
        {error && (
          <div className="upload-error-card" role="alert">
            <p className="error-title">⚠ Analysis failed</p>
            <p className="error-message">{error}</p>
            <div className="error-actions">
              <button type="button" className="button button-primary" onClick={resetState}>
                Try again
              </button>
            </div>
            <details className="error-troubleshoot">
              <summary>Troubleshooting</summary>
              <ul>
                <li>The file must be a <strong>.zip</strong> archive</li>
                <li>It should contain JavaScript (.js/.jsx), TypeScript (.ts/.tsx), or Python (.py) source files</li>
                <li>Maximum file size is 25 MB</li>
                <li>Ensure the zip doesn&apos;t contain only <code>node_modules</code> or <code>dist</code> folders</li>
                <li>Try zipping the project root directory directly</li>
              </ul>
            </details>
          </div>
        )}
      </form>

      {/* Loading skeleton shown during analysis (Issue 10) */}
      {showSkeleton && <LoadingSkeleton />}
    </>
  );
}
