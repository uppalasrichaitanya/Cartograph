# Cartograph — Technical Specification Priorities

Which components deserve a dedicated design document before implementation, ranked by
priority and complexity, with a recommended design order. Components explicitly excluded
are listed at the end, with reasoning — the goal is design effort proportional to actual
risk, not uniform coverage.

---

## Priority / complexity matrix

| # | Component | Complexity | Priority | Blocks |
|---|---|---|---|---|
| 1 | IR & Identity Model | Medium | Critical | Milestone 1 |
| 2 | Extraction Safety & Input Hardening | Medium (edge-case heavy) | Critical | Milestone 1 |
| 3 | Performance & Benchmarking Framework | Low | High | All milestones (DoD enforcement) |
| 4 | Parser Plugin Interface & Registry | Medium-High | Critical | Milestone 2 |
| 5 | Conformance Test Framework | Low-Medium | High | Milestone 3 |
| 6 | Analyzer Framework | Medium | High | Milestone 4 |
| 7 | Python Parser (validation implementation) | High | High | Milestone 3 |
| 8 | Architecture Model | Medium | Medium | Milestone 5 |
| 9 | Query Engine | High | Medium-High | Milestone 7 (design earlier) |
| 10 | AI Query Layer | High (trust-critical) | Medium | Milestone 8 |

---

## 1. IR & Identity Model

**Why it deserves a spec:** Every other component reads or writes this shape. A mistake here
propagates into every parser, analyzer, the Architecture Model, and eventually the AI layer.
It is also the component hardest to change once data exists in production.

**Responsibility:** Defines the canonical `SourceFileAnalysis`/`ExtractionResult` schema,
node/edge identity, the containment-vs-dependency edge split, the provenance value type
(`verified` / `derived` / `heuristic` / `user-defined` / `ai-interpretation`), and the
`irVersion` field and compatibility policy.

**Technical challenges and edge cases:** ID stability across re-uploads of "the same" repo;
what makes an ID stable when a file is renamed or moved; how containment edges behave for
files that don't cleanly belong to one module root; provenance propagation rule enforcement
(a value touched by any heuristic input becomes heuristic, never silently upgrades).

**Algorithms/data structures:** Deterministic ID derivation (path + root fingerprint, not
random UUIDs); a typed edge model with a `kind` discriminant.

**Key interfaces first:** The `SourceFileAnalysis` / `ExtractionResult` TypeScript types; the
`Provenance` type; the containment-edge and dependency-edge shapes as distinct types.

**Expected interactions:** Consumed by every parser (produces it), every analyzer (reads it),
the Architecture Model (indexes it), the Query Engine (serves it), and eventually the AI layer
(cites it).

**Performance/scalability:** Schema size directly drives stored-blob size and, later,
query-engine indexing cost — keep it lean; no raw source text, only position references.

**Common pitfalls:** Treating `filePath` as identity (breaks on rename); adding fields that
aren't optional (breaks the additive-only versioning policy); conflating containment and
dependency semantics in one edge type.

**Testing strategy:** Schema validation tests; determinism tests (same input → identical IDs
across runs); a specific test asserting provenance never silently upgrades.

**Blocker status:** Yes — blocks Milestone 1 entirely.

---

## 2. Extraction Safety & Input Hardening

**Why it deserves a spec:** Currently undesigned despite being security-critical. The existing
`safeUnzip.ts` covers aggregate limits; nothing yet covers adversarial single-file input, and
this is a live gap in the current codebase, not just future risk.

**Responsibility:** Defend against zip-slip/path traversal during extraction, and against
pathological individual files (deeply nested structures, extreme line lengths) that could
crash or hang a parser regardless of aggregate repo size staying within limits.

**Technical challenges and edge cases:** Symlink-based traversal; archives with conflicting
or malicious relative paths; a single file within limits that still causes catastrophic
parser backtracking (relevant for both the TS compiler API and tree-sitter).

**Algorithms/data structures:** Path canonicalization and containment checks
(resolved-path-must-be-within-root validation); per-file timeout/step budgets during parsing.

**Key interfaces first:** A `validateExtractedPath()` utility used uniformly by all extraction
code; a per-file resource budget passed into every parser's `parseFile()` call.

**Expected interactions:** Sits between unzip and the parser registry; every parser must
respect the same per-file budget, regardless of language.

**Performance/scalability:** Must add negligible overhead to the common case (well-formed
files) while reliably bounding the worst case.

**Common pitfalls:** Validating paths before symlink resolution instead of after; setting
per-file timeouts too generously to "be safe," which defeats the point.

**Testing strategy:** A dedicated adversarial-input fixture set (malicious zip paths,
pathological source files) run in CI; must-fail-safely tests, not just must-succeed tests.

**Blocker status:** Yes — should land in Milestone 1 alongside the identity/safety hardening
already scoped there.

---

## 3. Performance & Benchmarking Framework

**Why it deserves a spec:** Every other milestone's Definition of Done references "benchmark
against budgets" — that's not enforceable without one shared measurement framework and fixture
set. Building it once, early, prevents ten milestones from each inventing their own ad hoc
benchmarking approach.

**Responsibility:** Defines the fixture repos (by size tier), the harness that runs
analysis/query/AI operations against them, and how results are recorded and compared against
the budgets already defined in the roadmap.

**Technical challenges and edge cases:** Keeping fixture repos representative without them
becoming stale or unrealistic; separating "budget regression" from "legitimate trade-off"
in CI without excessive false alarms.

**Algorithms/data structures:** None novel — this is an engineering-practice component, not an
algorithmic one.

**Key interfaces first:** A `runBenchmark(operation, fixtureTier)` harness; a results-recording
format that later milestones' CI can reference.

**Expected interactions:** Used by every subsequent milestone's Definition of Done.

**Performance/scalability:** N/A to itself — it measures others.

**Common pitfalls:** Treating this as a "nice to have" and building it reactively once a
performance problem already exists, at which point there's no baseline to compare against.

**Testing strategy:** The framework itself needs tests confirming its measurements are stable
run-to-run (a benchmarking framework with noisy measurements is worse than none).

**Blocker status:** Not a hard blocker for any single milestone, but should exist before
Milestone 1 closes so every subsequent DoD has something real to reference.

---

## 4. Parser Plugin Interface & Registry

**Why it deserves a spec:** This is the seam the entire multi-language vision depends on. It
is also the component with the least room for error — a shape mistake here is invisible with
one language and expensive with three.

**Responsibility:** Defines `LanguageParser`, the capability-flag model, `initialize()`
semantics for multi-root resolution, and the registry's lazy-loading behavior.

**Technical challenges and edge cases:** Multi-root resolution (multiple `go.mod`/
`pyproject.toml`/`package.json` in one repo); extension collisions across languages (`.h`
shared by C/C++); capability degradation when a parser can't fulfill what an analyzer expects.

**Algorithms/data structures:** Extension → parser dispatch table; capability set (bitset or
`Set<Capability>`) per parser and per file.

**Key interfaces first:** `LanguageParser` interface; `Capability` enum (minimal — imports,
exports, to start); `ParserRegistry.get(extension)` and lazy-load semantics.

**Expected interactions:** Consumes nothing; produces `ExtractionResult` per the IR spec;
consumed by the orchestration layer (`analyzeRepository.ts`) and later by the Conformance Test
Framework.

**Performance/scalability:** Cold-start cost is proportional to eagerly-loaded parsers — lazy
loading is not optional at scale.

**Common pitfalls:** Designing the interface around TypeScript's specific needs before a
second language exists to stress-test it (mitigated by writing this spec before, not during,
TS migration).

**Testing strategy:** Interface-level contract tests independent of any specific language
implementation; a synthetic "minimal fake parser" used to test the registry in isolation.

**Blocker status:** Yes — blocks Milestone 2.

---

## 5. Conformance Test Framework

**Why it deserves a spec:** Cross-cutting infrastructure used by every parser and analyzer
going forward. Deciding the fixture format and assertion model once, before Python exists,
avoids each new language inventing its own ad hoc test approach.

**Responsibility:** Defines fixture repo format, expected-output format
(`SourceFileAnalysis` golden files), and the assertion model every parser and analyzer plugin
must pass.

**Technical challenges and edge cases:** Capturing "acceptable variance" for heuristic/
lower-confidence outputs without the suite becoming either too strict (blocks legitimate
language differences) or too loose (misses real regressions).

**Algorithms/data structures:** Golden-file diffing; a shared fixture repo registry.

**Key interfaces first:** `ConformanceFixture` format; `runConformanceSuite(parser, fixtures)`
entry point.

**Expected interactions:** Runs against every `LanguageParser` and, later, every `Analyzer`
implementation.

**Performance/scalability:** Needs to run fast enough for CI on every PR — keep fixtures
representative but not exhaustive.

**Common pitfalls:** Building this reactively after Python instead of before — the entire
point is catching Python's edge cases against a framework designed before those edge cases
are known.

**Testing strategy:** Self-referential — the framework's own correctness is validated by
intentionally broken fixture parsers that should fail the suite.

**Blocker status:** Should exist before Milestone 3 (Python) begins.

---

## 6. Analyzer Framework

**Status:** Implemented in Milestone 5. The shipped contract uses two ordered tiers,
capability-aware skip/degrade behavior, explicit earlier-tier dependencies, provenance-bearing
execution summaries, and `AnalysisContext.getResult()`.

**Why it deserves a spec:** Symmetric in importance to the parser registry, but on the output
side — the same "get this wrong once, pay for it three times" risk applies.

**Responsibility:** Defines the `Analyzer` interface, tiered (not DAG) execution order, the
context object that lets tier-2 analyzers read tier-1 output, and how capability-flag checks
cause an analyzer to skip or degrade.

**Technical challenges and edge cases:** Designing degradation behavior for a capability gap
that doesn't exist yet in any real language (TS and Python both have similar capabilities) —
this has to be deliberately tested with a synthetic low-capability fixture, not just assumed
correct.

**Algorithms/data structures:** Ordered execution list; a `context.getResult(analyzerId)`
lookup shaped so a real DAG scheduler could replace it later without changing the plugin
contract.

**Key interfaces first:** `Analyzer` interface; `AnalysisContext`; the tier-1/tier-2 ordering
contract.

**Expected interactions:** Consumes the IR/graph and, for tier-2, other analyzers' output;
produces `AnalysisView` objects consumed by the UI and eventually the Query Engine.

**Performance/scalability:** Analyzer execution time scales with graph size — needs its own
benchmark tier once graphs get large (thousands of edges, per the existing elkjs concern).

**Common pitfalls:** Building the general DAG scheduler now instead of the simpler ordered
model — explicitly out of scope until real duplicated-logic pain is observed.

**Testing strategy:** Contract tests independent of specific analyzers; the deliberate
capability-degradation fixture mentioned above.

**Blocker status:** Delivered in Milestone 5.

---

## 7. Python Parser (validation implementation)

**Why it deserves a spec:** Not because Python itself is architecturally novel, but because
this is the actual test of the Parser Interface — and Python's resolution model (relative
imports, namespace packages, `sys.path`) is complex enough to genuinely stress it.

**Responsibility:** Tier-1 import/export extraction via tree-sitter WASM; multi-root
discovery for Python-specific project layouts.

**Technical challenges and edge cases:** Relative imports (`from . import x`); implicit
namespace packages (no `__init__.py`); conditional imports (`TYPE_CHECKING` guards, `try`/
`except ImportError` fallbacks) and a documented decision on which of these "count."

**Algorithms/data structures:** tree-sitter query patterns for import statement extraction;
a Python-specific module-path resolver.

**Key interfaces first:** Implements `LanguageParser` from Component 4 — no new interfaces of
its own, by design.

**Expected interactions:** Registered in the Parser Registry; validated by the Conformance
Test Framework; consumed identically to the TS parser by everything downstream.

**Performance/scalability:** tree-sitter WASM cold-start cost specifically — benchmark
against the framework in Component 3 before committing to full rollout.

**Common pitfalls:** Silently deciding import-counting edge cases ad hoc instead of
documenting them (the same decisions will need re-litigating for every future language
otherwise).

**Testing strategy:** Conformance suite (Component 5) fixtures covering the edge cases above;
manual verification against 3–5 real open-source repos.

**Blocker status:** Yes — is Milestone 3 itself, and is the checkpoint that validates or
invalidates the whole parser abstraction.

---

## 8. Architecture Model

**Status:** Implemented in Milestone 6. The shipped model indexes module roots, folder
hierarchy, and deterministic display regions over canonical IR node IDs. Heuristic
layers/domains remain deferred.

**Why it deserves a spec:** A genuinely new abstraction (not a refactor of existing code), and
one other future analyzers will build directly on top of — worth getting the shape right
before anything depends on it.

**Responsibility:** A grouping/boundary index over existing node IDs (module roots, folder
containment) — deterministic only, at this stage; heuristic layers/domains are explicitly
out of scope until Milestone 10.

**Technical challenges and edge cases:** Representing a boundary that doesn't map cleanly to
folder structure (rare at the deterministic tier, but the schema should not preclude it later);
migrating at least one existing UI consumer onto it without behavior change, as proof it's
actually useful.

**Algorithms/data structures:** A boundary record type: `{id, kind, containedNodeIds,
provenance}`; built from containment edges already in the IR.

**Key interfaces first:** `ArchitectureModel.getBoundary(id)` / `getContainingBoundaries(nodeId)`.

**Expected interactions:** Reads containment edges from the IR; read by analyzers and UI;
future heuristic analyzers (Milestone 10) will populate additional boundary records into the
same structure.

**Performance/scalability:** Should be cheap — it's an index over data that already exists,
not new computation.

**Common pitfalls:** Building heuristic inference alongside this despite the roadmap
explicitly deferring it — the discipline here is deterministic-only, full stop, for this spec.

**Testing strategy:** Equivalence tests against the old ad hoc folder-grouping logic it
replaces; provenance-tagging tests.

**Blocker status:** Delivered in Milestone 6.

---

## 9. Query Engine

**Why it deserves a spec — and why now, ahead of its own milestone:** Identified repeatedly as
the most likely 2–3 year bottleneck. The risk isn't the Milestone 7 implementation — it's
Components 6 and 8 (Analyzer Framework, Architecture Model) being built without this interface
in mind, and needing rework once the Query Engine's real shape is known. Draft this spec
early; implement it at Milestone 7.

**Responsibility:** The sole sanctioned read path into the graph — `getNode`, `getNeighbors`,
`findCycles`, `computeImpact` — decoupled from whatever storage backend sits behind it.

**Technical challenges and edge cases:** Query patterns needed by the AI layer aren't fully
known yet at design time — this spec should be validated against the planned AI tool list
(Component 10) before being finalized, not designed in isolation.

**Algorithms/data structures:** Graph traversal algorithms (BFS/DFS for reachability and
impact); an indexing structure sufficient to avoid full-blob deserialization per query.

**Key interfaces first:** The query function signatures themselves — these become the contract
every future consumer (UI, analyzers, AI) is written against, so they matter more than the
backend implementation behind them.

**Expected interactions:** Sits between storage and every consumer; the Architecture Model and
Analyzer Framework should be written assuming this interface exists, even before it's
implemented.

**Performance/scalability:** The component most directly tied to the performance budgets
(p95 < 200ms point queries, < 2s traversals) — needs real benchmark data from Component 3
before finalizing the backend choice.

**Common pitfalls:** Designing the query API to match today's blob-storage reality instead of
the eventual indexed backend — this locks in the wrong abstraction exactly where flexibility
matters most.

**Testing strategy:** Contract tests against the interface, runnable against both the interim
blob-backed implementation and any prototype indexed backend, to confirm swapping backends
doesn't change query semantics.

**Blocker status:** Not a hard blocker until Milestone 7, but the spec should be drafted well
before Milestone 5 so downstream components aren't designed blind to it.

---

## 10. AI Query Layer

**Why it deserves a spec:** The first non-deterministic component in the system, and the one
place the entire "verified facts" philosophy is most at risk of quietly eroding. Deserves the
most scrutiny of any component here, even though it's built last.

**Responsibility:** Tool-use-based, read-only reasoning over the Query Engine; every AI
statement must be traceable to a specific cited fact.

**Technical challenges and edge cases:** Behavior when a query returns empty or ambiguous
results (must say "no verified data," never fill the gap); cost/latency from multi-turn tool
calls on large graphs; adversarial prompts specifically designed to elicit ungrounded claims.

**Algorithms/data structures:** Tool definitions mapped 1:1 to Query Engine functions; a
citation-validation pass that checks every referenced ID actually exists in the graph before
a response is considered valid.

**Key interfaces first:** The tool schema itself (one tool per Query Engine function, no
more); the citation-validation function, designed and tested before any AI prompt work begins.

**Expected interactions:** Exclusively reads through the Query Engine (Component 9) — no
direct storage or IR access; UI surfaces its output with explicit provenance labeling.

**Performance/scalability:** Latency budget (< 10–15s typical) depends heavily on caching
common queries (top god modules, cycle list) so routine questions don't require full tool-call
chains every time.

**Common pitfalls:** Treating prompt instructions ("only cite real facts") as sufficient
instead of building the automated citation-validation check — this is the single most
important thing to get right in this component, and it's an engineering control, not a
prompting one.

**Testing strategy:** Adversarial prompt suite specifically trying to elicit ungrounded
claims; citation-validation unit tests; latency/cost benchmarking against Component 3.

**Blocker status:** Yes — blocks Milestone 8, and should not begin until Components 1, 9, and
the Milestone 3 conformance validation are all solid.

---

## Explicitly excluded from dedicated specs

- **TypeScript Parser** — existing, proven implementation. Needs a migration checklist against
  the Parser Plugin Interface spec (Component 4), not a new design document.
- **Future language parsers beyond Python** (Go, Java, Rust, C#, C/C++) — follow a lightweight
  template distilled from the Python Parser spec (Component 7) plus the Conformance Test
  Framework (Component 5). A full spec per language is exactly the over-design this exercise
  is meant to avoid.
- **Heuristic Architecture Views** (Milestone 9 layering/domain inference) — deliberately
  deferred in the roadmap until real usage data exists; designing it now would be speculative.
- **Third-party plugin ecosystem** — out of scope per the roadmap unless it becomes a confirmed
  product goal; not worth spec effort until then.

---

## Recommended design order

Sequential dependencies first, parallelizable work noted explicitly:

1. **IR & Identity Model** — everything else depends on this.
2. **Extraction Safety & Input Hardening** — can be designed in parallel with #1 by a
   different contributor; both are needed before Milestone 1 closes.
3. **Performance & Benchmarking Framework** — lightweight; get it scaffolded early so every
   later spec defines its budget within an existing framework instead of inventing one.
4. **Parser Plugin Interface & Registry** — depends on the IR shape from #1.
5. **Conformance Test Framework** — depends on the parser interface from #4; must exist
   before Python work starts.
6. **Analyzer Framework** and **7. Python Parser** — independent of each other, both depend
   only on #1 and #4. Design in parallel if you have the bandwidth; sequentially otherwise,
   in either order.
8. **Architecture Model** — depends on the containment edges from #1 and the analyzer shape
   from #6.
9. **Query Engine** — draft the interface now, informed by #8, even though implementation
   waits for Milestone 7 — this is the one spec deliberately sequenced ahead of its own
   implementation milestone, specifically so #6 and #8 aren't built blind to it.
10. **AI Query Layer** — designed last, and validated against #9's actual interface rather
    than a guess at what it might look like.
