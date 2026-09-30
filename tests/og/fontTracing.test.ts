import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "@/next.config";
import { OG_FONT_FILES } from "@/lib/og/render";

test("every bundled OG font is listed for Vercel file tracing", () => {
  const traced = nextConfig.outputFileTracingIncludes?.["/api/og/**"] ?? [];
  for (const file of OG_FONT_FILES) assert.ok(traced.includes(`./lib/og/fonts/${file}`), `${file} is missing from outputFileTracingIncludes`);
});
