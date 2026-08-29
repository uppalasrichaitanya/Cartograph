import type { Metadata } from "next";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";
import "./globals.css";

/**
 * Two faces, and only two.
 *
 * IBM Plex Sans carries every reading register. It was drawn for technical
 * documentation, which is the register Cartograph actually speaks in, and it
 * has genuine 400/500/600 weights rather than a browser's synthesised bold —
 * so hierarchy can be built from weight without changing size.
 *
 * IBM Plex Mono carries paths, counts, and every marginal label. A path is a
 * machine-readable string that a person compares character by character, and
 * it must survive that comparison: Plex Mono's 0 is slashed, and its 1, l and
 * I are drawn as three unmistakably different shapes. Arial fails both tests,
 * which is the substantive reason it goes — not that it is a default.
 *
 * They share a skeleton, so mixing them in one line reads as one voice at two
 * registers rather than as two typefaces competing.
 *
 * The Latin font files ship with the application through Fontsource, so
 * production builds and page loads do not depend on a third-party service.
 */

export const metadata: Metadata = {
  title: "Cartograph — Codebase architecture, verified",
  description: "Generate an interactive architecture diagram from a JavaScript, TypeScript, or Python repository.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
