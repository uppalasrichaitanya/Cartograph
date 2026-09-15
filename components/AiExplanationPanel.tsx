"use client";

import { useMemo, useState } from "react";
import type { GraphNode } from "@/types/graph";
import { CloseIcon, SparkIcon } from "./Icons";

type AiCitation = { kind: "node" | "edge" | "analyzer-result"; id: string };
type AiResult = {
  answer: string;
  claims: Array<{ text: string; citations: AiCitation[] }>;
  uncertainty?: string;
  provider: string;
  model: string;
};

export function AiExplanationPanel({
  analysisId,
  file,
  onClose,
}: {
  analysisId: string;
  file: GraphNode | null;
  onClose: () => void;
}) {
  const [resultEnvelope, setResultEnvelope] = useState<{ subjectId: string | null; data: AiResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorEnvelope, setErrorEnvelope] = useState<{ subjectId: string | null; message: string } | null>(null);
  const subjectId = file?.id ?? null;
  const subjectLabel = file?.path ?? "Repository overview";
  const result = resultEnvelope?.subjectId === subjectId ? resultEnvelope.data : null;
  const error = errorEnvelope?.subjectId === subjectId ? errorEnvelope.message : null;

  const citations = useMemo(() => {
    const seen = new Set<string>();
    return (result?.claims ?? []).flatMap((claim) => claim.citations).filter((citation) => {
      const key = `${citation.kind}:${citation.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [result]);

  async function explain() {
    setLoading(true);
    setResultEnvelope(null);
    setErrorEnvelope(null);
    try {
      const response = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, ...(subjectId ? { nodeId: subjectId } : {}) }),
      });
      const payload = (await response.json()) as AiResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "AI explanation failed.");
      setResultEnvelope({ subjectId, data: payload });
    } catch (caught) {
      setErrorEnvelope({ subjectId, message: caught instanceof Error ? caught.message : "AI explanation failed." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="detail-panel ai-panel is-entering" aria-label="AI-assisted explanation">
      <div className="detail-panel-heading">
        <div>
          <p className="eyebrow"><SparkIcon size={13} /> AI-ASSISTED</p>
          <h2 title={subjectLabel}>{subjectLabel}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close AI explanation"><CloseIcon size={14} /></button>
      </div>

      {!result && !loading && (
        <div className="ai-empty-state">
          <p>Generate a grounded interpretation from the measured graph and its citations.</p>
          <button type="button" className="quick-action ai-generate" onClick={explain}>
            <SparkIcon size={14} /> Explain {file ? "file" : "repository"}
          </button>
        </div>
      )}

      {loading && <p className="ai-status" role="status">Reading evidence and asking the configured provider...</p>}
      {error && (
        <div className="ai-error" role="alert">
          <strong>Explanation unavailable</strong>
          <p>{error}</p>
          <button type="button" className="quick-action" onClick={explain}>Try again</button>
        </div>
      )}
      {result && (
        <div className="ai-result">
          <div className="assisted-note">
            <span className="assisted-label">Generated interpretation - {result.provider}</span>
            <p>{result.answer}</p>
          </div>
          {result.uncertainty && <p className="ai-uncertainty">Limit: {result.uncertainty}</p>}
          <section>
            <h3>Grounded claims <span>{result.claims.length}</span></h3>
            <ul className="ai-claims">
              {result.claims.map((claim, index) => (
                <li key={`${claim.text}-${index}`}>
                  <p>{claim.text}</p>
                  <div className="ai-citations">
                    {claim.citations.map((citation) => <code key={`${citation.kind}:${citation.id}`}>{citation.kind}:{citation.id}</code>)}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          {citations.length > 0 && <p className="ai-provider">{result.model} - {citations.length} evidence references</p>}
          <button type="button" className="quick-action" onClick={explain}>Refresh explanation</button>
        </div>
      )}
    </aside>
  );
}
