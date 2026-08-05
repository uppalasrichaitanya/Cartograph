/**
 * The Trail — an ordered record of what an investigation examined
 *
 * Workspace Philosophy, Foundation III: "Context decays faster than knowledge.
 * People remember discoveries. They forget why those discoveries mattered."
 *
 * The trail answers "how did I get here?" — which is a different question from
 * "where am I?" A breadcrumb shows position in a hierarchy: repository ›
 * region › file. It is derived entirely from the current position and says
 * nothing about the path taken. The trail is the path taken, in order.
 *
 * It is also not browser history. History records addresses, including every
 * camera nudge; the trail records the objects a person actually looked at.
 *
 * Deliberately session-scoped and NOT carried in the URL: a trail belongs to
 * one person's investigation, grows without bound, and would make every shared
 * link carry somebody else's path. A shared link reproduces a position; it does
 * not transplant a history.
 *
 * @module lib/workspace/trail
 */

/** What kind of thing was examined. */
export type TrailEntryKind = "region" | "file";

export type TrailEntry = {
  /** Stable identity — a region name or a file path. */
  readonly id: string;
  readonly kind: TrailEntryKind;
  /** Short label for display. */
  readonly label: string;
};

/**
 * How many entries to keep.
 *
 * The trail exists to help someone resume a line of reasoning, not to be a
 * complete audit log. Past a dozen or so, older entries stop aiding recall and
 * start competing for the attention the map needs — so the oldest are dropped.
 * Twelve is enough to hold a session's worth of reasoning while staying
 * scannable at a glance.
 */
export const TRAIL_LIMIT = 12;

/**
 * Append an examined object to the trail.
 *
 * Rules, each with a reason:
 *
 *   - Re-examining the most recent entry is not a new step. Selecting the same
 *     file twice in a row is one act of attention, and recording it twice
 *     would make the trail longer without making it more informative.
 *
 *   - Revisiting an EARLIER entry moves it to the end rather than duplicating
 *     it. The trail should read as the order in which things last mattered;
 *     duplicates would make it look like more happened than did.
 *
 *   - The list is capped, oldest-first.
 *
 * Pure: returns a new array, never mutates the input.
 */
export function appendToTrail(
  trail: ReadonlyArray<TrailEntry>,
  entry: TrailEntry,
): ReadonlyArray<TrailEntry> {
  const last = trail[trail.length - 1];
  if (last && last.id === entry.id && last.kind === entry.kind) {
    return trail;
  }

  const withoutDuplicate = trail.filter(
    (existing) => !(existing.id === entry.id && existing.kind === entry.kind),
  );
  const appended = [...withoutDuplicate, entry];
  return appended.length > TRAIL_LIMIT
    ? appended.slice(appended.length - TRAIL_LIMIT)
    : appended;
}

/** Short display label for a file path — the basename. */
export function fileLabel(filePath: string): string {
  const segments = filePath.split("/");
  return segments[segments.length - 1] || filePath;
}
