"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  highlightSegments,
  rankSearchItems,
  type RankedResult,
  type SearchItem,
} from "@/lib/workspace/search";
import { SearchIcon } from "./Icons";

/**
 * How many results to show.
 *
 * A cap is reasonable now that results are ranked — the top of the list is
 * genuinely the best of the list. Previously the cap was hiding the absence of
 * ranking, so the best match could fall outside it entirely.
 *
 * The true total is always reported below, so a truncated list never implies
 * it is everything.
 */
const RESULT_LIMIT = 50;

/** Matched characters, marked so the ranking can be checked rather than trusted. */
function Highlighted({
  text,
  indices,
}: {
  text: string;
  indices: ReadonlyArray<number>;
}) {
  const segments = useMemo(() => highlightSegments(text, indices), [text, indices]);
  return (
    <>
      {segments.map((segment, i) =>
        segment.matched ? (
          <mark key={i} className="search-match">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function SearchOverlay({
  items,
  onSelect,
  onClose,
}: {
  items: ReadonlyArray<SearchItem>;
  onSelect: (target: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { results, total } = useMemo(
    () => rankSearchItems(items, query, RESULT_LIMIT),
    [items, query],
  );

  // Reset the cursor whenever the result set changes.
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleSelect = useCallback(
    (result: RankedResult) => {
      onSelect(result.item.target);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (results[activeIndex]) handleSelect(results[activeIndex]);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  const truncated = total > results.length;

  return (
    <div className="search-backdrop" onClick={onClose} role="presentation">
      <div
        className="search-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Search files and packages"
      >
        <div className="search-input-wrap">
          <span className="search-icon"><SearchIcon size={15} /></span>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="Search files and packages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search files and packages"
          />
          <span className="search-kbd" aria-hidden="true">Esc</span>
        </div>

        <div
          className="search-results"
          ref={listRef}
          role="listbox"
          aria-label="Search results"
        >
          {results.length === 0 && (
            <div className="search-empty">
              Nothing matches &ldquo;{query}&rdquo;
            </div>
          )}
          {results.map((result, i) => (
            <button
              key={result.item.id}
              type="button"
              className={`search-result ${i === activeIndex ? "is-active" : ""}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="search-result-path">
                {result.matchedField === "label" ? (
                  <Highlighted
                    text={result.item.label}
                    indices={result.matchedIndices}
                  />
                ) : (
                  result.item.label
                )}
              </span>
              {/* Packages are named as such. Without it, a package row and a
                  file row would look alike while meaning different things. */}
              {result.item.kind === "package" && (
                <span className="search-result-kind">package</span>
              )}
              <span className="search-result-folder">
                {result.matchedField === "context" ? (
                  <Highlighted
                    text={result.item.context}
                    indices={result.matchedIndices}
                  />
                ) : (
                  result.item.context
                )}
              </span>
            </button>
          ))}
        </div>

        {results.length > 0 && (
          <div className="search-count" aria-live="polite">
            {truncated
              ? `Showing ${results.length} of ${total}`
              : `${total} result${total === 1 ? "" : "s"}`}
            {query.trim()
              ? ` for "${query.trim()}"`
              : " — most depended upon"}
          </div>
        )}
      </div>
    </div>
  );
}
