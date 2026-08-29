# Cartograph Roadmap Next Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record Cartograph's implemented milestone state accurately, then complete Milestone 4 by moving existing graph, clustering, and structural-observation computations behind a minimal ordered analyzer framework without changing user-visible results.

**Architecture:** Keep parsers responsible only for extraction and import resolution. Introduce analyzers as deterministic consumers of validated extraction/IR data, executed in two ordered tiers: tier 1 builds the dependency graph; tier 2 consumes that graph to produce clusters and observations. Preserve the current `AnalysisResult` contract during this milestone so the frontend and persisted analyses remain backward compatible.

**Tech Stack:** Next.js 16, TypeScript 5, Node test runner through `tsx --test`, existing Repository IR and parser capability types.

**Spec:** `docs/engineering-roadmap.md`, Milestone 4 - Analyzer Plugin Framework.

## Global Constraints

- No UI or persisted `AnalysisResult` shape changes in Milestone 4.
- Analyzer execution is ordered by numeric tier; do not build a DAG scheduler.
- Analyzer outputs are deterministic for identical input.
- Capability shortfalls produce an explicit `skipped` or `degraded` result, never silent omission.
- Existing `buildGraph`, `clusterByFolder`, and `detectAnomalies` behavior remains byte-for-byte compatible at their public boundaries.
- Every production change follows a failing-test-first cycle.

---

### Task 1: Publish The Current Milestone Status

**Files:**
- Create: `docs/project-status.md`
- Modify: `README.md`
- Modify: `docs/engineering-roadmap.md`

**Interfaces:**
- Consumes: current repository modules and verification commands.
- Produces: one canonical status page linked from the README and milestone overview.

- [ ] **Step 1: Write the status document**

Document Milestones 1-3 as implemented, Milestone 4 as next, and Milestones 5-10 as planned. For each completed milestone, link the concrete modules and tests that prove it.

- [ ] **Step 2: Add verification evidence**

Record the supported languages, storage modes, safety limits, and the commands that define release readiness:

```text
npm test
npm run lint
npm run build
npm audit --omit=dev
```

- [ ] **Step 3: Link the status page**

Add a short `Project status` link near the README roadmap/project-layout material and mark Milestones 1-3 completed in the roadmap overview without rewriting the milestone specifications.

- [ ] **Step 4: Review documentation consistency**

Check that README claims, status claims, and roadmap states do not contradict the implemented language support or storage behavior.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/project-status.md docs/engineering-roadmap.md
git commit -m "docs: record implemented roadmap status"
```

---

### Task 2: Define The Analyzer Contract

**Files:**
- Create: `lib/analysis/analyzers/interface.ts`
- Test: `tests/analyzers/interface.test.ts`

**Interfaces:**
- Consumes: `RawExtraction`, `RepositoryIR`, `ParserCapability`, `DependencyGraph`, `Cluster`, and `Anomalies`.
- Produces: `Analyzer`, `AnalyzerContext`, `AnalyzerExecution`, and `AnalyzerStatus`.

- [ ] **Step 1: Write failing contract tests**

Test that analyzer IDs are unique strings, tiers are positive integers, requirements are expressed as parser capabilities, and every execution result carries one of these explicit states:

```ts
export type AnalyzerStatus =
  | { readonly state: "completed" }
  | { readonly state: "degraded"; readonly reason: string }
  | { readonly state: "skipped"; readonly reason: string };
```

- [ ] **Step 2: Run the contract test and confirm failure**

Run:

```bash
npx tsx --test tests/analyzers/interface.test.ts
```

Expected: failure because `lib/analysis/analyzers/interface.ts` does not exist.

- [ ] **Step 3: Implement the minimal types**

Define a context that exposes immutable extraction/IR inputs and completed analyzer outputs:

```ts
export interface AnalyzerContext {
  readonly extractions: ReadonlyArray<RawExtraction>;
  readonly repositoryIR: RepositoryIR | null;
  readonly capabilities: ReadonlySet<ParserCapability>;
  readonly outputs: ReadonlyMap<string, unknown>;
}

export interface Analyzer<T> {
  readonly id: string;
  readonly tier: number;
  readonly requiredCapabilities: ReadonlySet<ParserCapability>;
  analyze(context: AnalyzerContext): Promise<AnalyzerExecution<T>> | AnalyzerExecution<T>;
}
```

- [ ] **Step 4: Run the contract test**

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/analysis/analyzers/interface.ts tests/analyzers/interface.test.ts
git commit -m "feat: define analyzer plugin contract"
```

---

### Task 3: Implement Ordered Analyzer Registration And Execution

**Files:**
- Create: `lib/analysis/analyzers/registry.ts`
- Test: `tests/analyzers/registry.test.ts`

**Interfaces:**
- Consumes: `Analyzer<T>` from Task 2.
- Produces: `AnalyzerRegistry.register()` and `AnalyzerRegistry.run()`.

- [ ] **Step 1: Write failing registry tests**

Cover duplicate-ID rejection, tier ordering independent of registration order, tier-2 access to tier-1 outputs, and deterministic execution ordering.

- [ ] **Step 2: Write failing capability tests**

Register one analyzer requiring `imports` and another requiring `exports`. Supply only `imports`; assert that the first completes and the second returns an explicit skipped result with its missing capability named.

- [ ] **Step 3: Run the registry tests and confirm failure**

```bash
npx tsx --test tests/analyzers/registry.test.ts
```

- [ ] **Step 4: Implement the registry**

Use a `Map<string, Analyzer<unknown>>` for registration, sort a copied analyzer array by `tier` then `id`, and create a fresh immutable output map after every execution. Do not permit an analyzer to mutate prior outputs.

- [ ] **Step 5: Run registry tests**

Expected: all registry and capability tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/analysis/analyzers/registry.ts tests/analyzers/registry.test.ts
git commit -m "feat: run analyzers in ordered tiers"
```

---

### Task 4: Adapt Existing Graph, Cluster, And Observation Logic

**Files:**
- Create: `lib/analysis/analyzers/dependencyGraph.ts`
- Create: `lib/analysis/analyzers/folderClusters.ts`
- Create: `lib/analysis/analyzers/structuralObservations.ts`
- Modify: `lib/analysis/buildGraph.ts`
- Modify: `lib/analysis/clusterByFolder.ts`
- Modify: `lib/analysis/detectAnomalies.ts`
- Test: `tests/analyzers/builtins.test.ts`

**Interfaces:**
- Consumes: analyzer registry and current pure analysis functions.
- Produces analyzer IDs `dependency-graph`, `folder-clusters`, and `structural-observations`.

- [ ] **Step 1: Write parity tests against current outputs**

For representative TypeScript and Python extractions, compute the current graph/clusters/anomalies and assert the built-in analyzers return deeply equal values.

- [ ] **Step 2: Run parity tests and confirm failure**

Expected: built-in analyzer modules do not exist.

- [ ] **Step 3: Implement thin analyzer adapters**

Keep the existing pure functions as the behavior owners. The adapters should only read context, invoke the existing function, and return status/output. Set tiers as:

```text
dependency-graph: tier 1
folder-clusters: tier 2
structural-observations: tier 2
```

- [ ] **Step 4: Add explicit output lookup helpers**

Provide typed helpers for reading the dependency graph from completed outputs so tier-2 analyzers do not scatter string casts.

- [ ] **Step 5: Run parity and existing analysis tests**

```bash
npx tsx --test tests/analyzers/builtins.test.ts tests/analysis.test.ts tests/workspace/observations.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/analysis/analyzers lib/analysis/buildGraph.ts lib/analysis/clusterByFolder.ts lib/analysis/detectAnomalies.ts tests/analyzers/builtins.test.ts
git commit -m "feat: expose existing analyses as plugins"
```

---

### Task 5: Integrate The Analyzer Registry Into Repository Analysis

**Files:**
- Modify: `lib/analysis/analyzeRepository.ts`
- Test: `tests/analyzers/integration.test.ts`

**Interfaces:**
- Consumes: built-in analyzers from Task 4.
- Produces: the same `AnalysisResult.graph`, `clusters`, and `anomalies` fields currently persisted and rendered.

- [ ] **Step 1: Write a failing end-to-end parity test**

Run a small repository through the pre-integration pure-function pipeline and through the registry-driven pipeline, excluding random analysis ID/timestamps, and assert equal graph, clusters, observations, render data inputs, and repository metadata counts.

- [ ] **Step 2: Run the integration test and confirm failure**

Expected: `analyzeRepository` still invokes the pure functions directly.

- [ ] **Step 3: Register and execute built-ins**

Build the analyzer context after extraction and IR construction, derive the available capability set from all extractions, execute the registry, and read the three required outputs. Treat a missing built-in output as an internal `AnalysisError`, not as user input failure.

- [ ] **Step 4: Preserve progress reporting**

Keep the existing user-visible phases and details (`clustering`, `detecting`) even though their implementation now runs through the registry.

- [ ] **Step 5: Run integration and determinism tests**

```bash
npx tsx --test tests/analyzers/integration.test.ts tests/ir/determinism.test.ts tests/ir/integration.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/analysis/analyzeRepository.ts tests/analyzers/integration.test.ts
git commit -m "refactor: execute repository analyses through registry"
```

---

### Task 6: Prove Graceful Capability Degradation

**Files:**
- Create: `tests/analyzers/capabilityDegradation.test.ts`
- Modify: `lib/analysis/analyzers/registry.ts`
- Modify: built-in analyzer files only if the test reveals a missing degradation rule.

**Interfaces:**
- Consumes: parser capability sets and analyzer requirements.
- Produces: observable skipped/degraded analyzer records suitable for future UI/query consumers.

- [ ] **Step 1: Create an asymmetric parser fixture**

Use a test parser that reports `imports` but not `exports`, alongside a test analyzer requiring each capability.

- [ ] **Step 2: Assert honest degradation**

Verify missing capabilities cannot produce a completed result, skipped analyzers name the missing capabilities, completed analyzers still run, and downstream analyzers can distinguish absent output from an empty output.

- [ ] **Step 3: Run the test and implement the minimal correction**

```bash
npx tsx --test tests/analyzers/capabilityDegradation.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/analyzers/capabilityDegradation.test.ts lib/analysis/analyzers
git commit -m "test: prove analyzer capability degradation"
```

---

### Task 7: Benchmark And Release-Gate Milestone 4

**Files:**
- Create: `tests/analyzers/benchmark.ts`
- Modify: `docs/project-status.md`

**Interfaces:**
- Consumes: largest existing fixture or a generated deterministic graph.
- Produces: recorded runtime/memory baseline and a completed Milestone 4 status entry.

- [ ] **Step 1: Add a repeatable benchmark harness**

Measure registry overhead separately from parser and layout time. Run enough iterations to report median analyzer time; do not add a brittle pass/fail timing threshold to the normal test suite.

- [ ] **Step 2: Run complete verification**

```bash
npm test
npm run lint
npm run build
npm audit --omit=dev
```

- [ ] **Step 3: Run TypeScript and Python browser smoke tests**

Exercise upload, streamed progress, repository redirect, folder drill-down, file selection, and inspector rendering for both languages.

- [ ] **Step 4: Update project status**

Mark Milestone 4 complete only after parity, degradation, determinism, production build, audit, and browser smoke checks pass.

- [ ] **Step 5: Commit**

```bash
git add tests/analyzers/benchmark.ts docs/project-status.md
git commit -m "docs: close analyzer framework milestone"
```

---

## Review Notes

This plan deliberately stops after Milestone 4. Milestone 5 should get a separate design and plan because it changes the architecture model shared by future analyzers, query consumers, and eventually AI. Starting it inside this refactor would make parity failures difficult to attribute and would remove the clean rollback boundary after the analyzer framework.

The main review decision is whether skipped/degraded analyzer execution records should remain internal during Milestone 4, as proposed, or be added immediately to persisted `AnalysisResult`. The recommendation is to keep them internal until Milestone 7 defines the stable query/storage contract; persisting them now would create a public schema before there is a consumer.
