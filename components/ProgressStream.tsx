"use client";

export type ProgressState = {
  phase: string;
  detail: string;
};

const PHASE_LABELS: Record<string, string> = {
  validating: "Validating",
  unzipping: "Unzipping",
  parsing: "Parsing",
  clustering: "Clustering",
  detecting: "Finding anomalies",
  layout: "Laying out",
  persisting: "Saving",
};

export function ProgressStream({ progress }: { progress: ProgressState | null }) {
  if (!progress) return null;
  return (
    <div className="progress-stream" role="status" aria-live="polite">
      <span className="progress-pulse" aria-hidden="true" />
      <div>
        <strong>{PHASE_LABELS[progress.phase] ?? "Analyzing"}</strong>
        <p>{progress.detail}</p>
      </div>
    </div>
  );
}
