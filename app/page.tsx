import { UploadForm } from "@/components/UploadForm";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Cartograph home">
          <span className="brand-mark" aria-hidden="true">⌘</span>
          Cartograph
        </Link>
        <span className="header-note">Static analysis only</span>
      </header>

      <section className="hero">
        <p className="eyebrow">CODEBASE CARTOGRAPHY</p>
        <h1>See how your code is really connected.</h1>
        <p className="hero-copy">
          Upload a JavaScript, TypeScript, or Python project and get a clickable dependency map built from its real imports — no guessed edges.
        </p>
        <UploadForm />
        <p className="privacy-note">Zip files go directly to Vercel Blob. Archives are removed from the analysis worker when processing ends.</p>
      </section>

      <section className="principles" aria-label="What Cartograph analyzes">
        <article>
          <span>01</span>
          <h2>Real imports</h2>
          <p>Static analysis reads imports and re-exports from TypeScript, JavaScript, and Python — including configured path aliases.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Clear structure</h2>
          <p>Folder layers and ELK layout keep the diagram legible from repo view to file view.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Useful warnings</h2>
          <p>Cycles, dependency hubs, and disconnected files are marked by deterministic checks.</p>
        </article>
      </section>
    </main>
  );
}
