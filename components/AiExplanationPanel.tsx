"use client";

import { useState } from "react";
import type { GraphNode } from "@/types/graph";
import { CloseIcon, SparkIcon } from "./Icons";

type AiCitation = { kind: "node" | "edge" | "region" | "analyzer-result"; id: string };
type AiClaim = { text: string; citations: AiCitation[]; section?: string };
type AiResult = {
  answer: string;
  claims: AiClaim[];
  readingOrder?: Array<{ id: string; reason: string }>;
  uncertainty?: string;
  dropped?: number;
  provider: string;
  model: string;
  cached?: boolean;
  generatedAt?: string;
};

type Subject =
  | { kind: "overview" }
  | { kind: "region"; id: string }
  | { kind: "file"; id: string };

const SUBJECT_COPY: Record<Subject["kind"], { eyebrow: string; action: string; intro: string }> = {
  overview: {
    eyebrow: "REPOSITORY",
    action: "Explain this repository",
    intro: "Get a guided tour: what the project likely does, how its regions divide the work, where complexity concentrates, and which files to read first.",
  },
  region: {
    eyebrow: "REGION",
    action: "Explain this region",
    intro: "Learn what this region is responsible for, its key files, and how it connects to the rest of the codebase.",
  },
  file: {
    eyebrow: "FILE",
    action: "Explain this file",
    intro: "Learn what this file is for, what it relies on, what relies on it, and what could break if it changes.",
  },
};

function subjectKey(subject: Subject): string {
  return subject.kind === "overview" ? "overview" : `${subject.kind}:${subject.id}`;
}

function basename(path: string): string {
  return path.split("/").pop() || path;
}

/** Edge IDs are `<from>-><to>`; either end is a file the reader can open. */
function edgeEnds(id: string): [string, string] | null {
  const split = id.indexOf("->");
  return split > 0 ? [id.slice(0, split), id.slice(split + 2)] : null;
}

/** Models sometimes use `code` and **bold** despite being asked for plain text. Render just those two. */
function InlineText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={index}>{part.slice(1, -1)}</code>
        : part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={index}>{part.slice(2, -2)}</strong>
        : part,
      )}
    </>
  );
}

function groupBySection(claims: ReadonlyArray<AiClaim>): Array<[string, AiClaim[]]> {
  const groups = new Map<string, AiClaim[]>();
  for (const claim of claims) {
    const section = claim.section ?? "Observations";
    groups.set(section, [...(groups.get(section) ?? []), claim]);
  }
  return [...groups.entries()];
}

export function AiExplanationPanel({
  analysisId,
  file,
  region,
  onClose,
  onNavigateToFile,
  onNavigateToRegion,
}: {
  analysisId: string;
  file: GraphNode | null;
  region: string | null;
  onClose: () => void;
  onNavigateToFile: (id: string) => void;
  onNavigateToRegion: (region: string) => void;
}) {
  const subject: Subject = file ? { kind: "file", id: file.id } : region ? { kind: "region", id: region } : { kind: "overview" };
  const key = subjectKey(subject);
  // Results are kept per subject, so following a citation and coming back
  // does not cost another request.
  const [results, setResults] = useState<Record<string, AiResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const result = results[key] ?? null;
  const error = errors[key] ?? null;
  const loading = loadingKey === key;
  const copy = SUBJECT_COPY[subject.kind];
  const label = subject.kind === "overview" ? "Repository overview" : subject.id;

  async function explain(refresh = false) {
    const requestKey = key;
    setLoadingKey(requestKey);
    setErrors((current) => {
      const next = { ...current };
      delete next[requestKey];
      return next;
    });
    try {
      const response = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, subject, ...(refresh ? { refresh: true } : {}) }),
      });
      const payload = (await response.json()) as AiResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "AI explanation failed.");
      setResults((current) => ({ ...current, [requestKey]: payload }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "AI explanation failed.";
      setErrors((current) => ({ ...current, [requestKey]: message }));
    } finally {
      setLoadingKey((current) => (current === requestKey ? null : current));
    }
  }

  function citationChip(citation: AiCitation) {
    const chipKey = `${citation.kind}:${citation.id}`;
    if (citation.kind === "node") {
      return (
        <button key={chipKey} type="button" className="ai-chip" title={`Open ${citation.id}`} onClick={() => onNavigateToFile(citation.id)}>
          {basename(citation.id)}
        </button>
      );
    }
    if (citation.kind === "region") {
      return (
        <button key={chipKey} type="button" className="ai-chip is-region" title={`Open region ${citation.id}`} onClick={() => onNavigateToRegion(citation.id)}>
          {citation.id}/
        </button>
      );
    }
    const ends = citation.kind === "edge" ? edgeEnds(citation.id) : null;
    if (ends) {
      return (
        <button key={chipKey} type="button" className="ai-chip is-edge" title={`Import ${ends[0]} → ${ends[1]}`} onClick={() => onNavigateToFile(ends[0])}>
          {basename(ends[0])} → {basename(ends[1])}
        </button>
      );
    }
    return <code key={chipKey} className="ai-chip is-static">{citation.id}</code>;
  }

  return (
    <aside className="detail-panel ai-panel is-entering" aria-label="AI-assisted explanation">
      <div className="detail-panel-heading">
        <div>
          <p className="eyebrow"><SparkIcon size={13} /> AI GUIDE · {copy.eyebrow}</p>
          <h2 title={label}>{label}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close AI explanation"><CloseIcon size={14} /></button>
      </div>

      {!result && !loading && !error && (
        <div className="ai-empty-state">
          <p>{copy.intro}</p>
          <button type="button" className="quick-action ai-generate" onClick={() => explain()}>
            <SparkIcon size={14} /> {copy.action}
          </button>
          <p className="ai-hint">Select a region or file on the map to change what gets explained.</p>
        </div>
      )}

      {loading && <p className="ai-status" role="status">Reading the measured graph and asking the AI provider…</p>}

      {error && !loading && (
        <div className="ai-error" role="alert">
          <strong>Explanation unavailable</strong>
          <p>{error}</p>
          <button type="button" className="quick-action" onClick={() => explain()}>Try again</button>
        </div>
      )}

      {result && !loading && (
        <div className="ai-result">
          <div className="assisted-note">
            <span className="assisted-label">In short</span>
            <p><InlineText text={result.answer} /></p>
          </div>

          {groupBySection(result.claims).map(([section, claims]) => (
            <section key={section} className="ai-section">
              <h3>{section}</h3>
              <ul className="ai-claims">
                {claims.map((claim, index) => (
                  <li key={`${section}-${index}`}>
                    <p><InlineText text={claim.text} /></p>
                    <div className="ai-citations" aria-label="Evidence">
                      {claim.citations.map(citationChip)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {result.readingOrder && result.readingOrder.length > 0 && (
            <section className="ai-section">
              <h3>{subject.kind === "file" ? "Read next" : "Start reading here"}</h3>
              <ol className="ai-reading-order">
                {result.readingOrder.map((step) => (
                  <li key={step.id}>
                    <button type="button" className="file-ref" onClick={() => onNavigateToFile(step.id)} title={`Open ${step.id}`}>
                      <code>{step.id}</code>
                    </button>
                    <p><InlineText text={step.reason} /></p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {result.uncertainty && <p className="ai-uncertainty">Limits: <InlineText text={result.uncertainty} /></p>}

          <p className="ai-disclaimer">
            Generated interpretation. Each point links to the measured files and imports it rests on, and
            points with unknown citations or figures are removed{result.dropped ? ` (${result.dropped} removed here)` : ""}.
            The wording can still be wrong. Check it against the map.
          </p>
          <p className="ai-provider">
            {result.provider} · {result.model}{result.cached ? " · cached" : ""}
          </p>
          <button type="button" className="quick-action" onClick={() => explain(true)}>Regenerate</button>
        </div>
      )}
    </aside>
  );
}
