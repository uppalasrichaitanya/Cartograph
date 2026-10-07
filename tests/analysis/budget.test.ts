import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { analyzeRepository, AnalysisTimeoutError } from "@/lib/analysis/analyzeRepository";

const source = { owner: "o", repo: "slow", ref: null };

function tinyZip(destinationPath: string): void {
  const zip = new AdmZip();
  zip.addFile("slow-HEAD/a.ts", Buffer.from("export const a = 1;\n"));
  zip.writeZip(destinationPath);
}

test("an analysis that outlives its time budget fails with a friendly timeout error", async () => {
  const started = Date.now();
  await assert.rejects(
    analyzeRepository(
      { github: source },
      () => {},
      {
        budgetMs: 150,
        // A download that never settles and ignores its abort signal.
        downloadGithubArchive: () => new Promise(() => {}),
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof AnalysisTimeoutError);
      assert.match((error as Error).message, /took too long to analyse/);
      assert.match((error as Error).message, /smaller repository|subfolder/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 3000, "fails promptly instead of hanging");
});

test("the budget is checked between phases, so a late finish never persists a result", async () => {
  let saved = false;
  const { getStorage } = await import("@/lib/storage");
  const storage = getStorage();
  const original = storage.saveAnalysis.bind(storage);
  storage.saveAnalysis = async (result) => { saved = true; await original(result); };
  try {
    await assert.rejects(
      analyzeRepository(
        { github: source },
        () => {},
        {
          budgetMs: 60,
          downloadGithubArchive: async (_s, destinationPath) => {
            await new Promise((resolve) => setTimeout(resolve, 200));
            tinyZip(destinationPath);
            return { bytes: 10 };
          },
        },
      ),
      AnalysisTimeoutError,
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(saved, false);
  } finally {
    storage.saveAnalysis = original;
  }
});

test("an analysis within budget is unaffected", async () => {
  const result = await analyzeRepository(
    { github: source },
    () => {},
    { budgetMs: 60_000, downloadGithubArchive: async (_s, p) => { tinyZip(p); return { bytes: 10 }; } },
  );
  const { getStorage } = await import("@/lib/storage");
  await getStorage().deleteAnalysis(result.id);
  assert.equal(result.graph.nodes.length, 1);
});

test("if the budget expires while the result is being saved, the saved analysis is deleted", async () => {
  const { getStorage } = await import("@/lib/storage");
  const storage = getStorage();
  const original = storage.saveAnalysis.bind(storage);
  let savedId = "";
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => { release = resolve; });
  storage.saveAnalysis = async (result) => {
    savedId = result.id;
    await released; // held open until the budget has expired
    await original(result);
  };
  try {
    await assert.rejects(
      analyzeRepository(
        { github: source },
        () => {},
        { budgetMs: 1200, downloadGithubArchive: async (_s, p) => { tinyZip(p); return { bytes: 10 }; } },
      ),
      AnalysisTimeoutError,
    );
    // Now let the abandoned run finish its slow save; it must clean up after itself.
    release();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.ok(savedId, "the run reached the persist phase");
    assert.equal(await storage.loadAnalysis(savedId), null, "no orphaned analysis remains");
    assert.equal(await storage.loadOwner(savedId), null, "no orphaned owner record remains");
  } finally {
    storage.saveAnalysis = original;
  }
});
