/**
 * Regenerates public/og-default.png, the fallback link-preview card, from
 * Cartograph's own exported figure. Run: npx tsx scripts/generate-og-default.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { composeOgCard } from "../lib/og/card";
import { rasterizeCard } from "../lib/og/render";

const figure = readFileSync(path.join(process.cwd(), "public", "readme", "architecture.svg"), "utf8");
const png = rasterizeCard(composeOgCard(figure));
writeFileSync(path.join(process.cwd(), "public", "og-default.png"), png);
console.log(`public/og-default.png ${png.length} bytes`);
