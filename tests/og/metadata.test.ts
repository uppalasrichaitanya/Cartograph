import assert from "node:assert/strict";
import test from "node:test";
import { metadataBaseUrl, repoMetadata } from "@/lib/og/metadata";
import { webApp } from "../diagram/fixtures";

const ID = "00000000-0000-4000-8000-000000000000";

test("repo metadata names the repo and quotes the measured counts", () => {
  const meta = repoMetadata(webApp(), ID);
  assert.equal(meta.title, "fixture · architecture map · Cartograph");
  assert.match(String(meta.description), /^\d+ files in \d+ regions, \d+ import edges, each read from an import statement\.$/);
  assert.deepEqual(meta.robots, { index: false, follow: false });
  const image = (meta.openGraph?.images as { url: string; width: number; height: number; alt: string }[])[0];
  assert.deepEqual([image.url, image.width, image.height], [`/api/og/${ID}`, 1200, 630]);
  assert.match(image.alt, /fixture/);
  assert.equal((meta.twitter as { card: string }).card, "summary_large_image");
});

test("the metadata base follows the deployment, and never throws without env", () => {
  assert.equal(metadataBaseUrl({}).href, "http://localhost:3000/");
  assert.equal(metadataBaseUrl({ VERCEL_URL: "x-abc.vercel.app" }).href, "https://x-abc.vercel.app/");
  assert.equal(
    metadataBaseUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "cartograph.app", VERCEL_URL: "x-abc.vercel.app" }).href,
    "https://cartograph.app/",
  );
  assert.equal(metadataBaseUrl({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "cartograph.app", VERCEL_URL: "x-abc.vercel.app" }).href, "https://x-abc.vercel.app/");
  assert.equal(metadataBaseUrl({ VERCEL_URL: "not a host!" }).href, "http://localhost:3000/");
});

test("metadataFor falls back to defaults for a missing analysis or a throwing load", async () => {
  const { metadataFor } = await import("@/lib/og/metadata");
  assert.deepEqual(await metadataFor(ID, async () => null), {});
  assert.deepEqual(await metadataFor(ID, async () => { throw new Error("storage down"); }), {});
  assert.equal((await metadataFor(ID, async () => webApp())).title, "fixture · architecture map · Cartograph");
});
