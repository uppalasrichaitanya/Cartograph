import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { THEMES } from "@/lib/diagram/theme";

const luminance = (hex: string) => {
  const c = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => Number.parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("every text ink reads at AA (4.5:1) on every ground in every theme", () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const ink of ["ink", "inkMuted", "inkFaint", "accent", "cycle", "assisted"] as const) {
      for (const ground of ["ground", "surface", "well"] as const) {
        const value = ratio(theme[ink], theme[ground]);
        assert.ok(value >= 4.5, `${name}: ${ink} on ${ground} is ${value.toFixed(2)}`);
      }
    }
  }
});

test("the light theme is the product's own palette", () => {
  const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
  const token = (name: string) => css.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]?.toUpperCase();
  const light = THEMES.light;
  assert.equal(light.ground, token("--paper"));
  assert.equal(light.surface, token("--surface"));
  assert.equal(light.well, token("--well"));
  assert.equal(light.ink, token("--ink"));
  assert.equal(light.inkMuted, token("--ink-muted"));
  assert.equal(light.inkFaint, token("--ink-faint"));
  assert.equal(light.rule, token("--rule"));
  assert.equal(light.ruleStrong, token("--rule-strong"));
  assert.equal(light.accent, token("--focus"));
  assert.equal(light.cycle, token("--amber"));
  assert.equal(light.assisted, token("--assisted"));
});
