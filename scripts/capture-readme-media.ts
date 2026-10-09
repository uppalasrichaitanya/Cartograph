/**
 * Regenerates the README's screenshots, tour GIF, and architecture figure
 * from Cartograph's own repository.
 *
 * Prerequisites:
 *  - A production build serving on :3210 with local storage and your AI keys:
 *      npm run build
 *      BLOB_READ_WRITE_TOKEN= npm run start -- -p 3210
 *  - Playwright's Chromium: npx playwright install chromium
 *  - ffmpeg for the GIF. Set FFMPEG to its path, or have `ffmpeg` on PATH. It is
 *    deliberately not a project dependency; a throwaway install works:
 *      npm i --prefix <scratch dir> ffmpeg-static
 *      FFMPEG=<scratch dir>/node_modules/ffmpeg-static/ffmpeg.exe
 *
 * Run: npx tsx scripts/capture-readme-media.ts
 *
 * Screenshots are palette-quantised with sharp when it is available (it ships
 * with Next.js) to stay under the README's per-image size budget.
 */
import { chromium } from "@playwright/test";
import AdmZip from "adm-zip";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";

const BASE = "http://localhost:3210";
const OUT = path.join(process.cwd(), "public", "readme");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const REGION_PREFERENCE = ["lib/ai", "lib/analysis", "components"];

/** Source files only, from git's own list, so no .env, lockfile, or test fixture is ever packed. */
function repoZip(): string {
  const zip = new AdmZip();
  const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split(/\r?\n/)
    .filter((file) => /\.(ts|tsx|js|jsx|json)$/.test(file) && !file.startsWith("tests/e2e/fixtures/") && !/(^|\/)\.env/.test(file));
  for (const file of files) zip.addLocalFile(file, path.posix.join("cartograph", path.posix.dirname(file) === "." ? "" : path.posix.dirname(file)));
  const out = path.join(mkdtempSync(path.join(tmpdir(), "cartograph-readme-")), "cartograph.zip");
  zip.writeZip(out);
  return out;
}

async function shoot(page: Page, name: string) {
  const buffer = await page.screenshot();
  let output: Buffer = buffer;
  try {
    const sharp = (await import("sharp")).default;
    output = await sharp(buffer).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 }).toBuffer();
  } catch {
    console.warn(`sharp unavailable; ${name} saved unoptimised`);
  }
  writeFileSync(path.join(OUT, name), output);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const videoDir = mkdtempSync(path.join(tmpdir(), "cartograph-video-"));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } });
  const page = await context.newPage();
  const videoStart = Date.now();
  const marks: Record<string, number> = {};
  const mark = (name: string) => { marks[name] = (Date.now() - videoStart) / 1000; };

  await page.goto(BASE);
  await page.getByLabel("Until I delete it").check();
  await page.locator('input[type="file"]').setInputFiles(repoZip());
  await page.getByRole("button", { name: "Generate map" }).click();
  await page.waitForURL(/\/repo\/[a-f0-9-]{36}$/, { timeout: 180_000 });
  const id = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Dismiss" }).click().catch(() => undefined);
  await page.locator(".react-flow__node").first().waitFor();
  await page.waitForTimeout(1_500);
  mark("map");
  await shoot(page, "map-overview.png");

  // Region names adapt to the repository, so choose from what was rendered.
  const labels = await page.locator(".react-flow__node").allInnerTexts();
  const region = REGION_PREFERENCE.find((name) => labels.some((label) => label.includes(name)));
  if (!region) throw new Error(`No preferred region among: ${labels.join(" | ")}`);
  console.log(`Opening region ${region}`);
  await page.locator(".react-flow__node").filter({ hasText: region }).first().dblclick();
  await page.waitForURL(/region=/);
  await page.waitForTimeout(1_500);
  await shoot(page, "region-files.png");

  await page.getByRole("button", { name: /AI explain/ }).click();
  const panel = page.locator(".ai-panel");
  await panel.getByRole("button", { name: "Explain this region" }).click();
  await panel.getByRole("button", { name: "Explain this region" }).waitFor({ state: "detached", timeout: 15_000 });
  await panel.locator(".ai-chip").first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1_000);
  mark("ai");
  await shoot(page, "ai-guide.png");
  await page.getByRole("button", { name: "Close AI explanation" }).click();

  await page.keyboard.press("e");
  const dialog = page.getByRole("dialog", { name: "Export diagram" });
  await dialog.waitFor();
  await dialog.getByRole("radio", { name: "Repository", exact: true }).click();
  await page.waitForTimeout(1_000); // the whole-repo figure, not the open region
  await page.waitForFunction(() => { const img = document.querySelector('[role="dialog"] img') as HTMLImageElement | null; return !!img && img.complete && img.naturalWidth > 0; });
  await page.waitForTimeout(1_000);
  mark("export");
  await shoot(page, "export-dialog.png");

  // The figure's provenance line and the Mermaid comment carry this local URL, which would be a dead link in the README.
  const localLink = new RegExp(` \u00b7 ${BASE}/repo/${id}|\n%% ${BASE}/repo/${id}`, "g");
  const diagram = async (query: string) => (await (await fetch(`${BASE}/api/diagram/${id}?${query}`)).text()).replace(localLink, "");
  writeFileSync(path.join(OUT, "architecture.svg"), await diagram("preset=document&theme=light"));
  writeFileSync(path.join(OUT, "architecture.mmd"), await diagram("format=mermaid"));
  if (process.env.SLIDE_PREVIEW) writeFileSync(process.env.SLIDE_PREVIEW, await diagram("preset=slide&theme=dark"));

  // The measured tour, a few steps in, where it reaches a hub rather than an entry point.
  // After the GIF's last mark, so the GIF is unchanged.
  await page.goto(`${BASE}/repo/${id}`);
  await page.getByRole("button", { name: /Take the tour/ }).click();
  const tourCard = page.getByRole("region", { name: "Guided tour" });
  for (let step = 1; step < 4; step++) await tourCard.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(1_800);
  await shoot(page, "guided-tour.png");

  await context.close();
  await browser.close();

  const video = readdirSync(videoDir).find((file) => file.endsWith(".webm"));
  if (video) {
    const fps = process.env.GIF_FPS || "8";
    const width = process.env.GIF_WIDTH || "900";
    // The tour opens on the finished map and ends on the export dialog.
    execFileSync(FFMPEG, [
      "-y", "-ss", String(marks.map), "-to", String(marks.export + 1.5), "-i", path.join(videoDir, video),
      "-vf", `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer`,
      path.join(OUT, "tour.gif"),
    ], { stdio: "inherit" });
  }
  console.log(`Media written to ${OUT}. Analysis ${id} was kept for the README embed.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
