import test from "node:test";
import assert from "node:assert/strict";
import { runWithResourceGuard, DEFAULT_BUDGET } from "../../lib/safety/resourceGuard";
import { WorkerPool } from "../../lib/safety/workerPool";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("ResourceGuard - size limit enforcement", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cartograph-resourceguard-"));
  const pool = new WorkerPool(1);

  try {
    const bigFile = path.join(tmpDir, "big.ts");
    // Write a file slightly larger than the budget limit
    await fs.writeFile(bigFile, Buffer.alloc(110)); 

    const budget = {
      timeoutMs: 1000,
      maxLineLength: 500,
      maxFileSizeBytes: 100, // smaller than the file
    };

    const script = `return 1;`;
    const result = await runWithResourceGuard(pool, bigFile, script, {}, budget);
    assert.equal(result.outcome, "oversized");
    assert.match(String(result.errorDetail), /exceeds limit/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await pool.shutdown();
  }
});

test("ResourceGuard - line length limit enforcement", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cartograph-resourceguard-"));
  const pool = new WorkerPool(1);

  try {
    const longLineFile = path.join(tmpDir, "long.ts");
    // Write a file with a very long single line
    await fs.writeFile(longLineFile, "a".repeat(200)); 

    const budget = {
      timeoutMs: 1000,
      maxLineLength: 100, // smaller than the line
      maxFileSizeBytes: 1024,
    };

    const script = `return 1;`;
    const result = await runWithResourceGuard(pool, longLineFile, script, {}, budget);
    assert.equal(result.outcome, "oversized");
    assert.match(String(result.errorDetail), /Line length 200 exceeds limit/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await pool.shutdown();
  }
});

test("ResourceGuard - successful execution within limits", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cartograph-resourceguard-"));
  const pool = new WorkerPool(1);

  try {
    const validFile = path.join(tmpDir, "valid.ts");
    await fs.writeFile(validFile, "const a = 1;\\nconst b = 2;"); 

    const script = `return taskData.val;`;
    const result = await runWithResourceGuard(pool, validFile, script, { val: "ok" }, DEFAULT_BUDGET);
    
    assert.equal(result.outcome, "completed");
    assert.equal(result.value, "ok");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await pool.shutdown();
  }
});
