"use client";

import { useRef, useState, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import { buildUploadPathname } from "@/lib/storage/uploadPathname";
import { ProgressStream, type ProgressState } from "./ProgressStream";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { saveOwnerToken } from "@/lib/workspace/ownerToken";
import { consumeAnalysisStream, type StreamMessage } from "@/lib/client/analysisStream";
import { GithubSourceError, parseGithubSource } from "@/lib/github/source";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type SourceMode = "zip" | "github";

type StreamResult = Extract<StreamMessage, { type: "result" }>;

export function UploadForm({ useBlob = false, initialGithub = "" }: { useBlob?: boolean; initialGithub?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [retention, setRetention] = useState<"7d" | "30d" | "manual">("30d");
  // `/?github=owner/repo` opens in GitHub mode with the value filled in. It
  // never submits on its own: mapping someone's repository is a click away.
  const [mode, setMode] = useState<SourceMode>(initialGithub ? "github" : "zip");
  const [githubValue, setGithubValue] = useState(initialGithub);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const resetState = useCallback(() => {
    setIsWorking(false);
    setProgress(null);
    setError(null);
    setShowSkeleton(false);
    setSelectedFileName(null);
    setFieldError(null);
    if (input.current) input.current.value = "";
  }, []);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resetState();
  }, [resetState]);

  const arriveAtMap = (outcome: StreamResult) => {
    const id = outcome.shareUrl.split("/").pop() ?? "";
    saveOwnerToken(id, outcome.ownerToken);
    // One-time notice on arrival: see OwnerNotice.
    try { window.sessionStorage.setItem(`cartograph:new:${id}`, outcome.expiresAt ?? "manual"); } catch { /* unavailable */ }
    window.location.assign(outcome.shareUrl);
  };

  const importFromGithub = async () => {
    // The same parser the server applies, so a bad link is explained here
    // without a round trip; the server still validates on its own.
    try {
      parseGithubSource(githubValue);
    } catch (caught) {
      setFieldError(caught instanceof GithubSourceError ? caught.message : "That doesn't look like a GitHub link.");
      return;
    }
    setFieldError(null);
    setError(null);
    setIsWorking(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setProgress({ phase: "validating", detail: "Contacting GitHub" });
      setShowSkeleton(true);
      const outcome = await consumeAnalysisStream({ github: githubValue.trim(), retention }, setProgress, { signal: controller.signal });
      arriveAtMap(outcome);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "The import failed.");
      setProgress(null);
      setIsWorking(false);
      setShowSkeleton(false);
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "github") {
      await importFromGithub();
      return;
    }
    const file = input.current?.files?.[0];
    if (!file) {
      setError("Choose a .zip file to analyze.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Choose a .zip archive of a JavaScript, TypeScript, Python, or Go project.");
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

      let zipRef: string;

      if (useBlob) {
        // --- Vercel Blob: client-side upload directly to Blob storage ---
        // The pathname must be unique per upload: the analysis deletes the
        // archive when it finishes, so a shared pathname would let one run's
        // cleanup remove another run's archive.
        const blob = await upload(buildUploadPathname(file.name), file, {
          access: "public",
          handleUploadUrl: "/api/upload-url",
        });
        // Use the URL Blob actually returned — it carries the random suffix
        // the token added, so analysis and cleanup act on this upload alone.
        zipRef = blob.url;
      } else {
        // --- Local: upload through the local API route ---
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
        zipRef = tempPath;
      }

      // Show skeleton once analysis begins.
      setShowSkeleton(true);

      // Derive repo name from filename (strip .zip extension).
      const repoName = file.name.replace(/\.zip$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled Repository";
      const repoSizeBytes = file.size;

      const outcome = await consumeAnalysisStream({ zipPath: zipRef, repoName, repoSizeBytes, retention }, setProgress, { signal: controller.signal });
      arriveAtMap(outcome);
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
        {/* Source: one of two ways in. A radio group, so arrow keys and the
            browser's own semantics come for free; drawn as a segmented control. */}
        <fieldset className="source-toggle" disabled={isWorking}>
          <legend>Source</legend>
          {([["zip", "Zip file"], ["github", "GitHub link"]] as const).map(([value, label]) => (
            <label key={value} className={mode === value ? "is-on" : ""}>
              <input
                type="radio"
                name="source"
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  setFieldError(null);
                  setError(null);
                  // The file input is unmounted in GitHub mode: forget its file name too.
                  setSelectedFileName(null);
                }}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        {mode === "zip" ? (
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
            <small>JavaScript, TypeScript, Python &amp; Go · 25 MB max</small>
          </label>
        ) : (
          <div className="github-field">
            <label htmlFor="github-source">Public GitHub repository</label>
            <input
              id="github-source"
              className="github-input"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="github.com/owner/repo"
              value={githubValue}
              disabled={isWorking}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "github-help github-error" : "github-help"}
              onChange={(event) => { setGithubValue(event.currentTarget.value); setFieldError(null); }}
            />
            <small id="github-help">Public repositories only · archive up to 25 MB · add /tree/branch for another branch</small>
            {fieldError && <p id="github-error" className="form-error" role="alert">{fieldError}</p>}
          </div>
        )}

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

        <fieldset className="retention" disabled={isWorking}>
          <legend>Keep this map</legend>
          {([["30d", "30 days"], ["7d", "7 days"], ["manual", "Until I delete it"]] as const).map(([value, label]) => (
            <label key={value}>
              <input type="radio" name="retention" value={value} checked={retention === value} onChange={() => setRetention(value)} />
              {label}
            </label>
          ))}
        </fieldset>

        {/* Progress stepper (Issue 9) */}
        <ProgressStream progress={progress} />

        {/* Error display (Issue 28) */}
        {error && (
          <div className="upload-error-card" role="alert">
            <p className="error-title">⚠ {mode === "github" ? "Import failed" : "Analysis failed"}</p>
            <p className="error-message">{error}</p>
            <div className="error-actions">
              <button type="button" className="button button-primary" onClick={resetState}>
                Try again
              </button>
            </div>
            <details className="error-troubleshoot">
              <summary>Troubleshooting</summary>
              {mode === "github" ? (
                <ul>
                  <li>The repository must be <strong>public</strong>; for a private one, upload a zip instead</li>
                  <li>Use a link like <code>github.com/owner/repo</code>, or add <code>/tree/branch</code> for another branch or tag</li>
                  <li>The repository&apos;s archive must be 25 MB or smaller</li>
                  <li>It should contain JavaScript (.js/.jsx), TypeScript (.ts/.tsx), Python (.py), or Go (.go) source files</li>
                  <li>If GitHub is busy, wait a minute and try again</li>
                </ul>
              ) : (
                <ul>
                  <li>The file must be a <strong>.zip</strong> archive</li>
                  <li>It should contain JavaScript (.js/.jsx), TypeScript (.ts/.tsx), Python (.py), or Go (.go) source files</li>
                  <li>Maximum file size is 25 MB</li>
                  <li>Ensure the zip doesn&apos;t contain only <code>node_modules</code> or <code>dist</code> folders</li>
                  <li>Try zipping the project root directory directly</li>
                </ul>
              )}
            </details>
          </div>
        )}
      </form>

      {/* Loading skeleton shown during analysis (Issue 10) */}
      {showSkeleton && <LoadingSkeleton />}
    </>
  );
}
