/**
 * The specimen plate.
 *
 * A labelled figure showing the four marks Cartograph's map uses, drawn in
 * the real notation at real proportions.
 *
 * WHY THIS AND NOT A SCREENSHOT. The product's entire claim is that what it
 * draws was measured from source. A hero image of some impressive-looking
 * graph would be a picture of an analysis nobody can check — asserting
 * exactly the kind of unverifiable authority the rest of the product exists
 * to avoid. A plate that teaches the notation makes no claim about any
 * repository at all, and it is the one thing a first-time reader actually
 * needs: the ability to read their own map when it arrives.
 *
 * Everything here is static SVG. No data, no fetch, no animation — it is a
 * printed figure, and it behaves like one.
 *
 * @module components/SpecimenPlate
 */

/** One row of the legend beneath the drawing. */
function LegendRow({
  sample,
  term,
  gloss,
}: {
  sample: React.ReactNode;
  term: string;
  gloss: string;
}) {
  return (
    <div className="legend-row">
      <div className="legend-sample" aria-hidden="true">
        {sample}
      </div>
      <div className="legend-text">
        <dt>{term}</dt>
        <dd>{gloss}</dd>
      </div>
    </div>
  );
}

export function SpecimenPlate() {
  return (
    <section className="specimen" aria-labelledby="specimen-title">
      <div className="specimen-head">
        <p className="specimen-designation">
          <span className="specimen-fig">Fig. 1</span>
          <span className="specimen-rule" aria-hidden="true" />
          <span>Map notation</span>
        </p>
        <h2 id="specimen-title" className="specimen-title">
          Four marks, and what each one asserts
        </h2>
      </div>

      {/* The drawing. Deliberately small and deliberately incomplete — it is a
          specimen, not a demonstration, and it should not read as a product
          screenshot. */}
      <div className="specimen-plate">
        <svg
          viewBox="0 0 640 208"
          className="specimen-svg"
          role="img"
          aria-label="A specimen showing a resolved dependency between two files, a partially read file, and an unresolved import."
        >
          <defs>
            {/* The graticule, at the same 1:5 ratio as the live map. */}
            <pattern id="spec-fine" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#DAD3C3" />
            </pattern>
            <pattern id="spec-coarse" width="120" height="120" patternUnits="userSpaceOnUse">
              <path d="M60 55v10M55 60h10" stroke="#C4BBA6" strokeWidth="0.7" fill="none" />
            </pattern>
            <marker
              id="spec-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M0 1l8 4-8 4z" fill="#B8AF9B" />
            </marker>
          </defs>

          <rect width="640" height="208" fill="#F4F0E6" />
          <rect width="640" height="208" fill="url(#spec-fine)" />
          <rect width="640" height="208" fill="url(#spec-coarse)" />

          {/* Resolved edge — solid, arrowheaded: the target is known. */}
          <path
            d="M186 62h44"
            stroke="#B8AF9B"
            strokeWidth="1.4"
            fill="none"
            markerEnd="url(#spec-arrow)"
          />
          {/* Unresolved edge — dashed, no arrowhead. An arrow asserts arrival
              at a known target, and this one has none. */}
          <path
            d="M186 146h44"
            stroke="#D6CFBF"
            strokeWidth="1.4"
            strokeDasharray="2 4"
            strokeLinecap="round"
            fill="none"
          />

          {/* Verified plate. No marker at all — absence IS the signal. */}
          <g>
            <rect x="42" y="34" width="144" height="56" rx="5" fill="#FCFAF5" stroke="#B8AF9B" />
            <text x="56" y="53" className="spec-kicker">FILE</text>
            <text x="56" y="70" className="spec-name">router.ts</text>
            <text x="56" y="82" className="spec-path">src/router.ts</text>
          </g>

          {/* Selected plate — rust edge and ring. */}
          <g>
            <rect x="230" y="30" width="152" height="64" rx="5" fill="#F6E9E1" stroke="#A84A26" strokeWidth="2" />
            <text x="246" y="51" className="spec-kicker spec-kicker-focus">FILE</text>
            <text x="246" y="68" className="spec-name">handlers.ts</text>
            <text x="246" y="80" className="spec-path">src/handlers.ts</text>
          </g>

          {/* Partial read — dashed edge, quieter ink, word marker. */}
          <g>
            <rect
              x="42"
              y="118"
              width="144"
              height="62"
              rx="5"
              fill="#FCFAF5"
              stroke="#D6CFBF"
              strokeDasharray="5 3"
            />
            <text x="56" y="137" className="spec-kicker">FILE</text>
            <text x="56" y="154" className="spec-name spec-name-quiet">legacy.js</text>
            <text x="56" y="170" className="spec-marker">· partial read</text>
          </g>

          {/* Unresolved — the shape does not close on the right. */}
          <g>
            <path
              d="M382 118h-152v62h152"
              fill="none"
              stroke="#D6CFBF"
              strokeDasharray="5 3"
            />
            <text x="246" y="137" className="spec-kicker">IMPORT</text>
            <text x="246" y="154" className="spec-name spec-name-quiet">./config</text>
            <text x="246" y="170" className="spec-marker">· unresolved</text>
          </g>

          {/* Margin annotations, in the surveyor's hand: a leader line and a
              short note, the way a plate is corrected after printing. */}
          <path d="M392 58h58" stroke="#A84A26" strokeWidth="1" fill="none" />
          <circle cx="392" cy="58" r="2" fill="#A84A26" />
          <text x="458" y="55" className="spec-note">Selected — the</text>
          <text x="458" y="67" className="spec-note">subject of your</text>
          <text x="458" y="79" className="spec-note">current question</text>

          <path d="M392 148h58" stroke="#A84A26" strokeWidth="1" fill="none" />
          <circle cx="392" cy="148" r="2" fill="#A84A26" />
          <text x="458" y="145" className="spec-note">Open edge — the</text>
          <text x="458" y="157" className="spec-note">import exists, its</text>
          <text x="458" y="169" className="spec-note">target does not</text>
        </svg>
      </div>

      {/* The legend. Sets out the encoding in words, so the notation is
          learnable without having to infer it from the drawing. */}
      <dl className="specimen-legend">
        <LegendRow
          sample={<span className="swatch swatch-verified" />}
          term="Unmarked"
          gloss="Read directly from source. The common case carries no mark, so a mark always means something."
        />
        <LegendRow
          sample={<span className="swatch swatch-dashed" />}
          term="Partial read"
          gloss="The file parsed incompletely. What was recovered is shown; what was not is not invented."
        />
        <LegendRow
          sample={<span className="swatch swatch-open" />}
          term="Unresolved"
          gloss="The import statement exists. Its target could not be found in the repository."
        />
        <LegendRow
          sample={<span className="swatch swatch-focus" />}
          term="Selected"
          gloss="What you asked about. The one colour the map spends on attention."
        />
      </dl>
    </section>
  );
}
