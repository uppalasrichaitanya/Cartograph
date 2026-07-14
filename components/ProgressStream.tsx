"use client";

export type ProgressState = {
  phase: string;
  detail: string;
};

const STEPS: { phase: string; label: string }[] = [
  { phase: "validating", label: "Uploading" },
  { phase: "unzipping", label: "Reading" },
  { phase: "parsing", label: "Parsing" },
  { phase: "clustering", label: "Resolving" },
  { phase: "detecting", label: "Analyzing" },
  { phase: "layout", label: "Generating" },
  { phase: "persisting", label: "Saving" },
];

function getStepIndex(phase: string): number {
  return STEPS.findIndex((s) => s.phase === phase);
}

export function ProgressStream({ progress }: { progress: ProgressState | null }) {
  if (!progress) return null;

  const currentIndex = getStepIndex(progress.phase);

  return (
    <div className="progress-stepper" role="status" aria-live="polite">
      {STEPS.map((step, i) => {
        const status = i < currentIndex ? "is-done" : i === currentIndex ? "is-active" : "is-pending";
        return (
          <span key={step.phase}>
            {i > 0 && <span className="progress-step-separator" aria-hidden="true">→</span>}
            <span className={`progress-step ${status}`}>
              <span className="progress-step-icon">
                {status === "is-done" ? "✓" : status === "is-active" ? "●" : ""}
              </span>
              {step.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
