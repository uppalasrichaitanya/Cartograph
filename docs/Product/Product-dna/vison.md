# Cartograph Product Bible

## Volume I — Product DNA

### Document 01 — Vision

**Status:** Draft v1.1 (amplified from v1.0)

---

# Vision

Software is often easier to write than it is to understand.

Joining a new team, contributing to an open-source project, studying an unfamiliar codebase, inheriting a legacy system, returning to a project after months away — these are different situations, but they begin with the same task: building a mental model of how the system actually works.

Today, that process is fragmented. People move between documentation, source files, search results, dependency chains, and AI assistants, gradually assembling an understanding of the project by hand. Each of these tools is valuable on its own terms, but each one answers a question. None of them leaves the person with a structure they can return to, verify, and build on. Asking an AI assistant to "explain the project" produces an answer — often a good one — but an answer is not the same thing as a map. It cannot be checked against the source with certainty, it does not persist, and it does not improve the next question someone asks. This is not a limitation of today's models that better ones will simply outgrow. It is a difference in kind: a generated explanation and a verified structure serve different purposes, no matter how fluent the explanation becomes.

**Cartograph exists to bridge that gap.**

Through deterministic static analysis, Cartograph transforms an uploaded project into an explorable architectural map — a structure that reveals organization, relationships, and dependencies before a person needs to understand every implementation detail. Cartograph does not aim to replace source code, documentation, or AI assistants. It aims to give each of them a foundation to stand on: a verified account of how the project is actually put together, which every other tool's answers can then be checked against.

Cartograph does not aim to replace reading code, either. Reading code is still how software is ultimately understood. What Cartograph removes is the disorientation that comes before that — the slow, manual work of figuring out where to even begin. It offers orientation before exploration, and context before implementation.

As Cartograph grows to support additional languages, richer analyses, and new ways of exploring a system, its purpose does not change:

> **Cartograph helps people build accurate mental models of software systems before they work on them.**

---

# Mission

Cartograph reduces the time between opening an unfamiliar codebase and being able to reason about it confidently — by replacing manual, ad hoc exploration with a single deterministic pass over the project that produces a structure the person can verify, not just a summary they have to take on faith.

---

# Ambition

*(Previously "Long-Term Vision" — retitled below the Review section explains why.)*

Cartograph aims to become the first tool people open when they need to understand a software project.

Not because it replaces the tools around it, but because it prepares people to use them well. A person who already has an accurate map of a system asks better questions of the documentation, gets more out of an AI assistant, and reads the code itself with a sense of where they are, rather than starting cold.

Whether someone is onboarding to a new codebase, contributing to an open-source project, studying software architecture, reviewing a legacy system, performing technical due diligence, or returning to a personal project after months away, Cartograph should let them begin with understanding instead of uncertainty.

---

# Who Cartograph Is For

The scenarios above describe *when* someone reaches for Cartograph. It is worth being equally clear about *who* — because the same map needs to serve people with different backgrounds and different stakes in getting it right.

- **The new contributor**, joining a codebase they didn't write and need to move around in safely before they've earned the trust to move fast.
- **The maintainer or reviewer**, who already knows the system but needs to verify — not just recall — how a specific change ripples outward.
- **The evaluator**, assessing a codebase from the outside: technical due diligence, an audit, a hiring exercise, a decision about whether to depend on something. For this person, "trust me" is not sufficient — the map has to be independently checkable, because their judgment about the system rests on it.
- **The student or researcher**, encountering real, unfamiliar software for the first time, without the surrounding institutional knowledge a teammate would have.
- **The returning owner**, coming back to their own project after enough time has passed that it is, functionally, unfamiliar again.

These are not equally weighted personas to design a feature matrix against. They are named here because they pull the product in different directions — the evaluator needs rigor and provenance above all; the student needs approachability above all — and Cartograph's design should be aware of that tension rather than averaging across it silently.

---

# What Cartograph Is

Cartograph is:

- A deterministic static analysis engine for software structure.
- An explorable, verifiable representation of how a codebase is actually organized.
- A foundation other tools — documentation, AI assistants, human judgment — can be checked against.

---

# What Cartograph Is Not

Cartograph is **not**:

- a code editor or an IDE replacement,
- an AI coding assistant,
- a documentation generator,
- a project management platform,
- a security scanner or vulnerability-detection tool — dependency structure and anomaly detection are about architecture, not exploitability, and the two should never be allowed to blur together in how the product is described or used,
- simply another dependency graph viewer,
- or a system that infers, guesses, or generates the structure it shows you. Everything Cartograph displays about a codebase's architecture is derived from the code itself, not asserted by a model. This is not an implementation detail. It is the reason the map can be trusted at all.

Its purpose is understanding. Everything else exists in service of that goal.

---

# Core Principles

These are not features. They are commitments that should outlast any specific feature, and that any future feature should be checked against.

1. **Nothing is asserted that cannot be verified against the source.** Every relationship Cartograph shows exists because it was found in the code, not because it was inferred to be probable. If a future capability cannot make this claim, it does not belong in the map itself — it belongs in a clearly separated, clearly labeled layer (see Principle 4).

2. **Fewer languages done rigorously beats more languages done approximately.** Cartograph will move slower onto a language than a competitor willing to guess. Where a language's own semantics make verifiable resolution impossible — where "architecture diagram" would quietly become "best-effort guess" — Cartograph should say so plainly rather than paper over the gap with confidence it hasn't earned.

3. **The product's structure should not assume any one language's shape is universal.** A file, a package, a module, and a class are not the same unit, and treating "file" as the default unit of software organization is a decision Cartograph made for the languages it started with, not a law of nature. As the map's vocabulary grows, it should grow to describe what different languages actually are, not force every language into a shape borrowed from the first one.

4. **What is verified and what is inferred must always be visually distinguishable.** As Cartograph adds AI-assisted explanation on top of its verified structure, the two must never look the same at a glance. A person exploring the map should always be able to tell, without asking, whether they are looking at a fact or an explanation of a fact.

5. **Trust is the product.** Speed, breadth, and polish all matter, but none of them matter if the map turns out to be wrong. Every decision that trades a small amount of accuracy for a larger amount of convenience should be treated as a decision worth arguing about, not a default.

---

# Design Implications

- The product should prioritize understanding over feature count.
- Every feature should help a person build or refine a mental model — not just present more information.
- Visualizations must explain relationships, not simply display data.
- AI features should extend understanding, grounded in the verified structure beneath them — never substitute for it, and never be visually indistinguishable from it.
- New language support should preserve deterministic analysis and a consistent experience, even when the underlying language's own semantics are less clean than the languages that came before it.
- Interface decisions should reduce cognitive load before they add new functionality.
- Provenance and confidence should be visible in the interface, not just present in the underlying data. If the system isn't fully certain about something, the person looking at it should be able to tell.

---

# Review — What Changed, and Why

Organized by the categories requested, not by document order.

### Contradictions found and addressed
- The original draft positioned Cartograph against AI assistants ("often produces summaries, not structured understanding") while also stating, later, that AI features are part of the roadmap ("AI features should augment understanding"). Read together without a bridging principle, this could land as inconsistent — critical of AI in one section, building on it in another. **Core Principle 4** now draws the actual distinction: the critique was never of AI itself, it was of AI operating *without* a verified structure beneath it. Cartograph's own future AI features are explicitly fine, because they'd be grounded in the IR, not freely generating claims about the codebase. This needed to be said outright rather than left for the reader to reconcile.
- "What Cartograph Is" originally listed four overlapping self-descriptions ("understanding platform," "static analysis engine," "exploration workspace," "tool for building mental models") that mostly restated each other. Tightened to three, each doing distinct work.

### Weak assumptions surfaced
- The opening frames the problem as broadly as "understanding software," but the actual mechanism — deterministic static analysis of a parseable source repository — is narrower than that framing implies. Left unaddressed, this gap could eventually make the Vision read as overpromising relative to what the product does. I did not narrow the ambition (the broad framing is good and worth keeping), but I did make the mechanism's current scope explicit rather than implied, and I've flagged the boundary itself as an open question below rather than deciding it silently.
- The document implicitly assumes a single person, in a single session, exploring a single uploaded repository. This is consistent with the architecture as built, but it's worth naming as an assumption rather than a law — see Open Questions.

### Missing principles added
- Nothing in the original draft stated, as a *product* principle, that Cartograph never fabricates structure via a model. This is arguably the single most defensible thing about the product — it's a hard-won engineering commitment already — but it was invisible at the product-philosophy layer. It now appears twice, deliberately: once in "What Cartograph Is Not" (the boundary) and once in Core Principle 1 (the reasoning behind the boundary).
- Added the "depth over breadth" principle (Core Principle 2) and the "no language's shape is universal" principle (Core Principle 3), both directly informed by real engineering judgment already made on this project (the caution around C/C++'s link-time resolution; the file-vs-package granularity question ahead of Go). Elevating engineering judgment already earned the hard way into product philosophy protects it from being overridden later by a purely commercial "we need to announce a new language" pressure.
- Added the security/vulnerability-scanner disclaimer to "What Cartograph Is Not." Anomaly detection and dependency graphs sit close enough to security tooling in people's mental models that this boundary is worth stating explicitly before a feature request accidentally blurs it.

### Missing personas added
- The original draft listed *moments* (onboarding, contributing, reviewing legacy code) but not *people*. Added "Who Cartograph Is For," organized around distinct needs rather than distinct scenarios — in particular, the evaluator/due-diligence persona, whose relationship to trust and provenance is meaningfully different from a student's, and whose needs will pull the product in a different direction if not named explicitly.

### Missing long-term considerations
Covered in Open Questions below rather than decided here, per the instruction to preserve philosophy over inventing new commitments when uncertain.

### Statements likely to age poorly, and how they were handled
- "Asking an AI assistant to 'explain the project' often produces summaries, but not the structured understanding needed" reads as a claim about today's AI capability gap — one that could simply stop being true. Rewritten around the durable distinction instead: a generated explanation and a verified, persistent structure are different *kinds* of thing, regardless of how good the explanation gets. This should hold up whether it's read next year or in ten.

### Structural / identity sharpening
- The original had both a "Vision" section and a "Long-Term Vision" section, which read as two versions of the same thing rather than two sections with distinct jobs. Retitled the second to **"Ambition"** — Vision now carries the timeless *why*, Ambition carries the specific *position in the world* Cartograph is aiming for. This removes an accidental redundancy without cutting any content.
- Tightened the Mission statement so it states the *mechanism* (a single deterministic pass, producing something verifiable) rather than re-describing the same goal as the Vision in different words. Vision and Mission now do different jobs instead of overlapping.
- Left the boxed mission line — *"Cartograph helps people build accurate mental models of software systems before they work on them"* — completely unchanged. It's clearly meant to function as the document's one canonical, quotable sentence, and editing it, even to improve it, would undermine its role as a fixed reference point everything else is checked against.

---

# Open Questions

Deliberately left undecided. Each of these deserves an actual design conversation, not a default inherited silently from how the product happens to work today.

1. **Is Cartograph fundamentally single-person and single-session, or does the "first tool people open" ambition eventually require team/organizational use** — a shared map a whole team references, annotates, or onboards new members through? The current architecture (upload, analyze, get a link) doesn't preclude this, but it doesn't anticipate it either, and the answer has real implications for accounts, persistent per-organization state, and permissions.

2. **Does "understanding a software system" stay scoped to a single parseable repository, or does it eventually need to span multiple repositories or services** — the way a real system, especially a microservice architecture, often does? The current model (one zip, one graph) is single-repo by construction. Whether that's a permanent boundary or a first step is unresolved.

3. **Is Cartograph a snapshot tool or a living one?** Today, a map reflects the state of a project at the moment it was uploaded. A more ambitious long-term version might track a repository continuously, showing how its architecture evolves over time rather than producing a single point-in-time artifact. This is a large product and technical decision — incremental re-analysis, diffing between snapshots, persistent tracking — and shouldn't be assumed either way by the current wording.

4. **If Cartograph ever supports third-party or plugin-based language parsers, does the product-level promise "Cartograph never executes your code" still hold without qualification?** The engineering guarantee today is about the *uploaded repository*; it was never written to make a claim about the trust level of the *parser* analyzing it. If third-party parsers are ever introduced, the public-facing version of this promise likely needs to be restated more precisely — but that's a decision for whenever that milestone is real, not something to resolve by implication now.

5. **Does "software" in this document's broadest framing stay scoped to source code, or does it eventually reach toward infrastructure-as-code, generated code, or non-code architectural artifacts?** The opening problem statement is written broadly enough to invite this question; the mechanism (static analysis of source files) currently answers it narrowly. Worth being honest that these two things aren't the same size yet, without forcing a premature decision about whether they should become the same size.
