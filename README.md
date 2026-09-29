<table align="center">
  <tr>
    <td align="center" bgcolor="#F4F0E6" width="112" height="112">
      <img src="./app/icon.svg" width="72" height="72" alt="Cartograph logo" />
    </td>
  </tr>
</table>

<h1 align="center">Cartograph</h1>

<p align="center">
  <strong>Verified dependency maps for real codebases.</strong><br />
  Upload a repository. Read its architecture. Follow every measured edge.
</p>

<p align="center">
  <a href="https://cartograph-dev.vercel.app">Live demo</a> ·
  <a href="#what-you-get">Features</a> ·
  <a href="#the-ai-guide">AI guide</a> ·
  <a href="#safety-and-limits">Safety</a> ·
  <a href="#run-locally">Run locally</a>
</p>

Cartograph turns a JavaScript, TypeScript, Python, or Go repository into a
shareable, interactive dependency map. Every edge on the map comes from an
import statement in the source. Nothing is guessed from folder names, and
uploaded code is never executed.

When an import cannot be resolved, Cartograph draws it as unresolved instead
of dropping it. A missing edge and an edge to nowhere are different facts.

## What you get

### A map with two altitudes

Start with a region-level survey of the whole repository, then open a region
to see its file-level dependencies. Imports that cross into another region stay
visible as boundary markers, so following an edge never dead-ends.

### Evidence you can see

Every node and edge carries the confidence of the fact behind it:

| Mark | Meaning |
| --- | --- |
| `verified` | Directly observed in source. |
| `derived` | Computed deterministically from verified facts, with lineage. |
| `heuristic` | Best effort. May be wrong. |
| `unknown` | The dependency exists, but its target could not be determined. |
| `assisted` | Generated interpretation. Never drawn as graph geometry. |

Confidence never increases as data moves through the pipeline.

### Structural observations

Inspect import cycles, dependency hubs ranked by how many files import them,
and files nothing imports. Each observation traces back to the graph that
produced it. Unlike measurements are never collapsed into one severity score.

### An AI guide to unfamiliar code

Ask for a plain-language tour of the whole repository, a region, or a single
file. See [The AI guide](#the-ai-guide).

### A workspace for investigation

Search files, named symbols, and packages. Open a file to follow its imports
and importers, inspect confidence evidence, and retrace your steps with the
breadcrumb and investigation trail. Every position has a URL, so a link opens
exactly what you were looking at.

### Presentation-ready diagrams

Export the architecture as a figure you can drop into a README, design doc,
or slide: grouped by folder, arrows weighted by import count, with a legend,
a note of anything left out, and a line saying where it came from. Download
SVG or 2× PNG, copy Mermaid for GitHub, or embed a live image link.

## How it works

1. You upload a repository as a `.zip`.
2. Cartograph validates the archive and discovers source files.
3. Language parsers extract imports, declarations, and parse errors.
4. The pipeline builds a validated intermediate representation and a
   deterministic dependency graph.
5. Regions, observations, and layout are computed from that graph.
6. The result is saved at `/repo/<id>` and can be shared directly.

The same repository always produces the same graph, ordering, and derived
records.

### Supported languages

| Language | Extensions | Parser |
| --- | --- | --- |
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.jsx` | TypeScript compiler API |
| Python | `.py` | tree-sitter Python (WASM) |
| Go | `.go` | tree-sitter Go (WASM) |

All parsers index named declarations. The symbol index is not a call graph:
the map stays file-level and import-based.

Path aliases from `tsconfig.json` or `jsconfig.json` are resolved, and
re-exports are followed. Python import roots come from declared layouts when
available; structural guesses are recorded as lower-confidence evidence. Go
package imports resolve to a deterministic representative file and are marked
heuristic when the package has several source files.

## The AI guide

Open **AI explain** to get a guided explanation of whatever you are looking
at:

| Subject | What it covers |
| --- | --- |
| Repository | What the project likely does, how its regions divide the work, how they connect, where complexity concentrates. |
| Region | What the region is responsible for, its key files, and what it depends on and is used by. |
| File | What the file is for, what it relies on, what relies on it, and what could break if it changes. |

Each explanation starts with a short summary, is organized into sections, and
ends with a reading order: the files to open first, and why. Every point links
to the files, imports, or regions it rests on, and clicking one moves the map
there.

### How answers are kept honest

The model interprets the graph. It never adds to it.

- **Bounded evidence.** The model receives a fixed-size evidence set built
  from the measured graph: counts, key files, declared names, cross-region
  imports, and cycles. Prompt size does not grow with the repository.
- **Citations are checked.** A point is shown only if every citation names a
  file, import, or region that exists in that evidence set.
- **Figures are checked.** A point that states a number not present in the
  evidence is removed. The panel tells you how many points were removed.
- **Fallback, not failure.** If a provider's answer has nothing grounded left,
  the next provider is tried.

Citations prove what a point rests on, not that its wording is right, and the
panel says so.

### Providers

Cartograph calls free-tier providers in this order, skipping any that are
unconfigured and moving past any that fail:

1. Gemini
2. Groq
3. OpenRouter

A provider that has just rate-limited or overloaded is tried last until its
cooldown passes. Explanations are cached per analysis and subject, so opening
the same explanation again costs no quota. **Regenerate** bypasses the cache.
Provider keys stay on the server.

## Export diagrams

Press **E** (or **Export**) in the workspace.

| Choice | Options |
| --- | --- |
| Format for | Document (wide, for READMEs and docs) or Slide (1920×1080) |
| Detail | Overview (top-level parts) or Standard (large folders split into their sub-folders) |
| Theme | Light, Dark, or Print (no colour; cycles are dashed) |
| Output | SVG, PNG at 2×, Mermaid, Markdown, or an embed link |

Every box is a folder or file group, and every arrow aggregates real import
statements; the number on an arrow is how many file-level imports it carries.
Anything left out (tests, weaker connections, less-connected files) is stated
on the figure.

Embed a figure that stays current with its analysis:

```markdown
![Architecture](https://cartograph-dev.vercel.app/api/diagram/<id>?preset=document)
```

## Safety and limits

Uploaded archives are treated as hostile input.

- **Never executed.** Parsing only: no build, lint, type-check, or runtime
  evaluation.
- **Archive paths are validated.** Traversal and symlink escapes are rejected
  per entry and recorded in the result.
- **Content is sniffed.** Binary and unreadable files are detected by content,
  not by extension.
- **Resources are bounded.** 25 MB compressed, 250 MB extracted, 800 source
  files. Parsing runs in a bounded worker pool.
- **Uploads are temporary.** The archive is deleted after analysis; only the
  result JSON is kept. Only archives in this deployment's own Blob store are
  accepted.

### Rate limits

Limits are per client IP, kept in memory on each server instance:

| Action | Limit |
| --- | --- |
| Upload | 10 per 10 minutes |
| Analyze | 6 per 10 minutes, 40 per day |
| AI explanation (uncached) | 6 per minute, 40 per hour |
| AI explanation, all clients | 20 per minute per instance |

Cached explanations don't count. A limited request gets HTTP 429 with a
`Retry-After` header. Because counters live on each instance, these are
abuse guards rather than global quotas; a shared store such as Redis is the
upgrade path.

> [!NOTE]
> Analyses and cached explanations are saved as public Blob objects under
> unguessable IDs. Anyone with a share link can open that analysis. Don't
> upload code you aren't allowed to share.

## Run locally

Requires Node.js `>=22.3.0`.

```bash
npm install
cp .env.example .env.local   # PowerShell: Copy-Item .env.example .env.local
npm run dev
```

Without `BLOB_READ_WRITE_TOKEN`, uploads, results, and cached explanations use
the local filesystem under `.data/`.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage. Leave empty for local storage. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini provider. Default model `gemini-2.5-flash`. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Groq provider. Default model `openai/gpt-oss-120b`. |
| `OPEN_ROUTER_API_KEY`, `OPEN_ROUTER_MODEL` | OpenRouter provider. Default model `openrouter/free`. |

All AI variables are optional; with none set, the AI guide reports that it is
not configured. Keep them server-side and never prefix them with
`NEXT_PUBLIC_`.

## Deploy to Vercel

1. Create a public Vercel Blob store and set `BLOB_READ_WRITE_TOKEN`.
2. Add any AI provider variables you want to use.
3. Deploy the Next.js app.

Analysis routes request a 300-second duration, which requires Fluid Compute.
The Go and Python tree-sitter WASM grammars are included in the production
trace.

## Verify changes

```bash
npm test
npm run lint
npm run build
npm run test:e2e   # browser smoke test: upload, map, AI panel, export, delete
```

The test suite covers parser conformance, IR validation, deterministic layout,
archive safety, rate limiting, indexed queries, AI grounding, workspace
navigation, and visual foundations.

## Project layout

```text
app/                              Next.js pages and API routes
components/                       Map, search, upload, AI, and workspace UI
lib/analysis/                     Discovery, parsing, orchestration, rendering
lib/analysis/analyzers/           Capability-aware analyzer plugins
lib/analysis/architecture-model/  Deterministic boundaries and inference
lib/analysis/ir/                  Versioned intermediate representation
lib/analysis/parsers/             Language parsers behind one registry
lib/ai/                           Evidence building, providers, grounding
lib/safety/                       Archive validation, resource guards, rate limits
lib/storage/                      Local filesystem and Vercel Blob backends
tests/                            node:test suites
```

Built with Next.js 16, React 19, `@xyflow/react`, and `elkjs`.

## Principles

- **Evidence over intuition.** Every architectural fact comes from something
  that can be verified; when certainty is impossible, the uncertainty is shown.
- **Deterministic.** The same repository and version always produce the same
  output.
- **One source of truth.** Every view derives from one validated
  representation of the repository.
- **AI explains, it never authors.** Generated text cannot create, remove, or
  reroute a graph edge.
- **Provenance is kept.** Confidence never increases as data flows through
  the pipeline.
- **Uploaded code never runs.**

## Scope

Cartograph is a static architecture survey. It is not an IDE, compiler, build
system, vulnerability scanner, CI policy engine, or coding assistant.

## License

MIT. See [`LICENSE`](LICENSE).
