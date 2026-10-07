import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { analyzeRepository } from "@/lib/analysis/analyzeRepository";
import { GithubImportError } from "@/lib/github/download";
import { getStorage, StorageError } from "@/lib/storage";

/** A zip laid out like a GitHub archive: everything under one `repo-ref/` folder. */
function githubStyleZip(destinationPath: string): void {
  const zip = new AdmZip();
  zip.addFile("slugify-HEAD/src/a.ts", Buffer.from('import { b } from "./b";\nexport const a = b + 1;\n'));
  zip.addFile("slugify-HEAD/src/b.ts", Buffer.from("export const b = 1;\n"));
  zip.writeZip(destinationPath);
}

function spyOnDeleteUpload(): { calls: string[]; restore: () => void } {
  const storage = getStorage();
  const original = storage.deleteUpload.bind(storage);
  const calls: string[] = [];
  storage.deleteUpload = async (ref: string) => {
    calls.push(ref);
    await original(ref);
  };
  return { calls, restore: () => { storage.deleteUpload = original; } };
}

test("a GitHub import downloads into the temp dir, analyses the single top-level folder, and never touches upload storage", async () => {
  const spy = spyOnDeleteUpload();
  let archivePath = "";
  try {
    const source = { owner: "sindresorhus", repo: "slugify", ref: null };
    const phases: Array<[string, string]> = [];
    const result = await analyzeRepository(
      { github: source, retention: "7d" },
      (phase, detail) => { phases.push([phase, detail]); },
      {
        downloadGithubArchive: async (received, destinationPath) => {
          assert.deepEqual(received, source);
          archivePath = destinationPath;
          githubStyleZip(destinationPath);
          return { bytes: 1234 };
        },
      },
    );
    try {
      assert.equal(result.repoMeta.repoName, "sindresorhus/slugify");
      assert.equal(result.repoMeta.repoSizeBytes, 1234);
      assert.deepEqual(result.repoMeta.source, { kind: "github", url: "https://github.com/sindresorhus/slugify" });
      assert.equal(result.graph.nodes.length, 2);
      assert.deepEqual(result.graph.nodes.map((node) => node.id).sort(), ["src/a.ts", "src/b.ts"]);
      assert.equal(result.graph.edges.length, 1);
      assert.deepEqual(phases[0], ["validating", "Downloading sindresorhus/slugify from GitHub"]);
      assert.deepEqual(spy.calls, [], "there is no uploaded object to delete");
      assert.ok(archivePath.includes("cartograph-"), "the archive lives inside the analysis temp dir");
      await assert.rejects(access(archivePath), "the archive is removed with the temp dir");
    } finally {
      await getStorage().deleteAnalysis(result.id);
    }
  } finally {
    spy.restore();
  }
});

test("a GitHub import pinned to a ref records the tree URL and a ref-qualified name", async () => {
  const result = await analyzeRepository(
    { github: { owner: "o", repo: "r", ref: "dev" } },
    () => {},
    { downloadGithubArchive: async (_source, destinationPath) => { githubStyleZip(destinationPath); return { bytes: 10 }; } },
  );
  try {
    assert.equal(result.repoMeta.repoName, "o/r@dev");
    assert.equal(result.repoMeta.source?.url, "https://github.com/o/r/tree/dev");
  } finally {
    await getStorage().deleteAnalysis(result.id);
  }
});

test("a failed download propagates its message and still cleans up without deleting an upload", async () => {
  const spy = spyOnDeleteUpload();
  let archivePath = "";
  try {
    await assert.rejects(
      analyzeRepository(
        { github: { owner: "o", repo: "gone", ref: null } },
        () => {},
        { downloadGithubArchive: async (_source, destinationPath) => { archivePath = destinationPath; throw new GithubImportError("Couldn't find a public GitHub repository at o/gone."); } },
      ),
      /Couldn't find a public GitHub repository at o\/gone\./,
    );
    assert.deepEqual(spy.calls, []);
    await assert.rejects(access(path.dirname(archivePath)));
  } finally {
    spy.restore();
  }
});

test("zip imports are unchanged: an invalid upload reference is still refused before anything runs", async () => {
  await assert.rejects(analyzeRepository({ zipPath: "/etc/passwd" }), StorageError);
});

test("zip imports record no source", async () => {
  // Guard against `source` leaking onto uploads: it must only be set for GitHub imports.
  const { detectRepoMeta } = await import("@/lib/analysis/detectRepoMeta");
  const meta = await detectRepoMeta(process.cwd(), { nodes: [], edges: [] } as never, [], "x", null);
  assert.equal("source" in meta, false);
});

test("the caller's abort signal reaches the GitHub download", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  await assert.rejects(
    analyzeRepository(
      { github: { owner: "octo", repo: "cat", ref: null }, retention: "7d" },
      () => {},
      {
        signal: controller.signal,
        downloadGithubArchive: async (_source, _destination, options) => {
          received = options?.signal;
          throw new Error("stop here");
        },
      },
    ),
    /stop here/,
  );
  // The download gets a signal combined with the time budget's, so it follows
  // the caller's: aborting the caller's signal aborts the one it received.
  assert.ok(received);
  assert.equal(received.aborted, false);
  controller.abort();
  assert.equal(received.aborted, true);
});
