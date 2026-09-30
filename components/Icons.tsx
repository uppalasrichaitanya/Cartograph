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
 * The product mark: two nodes joined by one routed edge whose bowl is a C.
 *
 * It is what the map itself draws, reduced to a single dependency: an
 * outlined source, a filled target, and the orthogonal route between them
 * with the same rounded corners the live map and the exports use. The route
 * shows direction without an arrowhead, and the bowl reads as the initial in
 * Cartograph, so the mark survives at favicon size without the wordmark.
 */
export function MarkIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <rect x="9" y="2" width="4.5" height="4.5" rx="0.75" />
      <rect x="9" y="9.5" width="4.5" height="4.5" rx="0.75" fill="currentColor" />
      <path d="M9 4.25H6A3 3 0 0 0 3 7.25V8.75A3 3 0 0 0 6 11.75H9" />
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

/** A small evidence spark for assisted interpretation controls. */
export function SparkIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M4.1 4.1l2.1 2.1M9.8 9.8l2.1 2.1M11.9 4.1 9.8 6.2M6.2 9.8l-2.1 2.1" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Share a stable address, represented as a connected link rather than a social icon. */
export function LinkIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M6.2 9.8 9.8 6.2M5.1 11.5H4a2.5 2.5 0 0 1 0-5h2M10.9 4.5H12a2.5 2.5 0 0 1 0 5h-2" />
    </Glyph>
  );
}

export function DownloadIcon({ size = 16 }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M8 2.5v7.5M4.75 6.75 8 10l3.25-3.25M3 12.75h10" />
    </Glyph>
  );
}
