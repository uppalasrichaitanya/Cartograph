// Guided tour: start from the overview, walk three steps with the buttons and
// the arrow keys, check the card never sits on the selected node or the
// inspector, leave with Esc, and open a step from a ?tour=k link.
import { expect, test, type Page } from "@playwright/test";
import AdmZip from "adm-zip";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

function fixtureZip(): string {
  const zip = new AdmZip();
  zip.addLocalFolder(path.join(__dirname, "fixtures", "small-repo"), "small-repo");
  // Added here rather than kept in the fixture folder, which `npm test` globs.
  zip.addFile("small-repo/tests/all.test.ts", Buffer.from(["api/auth", "api/health", "api/routes", "core/log", "ui/theme"].map((p) => 'import "../src/' + p + '";').join("\n") + "\n"));
  const file = path.join(mkdtempSync(path.join(tmpdir(), "cartograph-tour-")), "small-repo.zip");
  zip.writeZip(file);
  return file;
}

type Box = { left: number; right: number; top: number; bottom: number };
const box = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el): Box => el.getBoundingClientRect().toJSON());
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The selected node and the card and inspector must not overlap, at this viewport. */
async function expectClearOfCard(page: Page) {
  await page.waitForTimeout(700); // the camera settles
  const card = await box(page, ".tour-card");
  const inspector = await box(page, ".detail-panel");
  const node = await box(page, ".react-flow__node.is-selected");
  expect(overlaps(node, card), "selected node under the tour card").toBe(false);
  expect(overlaps(node, inspector), "selected node under the inspector").toBe(false);
  expect(overlaps(card, inspector), "tour card over the inspector").toBe(false);
  const viewport = page.viewportSize()!;
  expect(card.left).toBeGreaterThanOrEqual(0);
  expect(card.right).toBeLessThanOrEqual(viewport.width);
  expect(card.bottom).toBeLessThanOrEqual(viewport.height);
}

for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test(`guided tour: 3 steps, keyboard, exit, deep link (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/");
    await page.getByLabel("7 days").check();
    await page.locator('input[type="file"]').setInputFiles(fixtureZip());
    await page.getByRole("button", { name: "Generate map" }).click();
    await page.waitForURL(/\/repo\/[a-f0-9-]{36}$/, { timeout: 90_000 });
    const repoUrl = page.url();

    // Start from the overview; the steps are measured, and the card says so.
    const start = page.getByRole("button", { name: /Take the tour/ });
    await expect(start).toBeVisible();
    await start.click();
    const card = page.getByRole("region", { name: "Guided tour" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Measured from the import graph");
    await expect(card).toContainText(/Step 1 of \d/);
    await expect(page).toHaveURL(/tour=1/);
    const total = Number((await card.getByText(/Step 1 of \d/).textContent())!.match(/of (\d+)/)![1]);
    expect(total).toBeGreaterThanOrEqual(3);
    expect(total).toBeLessThanOrEqual(7);

    // The inspector shows the step's file, and the live region announces it.
    const firstFile = (await card.locator(".tour-file").getAttribute("title"))!;
    await expect(page.getByRole("complementary", { name: `Details for ${firstFile}` })).toBeVisible();
    await expect(page.locator(".sr-only[role=status]")).toHaveText(`Step 1 of ${total}: ${firstFile}`);
    await expectClearOfCard(page);

    // Step 2 with the button, step 3 with the arrow key, back with the other.
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card).toContainText(`Step 2 of ${total}`);
    await expect(page).toHaveURL(/tour=2/);
    const secondFile = (await card.locator(".tour-file").getAttribute("title"))!;
    expect(secondFile).not.toBe(firstFile);
    await expect(page.getByRole("complementary", { name: `Details for ${secondFile}` })).toBeVisible();
    await expectClearOfCard(page);

    await page.keyboard.press("ArrowRight");
    await expect(card).toContainText(`Step 3 of ${total}`);
    await expect(page).toHaveURL(/tour=3/);
    await expectClearOfCard(page);
    await page.keyboard.press("ArrowLeft");
    await expect(card).toContainText(`Step 2 of ${total}`);

    // Typing keeps the keyboard: arrows in the search box do not move the tour.
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog").locator("input").first();
    await search.fill("view");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await expect(card).toContainText(`Step 2 of ${total}`);
    await page.keyboard.press("Escape"); // closes search, not the tour
    await expect(card).toBeVisible();

    // Esc leaves the tour, drops ?tour, and the arrows go back to doing nothing.
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(page).not.toHaveURL(/tour=/);
    await page.keyboard.press("ArrowRight");
    await expect(card).toHaveCount(0);

    // A shared ?tour=k link opens that step directly.
    await page.goto(`${repoUrl}?tour=2`);
    const linked = page.getByRole("region", { name: "Guided tour" });
    await expect(linked).toContainText(`Step 2 of ${total}`);
    await expect(linked.locator(".tour-file")).toHaveAttribute("title", secondFile);
    await expect(page.getByRole("complementary", { name: `Details for ${secondFile}` })).toBeVisible();
    await expectClearOfCard(page);

    // An out-of-range step is ignored rather than breaking the page.
    await page.goto(`${repoUrl}?tour=99`);
    await expect(page.getByRole("region", { name: "Guided tour" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Take the tour/ })).toBeVisible();
  });
}
