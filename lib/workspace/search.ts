/**
 * Search Ranking — ordering results by earned match quality
 *
 * The previous behaviour was a subsequence test with no scoring: results kept
 * raw graph order and were hard-sliced to 50. So the best match could be item
 * 40, or excluded entirely, and a person searching "builder" might not see
 * `builder.ts` at all. The cap was hiding the absence of ranking.
 *
 * Ranking here is ordinal and explainable, not a tuned relevance model:
 *
 *   exact             the whole field is the query
 *   prefix            the field starts with the query
 *   boundary-aligned  the query starts at a word boundary inside the field
 *   subsequence       the query's characters appear in order
 *
 * Matched character positions are returned alongside each result so the
 * interface can show WHY something matched. That turns the ordering into
 * something a person can check rather than something they must trust.
 *
 * @module lib/workspace/search
 */

/** Where a match landed, in descending quality. */
export type MatchTier = "exact" | "prefix" | "boundary" | "subsequence";

/** Ordinal weight per tier. Gaps are wide enough that no tiebreaker can
 *  promote a weaker tier above a stronger one. */
const TIER_WEIGHT: Record<MatchTier, number> = {
  exact: 1000,
  prefix: 800,
  boundary: 600,
  subsequence: 400,
};

/**
 * Penalty for matching the context line rather than the label.
 *
 * A query that hits a file's name should always outrank one that only hits its
 * folder path. Smaller than the gap between tiers, so it never reorders tiers.
 */
const CONTEXT_PENALTY = 150;

export type SearchItemKind = "file" | "package";

export type SearchItem = {
  /** Stable identity for this result row. */
  readonly id: string;
  /** Primary text, and the main thing matched against. */
  readonly label: string;
  /** Secondary text — a folder for a file, an importer for a package. */
  readonly context: string;
  /**
   * Node id to navigate to. Differs from `id` for packages: a package has no
   * location in the map, so the destination is the file that imports it.
   */
  readonly target: string;
  readonly kind: SearchItemKind;
  /**
   * Structural tiebreaker — how many files depend on this. A verified count,
   * used ONLY to order results of equal match quality. It never promotes a
   * worse match above a better one.
   */
  readonly weight: number;
};

export type RankedResult = {
  readonly item: SearchItem;
  readonly score: number;
  readonly tier: MatchTier;
  /** Which field the reported match came from. */
  readonly matchedField: "label" | "context";
  /** Indices into that field's text that matched the query. */
  readonly matchedIndices: ReadonlyArray<number>;
};

/** Characters after which a new word starts in a path or package name. */
const SEPARATORS = new Set(["/", "-", "_", ".", "@", ":", " "]);

/**
 * Whether `index` begins a word.
 *
 * Covers both separator-delimited names (`analysis/build-graph`) and camelCase
 * (`buildGraph`), because both are ordinary in the identifiers this searches.
 */
function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  if (SEPARATORS.has(text[index - 1])) return true;
  const previous = text[index - 1];
  const current = text[index];
  return previous === previous.toLowerCase() && current === current.toUpperCase()
    && previous !== previous.toUpperCase();
}

/**
 * Greedy in-order character match.
 *
 * Returns the matched indices, or null when the query is not a subsequence.
 * Greedy rather than optimal: finding the most compact set of positions would
 * cost more and change only which characters are highlighted, never whether
 * an item matches or how it ranks.
 */
function subsequenceIndices(
  lowerText: string,
  lowerQuery: string,
): number[] | null {
  const indices: number[] = [];
  let qi = 0;
  for (let i = 0; i < lowerText.length && qi < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[qi]) {
      indices.push(i);
      qi++;
    }
  }
  return qi === lowerQuery.length ? indices : null;
}

/** Consecutive indices starting at `start`, for a contiguous match. */
function runOfIndices(start: number, length: number): number[] {
  return Array.from({ length }, (_, i) => start + i);
}

type FieldMatch = {
  readonly tier: MatchTier;
  readonly indices: ReadonlyArray<number>;
};

/**
 * Best match of `query` within one field, or null.
 *
 * Tiers are tested strongest-first and the first hit wins, so a field is
 * described by the best thing true of it rather than by every thing true.
 */
function matchField(text: string, query: string): FieldMatch | null {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerText === lowerQuery) {
    return { tier: "exact", indices: runOfIndices(0, text.length) };
  }
  if (lowerText.startsWith(lowerQuery)) {
    return { tier: "prefix", indices: runOfIndices(0, lowerQuery.length) };
  }

  // Earliest boundary-aligned occurrence. Earliest, because a match nearer the
  // start of a name is the one a person is more likely to have meant.
  let searchFrom = 0;
  for (;;) {
    const found = lowerText.indexOf(lowerQuery, searchFrom);
    if (found === -1) break;
    if (isBoundary(text, found)) {
      return { tier: "boundary", indices: runOfIndices(found, lowerQuery.length) };
    }
    searchFrom = found + 1;
  }

  const indices = subsequenceIndices(lowerText, lowerQuery);
  return indices ? { tier: "subsequence", indices } : null;
}

/**
 * Rank items against a query.
 *
 * With an empty query, returns the most-depended-upon items. An arbitrary
 * slice of graph order would tell a person nothing; "what most of this
 * repository relies on" is a defensible place to start reading.
 */
export function rankSearchItems(
  items: ReadonlyArray<SearchItem>,
  query: string,
  limit: number,
): { readonly results: ReadonlyArray<RankedResult>; readonly total: number } {
  const trimmed = query.trim();

  if (!trimmed) {
    const byWeight = [...items]
      .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
      .slice(0, limit)
      .map(
        (item): RankedResult => ({
          item,
          score: 0,
          tier: "subsequence",
          matchedField: "label",
          matchedIndices: [],
        }),
      );
    return { results: byWeight, total: items.length };
  }

  const scored: RankedResult[] = [];
  for (const item of items) {
    const labelMatch = matchField(item.label, trimmed);
    const contextMatch = labelMatch ? null : matchField(item.context, trimmed);

    if (labelMatch) {
      scored.push({
        item,
        score: TIER_WEIGHT[labelMatch.tier],
        tier: labelMatch.tier,
        matchedField: "label",
        matchedIndices: labelMatch.indices,
      });
    } else if (contextMatch) {
      scored.push({
        item,
        score: TIER_WEIGHT[contextMatch.tier] - CONTEXT_PENALTY,
        tier: contextMatch.tier,
        matchedField: "context",
        matchedIndices: contextMatch.indices,
      });
    }
  }

  // Score, then structural weight, then label — the last for stability, so the
  // same query always yields the same order.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.item.weight - a.item.weight ||
      a.item.label.localeCompare(b.item.label),
  );

  return { results: scored.slice(0, limit), total: scored.length };
}

export type HighlightSegment = {
  readonly text: string;
  readonly matched: boolean;
};

/**
 * Split text into alternating matched and unmatched runs.
 *
 * Lets the interface show which characters earned the result its place, so the
 * ranking is inspectable rather than asserted.
 */
export function highlightSegments(
  text: string,
  indices: ReadonlyArray<number>,
): ReadonlyArray<HighlightSegment> {
  if (indices.length === 0) return [{ text, matched: false }];

  const matchedSet = new Set(indices);
  const segments: HighlightSegment[] = [];
  let current = "";
  let currentMatched = matchedSet.has(0);

  for (let i = 0; i < text.length; i++) {
    const matched = matchedSet.has(i);
    if (matched !== currentMatched) {
      if (current) segments.push({ text: current, matched: currentMatched });
      current = "";
      currentMatched = matched;
    }
    current += text[i];
  }
  if (current) segments.push({ text: current, matched: currentMatched });
  return segments;
}
