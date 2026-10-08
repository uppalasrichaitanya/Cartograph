/**
 * The two reachability lenses as data: what the Observations popover lists and
 * which files the map emphasises. Kept out of the component so the wording and
 * the selection rules can be tested directly.
 *
 * The wording states a measurement ("no import path from any recognised entry
 * point") and never a verdict about the files.
 */
import type { ReachabilityResult } from "@/types/graph";

export type ReachabilityLensMode = "entries" | "unreachable";

export type ReachabilityLens = {
  mode: ReachabilityLensMode;
  label: string;
  note: string;
  empty: string;
  caveats?: ReadonlyArray<string>;
  limit: number;
  items: () => ReadonlyArray<{ id: string; label: string; target: string }>;
};

const TEST_RULES = new Set(["test file"]);

/** A reason without its file-specific parenthetical: `Next.js route (app/page.tsx)` is the rule `Next.js route`. */
export function ruleOf(reason: string): string {
  return reason.replace(/ \([^)]*\)$/, "");
}

/** One row per rule with its count; rules that are not tests first, then larger groups. */
export function groupEntryPoints(
  entryPoints: ReadonlyArray<{ path: string; reason: string }>,
): { rule: string; count: number; first: string }[] {
  const groups = new Map<string, { rule: string; count: number; first: string }>();
  for (const entry of entryPoints) {
    const rule = ruleOf(entry.reason);
    const group = groups.get(rule);
    if (!group) groups.set(rule, { rule, count: 1, first: entry.path });
    else {
      group.count++;
      if (entry.path < group.first) group.first = entry.path;
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(TEST_RULES.has(a.rule)) - Number(TEST_RULES.has(b.rule)) ||
      b.count - a.count ||
      a.rule.localeCompare(b.rule),
  );
}

export function buildReachabilityLenses(reachability: ReachabilityResult | undefined): ReachabilityLens[] {
  if (!reachability || reachability.entryPoints.length === 0) return [];
  return [
    {
      mode: "entries",
      label: "Entry points",
      note: "Where a runtime, framework, test runner or person starts, grouped by the rule that matched.",
      empty: "No entry points recognised.",
      limit: 8,
      items: () =>
        groupEntryPoints(reachability.entryPoints).map((group) => ({
          id: group.rule,
          label: `${group.rule} · ${group.count}`,
          target: group.first,
        })),
    },
    {
      mode: "unreachable",
      label: "Unreachable from entry points",
      note: "No import path from any recognised entry point.",
      empty: "Every file has an import path from an entry point.",
      caveats: reachability.caveats,
      limit: 8,
      items: () => reachability.unreachable.map((file) => ({ id: file, label: file, target: file })),
    },
  ];
}

/**
 * Files a reachability lens emphasises, or null when there is nothing to
 * emphasise (no search ran, or the set is empty) so the map is not dimmed for
 * no reason. The entries lens leaves out tests: in a repository whose entry
 * points are mostly tests, emphasising them would dim nothing.
 */
export function reachabilityLensFiles(
  reachability: ReachabilityResult | undefined,
  mode: ReachabilityLensMode,
): Set<string> | null {
  if (!reachability || reachability.entryPoints.length === 0) return null;
  const files = new Set(
    mode === "entries"
      ? reachability.entryPoints.filter((entry) => !TEST_RULES.has(ruleOf(entry.reason))).map((entry) => entry.path)
      : reachability.unreachable,
  );
  return files.size > 0 ? files : null;
}
