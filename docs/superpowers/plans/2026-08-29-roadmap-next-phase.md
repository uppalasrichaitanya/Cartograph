# Milestone 4: Verified Symbol Foundations

**Goal:** Add a deterministic, parser-observed symbol index before introducing the analyzer
framework.

**Architecture:** Parsers extract named declarations alongside imports. The IR builder embeds
validated declarations in each `FileNode` while keeping `irVersion: 1`. Search uses structured
file/package/symbol targets, and workspace position optionally records a symbol ID.

## Scope

- Add stable `SymbolId`, declaration kinds, 1-based source ranges, and provenance.
- Derive identity from file ID, kind, qualified name, and same-name ordinal. Source positions
  never participate in identity.
- Extract TypeScript/JavaScript functions, named function/arrow variable initializers, classes,
  constructors, methods, interfaces, type aliases, and enums.
- Extract Python functions, async functions, nested functions, classes, constructors, and
  methods.
- Preserve source order and reduced provenance for declarations recovered from invalid files.
- Persist declarations optionally so older analyses remain readable.
- Search symbols only after a query is entered. Navigate to the owning file and focus the
  declaration in the inspector.
- Round-trip valid symbol selections through `?symbol=` and reject stale or cross-file IDs.

## Explicit Non-Goals

- No call graph, reference graph, or speculative relationship inference.
- Symbols do not become canvas nodes; dependency geometry remains file-level.
- No analyzer framework in this milestone.

## Verification

- Cross-language fixtures for nesting, methods, constructors, async functions, named arrow
  functions, overloads, duplicates, and syntax errors.
- Repeated-run tests for deterministic declaration order and identity.
- IR validation for names, source ranges, source order, unique IDs, and provenance.
- Compatibility tests for analyses without declaration data.
- Search and URL tests covering empty queries, ranking, structured targets, round trips, and
  stale selections.
- Full tests, lint, production build, dependency audit, diff validation, and browser smoke
  tests for TypeScript and Python uploads.

The Analyzer Plugin Framework follows as Milestone 5. Putting symbols first means future
symbol-relationship analyzers produce useful results immediately instead of landing before
the declaration data they need.
