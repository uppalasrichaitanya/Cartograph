# Milestone 3 — Python Parser Support: Implementation Plan

Status: **Design only — no code.** For review before implementation begins.

---

## 1. Milestone Objectives

1. Implement a `PythonParser` conforming to the existing `LanguageParser` interface, requiring **zero changes** to `ParserRegistry`, `extractAll`, or the orchestrator's control flow.
2. Validate that `RepositoryIR`, `ResolvedSpecifier`, and `ParserInitContext` — as they exist today — are sufficient for a second, independently-designed file-native language.
3. Produce real, useful graphs on real Python repositories on day one (correct exclusions, correct relative-import resolution, correct namespace-package handling) rather than a minimal happy-path parser.
4. Extend the Conformance Framework with a Python fixture suite, proving the framework is genuinely language-agnostic rather than TypeScript-shaped.
5. Explicitly **not** attempt to validate the file/package granularity question reserved for the Go checkpoint. Python is a control case: same resolution unit (file) as TypeScript, different syntax and semantics. Any temptation to treat "Python worked cleanly" as evidence the IR is fully general should be resisted — that's not what this milestone tests, by design, per the prior review.

**Explicit non-goals for Milestone 3:**
- No changes to `IRNode`/`ResolvedSpecifier` shape (the `kind` discriminator question stays reserved for the pre-Go paper design).
- No build-tool execution of any kind (no invoking `pip`, `poetry`, `python -c`, etc.) — metadata parsing only, consistent with the "never execute uploaded code" guarantee.
- No dependency-version resolution or virtual environment introspection.
- No support for dynamic imports (`importlib.import_module(computed_string)`), which are undecidable by static analysis and should be recorded as parse-level "unresolvable" rather than silently dropped.

---

## 2. Python Import Semantics — the subset that matters for resolution

This section exists to make the design's assumptions explicit and checkable, not as a general Python tutorial.

### 2.1 Absolute imports
```python
import foo.bar
from foo.bar import baz
```
Resolves via Python's package/module search path. For Cartograph's purposes, "search path" is not `sys.path` at runtime — it's the **project's own root(s)**, discovered statically (see §3). We do not attempt to resolve imports that only resolve via an installed environment's `site-packages`; those are external imports by definition (§2.5).

### 2.2 Relative imports
```python
from . import sibling
from .. import cousin
from .subpkg import thing
```
Resolution is **relative to the importing file's own package position**, not the project root. This means `resolveImport()` needs the importing file's package path as context, not just the specifier string — already satisfied by `ParseFileInput` carrying the file's path, but worth confirming the resolver has access to the *package* path (derived from directory structure), not just the raw file path.

### 2.3 Regular packages vs. namespace packages
- **Regular package**: a directory containing `__init__.py`. Unambiguous package boundary.
- **Namespace package (PEP 420)**: a directory **without** `__init__.py` that Python still treats as an importable package, as long as at least one file inside it is imported. This is common in larger, modern Python codebases (Google-style monorepos, plugin architectures) and specifically the case most likely to be under-modeled if we assume "package = has `__init__.py`."

**Design implication:** package-directory detection must not require `__init__.py`. A directory is a candidate package if it contains `.py` files, full stop. `__init__.py` presence affects *what code runs on import*, not whether the directory is a valid import target — but for our purposes (static structure, not runtime behavior), we treat both as resolvable packages identically. This should be documented as a known simplification: we're building a structural graph, not a truthful simulation of Python's import machinery.

### 2.4 Layout conventions: flat vs. `src/`
Two common project layouts:
- **Flat layout**: `mypackage/` sits directly at the project root next to `pyproject.toml`.
- **`src/` layout**: `src/mypackage/` — increasingly the recommended convention (avoids accidental imports of the uninstalled package during testing).

**Design implication:** root discovery cannot assume the project root *is* the import root. `initialize()` needs to determine the actual import root(s) — either project root or `src/`, based on what `pyproject.toml` declares (if anything) or, failing that, a structural heuristic (does `src/` exist and contain the package implied by the project name).

### 2.5 External vs. internal classification
- Standard library imports (`os`, `json`, `typing`, ...) → external, but worth tagging distinctly from third-party (`requests`, `numpy`) if `RepositoryIR`'s external-import model supports a sub-classification. If it doesn't today, this is a **nice-to-have**, not a blocker — flagged as an open question in §9, not a requirement.
- Anything not resolvable to a file under the project's import root(s) → external.

### 2.6 Star imports and `__all__`
```python
from foo import *
```
Cannot statically determine which names are pulled in without deeper analysis of `foo`'s `__all__` or module contents. For edge purposes, this is still a resolvable **file-level dependency** (the importing file depends on `foo`) even though the *symbol-level* detail is unknowable. Record it as a normal resolved import; no special handling needed at the graph level, only worth noting so it isn't mistaken for an unresolvable case.

---

## 3. Required Project Metadata

| Source | Purpose | Priority |
|---|---|---|
| `pyproject.toml` | Modern, declarative. `[project]` table for name; `[tool.setuptools.packages.find]`, `[tool.hatch.build]`, etc. for layout hints, depending on build backend | Primary |
| `setup.cfg` | Legacy declarative config, still common. `[options] package_dir`, `[options.packages.find]` | Secondary |
| `setup.py` | Legacy, but **executable Python** — explicitly out of scope for execution per the "never execute uploaded code" guarantee. If present, we may parse it as an AST for the *literal* `package_dir=`/`packages=` arguments where statically extractable, but must not run it and must degrade gracefully (fall back to structural heuristic) if it's not staticly parseable | Best-effort only |
| `requirements.txt` / `Pipfile` / `poetry.lock` | Not needed for resolution. Optionally useful later for "most-used external dependency" trivia, matching the equivalent v1 idea for JS external packages | Not required for Milestone 3 |

### 3.1 Import-Root Heuristic — Finalized, Deterministic

Applied in this exact order. The first rule that produces a result wins; later rules are never consulted once an earlier one succeeds. This ordering is itself part of the spec — two runs against the same repo must produce the same root every time, and two developers reading this section must arrive at the same algorithm independently.

**Step 1 — Declared layout (highest priority).** Parse `pyproject.toml` as TOML (data only, no execution). Check, in this fixed order, for the first build-backend key that resolves to a real, existing path:
1. `[tool.setuptools.packages.find] where = [...]` → first entry that exists on disk
2. `[tool.setuptools] package-dir = {"" = "..."}` → the value for the `""` key
3. `[tool.hatch.build.targets.wheel] packages = [...]` → first entry's parent directory
4. `[tool.poetry] packages = [{include = "...", from = "..."}]` → the `from` value of the first entry
5. `[tool.flit.module] name = "..."` → project root itself (flit's convention is flat layout by default)

If a matched key's declared path **does not exist on disk** (stale/broken config), treat Step 1 as having failed entirely and fall through to Step 2 — do not partially trust a broken declaration.

**Step 2 — `setup.cfg` declared layout.** If Step 1 produced nothing, check `[options] package_dir` / `[options.packages.find] where` in `setup.cfg`, same existence-on-disk validation as Step 1.

**Step 3 — Structural heuristic (no declarative config, or declared config didn't validate).** Deterministic, in order:
1. If `src/` exists at the project root **and** contains at least one subdirectory with one or more `.py` files anywhere inside it (namespace-package-inclusive, per §2.3) → import root = `src/`.
2. Else → import root = project root itself.

**Step 4 — Multi-candidate conflict.** If Step 1 or 2 yields a declared path *and* Step 3's structural check would independently also flag `src/` as populated, and they **disagree** (e.g. declared path is `lib/` but `src/` is also populated with Python files) → the declared path from Step 1/2 wins, always. Declarative configuration is authoritative over structural inference by design. Record this as a `rootConfidence` of `'declared'` regardless of the conflict, but log the conflict for visibility (not silently discarded — see `PythonPackageIndex.rootConfidence` in §4).

**Result retained by `initialize()`:**
- `importRoot`: absolute path, single value (multi-root projects are out of scope, §9.2)
- `rootConfidence`: `'declared'` | `'structural-heuristic'` — which step actually produced the result, carried forward into the package index and, ultimately, available for the file-level `Provenance` field
- `declaredPackageName`: string | null — from `[project.name]` in `pyproject.toml` if present, used only as a resolution hint, never load-bearing on its own

This mirrors, in spirit, what `resolveAliases.ts` does for `tsconfig.json` today — read declarative config, build a resolution table, hand it to the resolver — which is a good sign the existing `ParserInitContext` shape is likely sufficient without changes. Confirming that remains one of this milestone's real validation goals (§9.1).

---

## 4. Parser Lifecycle

### `initialize(context: ParserInitContext)`
- Locate and parse `pyproject.toml` / `setup.cfg` per §3.
- Determine the import root using the deterministic heuristic in §3.1 (monorepo-style multi-root Python projects are a known edge case — treat as out-of-scope for Milestone 3, flagged in §9.2, not silently mishandled).
- Build the package index (structure below) via a single deterministic directory walk.
- Retain this index for use in `resolveImport()`. This is the Python-specific analogue of the TypeScript parser's alias-resolution table.

### 4.1 Package Index — Finalized Structure

```typescript
type PythonPackageIndex = {
  importRoot: string;                          // absolute path, per §3.1
  rootConfidence: 'declared' | 'structural-heuristic';
  packages: Map<string, PythonPackageEntry>;    // key: dotted path, e.g. "mypackage.utils"
};

type PythonPackageEntry = {
  dottedPath: string;        // "mypackage.utils"
  directoryPath: string;     // absolute path to the directory
  kind: 'regular' | 'namespace';   // has __init__.py, or PEP 420 namespace package
  initFile: string | null;   // absolute path to __init__.py, or null for namespace packages
  modules: Map<string, string>;    // module name (no extension) -> absolute .py file path
                                    // e.g. "helpers" -> "<root>/mypackage/utils/helpers.py"
};
```

**Construction rules (deterministic ordering):**
1. Walk the import root in pre-order, directories sorted lexicographically at each level (matches the determinism guarantee already established for IDs and graph ordering in Milestone 1 — the walk order must not depend on OS-level directory-listing order, which is not guaranteed stable).
2. A directory is added as a `PythonPackageEntry` if it contains at least one `.py` file directly inside it (`__init__.py` optional — presence determines `kind`, not eligibility, per §2.3).
3. `dottedPath` is computed as the directory's path relative to `importRoot`, with `/` replaced by `.`.
4. `modules` is populated from every `.py` file directly inside the directory (not recursively — subdirectories get their own `PythonPackageEntry`), keyed by filename without the `.py` extension. `__init__.py` itself is not added to `modules` (it's referenced via `initFile`, since it represents the package itself, not a submodule).
5. **Name-collision edge case**: if a directory `foo/bar/` and a file `foo/bar.py` both exist at the same level (invalid in a real Python environment — you cannot import both), the directory entry takes precedence deterministically and the colliding file is recorded as a conformance-fixture-worthy edge case (§6) rather than silently dropped or silently preferred arbitrarily.

Lookup for `resolveImport()` is then: split the dotted specifier, walk it segment by segment through `packages`, land on either a `PythonPackageEntry` (specifier refers to a package) or an entry in its `modules` map (specifier refers to a submodule file).

### `parseFile(input: ParseFileInput)`
- Parse the file's source into a syntax tree (tooling finalized in §8).
- Walk the tree collecting:
  - `import X`, `import X.Y`, `import X as Y` statements
  - `from X import Y` statements (including `from X import (A, B, C)` multi-imports)
  - Relative import forms: `from . import X`, `from .. import X`, `from .sub import X`
  - Record each as a raw specifier plus enough context (the dot-level for relative imports, the module path for absolute) for `resolveImport()` to act on.
- On syntax error: catch and record as a parse error (consistent with the existing TS parser's diagnostic-collection behavior), skip the file, do not fail the batch.
- Produce `RawExtraction`, same as the TypeScript parser does today — no new intermediate type needed.

### `resolveImport(specifier, context)` — Finalized classification rule

Three possible outcomes, decided in this order:

1. **Resolved-internal**: the specifier (absolute, resolved against `PythonPackageIndex`; or relative, resolved against the importing file's package position first, then against the index) lands on a real `PythonPackageEntry` or a real entry in its `modules` map. → normal internal import, becomes a graph edge to that file.
2. **Unresolved-internal**: the specifier is **syntactically incapable of referring to anything external** — i.e. it's a relative import (`.`/`..`-prefixed), or it's an absolute import whose first dotted segment matches a known top-level entry in `packages` — but the full path does not resolve (typo, deleted file, or a form of dynamism we don't follow, e.g. `getattr`-based access). This is **never** reclassified as external. Relative-import syntax cannot resolve to a third-party package under any circumstance in real Python, so calling it "external" would be a factual misclassification, not just an imprecise one.
3. **External**: everything else — absolute import whose first segment does not match any known top-level package in the index. Covers both stdlib and third-party.

**Handling of outcome 2 — mechanism (revised per independent review, C1 resolution):** unresolved-internal imports do **not** become graph edges — there is no real file to point to, and inventing a placeholder node would violate the “no guessed edges” principle the whole project is built on. Three additive, backward-compatible changes carry this information through the pipeline:

**Change 1 — `ResolvedSpecifier` gains an optional classification field:**

```typescript
export interface ResolvedSpecifier {
  readonly resolved: string | null;
  readonly raw: string;
  readonly unresolvedKind?: 'external' | 'unresolved-internal';  // only meaningful when resolved is null
}
```

When `resolved` is `null`, the parser sets `unresolvedKind` to signal whether the failed resolution is external (default, matching current TS behavior) or unresolved-internal (syntactically incapable of being external — relative imports, or absolute imports whose first segment matches a known package). When omitted, the orchestrator defaults to `'external'`, preserving full backward compatibility with the TypeScript parser (which does not set this field).

**Change 2 — `RawExtraction` gains an optional `unresolvedInternalImports` field:**

```typescript
unresolvedInternalImports?: readonly string[]   // raw specifier text, e.g. ".utils.missing_module"
```

**Change 3 — `extractAll`'s resolution loop routes the third outcome:**

```typescript
for (const specifier of extraction.internalImports) {
  const resolved = parser.resolveImport(specifier, file, discoveredFiles);
  if (resolved.resolved !== null) {
    internalImports.add(resolved.resolved);
  } else if (resolved.unresolvedKind === 'unresolved-internal') {
    unresolvedInternalImports.push(specifier);
  } else {
    externalImports.add(specifier);
  }
}
```

These three changes are additive and backward-compatible. The TypeScript parser requires no modification — it never sets `unresolvedKind`, so all its failed resolutions continue to be classified as external (matching current behavior). `buildRepositoryIR` attaches `unresolvedInternalImports` to the file's provenance/diagnostics, preserving the information (available for a future “N unresolved imports” UI affordance) without polluting the graph with phantom edges.

**Note for the record:** the TypeScript parser today collapses *all* failed resolutions — including failed relative imports — into “external.” That's the same latent inaccuracy this section fixes for Python, just not yet fixed for TS. Not in scope to change now, but worth a follow-up ticket once Milestone 3 ships, for consistency across parsers.

**Resolution mechanics**, for all three outcome paths above:
- **Absolute specifiers**: look up the dotted path against `packages` in the `PythonPackageIndex`. A match on a `PythonPackageEntry` itself resolves to its `initFile` (if `kind: 'regular'`) or to the directory conceptually (if `kind: 'namespace'`, there's no single file — treat the import as resolved-internal but pointing at the first-encountered module inside it deterministically, or, cleaner, treat a bare namespace-package import with no `initFile` as resolved-internal at the *directory* level only when the graph model can represent that; otherwise treat as needing a specific submodule to produce a file-level edge, consistent with file-granularity). A match landing in `modules` resolves to that specific file.
- **Relative specifiers**: derive the importing file's own package position (its directory's `dottedPath` in the index) from its file path, walk up `.`/`..` levels accordingly, then resolve the remainder the same way as an absolute lookup from that position.
- Return `ResolvedSpecifier` for all three outcomes: outcome 1 uses `{ resolved: "path/to/file.py", raw }`, outcome 2 uses `{ resolved: null, raw, unresolvedKind: 'unresolved-internal' }`, outcome 3 uses `{ resolved: null, raw }` (or explicitly `unresolvedKind: 'external'`). The orchestrator routes each accordingly per Change 3 above.

### `dispose()`
- Release the package index and any held file handles/parser state. No Python-specific complexity expected here.

---

## 5. Python-Specific Exclusions

Per the prior discussion, these need to ship **as part of Milestone 3**, not deferred to the general parser-aware discovery mechanism:

- `.venv/`, `venv/`, `env/` — virtual environments
- `__pycache__/` — bytecode cache, appears throughout the tree, not just at root
- `.pytest_cache/`
- `.tox/`
- `.mypy_cache/`
- `.ruff_cache/`
- `*.egg-info/` (directory suffix pattern, not a fixed name)
- `build/`, `dist/` (setuptools build artifacts — note overlap with JS's `dist/`/`build/`, already excluded generically, but confirm Python's versions are still caught if the existing exclusion logic is JS-flavored, e.g. assumes a fixed name rather than also matching Python's usage of the same names)
- `site-packages/` (in case a `.venv` isn't cleanly excluded upstream, e.g. a nested/copied environment)
- Conda: `conda-meta/`, environment directories if detectable

**Mechanism (per review M2):** Python exclusion directories are added directly to the existing `EXCLUDED_DIRECTORIES` set in `discoverFiles.ts`. This is the simplest approach and acceptable while parser count is low. The `*.egg-info/` pattern requires suffix matching (not exact name), so `discoverFiles.ts`'s directory-skip logic gains a small extension: in addition to `EXCLUDED_DIRECTORIES.has(name)`, check `name.endsWith('.egg-info')`. This is the only structural change to the traversal logic. Exclusions are checked at every directory level during traversal (`__pycache__` recurs throughout a tree), not just at the project root.

**Additional discovery changes required (per review M3, M4):**
- `findProjectRoot()` gains `pyproject.toml` as a root signal (alongside `package.json`, `tsconfig.json`), and `setup.cfg` as a secondary signal. Without this, pure Python repos would not be correctly identified.
- The error message in `discoverSourceFiles()` (“No .ts, .tsx, .js, or .jsx files...”) is updated to reflect the actual set of registered extensions, not hardcoded TS/JS names.
---

## 6. Conformance Testing Strategy

Extend `tests/conformance/` with `python.fixtures.ts`, mirroring the existing TypeScript fixture structure so the framework's language-agnostic claim gets exercised, not just asserted.

**Fixture categories:**
1. **Basic absolute imports** — `import foo`, `from foo import bar`, multi-import forms.
2. **Relative imports** — single-dot, double-dot, and deeper, including from a deeply nested file to confirm correct package-position resolution.
3. **Namespace packages** — a package directory with no `__init__.py`, confirm it still resolves.
4. **`src/`-layout project** — confirm import-root detection picks `src/` correctly.
5. **Flat-layout project** — confirm the structural fallback works when no `src/` exists.
6. **Circular imports** — A imports B imports A, confirmed the same DFS cycle detection that already works for TS correctly surfaces this without Python-specific changes to `detectAnomalies.ts` (this is itself a validation point: cycle detection should be provably language-agnostic, not just claimed to be).
7. **Syntax error handling** — a file with invalid Python syntax; confirm it's skipped gracefully and recorded as a parse error, doesn't crash the batch.
8. **External import classification** — stdlib import, third-party import, confirm both land as external, not as broken internal resolutions.
9. **Star imports** — confirm they resolve as file-level edges per §2.6, don't get dropped or crash resolution.
10. **Exclusion verification** — a fixture repo containing a `.venv/` with `.py` files inside; confirm those files never appear as nodes.
11. **Determinism** — run twice, confirm identical `RawExtraction` output (same requirement already enforced for TypeScript by the framework).

**Framework validation goal:** if all of the above can be expressed as fixtures + a minimal runner, without any change to `framework.ts` itself, that's the actual proof the conformance framework is language-agnostic — worth calling out explicitly as a milestone success criterion, not just "tests pass."

---

## 7. Integration Points with Existing Architecture

| Component | Change required? | Notes |
|---|---|---|
| `LanguageParser` interface | No | Python parser implements it as-is |
| `ParserRegistry` | No | New registration entry only |
| `extractAll` orchestrator | Yes (minor, additive) | Resolution loop updated to route `null` resolutions via `unresolvedKind` (§4.1 mechanism). Dispatch logic unchanged |
| `RepositoryIR` / `IRNode` | No | Python is file-granularity, same as TS — this is expected and is *not* evidence the IR generalizes beyond file-granularity languages (see §1) |
| `ResolvedSpecifier` | Additive only | Gains optional `unresolvedKind` field for three-outcome resolution (§4.1). Core `resolved`/`raw` contract unchanged. Confirming the interface holds under Python's relative-import context (§2.2) remains a real test |
| `ParserInitContext` | To be confirmed | Needs to comfortably carry "detected import root(s)" the way it carries TS's alias table. If the current shape forces an awkward fit, that's useful signal ahead of the Go/Java checkpoint, where the fit will be tested harder |
| `discoverSourceFiles` | Minor changes | Python exclusion patterns added. `findProjectRoot()` gains `pyproject.toml` signal. Error message updated to reflect registered extensions. Suffix matching for `*.egg-info` (§5) |
| Conformance framework | Additive only | New fixture file; `framework.ts` should need no changes (see §6) |

---

## 8. Parser Backend — Finalized: `tree-sitter-python` via WASM

Decided, not left open. Rationale and rejected alternatives kept below for the record.

**Decision:**
- Runtime: `web-tree-sitter` (WASM-based tree-sitter bindings) — no native binary, no `node-gyp`/prebuilt-binary compatibility risk across Vercel's serverless/Fluid Compute environment.
- Grammar: `tree-sitter-python`, compiled to `.wasm`. Use a maintained prebuilt WASM grammar bundle (e.g. the `tree-sitter-wasms` package) rather than compiling the grammar in-house, to avoid taking on a build-toolchain dependency for a single grammar file.
- Loading strategy: load the WASM runtime and the Python grammar once per warm function instance; cache the compiled `Language` object at module scope so repeated invocations in the same warm container reuse it. Do not assume cross-invocation persistence is guaranteed (cold starts will re-load) — this is a performance optimization, not a correctness dependency.
- Traversal style: mirror the existing TypeScript parser's approach (recursive node walk collecting import-shaped nodes) rather than tree-sitter's query-language (S-expression) matching, for stylistic and maintenance consistency with `extractImports.ts`'s existing pattern. This is a minor, revisitable choice — either approach is technically sound; consistency with the existing codebase is the deciding factor, not a technical requirement.
- Security posture: WASM execution here only builds a syntax tree from text — it does not evaluate Python, touch the filesystem, or make network calls. This is consistent with, not an exception to, the "never execute uploaded code" guarantee.

**Rejected alternatives:**
- **Python's own `ast` module via subprocess or embedded interpreter**: would give a fully faithful parse, but requires either shelling out to a `python` interpreter (execution-adjacent, and inconsistent with the "declarative-only, no execution" posture already adopted for `initialize()`) or a pure-JS reimplementation of Python's grammar. Rejected for the same reason build-tool invocation was flagged as requiring an explicit architecture review rather than being adopted as a shortcut.
- **Regex/heuristic parsing as the primary strategy**: rejected outright — the project's differentiation is AST-based, verified extraction, not pattern-guessing. A regex fallback remains acceptable only as a last resort for genuinely unparseable files, with confidence marked down accordingly, never as the default path.

**Residual cost, noted not dismissed:** adding a second language grammar increases cold-start payload and marginally increases the memory/event-loop concerns already logged as technical debt for the TS pipeline. Not a blocker for one additional grammar; worth re-evaluating cumulative bundle size once Go/Java grammars are also in play.

---

## 9. Risks, Assumptions, and Open Architectural Concerns

1. **`ParserInitContext` fit is unconfirmed, not assumed.** This document treats it as *likely* sufficient based on structural similarity to the TS alias-resolution case, but that's a hypothesis to test during implementation, not a settled fact. If it doesn't fit cleanly, that's valuable early signal ahead of Go/Java, where the fit is expected to be tested harder.
2. **Multi-root Python projects** (e.g. a monorepo with multiple independent `src/` trees, or a `pyproject.toml`-per-package monorepo layout) are explicitly out of scope for Milestone 3. Flagged rather than silently mishandled — if encountered, the parser should degrade to "best-effort single root" rather than silently producing a wrong graph.
3. **Unresolved-but-plausibly-internal imports** — finalized in §4.1. Classified via `ResolvedSpecifier.unresolvedKind` and routed to `RawExtraction.unresolvedInternalImports` by the orchestrator. Never folded into “external.” The TypeScript parser has the same latent gap today (all failed resolutions → external) and should eventually be brought to parity as a follow-up.
4. **`setup.py`-only legacy projects** (no `pyproject.toml`, no `setup.cfg`) will get best-effort structural-heuristic treatment only. This is an accepted limitation, not a bug to chase down in Milestone 3 — worth stating plainly so it isn't quietly expected to work.
5. **Namespace-package/regular-package conflation** (§2.3): treating both identically is a deliberate simplification for a *structural* graph, not a runtime-faithful one. Worth a one-line note in user-facing documentation eventually, so the "verified" claim stays honest about what's being verified (import structure) versus what isn't being modeled (runtime import machinery nuances).
6. **This milestone does not touch the file/package granularity question.** Restated deliberately from §1 because it's the single easiest thing to accidentally treat as resolved once Python ships cleanly. It isn't. The Go/Java/C++ paper design remains the actual test of that assumption.

---

## 10. Phased Implementation Plan

Mirrors the phase-gated review discipline used in Milestones 1–2.

- **Phase 1 — Metadata & Root Detection**: implement `pyproject.toml`/`setup.cfg` parsing and import-root detection logic in isolation, with unit tests against a handful of real-world layout examples (flat, `src/`, namespace-package-heavy). No parser integration yet.
- **Phase 2 — `PythonParser.initialize()`**: wire Phase 1 logic into the lifecycle method, build the package index, confirm `ParserInitContext` fit (§9.1).
- **Phase 3 — `parseFile()`**: `tree-sitter-python` (WASM, per §8) integration, import-statement extraction across all forms in §2. Conformance fixtures for parsing (not yet resolution) written alongside.
- **Phase 4 — `resolveImport()` & orchestrator integration**: absolute and relative resolution against the package index. Implement the three-outcome classification (§4.1): add `unresolvedKind` to `ResolvedSpecifier`, `unresolvedInternalImports` to `RawExtraction`, and update `extractAll`'s resolution loop. Conformance fixtures for resolution (§6, items 1–3, 8–9).
- **Phase 5 — Exclusions & discovery fixes**: Python-specific exclusion patterns (§5), suffix matching for `*.egg-info`, `pyproject.toml` root signal in `findProjectRoot()`, updated error message in `discoverSourceFiles()`. Fixture with a `.venv/` decoy (§6, item 10).
- **Phase 6 — Registry integration & end-to-end**: register `PythonParser`, run a real-world Python repo through the full pipeline, manually verify the resulting graph against known structure (mirroring the original v1 "verify against a repo you know" definition-of-done pattern).
- **Phase 7 — Conformance suite completion & determinism pass**: remaining fixtures (§6, items 4–7, 11), full framework run.

Each phase independently reviewable before the next begins, consistent with the existing Claude-implements / Gemini-reviews workflow.

---

## 12. Definition of Done

**Structural criterion (necessary, not sufficient on its own):**
`PythonParser` is implemented without modifying `LanguageParser`'s existing method signatures, `ParserRegistry`, or `framework.ts` in the conformance suite. The following additive changes are pre-approved as part of this design (per independent review, C1 resolution):
- New fixture files in `tests/conformance/` (expected and required)
- An optional `unresolvedKind` field on `ResolvedSpecifier` (additive, backward-compatible — §4.1)
- An optional `unresolvedInternalImports` field on `RawExtraction` (additive, backward-compatible — §4.1)
- A minor update to `extractAll`'s resolution loop to route `null` resolutions via `unresolvedKind` (§4.1)
- Python exclusion patterns in `discoverSourceFiles`, `pyproject.toml` root signal in `findProjectRoot`, and updated error message (§5)
Any change to `IRNode`'s core shape, `RepositoryIR`'s structure, or `ParserInitContext`'s type signature falls outside this criterion. If implementation reveals one of these is necessary, that is a stop-and-return-to-design event, not something to route around quietly to preserve a passing checkbox.

**Qualitative criterion (equally required):**
The existing interfaces must be used as designed, not stretched to fit. If `ParserInitContext` technically accepts the Python package index without a type change, but only by overloading a field intended for something else, or by working around a missing capability rather than cleanly using one that exists — that is **not** a pass. It's a legitimate and useful finding (the interface doesn't actually generalize as cleanly as hoped), and should be reported as such rather than absorbed silently.

**Scope of the claim, stated explicitly:** meeting both criteria above validates the language-plugin architecture **for a second file-native language**. It does not validate — and should not be characterized, in this document or in any progress report derived from it, as validating — the architecture's fitness for package-granularity (Go, Rust), classpath-granularity (Java), or non-statically-resolvable (C/C++) languages. That remains gated behind the separate Go/Java/C++ paper design checkpoint agreed on before Milestone 4.

**Out of scope for this Definition of Done:** performance characteristics (WASM grammar load time, cold-start impact, memory under large repos) are a separate axis, not covered by "did the architecture hold." A Milestone 3 that passes both criteria above but reveals a performance problem is still a successful architectural validation — the performance concern gets tracked separately (§9, technical debt), not folded into this DoD.

---

## 13. Summary

Python is the right next step, and this plan is designed to make it a genuinely useful milestone on two fronts at once: real support for a widely-requested language, and honest validation of the existing architecture's file-native assumptions — without overreaching into claiming it validates anything about package- or classpath-native languages, which remains reserved for the Go/Java/C++ checkpoint already agreed on.

Stopping here for review, per instructions. No implementation to follow until this plan is discussed.