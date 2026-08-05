import { UploadForm } from "@/components/UploadForm";
import { SpecimenPlate } from "@/components/SpecimenPlate";
import Link from "next/link";
import { MarkIcon } from "@/components/Icons";
import { isUsingBlobStorage } from "@/lib/storage";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Cartograph home">
          <MarkIcon size={17} />
          Cartograph
        </Link>
        <span className="header-note">Static analysis only</span>
      </header>

      <section className="hero">
        {/* The sheet designation. An atlas plate states what it covers and by
            what method before it shows anything: a reader needs to know what
            they are looking at in order to judge it. */}
        <p className="eyebrow">
          <span className="eyebrow-rule" aria-hidden="true" />
          Dependency survey · JS · TS · Python
        </p>
        <h1>
          Every edge is read from
          <br />
          an import statement.
        </h1>
        <p className="hero-copy">
          Upload a repository and get a map of what actually imports what.
          Nothing is inferred from folder names, and anything that could not be
          resolved is drawn as unresolved rather than quietly dropped.
        </p>
        <UploadForm useBlob={isUsingBlobStorage()} />
        <p className="privacy-note">
          Archives are removed from the analysis worker when processing ends.
        </p>
      </section>

      {/* ─── The showcase ───────────────────────────────────────────────
        *
        * A specimen plate, and deliberately not a screenshot of a real
        * repository. Cartograph's whole argument is that what it draws was
        * measured; opening with a marketing image of a graph nobody can
        * verify would undercut that on the first screen a person sees.
        *
        * What this shows instead is the NOTATION — the marks the map uses and
        * what each one means. That is honest, it is useful before a first
        * upload, and it is the one thing a person needs in order to read
        * their own map when it arrives. */}
      <SpecimenPlate />

      <section className="principles" aria-label="How Cartograph works">
        <article>
          <span className="plate-no">01</span>
          <h2>Read</h2>
          <p>
            Imports and re-exports are parsed from source, including configured
            path aliases. Folder names are never used to guess a relationship.
          </p>
        </article>
        <article>
          <span className="plate-no">02</span>
          <h2>Draw</h2>
          <p>
            Regions and files are laid out so the drawing stays legible from
            repository overview down to a single file&rsquo;s neighbourhood.
          </p>
        </article>
        <article>
          <span className="plate-no">03</span>
          <h2>Mark</h2>
          <p>
            Partial reads and unresolved targets are marked on the map itself,
            so the limits of the analysis stay visible rather than filed away.
          </p>
        </article>
      </section>
    </main>
  );
}
