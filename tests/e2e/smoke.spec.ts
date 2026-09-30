// Browser smoke test: the two bugs that only ever showed in a real browser
// (the camera framing and clipped AI text) are guarded here, alongside the
// upload, export and delete journey around them.
import { expect, test, type Page } from "@playwright/test";
import AdmZip from "adm-zip";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function fixtureZip(): string {
  const zip = new AdmZip();
  zip.addLocalFolder(path.join(__dirname, "fixtures", "small-repo"), "small-repo");
  // Added here, not kept in the fixture folder: a *.test.ts file there would be
  // picked up by the `node:test` glob in `npm test`.
  zip.addFile("small-repo/tests/jobs.test.ts", Buffer.from('import { runJob } from "../src/core/jobs";\nexport const check = () => runJob();\n'));
  const file = path.join(mkdtempSync(path.join(tmpdir(), "cartograph-e2e-")), "small-repo.zip");
  zip.writeZip(file);
  return file;
}

async function noClippedText(page: Page, selector: string) {
  const clipped = await page.$$eval(selector, (elements) =>
    elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent?.slice(0, 60)));
  expect(clipped, "text overflowing its container").toEqual([]);
}

async function readAll(stream: NodeJS.ReadableStream | null): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test("upload → map → AI → export → delete", async ({ page }) => {
  // 1. Home names every language.
  await page.goto("/");
  await expect(page.getByText(/Python · Go/)).toBeVisible();

  // 2. Upload with a 7-day retention.
  await page.getByLabel("7 days").check();
  await page.locator('input[type="file"]').setInputFiles(fixtureZip());
  await page.getByRole("button", { name: "Generate map" }).click();
  await page.waitForURL(/\/repo\/[a-f0-9-]{36}$/, { timeout: 90_000 });
  const id = page.url().split("/").pop()!;

  // 3. Region map with weighted edges.
  await expect(page.locator(".react-flow__node").filter({ hasText: "src/core" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /expires on/ })).toBeVisible();
  await page.locator(".react-flow__node").filter({ hasText: "src/api" }).hover();
  await expect(page.locator(".react-flow__edge-text").first()).toBeVisible();

  // 4. Drill in; the camera fits the region.
  await page.locator(".react-flow__node").filter({ hasText: "src/core" }).dblclick();
  await expect(page).toHaveURL(/region=src%2Fcore/);
  await page.waitForTimeout(800);
  const viewport = page.viewportSize()!;
  const boxes = await page.locator(".react-flow__node").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(-1);
    expect(box.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.top).toBeGreaterThanOrEqual(-1);
    expect(box.bottom).toBeLessThanOrEqual(viewport.height + 1);
  }

  // 5. AI panel: "not configured" without keys, then a mocked grounded answer.
  await page.getByRole("button", { name: /AI explain/ }).click();
  const panel = page.locator(".ai-panel");
  await panel.getByRole("button", { name: "Explain this region" }).click();
  await expect(panel.getByText(/not configured/i)).toBeVisible();
  await page.route("**/api/ai/explain", (route) => route.fulfill({
    json: {
      answer: "The core region runs jobs through a queue and reads configuration.",
      claims: [
        { section: "Role", text: "jobs.ts likely coordinates work by handing names to the queue.", citations: [{ kind: "node", id: "src/core/jobs.ts" }] },
        { section: "Hotspots and risks", text: "jobs.ts and queue.ts import each other, so changes to either can ripple.", citations: [{ kind: "node", id: "src/core/queue.ts" }] },
      ],
      readingOrder: [{ id: "src/core/jobs.ts", reason: "The entry to the region." }],
      dropped: 0, cached: false, provider: "gemini", model: "mock", generatedAt: "2026-09-29T00:00:00.000Z",
    },
  }));
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByText("The core region runs jobs")).toBeVisible();
  await noClippedText(page, ".ai-panel p, .ai-panel li");

  // 6. Export.
  await page.getByRole("button", { name: "Close AI explanation" }).click();
  await page.keyboard.press("e");
  const dialog = page.getByRole("dialog", { name: "Export diagram" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("img")).toHaveJSProperty("complete", true);
  expect(await dialog.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

  const svgDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "SVG" }).click();
  const svgText = (await readAll(await (await svgDownload).createReadStream())).toString("utf8");
  expect(svgText.startsWith("<svg")).toBe(true);
  expect(svgText).toContain("small repo");

  const pngDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "PNG" }).click();
  const pngBuffer = await readAll(await (await pngDownload).createReadStream());
  expect(pngBuffer.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const pngWidth = pngBuffer.readUInt32BE(16);
  const svgWidth = Number(svgText.match(/viewBox="0 0 ([\d.]+)/)![1]);
  expect(pngWidth).toBe(Math.round(Math.min(2, 4800 / svgWidth) * svgWidth));

  await dialog.getByRole("button", { name: "Copy Markdown" }).click();
  // The copy is asynchronous (it fetches the Mermaid source first); wait for its confirmation.
  await expect(dialog.getByText("Markdown copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("```mermaid");
  await page.keyboard.press("Escape");

  // 7. Delete.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Delete analysis/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForURL(/\/\?deleted=1$/);
  await expect(page.getByText("Analysis deleted")).toBeVisible();
  const gone = await page.goto(`/repo/${id}`);
  expect(gone?.status()).toBe(404);
});

test("GitHub mode: prefill from the URL, and a bad link is explained inline", async ({ page }) => {
  await page.goto("/");
  // Zip is the default; the drop zone shows and the GitHub field does not.
  await expect(page.locator('input[type="file"]')).toBeAttached();
  await expect(page.getByLabel("Public GitHub repository")).toHaveCount(0);

  // Generate with no file is never silent, and round-tripping the mode keeps no stale file.
  await page.locator('input[type="file"]').setInputFiles({ name: "foo.zip", mimeType: "application/zip", buffer: Buffer.from("x") });
  await expect(page.getByText("foo.zip")).toBeVisible();
  await page.getByRole("radio", { name: "GitHub link" }).check();
  await page.getByRole("radio", { name: "Zip file" }).check();
  await expect(page.getByText("foo.zip")).toHaveCount(0);
  await page.getByRole("button", { name: "Generate map" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Choose a \.zip file/ })).toBeVisible();
  await page.getByRole("radio", { name: "GitHub link" }).check();
  const field = page.getByLabel("Public GitHub repository");
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute("placeholder", "github.com/owner/repo");
  await expect(page.getByText(/Public repositories only · archive up to 25 MB/)).toBeVisible();

  // No network in e2e: this is rejected by the shared parser before any request.
  let requested = false;
  page.on("request", (request) => { if (request.url().includes("/api/analyze")) requested = true; });
  await field.fill("not a link");
  await page.getByRole("button", { name: "Generate map" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /owner\/repo/ })).toBeVisible();
  expect(requested).toBe(false);

  // ?github= prefills GitHub mode and never submits.
  await page.goto("/?github=octo/cat");
  await expect(page.getByRole("radio", { name: "GitHub link" })).toBeChecked();
  await expect(page.getByLabel("Public GitHub repository")).toHaveValue("octo/cat");
  await expect(page.getByRole("button", { name: "Generate map" })).toBeEnabled();
});
