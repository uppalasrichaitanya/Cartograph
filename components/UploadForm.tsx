"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import { ProgressStream, type ProgressState } from "./ProgressStream";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type StreamMessage =
  | { type: "progress"; phase: string; detail: string }
  | { type: "result"; shareUrl: string }
  | { type: "error"; error: string };

function sanitizeFilename(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}

async function consumeAnalysisStream(blobUrl: string, onProgress: (progress: ProgressState) => void): Promise<string> {
  const response = await fetch("/api/analyze/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blobUrl }),
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
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      setError("Choose a .zip archive of a JavaScript or TypeScript project.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("This zip is larger than the 25 MB limit.");
      return;
    }

    setError(null);
    setIsWorking(true);
    try {
      setProgress({ phase: "validating", detail: "Uploading the archive directly to storage" });
      const blob = await upload(`uploads/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload-url",
        multipart: file.size > 4 * 1024 * 1024,
        onUploadProgress: ({ percentage }) =>
          setProgress({ phase: "validating", detail: `Uploading the archive (${Math.round(percentage)}%)` }),
      });
      const shareUrl = await consumeAnalysisStream(blob.url, setProgress);
      window.location.assign(shareUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload or analysis failed.");
      setProgress(null);
      setIsWorking(false);
    }
  };

  return (
    <form className="upload-form" onSubmit={onSubmit}>
      <label className="file-drop">
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          disabled={isWorking}
          onChange={(event) => setSelectedFileName(event.currentTarget.files?.[0]?.name ?? null)}
        />
        <span className="file-icon" aria-hidden="true">↑</span>
        <span>{selectedFileName ?? "Drop a project zip here, or choose a file"}</span>
        <small>JavaScript &amp; TypeScript · 25 MB max</small>
      </label>
      <button className="button button-primary" type="submit" disabled={isWorking}>
        {isWorking ? "Mapping repository…" : "Generate map"}
      </button>
      <ProgressStream progress={progress} />
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  );
}
