/**
 * Cartograph Safety Event Log — Extraction Safety Layer
 *
 * Implements the Safety Event Log specified in:
 *   specs/cartograph_extraction_safety_spec.md — Section 4
 *
 * Responsibility:
 *   Structured record of every rejection or degradation during
 *   extraction and parsing. Feeds future observability work
 *   (Milestone 10) and provides immediate diagnostic value.
 *
 * Contract:
 *   - record() never throws.
 *   - drain() returns all accumulated events and resets the log —
 *     consumed once per analysis run, attached to run metadata.
 *   - Thread-safe in the sense that events are appended atomically
 *     to the array (single-threaded main process).
 *
 * Integration:
 *   Every rejection from the Path Validator, Content Sniffer, or
 *   Resource Guard produces a SafetyEvent. These events are consumed
 *   by the IR wiring layer to produce ParseError entries on the
 *   affected FileNodes, ensuring rejected files remain visible in
 *   the graph (per the IR spec's failure handling model).
 *
 * @module lib/safety/eventLog
 */

// ---------------------------------------------------------------------------
// Types (from spec Section 4)
// ---------------------------------------------------------------------------

/**
 * A structured safety event recording a rejection or degradation.
 *
 * Uses the exact type union from the spec's public interface definition.
 */
export interface SafetyEvent {
  readonly type: "path-rejected" | "content-unreadable" | "resource-exceeded";
  /** Relative path of the affected file (or entry path for zip entries). */
  readonly path: string;
  /** Human-readable description of what was rejected and why. */
  readonly detail: string;
  /** ISO 8601 timestamp of when the event occurred. */
  readonly timestamp: string;
}

/**
 * Mapping from SafetyEvent types to IRParseError reason codes.
 *
 * This mapping ensures the safety subsystem produces ParseError entries
 * using the shared reason-code type from Component 1 (IR spec), not an
 * independently-maintained string union (spec PR 4).
 */
export type SafetyEventToParseReason = {
  "path-rejected": "unreadable";
  "content-unreadable": "unreadable";
  "resource-exceeded": "timeout";
};

/**
 * Map a SafetyEvent type to the corresponding IRParseError reason.
 *
 * Per spec PR 4: "ensure every rejection/timeout/binary-content event
 * produces a ParseError consumable by the IR Builder, using the shared
 * reason-code type from Component 1."
 */
export function safetyEventToParseReason(
  eventType: SafetyEvent["type"],
): "unreadable" | "timeout" {
  switch (eventType) {
    case "path-rejected":
      return "unreadable";
    case "content-unreadable":
      return "unreadable";
    case "resource-exceeded":
      return "timeout";
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Accumulator for safety events during a single analysis run.
 *
 * Per the spec: "consumed once per analysis run, attached to run metadata."
 * The drain() method returns all accumulated events and resets the log,
 * ensuring each analysis run gets a fresh event log.
 */
export class SafetyEventLog {
  private events: SafetyEvent[] = [];

  /**
   * Record a safety event.
   *
   * Never throws — this is a fire-and-forget operation. If recording
   * somehow fails (which shouldn't happen since it's just an array push),
   * the failure is silently ignored to avoid disrupting the analysis pipeline.
   *
   * @param event - The safety event to record
   */
  record(event: SafetyEvent): void {
    this.events.push(event);
  }

  /**
   * Record a path rejection event.
   * Convenience method that constructs the SafetyEvent.
   */
  recordPathRejection(entryPath: string, reason: string): void {
    this.record({
      type: "path-rejected",
      path: entryPath,
      detail: `Path rejected: ${reason}`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record a content-unreadable event.
   * Convenience method that constructs the SafetyEvent.
   */
  recordContentUnreadable(
    filePath: string,
    reason: "binary" | "invalid-encoding" | "empty",
  ): void {
    this.record({
      type: "content-unreadable",
      path: filePath,
      detail: `Content rejected: ${reason}`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record a resource-exceeded event.
   * Convenience method that constructs the SafetyEvent.
   */
  recordResourceExceeded(
    filePath: string,
    reason: "timeout" | "oversized" | "crashed",
    detail?: string,
  ): void {
    this.record({
      type: "resource-exceeded",
      path: filePath,
      detail: `Resource exceeded: ${reason}${detail ? ` — ${detail}` : ""}`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Drain all accumulated events and reset the log.
   *
   * Returns a snapshot of all events recorded since the last drain
   * (or since construction). After draining, the internal log is
   * empty and ready for the next analysis run.
   *
   * Per the spec: "consumed once per analysis run, attached to
   * run metadata."
   */
  drain(): SafetyEvent[] {
    const snapshot = [...this.events];
    this.events = [];
    return snapshot;
  }

  /** Number of events currently in the log. */
  get length(): number {
    return this.events.length;
  }
}
