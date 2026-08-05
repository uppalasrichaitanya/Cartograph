/**
 * The motion system.
 *
 * One source of truth for how long anything takes to move and what curve it
 * moves along. Before this module the product carried 150ms, 180ms, 200ms,
 * 220ms, 250ms, 300ms, 400ms, 700ms, 800ms, .5s and 1.5s across CSS and JS in
 * parallel, with a `--transition-slow` token that was defined and never used
 * and an `--ease-spring` token that was defined and never used. Two systems
 * with no agreement between them is the definition of Motion Debt: similar
 * transitions behaving differently for no reason a person could learn.
 *
 * ── The three tiers ───────────────────────────────────────────────────────
 *
 * Chosen by the cognitive significance of the change, never by event type.
 * The same act reached two ways gets one duration; two different acts that
 * happen to share a mechanism do not have to.
 *
 *   immediate   0ms     Changes needing no explanation. Hover, focus rings,
 *                       lens toggles, emphasis and recession. Feedback that
 *                       animates reads as lag, not as polish.
 *
 *   connective  180ms   Changes needing causal linking. The inspector
 *                       opening, a selection settling, a search result being
 *                       placed, camera moves inside one region.
 *
 *   structural  400ms   Changes that reorganize the mental model. Region
 *                       expansion, cross-region navigation — the cases where
 *                       what is on screen is replaced wholesale and a person
 *                       needs to see that it was a move rather than a jump.
 *
 * Tier 0 is the load-bearing one. Most state changes should not animate at
 * all: "The maturity of a motion system is measured not by how frequently it
 * moves. It is measured by how carefully movement is chosen."
 *
 * ── Where the numbers actually live ───────────────────────────────────────
 *
 * In CSS, as custom properties on :root. This module reads them rather than
 * restating them, which is what makes it one source of truth instead of two
 * that agree today. It follows the same pattern `inspectorWidth()` already
 * uses for `--panel-width`: declare once in CSS, read at the point of use, so
 * the stylesheet and the camera can never disagree.
 *
 * The consequence worth understanding: `prefers-reduced-motion` is honored in
 * CSS by overriding those same properties to 0ms, so JS inherits the
 * preference for free. There is no separate reduced-motion branch in the
 * camera code, and therefore no way for the two to drift apart.
 *
 * The fallbacks below are used only when there is no computed style to read —
 * server rendering, and tests. They must match the stylesheet, and a test
 * asserts that they do.
 *
 * @module lib/workspace/motion
 */

/** A tier, named by what it is responsible for rather than by how long it is. */
export type MotionTier = "immediate" | "connective" | "structural";

/**
 * Fallback durations, in milliseconds.
 *
 * Mirrors of the CSS tokens, not a second source of truth: they apply only
 * where no computed style exists. `tests/workspace/motion.test.ts` pins them
 * against the stylesheet so the mirror cannot rot.
 */
export const MOTION_FALLBACK_MS: Readonly<Record<MotionTier, number>> = {
  immediate: 0,
  connective: 180,
  structural: 400,
};

/** CSS custom property backing each tier. */
const TOKEN: Readonly<Record<MotionTier, string>> = {
  immediate: "--motion-immediate",
  connective: "--motion-connective",
  structural: "--motion-structural",
};

/**
 * Half of a structural transition.
 *
 * A region change is a two-legged move — the outgoing region recedes, the
 * incoming one arrives — and the pair together must cost one structural
 * duration rather than two, or navigating would take 800ms while claiming
 * 400ms.
 *
 * This is declared as its own CSS token rather than computed, because
 * `getComputedStyle` does not resolve `calc()` on unregistered custom
 * properties: reading a `calc(var(--motion-structural) / 2)` would hand JS
 * the literal string. So CSS owns the value and JS reads it, with a test
 * pinning it at exactly half of structural.
 */
const LEG_TOKEN = "--motion-structural-leg";

/** Fallback for one leg. Half of structural, by definition. */
export const MOTION_LEG_FALLBACK_MS = MOTION_FALLBACK_MS.structural / 2;

/**
 * The easing curve, as CSS writes it.
 *
 * One family throughout — a standard deceleration. Motion begins at full
 * speed and settles, so a transition reports its outcome as early as possible
 * and spends its remaining time arriving. Nothing overshoots: a spring that
 * passes its target and returns implies the target moved, which for a map of
 * fixed positions would be a small lie.
 *
 * Kept as the literal control points rather than a named CSS keyword because
 * `motionEase` has to evaluate the identical curve in JS for the camera, and
 * an approximation of "the same" curve is exactly the drift this module
 * exists to prevent.
 */
export const MOTION_EASE_POINTS = { x1: 0.4, y1: 0, x2: 0.2, y2: 1 } as const;

/** The curve as a CSS value. The stylesheet declares this; a test pins it. */
export const MOTION_EASE_CSS = `cubic-bezier(${MOTION_EASE_POINTS.x1}, ${MOTION_EASE_POINTS.y1}, ${MOTION_EASE_POINTS.x2}, ${MOTION_EASE_POINTS.y2})`;

/** One axis of a cubic Bézier with endpoints pinned at 0 and 1. */
function bezier(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * t * p1 + 3 * inv * t * t * p2 + t * t * t;
}

/** Derivative of the above, for Newton's method. */
function bezierSlope(t: number, p1: number, p2: number): number {
  const inv = 1 - t;
  return 3 * inv * inv * p1 + 6 * inv * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/**
 * The easing curve as a function, for callers that cannot use CSS.
 *
 * React Flow's camera helpers accept an `ease`, which is the hook that lets
 * the camera move along the same curve as everything the stylesheet animates.
 * Without it the map would ease differently from the interface drawn on top
 * of it, and a person would be learning two motion languages at once.
 *
 * A cubic-bezier is a parametric curve, so easing at progress `x` means first
 * solving for the `t` where the curve's x-component equals `x`, then reading
 * its y-component there. Newton's method converges in a handful of steps for
 * a monotonic curve like this one; bisection finishes the job in the rare case
 * the slope goes flat enough to stall it.
 *
 * @param x Linear progress through the transition, 0 to 1.
 * @returns Eased progress, 0 to 1.
 */
export function motionEase(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const { x1, y1, x2, y2 } = MOTION_EASE_POINTS;

  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const error = bezier(t, x1, x2) - x;
    if (Math.abs(error) < 1e-6) return bezier(t, y1, y2);
    const slope = bezierSlope(t, x1, x2);
    if (Math.abs(slope) < 1e-6) break;
    t -= error / slope;
  }

  // Newton stalled — fall back to bisection, which cannot fail on a
  // monotonic curve even if it is slower to arrive.
  let low = 0;
  let high = 1;
  t = x;
  for (let i = 0; i < 24; i += 1) {
    const current = bezier(t, x1, x2);
    if (Math.abs(current - x) < 1e-6) break;
    if (current < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return bezier(t, y1, y2);
}

/** Read a duration token, in milliseconds, or null if it cannot be read. */
function readToken(name: string): number | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return null;

  // Tokens are authored in ms. Seconds are accepted so a future edit in `s`
  // cannot silently become a 400x error.
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  return raw.endsWith("ms") ? value : raw.endsWith("s") ? value * 1000 : value;
}

/**
 * Duration of a tier, in milliseconds, as the stylesheet currently defines it.
 *
 * Returns 0 for tiers 2 and 3 when the reader has asked for reduced motion,
 * because the stylesheet sets those tokens to 0ms under
 * `prefers-reduced-motion` and this reads what is actually in effect. Callers
 * do not test for the preference; they pass a duration of 0 to the camera,
 * which lands it on the same final position without traversal.
 */
export function motionDuration(tier: MotionTier): number {
  return readToken(TOKEN[tier]) ?? MOTION_FALLBACK_MS[tier];
}

/**
 * Duration of one leg of a structural, two-legged transition.
 *
 * Zero means "do it now, in one synchronous step" — the caller should skip
 * the intermediate state rather than schedule a zero-length wait for it.
 */
export function structuralLegDuration(): number {
  return readToken(LEG_TOKEN) ?? MOTION_LEG_FALLBACK_MS;
}

/**
 * Camera options for a tier, ready to hand to React Flow.
 *
 * Exists so no call site ever pairs a duration with an easing by hand. Every
 * camera move in the product goes through this, which is what makes "one
 * easing family throughout" a property of the code rather than a convention
 * people have to remember.
 */
export function cameraMotion(tier: MotionTier): {
  duration: number;
  ease: (t: number) => number;
} {
  return { duration: motionDuration(tier), ease: motionEase };
}
