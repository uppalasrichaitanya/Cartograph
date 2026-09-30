import assert from "node:assert/strict";
import test from "node:test";
import { composeOgCard } from "@/lib/og/card";
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
