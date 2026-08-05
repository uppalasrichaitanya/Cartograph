/**
 * The icon set.
 *
 * Drawn from survey notation rather than a general-purpose UI icon library,
 * for the same reason the type is Plex and the ground is ivory: the marks a
 * measured drawing already uses are a learned vocabulary, and borrowing one
 * costs nothing while inventing one costs recognition.
 *
 * Replaces ⌘ ⌕ ⊡ × − +, which were six glyphs from four unrelated systems — a
 * Mac command key on a web app, a mathematical squared-dot, an ASCII hyphen
 * standing in for a minus. Their only shared property was being present in a
 * font, and they rendered differently on every platform.
 *
 * Rules, so the set stays one set:
 *   · 16×16 viewBox, 1.5 stroke, no fill except where a mark IS a point
 *   · currentColor throughout, so an icon inherits its context's ink and
 *     needs no variant for hover, active, or reduced states
 *   · aria-hidden, because every one of these sits inside a control that
 *     already carries an accessible name — announcing the decoration too
 *     would say the same thing twice
 *
 * @module components/Icons
 */

type IconProps = { size?: number };

function Glyph({ size = 16, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/**
 * The product mark: a triangulation station.
 *
 * A triangle enclosing a point is the surveyor's symbol for a fixed reference
 * — the known position every other measurement is taken against. It is the
 * most honest mark available for this product, whose entire claim is that it
 * gives you a fixed point to reason from.
 *
 * It is also the reason the wordmark is not load-bearing: a triangulation
 * station in rust, beside a monospaced repository name, over a graticule, is
 * recognisable as Cartograph with the word removed.
 */
export function MarkIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M8 2.5 14 13H2L8 2.5Z" />
      <circle cx="8" cy="9.6" r="1.1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Search — a lens held over the plate. */
export function SearchIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.4 10.4 14 14" />
    </Glyph>
  );
}

/**
 * Fit to view — registration corners.
 *
 * Four corner marks are how a plate is aligned in a press: they describe an
 * extent without drawing a box around it, which is exactly what fitting does
 * to the camera.
 */
export function FitIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M2 5.5V2.5h3.5M10.5 2.5H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5" />
    </Glyph>
  );
}

/** Zoom in. A plain cross — an addition of scale, not a plus button. */
export function ZoomInIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Glyph>
  );
}

/** Zoom out. */
export function ZoomOutIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M3.5 8h9" />
    </Glyph>
  );
}

/** Dismiss. A true cross, not a multiplication sign or the letter x. */
export function CloseIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Glyph>
  );
}
