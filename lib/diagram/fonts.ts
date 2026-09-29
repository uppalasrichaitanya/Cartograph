/**
 * Embedded font faces for exported SVG.
 *
 * An SVG opened without IBM Plex installed, or drawn into a canvas for PNG,
 * would otherwise fall back to a different face and overflow its boxes.
 * Latin subsets only: the renderer never draws characters outside them.
 *
 * @module lib/diagram/fonts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

type Face = Readonly<{ family: string; weight: number; style: "normal" | "italic"; file: string }>;

const FACES: ReadonlyArray<Face> = [
  { family: "IBM Plex Mono", weight: 400, style: "normal", file: "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2" },
  { family: "IBM Plex Mono", weight: 600, style: "normal", file: "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2" },
  { family: "IBM Plex Sans", weight: 600, style: "normal", file: "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2" },
  { family: "IBM Plex Sans", weight: 400, style: "italic", file: "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-italic.woff2" },
];

const cache = new Map<string, string>();

function base64(file: string): string {
  let value = cache.get(file);
  if (!value) {
    value = readFileSync(path.join(process.cwd(), "node_modules", file)).toString("base64");
    cache.set(file, value);
  }
  return value;
}

export function fontFaceCss({ italic }: { italic: boolean }): string {
  return FACES
    .filter((face) => italic || face.style === "normal")
    .map((face) => `@font-face{font-family:"${face.family}";font-weight:${face.weight};font-style:${face.style};src:url(data:font/woff2;base64,${base64(face.file)}) format("woff2");}`)
    .join("");
}

export const FONT_FILES = FACES.map((face) => `./node_modules/${face.file}`);
