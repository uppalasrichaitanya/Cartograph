/**
 * Colour tokens for exported figures.
 *
 * `light` is the product's own palette (tests keep it equal to the tokens in
 * app/globals.css). `dark` is for slides; `print` has no colour at all and
 * marks cycles with a dash pattern instead of amber.
 *
 * @module lib/diagram/theme
 */
import type { DiagramThemeName } from "./types";

export type DiagramTheme = Readonly<{
  ground: string;
  surface: string;
  well: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  rule: string;
  ruleStrong: string;
  accent: string;
  cycle: string;
  assisted: string;
  /** Dash pattern for cycle edges, when colour alone cannot carry them. */
  cycleDash: string | null;
}>;

export const THEMES: Readonly<Record<DiagramThemeName, DiagramTheme>> = {
  light: {
    ground: "#F4F0E6", surface: "#FCFAF5", well: "#EBE6D9",
    ink: "#232019", inkMuted: "#5C554A", inkFaint: "#6B6357",
    rule: "#D6CFBF", ruleStrong: "#B8AF9B",
    accent: "#A84A26", cycle: "#7A5312", assisted: "#54467E", cycleDash: null,
  },
  dark: {
    ground: "#1C1A16", surface: "#25221C", well: "#2E2A23",
    ink: "#EDE7DA", inkMuted: "#B5AC9C", inkFaint: "#A39A8C",
    rule: "#3F3A31", ruleStrong: "#5A5346",
    accent: "#E07A50", cycle: "#E0A94A", assisted: "#A99BDB", cycleDash: null,
  },
  print: {
    ground: "#FFFFFF", surface: "#FFFFFF", well: "#F2F2F2",
    ink: "#000000", inkMuted: "#333333", inkFaint: "#555555",
    rule: "#999999", ruleStrong: "#555555",
    accent: "#000000", cycle: "#000000", assisted: "#333333", cycleDash: "6 3",
  },
};
