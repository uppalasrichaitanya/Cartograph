import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
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
 * Self-hosted by next/font at build time: no render-blocking request to a
 * third party, and no layout shift as a fallback face is swapped out.
 */
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cartograph — Codebase architecture, verified",
  description: "Generate an interactive architecture diagram from a JavaScript, TypeScript, or Python repository.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
