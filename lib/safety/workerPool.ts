/**
 * Cartograph Worker Pool — Managed worker_threads Pool for Parse Isolation
 *
 * Implements the worker pool specified in:
 *   specs/cartograph_extraction_safety_spec.md — Section 5 & Section 8
 *
 * Responsibility:
 *   Provide a pool of reusable worker_threads that execute arbitrary
 *   functions with genuine OS-level termination on timeout. This is
 *   the mechanism that makes per-file resource budgets enforceable.
 *
 * Key design decision (from spec Section 5):
 *   Node.js cannot preemptively terminate synchronous CPU-bound work
 *   without a worker thread. A naive Promise.race against a timer does
 *   NOT stop a runaway synchronous parse — the CPU-bound work keeps
 *   blocking the event loop even after the timeout promise "wins" the
 *   race. worker.terminate() provides a real, OS-enforced termination.
 *
 * Contract:
 *   - Workers are long-lived and pooled (spec Section 8: "explicitly
 *     design for a long-lived pool").
 *   - Pool size is capped at available CPU cores with a ceiling for
 *     serverless environments (spec Section 5).
 *   - On exhaustion, tasks queue — never fall back to unguarded
 *     synchronous parsing (spec Section 6, edge case 10).
 *   - shutdown() must be called to clean up workers when the pool
 *     is no longer needed.
 *
 * @module lib/safety/workerPool
 */

import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of a task executed in the worker pool.
 *
 * Discriminated on `outcome`:
 *   - 'completed': the function returned successfully; `value` is present.
 *   - 'timeout': the worker was terminated after exceeding the time budget.
 *   - 'crashed': the worker encountered an unrecoverable error.
 */
export interface WorkerTaskResult<T> {
  readonly outcome: "completed" | "timeout" | "crashed";
  readonly value?: T;
  readonly errorDetail?: string;
}

/** Internal representation of a queued task. */
interface QueuedTask {
  readonly taskScript: string;
  readonly taskData: unknown;
  readonly timeoutMs: number;
  resolve: (result: WorkerTaskResult<unknown>) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum pool size for serverless environments where reported core count
 * may not reflect real allocation (spec Section 5).
 */
const MAX_POOL_SIZE = 4;

// ---------------------------------------------------------------------------
// Worker Pool
// ---------------------------------------------------------------------------

export class WorkerPool {
  private readonly poolSize: number;
  private readonly workers: Worker[] = [];
  private readonly available: Worker[] = [];
  private readonly taskQueue: QueuedTask[] = [];
  private isShutdown = false;

  /**
   * Create a new worker pool.
   *
   * @param maxWorkers - Override pool size (defaults to min(cpuCores, MAX_POOL_SIZE))
   */
  constructor(maxWorkers?: number) {
    this.poolSize = maxWorkers ?? Math.min(availableParallelism(), MAX_POOL_SIZE);
    for (let i = 0; i < this.poolSize; i++) {
      const worker = this.createWorker();
      this.workers.push(worker);
      this.available.push(worker);
    }
  }

  /**
   * Execute a task in the worker pool with a timeout budget.
   *
   * The task is defined by a script string that will be executed in
   * the worker context. The script receives `workerData` containing
   * the serialized `taskData`, and must post a message back with the
   * result using `parentPort.postMessage()`.
   *
   * If no worker is available, the task is queued (spec Section 6,
   * edge case 10: "Must degrade to queuing — never fall back to
   * unguarded synchronous parsing").
   *
   * @param taskScript - The code to execute in the worker (as a string
   *   evaluated via `new Worker(code, { eval: true })`)
   * @param taskData - Data passed to the worker via workerData (must
   *   be serializable via the structured clone algorithm)
   * @param timeoutMs - Maximum wall-clock time before termination
   * @returns A WorkerTaskResult — never throws
   */
  async runTask<T>(
    taskScript: string,
    taskData: unknown,
    timeoutMs: number,
  ): Promise<WorkerTaskResult<T>> {
    if (this.isShutdown) {
      return { outcome: "crashed", errorDetail: "Worker pool has been shut down" };
    }

    return new Promise<WorkerTaskResult<T>>((resolve) => {
      const task: QueuedTask = {
        taskScript,
        taskData,
        timeoutMs,
        resolve: resolve as (result: WorkerTaskResult<unknown>) => void,
      };

      const worker = this.available.pop();
      if (worker) {
        this.executeTask(worker, task);
      } else {
        // Queue the task — never fall back to unguarded execution
        this.taskQueue.push(task);
      }
    });
  }

  /**
   * Shut down all workers and reject any queued tasks.
   * Must be called when the pool is no longer needed to prevent
   * resource leaks.
   */
  async shutdown(): Promise<void> {
    this.isShutdown = true;

    // Reject all queued tasks
    for (const task of this.taskQueue) {
      task.resolve({ outcome: "crashed", errorDetail: "Worker pool shutdown" });
    }
    this.taskQueue.length = 0;

    // Terminate all workers
    const terminations = this.workers.map((w) => w.terminate());
    await Promise.allSettled(terminations);
    this.workers.length = 0;
    this.available.length = 0;
  }

  /** Current number of workers in the pool. */
  get size(): number {
    return this.poolSize;
  }

  /** Number of tasks waiting in the queue. */
  get queueLength(): number {
    return this.taskQueue.length;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Create a new generic worker that waits for task messages.
   *
   * The worker evaluates a task runner script that:
   *   1. Listens for a 'task' message containing the actual task code
   *   2. Evaluates the task code in a function scope
   *   3. Posts the result back to the parent
   *
   * This approach avoids creating a new Worker per task (expensive)
   * while still allowing arbitrary task code execution.
   */
  private createWorker(): Worker {
    const workerBootstrap = `
      const { parentPort, workerData } = require('node:worker_threads');

      parentPort.on('message', async (msg) => {
        if (msg.type === 'task') {
          try {
            // The task function receives the task data and returns a result
            const taskFn = new Function('taskData', 'require', msg.code);
            const result = await taskFn(msg.data, require);
            parentPort.postMessage({ type: 'result', value: result });
          } catch (err) {
            parentPort.postMessage({
              type: 'error',
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        }
      });
    `;

    return new Worker(workerBootstrap, { eval: true });
  }

  /**
   * Execute a task on a specific worker with timeout enforcement.
   */
  private executeTask(worker: Worker, task: QueuedTask): void {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout>;

    const settle = (result: WorkerTaskResult<unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      worker.removeAllListeners("message");
      worker.removeAllListeners("error");
      worker.removeAllListeners("exit");
      task.resolve(result);
    };

    // Set up the timeout — this is the actual enforcement mechanism.
    // On timeout, worker.terminate() is called — a real, OS-enforced
    // termination (spec Section 5).
    timeoutHandle = setTimeout(() => {
      if (!settled) {
        // Terminate the worker — this is the key correctness property.
        // Unlike Promise.race, this actually stops the CPU-bound work.
        worker.terminate().then(() => {
          // Replace the terminated worker with a fresh one
          const idx = this.workers.indexOf(worker);
          if (idx !== -1) {
            const replacement = this.createWorker();
            this.workers[idx] = replacement;
            this.returnWorker(replacement);
          }
        });
        settle({ outcome: "timeout" });
      }
    }, task.timeoutMs);

    // Listen for the task result
    const onMessage = (msg: { type: string; value?: unknown; detail?: string }) => {
      if (msg.type === "result") {
        settle({ outcome: "completed", value: msg.value });
        this.returnWorker(worker);
      } else if (msg.type === "error") {
        settle({ outcome: "crashed", errorDetail: msg.detail });
        this.returnWorker(worker);
      }
    };

    // Handle worker crashes (spec Section 6, edge case 6):
    // "A worker crash (including a native stack overflow) must be caught
    // via the worker's exit/error event, not just its resolved value."
    const onError = (err: Error) => {
      settle({ outcome: "crashed", errorDetail: err.message });
      // Replace the crashed worker
      const idx = this.workers.indexOf(worker);
      if (idx !== -1) {
        const replacement = this.createWorker();
        this.workers[idx] = replacement;
        this.returnWorker(replacement);
      }
    };

    const onExit = (code: number) => {
      if (!settled) {
        settle({
          outcome: "crashed",
          errorDetail: `Worker exited unexpectedly with code ${code}`,
        });
        // Replace the exited worker
        const idx = this.workers.indexOf(worker);
        if (idx !== -1) {
          const replacement = this.createWorker();
          this.workers[idx] = replacement;
          this.returnWorker(replacement);
        }
      }
    };

    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);

    // Send the task to the worker
    worker.postMessage({
      type: "task",
      code: task.taskScript,
      data: task.taskData,
    });
  }

  /**
   * Return a worker to the available pool and process the next
   * queued task if one exists.
   */
  private returnWorker(worker: Worker): void {
    if (this.isShutdown) return;

    const nextTask = this.taskQueue.shift();
    if (nextTask) {
      this.executeTask(worker, nextTask);
    } else {
      this.available.push(worker);
    }
  }
}
