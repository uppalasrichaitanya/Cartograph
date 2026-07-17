import test from "node:test";
import assert from "node:assert/strict";
import { WorkerPool } from "../../lib/safety/workerPool";

test("WorkerPool - successful task execution", async () => {
  const pool = new WorkerPool(1);
  const script = `return taskData.a + taskData.b;`;
  
  const result = await pool.runTask(script, { a: 1, b: 2 }, 1000);
  assert.equal(result.outcome, "completed");
  assert.equal(result.value, 3);
  
  await pool.shutdown();
});

test("WorkerPool - timeout enforcement", async () => {
  const pool = new WorkerPool(1);
  // Infinite loop to simulate CPU-bound synchronous runaway parse
  const script = `while(true){}`;
  
  const start = Date.now();
  const result = await pool.runTask(script, {}, 100);
  const elapsed = Date.now() - start;
  
  assert.equal(result.outcome, "timeout");
  assert.ok(elapsed < 500, `Worker should terminate within 500ms, took ${elapsed}ms`);
  
  await pool.shutdown();
});

test("WorkerPool - crash handling", async () => {
  const pool = new WorkerPool(1);
  const script = `throw new Error("Boom");`;
  
  const result = await pool.runTask(script, {}, 1000);
  assert.equal(result.outcome, "crashed");
  assert.match(String(result.errorDetail), /Boom/);
  
  await pool.shutdown();
});

test("WorkerPool - queueing and exhaustion", async () => {
  const pool = new WorkerPool(2);
  
  // A task that takes 100ms
  const script = `
    const start = Date.now();
    while (Date.now() - start < 100) {}
    return taskData;
  `;
  
  // Launch 4 tasks, pool size is 2. 
  // Tasks 3 and 4 should be queued and complete successfully.
  const p1 = pool.runTask(script, 1, 1000);
  const p2 = pool.runTask(script, 2, 1000);
  const p3 = pool.runTask(script, 3, 1000);
  const p4 = pool.runTask(script, 4, 1000);
  
  const results = await Promise.all([p1, p2, p3, p4]);
  
  for (let i = 0; i < 4; i++) {
    assert.equal(results[i].outcome, "completed");
    assert.equal(results[i].value, i + 1);
  }
  
  await pool.shutdown();
});
