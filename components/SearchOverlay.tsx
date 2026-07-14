"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

type SearchItem = {
  id: string;
  label: string;
  folder: string;
};

/**
 * Simple fuzzy match: checks if all characters in the query appear
 * in order in the target string (case-insensitive).
 */
function fuzzyMatch(target: string, query: string): boolean {
  const lower = target.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function SearchOverlay({
  items,
  onSelect,
  onClose,
}: {
  items: SearchItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 50);
    return items.filter((item) => fuzzyMatch(item.label, query) || fuzzyMatch(item.folder, query)).slice(0, 50);
  }, [items, query]);

  // Reset active index when results change.
  useEffect(() => { setActiveIndex(0); }, [filtered]);

  // Focus input on mount.
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Scroll active item into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const handleSelect = useCallback(
    (id: string) => { onSelect(id); onClose(); },
    [onSelect, onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[activeIndex]) handleSelect(filtered[activeIndex].id);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <div className="search-backdrop" onClick={onClose} role="presentation">
      <div className="search-card" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown} role="dialog" aria-modal="true" aria-label="Search files">
        <div className="search-input-wrap">
          <span className="search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="Search files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search files"
          />
          <span className="search-kbd" aria-hidden="true">Esc</span>
        </div>
        <div className="search-results" ref={listRef} role="listbox" aria-label="Search results">
          {filtered.length === 0 && (
            <div className="search-empty">No files match "{query}"</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`search-result ${i === activeIndex ? "is-active" : ""}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => handleSelect(item.id)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="search-result-icon" aria-hidden="true">📄</span>
              <span className="search-result-path">{item.label}</span>
              <span className="search-result-folder">{item.folder}</span>
            </button>
          ))}
        </div>
        {filtered.length > 0 && (
          <div className="search-count" aria-live="polite">
            {filtered.length} result{filtered.length === 1 ? "" : "s"}
            {query && ` for "${query}"`}
          </div>
        )}
      </div>
    </div>
  );
}
