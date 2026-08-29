# Cartograph Engineering Roadmap

This roadmap turns the architecture and philosophy established in design review into an
implementation sequence. It is organized as **architectural milestones**, not a feature
checklist. Each milestone must leave the application fully functional and must be validated
before the next one begins.

**Running practice across every milestone:** golden-file / determinism tests (same input →
identical output) are added alongside any change that touches extraction, graph construction,
or storage — not bolted on at the end.

---

## Milestone overview

| # | Milestone | One-line goal |
|---|---|---|
| 1 | Foundation Hardening | Harden and re-key the existing TS-only pipeline before anything else changes |
| 2 | Parser Plugin Architecture & TS Migration | Extract TS logic behind `LanguageParser`, zero behavior change |
| 3 | Python Parser & Two-Language Validation | Prove the abstraction with a structurally different language |
| 4 | Verified Symbol Foundations | Index parser-observed named declarations before relationship analyzers |
| 5 | Analyzer Plugin Framework | Formalize existing analyses as tiered, capability-aware plugins |
| 6 | Architecture Model Foundations | Deterministic containment/boundary index, shared across analyzers |
| 7 | Third Language & Capability Stress Test | Prove graceful degradation under real asymmetry (Go/Java-class complexity) |
| 8 | Query Layer & Storage Evolution | Stable query API; prototype indexed storage before AI needs it |
| 9 | AI Reasoning Layer | Strictly grounded, citation-backed, read-only AI over the query API |
| 10 | Heuristic Architecture Views | First opinionated analyzers (layers/domains), fully provenance-tagged |
| 11 | Platform Hardening | Background execution, observability, re-upload identity - conditional, not scheduled |

---

## Milestone 1 — Foundation Hardening

**Objective:** Harden and re-key the existing TS-only pipeline so it can safely support
identity, versioning, and security decisions every later milestone depends on — with zero
change to user-visible behavior.

**Why this phase exists:** Every later milestone inherits whatever identity/versioning/security
model exists here. Retrofitting these after multiple parsers and analyzers exist is a
cross-cutting rewrite; doing it now touches a single language's pipeline.

**Components/modules affected:** `safeUnzip.ts`, `discoverFiles.ts`, `extractImports.ts`,
`buildGraph.ts`, storage layer, `tests/`.

**Expected architectural outcome:** Same TS/JS functionality, now backed by stable opaque
node/edge IDs; a versioned IR schema (`irVersion: 1`) with minimal `confidence` /
`parseErrors` fields (populated by TS only, for now); containment edges (file → folder → root)
modeled separately from dependency edges (file imports file); hardened extraction limits
(per-file size/complexity caps, zip-slip/path-traversal protection).

**Risks and mitigation:**
- *Identity refactor silently changes graph shape* → capture golden-file snapshots before
  refactoring, diff after.
- *Scope creep into multi-language interface work* → explicitly time-boxed to TS-only; no
  registry, no `LanguageParser` interface yet.

**Validation strategy:** Existing test suite passes with identical outcomes; new
determinism tests (same zip, repeated runs, byte-identical graph); adversarial-input tests for
zip-slip and pathological single-file inputs.

**Exit criteria:** All existing features behave identically to users; IDs, versioning, and
security land with zero regressions; determinism suite is green in CI.

---

## Milestone 2 — Parser Plugin Architecture & TS Migration

**Objective:** Extract TypeScript-specific extraction logic behind the `LanguageParser`
interface and a lazy-loaded registry, with zero behavior change.

**Why this phase exists:** This is the actual abstraction the multi-language vision depends
on. Every later milestone assumes this seam is real — it is the highest-risk phase to
under-validate.

**Components/modules affected:** new `lib/analysis/parsers/interface.ts`,
`lib/analysis/parsers/registry.ts`, `lib/analysis/parsers/typescript/*`; `extractImports.ts`
deleted and replaced by `extractAll.ts`; `resolveAliases.ts` moved inside the TS parser;
`analyzeRepository.ts` updated to orchestrate via the registry.

**Expected architectural outcome:** TS/JS parsing is identical in output but now runs through
the general parser interface; the registry lazy-loads parsers by detected extension;
`ExtractionResult` carries real confidence/error data from TS diagnostics, not placeholder
values.

**Risks and mitigation:**
- *Interface shape gets designed around TS specifics and doesn't generalize* → write the
  interface spec first, implement against it second; resist letting existing TS code dictate
  the interface.
- *Added indirection regresses performance* → benchmark before/after on the largest fixture
  repo.

**Validation strategy:** Full existing test suite unchanged in outcome; new parser-conformance
fixture suite (TS-only entries for now) that any future parser must also pass; performance
benchmark comparison.

**Exit criteria:** Application behaves identically to end users; TS is a plugin, not
special-cased code; the conformance fixture suite exists and passes.

> **Pause and evaluate.** Before writing any Python-specific code: does the interface
> genuinely feel general, or would implementing a second parser require touching it again?
> Fix the interface now if it's in doubt — not after Python exists.

---

## Milestone 3 — Python Parser & Two-Language Validation

**Objective:** Implement the Python parser (tier 1 only — imports/exports, tree-sitter
WASM-based) and prove the architecture holds under a second, structurally different language.

**Why this phase exists:** This is the actual test of everything designed so far. A
single-language interface can look correct and still be wrong; two languages is the minimum
to find out.

**Components/modules affected:** new `lib/analysis/parsers/python/*`, registry, multi-root
discovery logic (Python's relative imports and namespace packages will exercise this
immediately), conformance fixture suite (Python fixtures added).

**Expected architectural outcome:** Mixed TS+Python repos analyze correctly; module-root
discovery correctly handles multiple `pyproject.toml`/`package.json` roots; Python parser
reports lower confidence where genuinely uncertain (e.g. dynamic imports); tier-2 declarations
intentionally deferred to a later, real consumer.

**Risks and mitigation:**
- *Python's resolution edge cases (relative imports, namespace packages, `sys.path`
  manipulation) reveal the module-root model is too simple* → budget explicit time for this;
  treat it as expected, not a surprise.
- *tree-sitter WASM bundle size/cold start in serverless* → benchmark cold start with and
  without the Python parser loaded.

**Validation strategy:** Conformance suite run against both parsers; mixed-language fixture
repos checked for correct disconnected-cluster behavior; cold-start benchmark; manual
verification against 3–5 real open-source Python repos of varying complexity.

**Exit criteria:** Python analysis is accurate on real repos; the registry lazy-loads correctly;
the module-root model handles multi-root Python projects; TS pipeline has zero regressions.

> **Pause and evaluate — the most important checkpoint in this roadmap.** Did anything about
> Python force a change to the shared interface, the IR, or the identity model? If so, fix it
> now, while only two parsers exist, not after a third and fourth are built on the same
> assumption.

*Historical Note: During implementation, Phase 5 (Pipeline Integration) and Phase 6 (Python Conformance Implementation) of this milestone were naturally executed and completed together to ensure correct behavior in the full framework.*

---

## Milestone 4 - Verified Symbol Foundations

**Status:** Implemented.

**Objective:** Build a trustworthy, searchable index of parser-observed functions, classes,
methods, constructors, interfaces, type aliases, and enums for TypeScript, JavaScript, and
Python.

**Why this phase exists:** Symbols are direct parser facts and do not require analyzer
infrastructure. Shipping them first gives users immediate navigation value and ensures later
call/reference analyzers have real declaration data to consume as soon as the analyzer
framework exists.

**Components/modules affected:** parser capability and extraction contracts, TypeScript and
Python declaration walkers, IR identity/builder/validation, workspace search, URL position,
and file inspector.

**Expected architectural outcome:** Declarations remain embedded in `FileNode` under IR v1;
stable symbol IDs ignore source positions; old analyses without declarations remain valid;
search can navigate to and restore a declaration selection. The dependency map remains
strictly file-level. No call or reference relationship is inferred in this milestone.

**Validation strategy:** Cross-language declaration fixtures, repeated-run identity checks,
syntax-error provenance tests, IR validation tests, search and URL round trips, and browser
smoke tests for both language families.

**Exit criteria:** Named declarations are searchable and inspectable with deterministic IDs,
honest provenance, backward-compatible storage, and no speculative relationship edges.

---

## Milestone 5 - Analyzer Plugin Framework

**Objective:** Formalize `buildGraph`, `detectAnomalies`, and `clusterByFolder` as tiered
analyzer plugins behind a shared interface, with ordered (not DAG) execution and a context
object letting tier-2 analyzers read tier-1 output.

**Why this phase exists:** Required before a third language — the third language's real
purpose is proving analyzers degrade gracefully under uneven capabilities, which only means
something if analyzers are already a real plugin system.

**Components/modules affected:** new `lib/analysis/analyzers/interface.ts`,
`analyzers/registry.ts`; `buildGraph.ts` / `detectAnomalies.ts` / `clusterByFolder.ts`
refactored into plugins; `analyzeRepository.ts` orchestration updated.

**Expected architectural outcome:** Existing health/cycle/orphan detection behaves identically
but runs through the analyzer plugin contract; analyzer output carries the same
confidence/provenance discipline as parser output; capability-flag checks let an analyzer skip
or degrade per language.

**Risks and mitigation:**
- *Forcing existing functions into plugin shape adds complexity without near-term payoff* →
  keep the interface minimal — ordered tiers only, no DAG scheduler.
- *Capability degradation is untested because every language so far has similar
  capabilities* → deliberately construct a fixture where one parser lacks a capability another
  needs, to prove the degradation path actually works.

**Validation strategy:** Existing anomaly-detection test suite passes unchanged; new tests
specifically exercising capability degradation; benchmark on the largest fixture repo.

**Exit criteria:** All three existing analyses run as plugins with no behavior change;
capability degradation is demonstrably correct, not just designed.

---

## Milestone 6 - Architecture Model Foundations

**Objective:** Introduce the Architecture Model as a grouping/boundary index over existing
node IDs, populated only with deterministic containment data (module roots, folder hierarchy)
— explicitly not yet populated with heuristic layers or domains.

**Why this phase exists:** The last purely deterministic piece of infrastructure before
anything heuristic enters the system. Getting its shape right now means later heuristic
boundary detection fills an existing slot instead of forcing a pipeline restructure.

**Components/modules affected:** new `lib/analysis/architecture-model/*`; containment edges
from Milestone 1; UI grouping components (`RepoContextBar`, folder-view consumers).

**Expected architectural outcome:** A shared, referenceable set of boundary records that
analyzers and UI both read instead of independently inferring folder groupings; the
provenance value type is introduced and used for the first time (`verified`/`derived`
populated; `heuristic`/`user-defined`/`ai-interpretation` exist in the type but are unused so
far).

**Risks and mitigation:**
- *Built speculatively, before any analyzer actually needs shared groupings* → migrate at
  least one existing consumer (folder-grouping UI) onto it immediately, so it's proven in use.

**Validation strategy:** UI folder-grouping views produce identical output when read from the
new model vs. the old ad hoc logic; provenance propagation rule ("never silently upgrades")
enforced by a unit test.

**Exit criteria:** At least one real feature reads groupings from the Architecture Model
instead of ad hoc folder logic; the provenance propagation rule is tested, not just documented.

---

## Milestone 7 - Third Language & Capability Stress Test

**Objective:** Add a third language chosen specifically for structural difference from TS and
Python (Go's module system, or Java's classpath-vs-file mismatch) to stress-test capability
flags and the Architecture Model under real asymmetry.

**Why this phase exists:** Explicitly mandatory before claiming "multi-language platform" —
two similar languages aren't enough to prove the abstraction handles genuinely different
resolution models.

**Components/modules affected:** `lib/analysis/parsers/<language>/*`, conformance suite,
capability flag set (likely needs at least one new capability, or an explicit
"unsupported" case).

**Expected architectural outcome:** A real example of a language shipping at reduced
capability/confidence, visibly communicated in the UI, without destabilizing anything else.

**Risks and mitigation:**
- *Choosing an "easy" third language defeats the point of the stress test* → deliberately
  pick Go or Java for their harder resolution semantics, not a JS-adjacent language.
- *Harder edge cases blow the serverless time/memory budget* → benchmark against the largest
  fixture repo for this language specifically before committing to full support.

**Validation strategy:** Conformance suite passes with real, not synthetic, degraded-confidence
cases; manual review of the UI honestly communicating reduced coverage; benchmark within
serverless constraints.

**Exit criteria:** A genuinely harder language is supported with honestly communicated
limitations, and adding it required zero changes to the parser or analyzer interfaces.

> **Pause and evaluate.** With real proof across three structurally different languages, this
> is the point to decide — with data, not speculation — whether the capability-flag
> granularity and confidence model need adjustment before investing further.

---

## Milestone 8 - Query Layer & Storage Evolution

**Objective:** Introduce a stable query API (`getNode`, `getNeighbors`, `findCycles`,
`computeImpact`) as the only sanctioned way to read the graph, and prototype an indexed
storage backend behind it — even if blob storage stays the default for now.

**Why this phase exists:** Identified as the most likely 2–3 year bottleneck. This is the
deliberate de-risking phase, done before AI (the first heavy consumer of arbitrary queries)
rather than after.

**Components/modules affected:** new `lib/analysis/query/*`, storage abstraction layer, at
least one prototype alternate backend (in-memory indexed graph library or lightweight embedded
store) benchmarked against the current blob-based read path.

**Expected architectural outcome:** Every downstream consumer (UI, analyzers, future AI) reads
through the query interface — never "give me the whole blob and traverse it yourself"; real
benchmark data comparing blob-deserialize-and-traverse vs. indexed query at multiple repo
sizes.

**Risks and mitigation:**
- *Over-building a new storage backend before it's proven necessary* → blob storage stays the
  default; this phase proves the interface and measures, it does not migrate everyone.
- *Query interface designed around today's known patterns turns out too narrow for AI's
  actual needs* → validate the interface against the planned AI tool list (Milestone 8) before
  finalizing it.

**Validation strategy:** Benchmark data at multiple repo sizes; existing UI functionality
unchanged when routed through the new query layer.

**Exit criteria:** The query interface is the only read path in use anywhere in the codebase;
benchmark data exists to make an informed call on when — not if — to switch the default
backend.

---

## Milestone 9 - AI Reasoning Layer

**Objective:** Build the AI layer as a strictly read-only, tool-use consumer of the Milestone 7
query API, with every AI statement traceable to specific queried facts.

**Why this phase exists:** Everything before this exists to make this phase safe. It is the
first place a non-deterministic component enters the system, and should only be built once the
deterministic foundation beneath it is proven.

**Components/modules affected:** new `lib/ai/*`, tool definitions mapped 1:1 to the query API,
a citation/grounding validation layer, UI surfaces for AI explanations.

**Expected architectural outcome:** AI answers questions by calling real queries and citing
specific node/edge/analyzer-result IDs; answers can be programmatically checked so every cited
ID actually exists in the verified/derived layers.

**Risks and mitigation:**
- *AI defaults to summarizing without grounding when a query returns empty or ambiguous
  results* → explicitly test this failure mode; require the AI to say "no verified data for
  that" rather than filling the gap.
- *Cost/latency from multi-turn tool calls on large repos* → cache common queries (top god
  modules, cycle list) so the AI isn't re-deriving basics every conversation.

**Validation strategy:** Adversarial prompt testing specifically aimed at getting the AI to
state something without a citation; latency/cost benchmarking; manual review against
known-correct facts on fixture repos.

**Exit criteria:** The AI cannot produce an architecture claim without a verifiable citation
into the graph — enforced by an automated check, not just prompt instructions.

> **Pause and evaluate — the second most important checkpoint in this roadmap.** Before
> adding any heuristic or opinionated analysis, confirm the AI grounding holds up under real,
> adversarial use, not just happy-path demos. This is the one place the "verified facts"
> philosophy could quietly erode.

---

## Milestone 10 - Heuristic Architecture Views

**Objective:** Build the first heuristic analyzers (layer inference, or domain/feature
grouping) on top of the Architecture Model, fully provenance-tagged as `heuristic`, with
optional user-defined overrides.

**Why this phase exists:** Deliberately sequenced last among the core milestones — this is
where the system first presents best-effort inference as a first-class feature, and it should
only happen once the verified/derived foundation and the AI's honest-uncertainty behavior are
both proven.

**Components/modules affected:** `lib/analysis/architecture-model/inference/*`, UI treatment
for heuristic vs. verified content (visually distinct, not just labeled), user-config schema
for manual overrides.

**Expected architectural outcome:** Layer/domain views exist, are clearly and consistently
marked as heuristic in the UI, and can be overridden by explicit user-defined metadata that is
tagged separately again.

**Risks and mitigation:**
- *Heuristic confidence looks the same as verified confidence in the UI by default* — a
  design risk, not just a backend one — → require a dedicated design review specifically for
  how uncertainty is visually communicated.
- *Heuristics tuned on internal fixtures don't generalize* → validate against a deliberately
  diverse external repo sample, not just internal fixtures.

**Validation strategy:** User testing on whether people correctly perceive heuristic content
as less certain than verified content; accuracy spot-checks against manually labeled real
repos.

**Exit criteria:** Heuristic views are shipped, visually distinguishable, and a real user
study or spot-check confirms people don't mistake them for verified fact.

---

## Milestone 11 - Platform Hardening (conditional)

**Objective:** Address operational maturity gaps — background job execution for heavy
analyses, observability on aggregate provenance mix (a practical trust metric), and a stable
identity strategy for repo re-uploads if drift-tracking becomes a real goal.

**Why this phase exists:** Genuinely a "when you need it" milestone, not a fixed-timeline one.
Sequence it whenever growth or heavier analyzers actually strain the synchronous request
model — not preemptively.

**Components/modules affected:** execution model (SSE/synchronous → job queue),
logging/metrics layer, storage identity strategy.

**Expected architectural outcome:** Heavy analyses no longer bound by serverless request
duration; internal dashboards showing aggregate provenance mix; optional groundwork for
recognizing re-uploads of the same project.

**Risks and mitigation:**
- *Doing this too early wastes effort on infrastructure the product doesn't need yet* →
  explicitly gate this milestone behind an observed real constraint (a specific repo or
  analyzer hitting the time limit), not a calendar date.

**Validation strategy:** Load testing against the largest realistic repos across all
supported languages; dashboard review confirming provenance metrics are actually informative.

**Exit criteria:** Defined by whichever specific constraint triggered this milestone — not a
fixed checklist, since its timing is deliberately conditional.

---

## Mandatory sequencing

**Before implementing Python (mandatory):** Milestones 1 and 2, completed in full. Stable
identity, containment/dependency edge separation, minimal versioned schema, and a genuinely
general parser interface must all exist before Python-specific code is written.

**Before a third language (mandatory):** Milestones 1 through 5. The third language's purpose
is stress-testing capability degradation across a real analyzer framework and a real
Architecture Model — both must exist and be proven, not just designed, before it's a
meaningful test.

---

## Explicitly deferred / out of scope for now

- Full analyzer DAG dependency scheduler (ordered tiers are sufficient through Milestone 9)
- Third-party analyzer plugin sandboxing and marketplace (a separate security-review-level
  initiative, only worth starting if third-party extensibility becomes a confirmed product goal)
- Symbol-level (tier 2) declarations beyond what a real dead-code analyzer requires
- Rich capability-flag taxonomy beyond the minimal set needed at each stage
- Full IR migration/transform tooling (a single version field with an additive-only policy is
  sufficient until there's an actual breaking change to migrate)
- Storage backend migration to production use (the interface is proven in Milestone 7; full
  migration is deferred until benchmark data justifies it)
- Background job execution model (Milestone 10, conditional on observed strain)
- Drift-tracking across repo re-uploads (Milestone 10, conditional on product decision)
- Permanently out of scope per product philosophy: CI/CD policy gating, general code
  search/navigation, SAST/vulnerability scanning, open-ended code generation

---

## Architecture pause points (consolidated)

1. **After Milestone 2** — confirm the parser interface is genuinely general before Python
   exists.
2. **After Milestone 3 (most important)** — confirm nothing about Python forced a change to
   the shared interface, IR, or identity model, while only two parsers exist to fix.
3. **After Milestone 6** — with three structurally different languages proven, decide with
   real data whether the capability/confidence model needs adjustment.
4. **After Milestone 8 (most important from a trust standpoint)** — confirm AI grounding holds
   under adversarial use before any heuristic, opinionated feature is added on top of it.

---

## Architecture success criteria

Each core claim gets a positive test (evidence it's working) and a falsification test (a
specific event that means it isn't):

- **Extensibility.** Adding a language after Milestone 3 requires zero changes to the
  `LanguageParser` interface, the analyzer framework, or the IR schema.
  *Falsification:* if language 4 forces an interface change, the abstraction has failed and
  needs redesign, not a patch.
- **Consistency.** An automated CI check asserts that facts shared across views (e.g. an edge
  present in both the dependency graph and the Architecture Model) never disagree.
- **Trustworthiness.** 100% of AI-cited facts resolve to real graph IDs, tracked as an ongoing
  metric via the Milestone 8 grounding validator — not a one-time pass/fail.
- **Determinism.** Zero determinism regressions merged to main over a rolling window.

---

## Performance and scalability budgets

Starting targets, defined per repo-size tier, treated as regression gates to calibrate against
real measurement rather than fixed guarantees:

| Budget | Target | Notes |
|---|---|---|
| Analysis time (p95, 800-file/250MB repo) | < 120s | Against a 300s serverless ceiling — margin reserved for tier-2 and analyzer work added later |
| Peak memory (same boundary) | < 1GB | Margin matters more than the platform ceiling |
| Cold start increase per added language | < ~150ms | Confirms lazy loading is actually working; track per language added |
| Query latency, point queries (p95) | < 200ms | `getNode`, `getNeighbors` |
| Query latency, heavy traversals (p95) | < 2s | `findCycles`, `computeImpact` |
| AI end-to-end latency (typical question) | < 10–15s | Least predictable; treat as a starting hypothesis, not a commitment |

Any breach is a discussion point, not an automatic failure — some budget increases are
legitimate correctness trade-offs.

---

## Definition of Done (applies to every milestone)

Layered on top of each milestone's specific exit criteria:

- New or changed public interfaces are documented, not just implemented.
- Conformance/determinism/regression tests are green, including tests this milestone
  introduces.
- Benchmarks run against the budgets above, with results recorded.
- Confirmation that no earlier milestone's exit criteria silently regressed.
- A rollback/migration note for any change to stored data shape.
- Feature-flag or staged rollout for anything touching the live analysis pipeline (practice
  starts around Milestone 2, gating parsers per language).
- Explicit sign-off that any applicable "pause and evaluate" checkpoint actually happened, with
  its outcome recorded.

---

## Maintainability practices

- **Architecture Decision Records** for the nuanced calls made during design (edge-type split,
  provenance propagation rule, capability flags, etc.) — lightweight, one per decision, so
  future contributors know *why*, not just *what*.
- **A "how to add a language" guide**, written once Milestone 3 lands, using Python as the
  reference implementation and the conformance suite as the checklist.
- **Supply-chain hygiene for parser dependencies.** Pin tree-sitter grammar versions; review
  updates deliberately — an unpinned grammar update can silently change analysis output on an
  unchanged repo, a determinism failure across time rather than within a run.
- **Decide the backward-compatible link policy before Milestone 1 ships versioning.** When a
  stored shared link predates a schema change: show degraded content, silently re-run, or ask
  the user? This is a product decision hiding inside an architecture gap — UI behavior needs
  building alongside the versioning work, not after.
- **A merge-time checklist for the core principles** (no code execution, no unlabeled
  inference, no AI writes to the graph) — turns the manifesto into an enforced gate instead of
  cultural memory.
