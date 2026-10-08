// Guided tour: start from the overview, walk three steps with the buttons and
// the arrow keys, check the card never sits on the selected node or the
// inspector, leave with Esc, and open a step from a ?tour=k link. Also Back and
// Forward through a tour, leaving it by other navigation, and a 390px screen.
// Every analysis a test creates is deleted again through the app.
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

async function createRepo(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByLabel("7 days").check();
  await page.locator('input[type="file"]').setInputFiles(fixtureZip());
  await page.getByRole("button", { name: "Generate map" }).click();
  await page.waitForURL(/\/repo\/[a-f0-9-]{36}$/, { timeout: 90_000 });
  return page.url();
}

/** Delete the analysis the way a person does, so the 7-day copy does not linger. */
async function deleteRepo(page: Page, repoUrl: string) {
  await page.goto(repoUrl);
  // On a narrow screen the one-time owner notice sits over the menu.
  const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Delete analysis/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForURL(/\/\?deleted=1$/);
}

type Box = { left: number; right: number; top: number; bottom: number };
const box = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el): Box => el.getBoundingClientRect().toJSON());
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const card = (page: Page) => page.getByRole("region", { name: "Guided tour" });
const fileOf = async (page: Page) => (await card(page).locator(".tour-file").getAttribute("title"))!;

/** The selected node and the card and inspector must not overlap, at this viewport. */
async function expectClearOfCard(page: Page) {
  // The camera settles: the selected node stops moving between two reads.
  let last = "";
  await expect.poll(async () => {
    const now = JSON.stringify(await box(page, ".react-flow__node.is-selected"));
    const still = now === last;
    last = now;
    return still;
  }, { intervals: [150], timeout: 10_000 }).toBe(true);
  const tourCard = await box(page, ".tour-card");
  const inspector = await box(page, ".detail-panel");
  const node = await box(page, ".react-flow__node.is-selected");
  expect(overlaps(node, tourCard), "selected node under the tour card").toBe(false);
  expect(overlaps(node, inspector), "selected node under the inspector").toBe(false);
  expect(overlaps(tourCard, inspector), "tour card over the inspector").toBe(false);
  const viewport = page.viewportSize()!;
  expect(tourCard.left).toBeGreaterThanOrEqual(0);
  expect(tourCard.right).toBeLessThanOrEqual(viewport.width);
  expect(tourCard.bottom).toBeLessThanOrEqual(viewport.height);
}

for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test(`guided tour: 3 steps, keyboard, exit, deep link (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    const repoUrl = await createRepo(page);
    try {
      // Start from the overview; the steps are measured, and the card says so.
      const start = page.getByRole("button", { name: /Take the tour/ });
      await expect(start).toBeVisible();
      await start.click();
      await expect(card(page)).toBeVisible();
      await expect(card(page)).toContainText("Measured from the import graph");
      await expect(card(page)).toContainText(/Step 1 of \d/);
      await expect(page).toHaveURL(/tour=1/);
      const total = Number((await card(page).getByText(/Step 1 of \d/).textContent())!.match(/of (\d+)/)![1]);
      expect(total).toBeGreaterThanOrEqual(3);
      expect(total).toBeLessThanOrEqual(7);

      // The inspector shows the step's file, and the live region announces it.
      const firstFile = await fileOf(page);
      await expect(page.getByRole("complementary", { name: `Details for ${firstFile}` })).toBeVisible();
      await expect(page.locator(".sr-only[role=status]")).toHaveText(`Step 1 of ${total}: ${firstFile}`);
      await expectClearOfCard(page);

      // Step 2 with the button, step 3 with the arrow key, back with the other.
      await card(page).getByRole("button", { name: "Next" }).click();
      await expect(card(page)).toContainText(`Step 2 of ${total}`);
      await expect(page).toHaveURL(/tour=2/);
      const secondFile = await fileOf(page);
      expect(secondFile).not.toBe(firstFile);
      await expect(page.getByRole("complementary", { name: `Details for ${secondFile}` })).toBeVisible();
      await expectClearOfCard(page);

      await page.keyboard.press("ArrowRight");
      await expect(card(page)).toContainText(`Step 3 of ${total}`);
      await expect(page).toHaveURL(/tour=3/);
      await expectClearOfCard(page);
      await page.keyboard.press("ArrowLeft");
      await expect(card(page)).toContainText(`Step 2 of ${total}`);

      // Typing keeps the keyboard: arrows in the search box do not move the tour.
      await page.keyboard.press("Control+k");
      const search = page.getByRole("dialog").locator("input").first();
      await search.fill("view");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowRight");
      await expect(card(page)).toContainText(`Step 2 of ${total}`);
      await page.keyboard.press("Escape"); // closes search, not the tour
      await expect(card(page)).toBeVisible();

      // Esc leaves the tour, drops ?tour, and the arrows go back to doing nothing.
      await page.keyboard.press("Escape");
      await expect(card(page)).toHaveCount(0);
      await expect(page).not.toHaveURL(/tour=/);
      await page.keyboard.press("ArrowRight");
      await expect(card(page)).toHaveCount(0);

      // A shared ?tour=k link opens that step directly.
      await page.goto(`${repoUrl}?tour=2`);
      await expect(card(page)).toContainText(`Step 2 of ${total}`);
      await expect(card(page).locator(".tour-file")).toHaveAttribute("title", secondFile);
      await expect(page.getByRole("complementary", { name: `Details for ${secondFile}` })).toBeVisible();
      await expectClearOfCard(page);

      // An out-of-range step is ignored rather than breaking the page.
      await page.goto(`${repoUrl}?tour=99`);
      await expect(card(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Take the tour/ })).toBeVisible();
    } finally {
      await deleteRepo(page, repoUrl);
    }
  });
}

test("guided tour: Back and Forward walk the steps; a deep link adds no history entry", async ({ page }) => {
  const repoUrl = await createRepo(page);
  try {
    await page.getByRole("button", { name: /Take the tour/ }).click();
    await expect(card(page)).toContainText("Step 1 of");
    // One step at a time, as a person reads: each settles into the address first.
    await card(page).getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/tour=2/);
    await card(page).getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/tour=3/);
    await expect(card(page)).toContainText("Step 3 of");
    const third = await fileOf(page);

    // Back: card, inspector and address agree on step 2, then step 1.
    await page.goBack();
    await expect(card(page)).toContainText("Step 2 of");
    await expect(page).toHaveURL(/tour=2/);
    await expect(page.getByRole("complementary", { name: `Details for ${await fileOf(page)}` })).toBeVisible();
    await page.goBack();
    await expect(card(page)).toContainText("Step 1 of");
    await expect(page).toHaveURL(/tour=1/);
    await expect(page.getByRole("complementary", { name: `Details for ${await fileOf(page)}` })).toBeVisible();
    // Back out of the tour: no card, no tour in the address.
    await page.goBack();
    await expect(card(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/tour=/);

    // Forward re-enters it, step by step.
    await page.goForward();
    await expect(card(page)).toContainText("Step 1 of");
    await page.goForward();
    await expect(card(page)).toContainText("Step 2 of");
    await page.goForward();
    await expect(card(page)).toContainText("Step 3 of");
    await expect(page).toHaveURL(/tour=3/);
    await expect(page.getByRole("complementary", { name: `Details for ${third}` })).toBeVisible();

    // A deep link replaces its own entry: one Back leaves the tour page for good.
    await page.goto(`${repoUrl}?tour=2`);
    await expect(card(page)).toContainText("Step 2 of");
    await card(page).getByRole("button", { name: "Next" }).click();
    await expect(page).toHaveURL(/tour=3/);
    await page.goBack();
    await expect(card(page)).toContainText("Step 2 of");
    await expect(page.getByRole("complementary", { name: `Details for ${await fileOf(page)}` })).toBeVisible();
    // One more Back lands on the page before the deep link (earlier, on step 3),
    // not on a second copy of step 2.
    await page.goBack();
    await expect(page).toHaveURL(/tour=3/);
    await expect(card(page)).toContainText("Step 3 of");
  } finally {
    await deleteRepo(page, repoUrl);
  }
});

test("guided tour: any navigation outside the tour ends it", async ({ page }) => {
  const repoUrl = await createRepo(page);
  try {
    await page.getByRole("button", { name: /Take the tour/ }).click();
    await expect(card(page)).toContainText("Step 1 of");
    // Closing the inspector leaves the tour, and the address drops ?tour.
    await page.getByRole("button", { name: "Close file details" }).click({ timeout: 10_000 });
    await expect(card(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/tour=/);

    // So does choosing another file (the start button lives on the overview).
    await page.goto(repoUrl);
    await page.getByRole("button", { name: /Take the tour/ }).click();
    await expect(card(page)).toContainText("Step 1 of");
    await expect(page.locator(".react-flow__node.is-selected").first()).toBeVisible();
    await page.locator(".react-flow__node:not(.is-selected)").first().click({ timeout: 10_000 });
    await expect(card(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/tour=/);
  } finally {
    await deleteRepo(page, repoUrl);
  }
});

test("guided tour: at 390px the card stays above the inspector and usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const repoUrl = await createRepo(page);
  try {
    await page.getByRole("button", { name: /Take the tour/ }).click();
    await expect(card(page)).toContainText("Step 1 of");
    const next = card(page).getByRole("button", { name: "Next" });
    await expect(next).toBeVisible();
    // The Next button is the topmost element at its own centre: nothing covers it.
    const covered = () => next.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !(hit && el.contains(hit));
    });
    expect(await covered()).toBe(false);
    const cardBox = await box(page, ".tour-card");
    const inspector = await box(page, ".detail-panel");
    expect(overlaps(cardBox, inspector), "inspector over the tour card").toBe(false);
    expect(cardBox.left).toBeGreaterThanOrEqual(0);
    expect(cardBox.right).toBeLessThanOrEqual(390);
    expect(cardBox.bottom).toBeLessThanOrEqual(844);
    await next.click();
    await expect(card(page)).toContainText("Step 2 of");
    expect(await covered()).toBe(false);
    await card(page).getByRole("button", { name: /Exit tour/ }).click();
    await expect(card(page)).toHaveCount(0);
  } finally {
    await deleteRepo(page, repoUrl);
  }
});
