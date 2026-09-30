import assert from "node:assert/strict";
import test from "node:test";
import { composeOgCard, composeSummaryCard, usesSummaryCard } from "@/lib/og/card";
import { THEMES } from "@/lib/diagram/theme";

const figure = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"><title id="t">x</title><rect width="10" height="10"/></svg>`;

test("the card is 1200 by 630 on the light theme's paper colour", () => {
  const svg = composeOgCard(figure(1920, 1080));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="630" viewBox="0 0 1200 630">/);
  assert.match(svg, new RegExp(`<rect width="1200" height="630" fill="${THEMES.light.ground}"/>`));
});

test("a slide figure is nested, scaled to fit and centred with side bands", () => {
  const svg = composeOgCard(figure(1920, 1080));
  // 630 / 1080 = 0.5833: the figure is 1120 wide, leaving 40 px either side.
  assert.match(svg, /<svg [^>]*x="40" y="0" width="1120" height="630" viewBox="0 0 1920 1080">/);
  assert.equal((svg.match(/\swidth="1920"/g) ?? []).length, 0, "the figure's own size is replaced");
  assert.match(svg, /<rect width="10" height="10"\/><\/svg><\/svg>$/);
});

test("a wide figure is letterboxed top and bottom instead", () => {
  const svg = composeOgCard(figure(2400, 1100));
  assert.match(svg, /<svg [^>]*x="0" y="([\d.]+)" width="1200" height="550" viewBox="0 0 2400 1100">/);
  assert.match(svg, /y="40"/);
});

test("something that is not an SVG is refused", () => {
  assert.throws(() => composeOgCard("<html></html>"), /not an SVG/);
});

const summaryInput = { repoName: "tiny", files: 3, imports: 2, language: "TypeScript" };

test("the summary card is 1200 by 630 paper with wordmark, name, stats and tagline", () => {
  const svg = composeSummaryCard(summaryInput, figure(1920, 1080));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1200" height="630" viewBox="0 0 1200 630">/);
  assert.match(svg, new RegExp(`<rect width="1200" height="630" fill="${THEMES.light.ground}"/>`));
  for (const part of ["CARTOGRAPH", ">tiny<", "3 files", "2 imports", "TypeScript", "Every edge is read from an import statement."]) {
    assert.ok(svg.includes(part), `missing ${part}`);
  }
});

test("the summary card escapes a hostile repository name", () => {
  const svg = composeSummaryCard({ ...summaryInput, repoName: `a<&">b` }, null);
  assert.ok(svg.includes("a&lt;&amp;&quot;&gt;b"));
  assert.ok(!svg.includes(`a<&">b`));
});

test("a long repository name shrinks then truncates with an ellipsis", () => {
  const svg = composeSummaryCard({ ...summaryInput, repoName: "x".repeat(200) }, null);
  assert.match(svg, />x+…</);
});

test("singular stats read naturally and a missing language is left out", () => {
  const svg = composeSummaryCard({ repoName: "one", files: 1, imports: 1, language: "" }, null);
  assert.ok(svg.includes("1 file ·"));
  assert.ok(svg.includes("1 import"));
  assert.ok(!svg.includes("1 imports"));
});

test("the summary is chosen below three units and the figure at three or more", () => {
  assert.equal(usesSummaryCard(0), true);
  assert.equal(usesSummaryCard(2), true);
  assert.equal(usesSummaryCard(3), false);
});

test("the figure is placed below only when it stays legible", () => {
  assert.ok(composeSummaryCard(summaryInput, figure(1000, 150)).includes('viewBox="0 0 1000 150"'));
  assert.ok(!composeSummaryCard(summaryInput, figure(1920, 1080)).includes('viewBox="0 0 1920 1080"'));
});
