"use client";

import { forwardRef } from "react";
import { tourSourceLabel, type TourSource, type TourStep } from "@/lib/workspace/tour";
import { SparkIcon } from "./Icons";
import { InlineText } from "./AiExplanationPanel";

/**
 * The guided tour's step card.
 *
 * Pinned bottom-centre of the map area left of the inspector, so it never
 * covers the selected node (the camera centres that in the same area) or the
 * inspector showing the step's evidence. States which source the steps came
 * from: AI guidance is labelled as such, a measured tour says it is measured.
 *
 * The live region is a sibling, not part of the card, so a screen reader hears
 * one short "Step k of n: file" per step instead of the whole card re-read.
 */
export const TourCard = forwardRef<HTMLElement, {
  source: TourSource;
  steps: ReadonlyArray<TourStep>;
  index: number;
  /** Offer the AI reading order: AI is configured and no AI order is loaded yet. */
  canUseAi: boolean;
  aiLoading: boolean;
  aiError: string | null;
  onPrevious: () => void;
  onNext: () => void;
  onExit: () => void;
  onUseAi: () => void;
}>(function TourCard(
  { source, steps, index, canUseAi, aiLoading, aiError, onPrevious, onNext, onExit, onUseAi },
  ref,
) {
  const step = steps[index];
  if (!step) return null;
  const last = index === steps.length - 1;
  const name = step.id.split("/").pop() ?? step.id;
  const dir = step.id.slice(0, Math.max(0, step.id.length - name.length - 1));

  return (
    <>
      <section ref={ref} className={`tour-card is-${source}`} role="region" aria-label="Guided tour" tabIndex={-1}>
        <div className="tour-card-head">
          <p className="tour-source">
            {source === "ai" && <SparkIcon size={12} />}
            {tourSourceLabel(source)}
          </p>
          <p className="tour-count">Step {index + 1} of {steps.length}</p>
        </div>
        <ol className="tour-progress" aria-hidden="true">
          {steps.map((s, i) => (
            <li key={s.id} className={i < index ? "is-done" : i === index ? "is-current" : ""} />
          ))}
        </ol>
        <h2 className="tour-file" title={step.id}>
          <span className="tour-file-name">{name}</span>
          {dir && <span className="tour-file-path">{dir}/</span>}
        </h2>
        <p className="tour-reason"><InlineText text={step.reason} /></p>
        {aiError && <p className="tour-note" role="alert">{aiError}</p>}
        <div className="tour-actions">
          <button type="button" className="quick-action" onClick={onPrevious} disabled={index === 0} aria-keyshortcuts="ArrowLeft">
            Previous
          </button>
          <button type="button" className="quick-action tour-next" onClick={last ? onExit : onNext} aria-keyshortcuts={last ? "Escape" : "ArrowRight"}>
            {last ? "Finish" : "Next"}
          </button>
          {canUseAi && (
            <button type="button" className="quick-action tour-ai" onClick={onUseAi} disabled={aiLoading}>
              <SparkIcon size={12} /> {aiLoading ? "Loading AI order…" : "Use AI reading order"}
            </button>
          )}
          {!last && (
            <button type="button" className="tour-exit" onClick={onExit} aria-keyshortcuts="Escape">
              Exit tour <kbd aria-hidden="true">Esc</kbd>
            </button>
          )}
        </div>
      </section>
      <p className="sr-only" role="status" aria-live="polite">
        Step {index + 1} of {steps.length}: {step.id}
      </p>
    </>
  );
});
