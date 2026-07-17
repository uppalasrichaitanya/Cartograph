# Cartograph — Project Philosophy

**Version:** 1.0  
**Status:** Approved (Frozen)  
**Last Updated:** July 2026

---

# Philosophy

Cartograph is founded on a simple belief:

> **Software architecture should be discovered through evidence, not inferred through intuition.**

Every design decision in Cartograph exists to reinforce this principle.

The project values correctness, determinism, explainability, and long-term maintainability over shortcuts, hidden heuristics, or impressive-looking features that cannot be trusted.

The architecture is intentionally designed to evolve for many years without compromising these principles.

---

# Core Engineering Principles

## 1. Determinism Over Convenience

Given the same repository and the same version of Cartograph, the output should always be identical.

Architecture should never depend on randomness, execution order, AI reasoning, or external state.

Determinism is a user-facing promise, not merely an implementation detail.

---

## 2. Verified Facts Over Inferred Knowledge

Every architectural fact must originate from something that can be verified.

Examples include:

- Parsed imports
- Module declarations
- Dependency edges
- Graph computations
- User-defined metadata

Architecture is never created through speculation.

When certainty is impossible, Cartograph explicitly communicates uncertainty instead of pretending confidence.

---

## 3. One Source of Truth

Cartograph maintains exactly one verified representation of a repository.

Everything else derives from it.

Examples:

- Dependency Graph
- Architecture Model
- Health Analysis
- Impact Analysis
- AI Explanations
- Future Views

No subsystem is allowed to independently reinterpret the repository.

If two views disagree about the same fact, it is considered a pipeline bug.

---

## 4. AI Explains—It Never Authors

Artificial Intelligence is an explanation layer.

It is not an architecture generation layer.

AI is permitted to:

- Explain
- Summarize
- Compare
- Teach
- Answer questions

AI is **not** permitted to:

- Invent dependencies
- Infer missing architecture
- Modify verified facts
- Create new relationships
- Rewrite the knowledge base

Every AI answer should ultimately trace back to verified repository facts.

---

## 5. Provenance Is Mandatory

Every piece of information carries provenance describing how it was obtained.

Examples include:

- Verified
- Derived
- Heuristic
- User Defined
- AI Interpretation

Provenance is never discarded.

Confidence never increases as information flows through the pipeline.

If a heuristic result is analyzed further, its descendants remain heuristic.

Trust is preserved by propagating uncertainty rather than hiding it.

---

## 6. Explainability

Every architectural insight should be explainable.

If Cartograph reports:

- High coupling
- Circular dependency
- Critical module
- Architectural hotspot

the user should always be able to ask:

> Why?

Cartograph should provide the exact graph evidence supporting the conclusion.

No result should behave like a black box.

---

## 7. No Execution of Uploaded Code

Uploaded repositories are never executed.

Cartograph performs:

- Static parsing
- Graph construction
- Deterministic analysis

Nothing more.

This principle protects:

- Security
- Privacy
- Reproducibility
- Trust

Any future feature requiring code execution belongs outside the core platform.

---

## 8. Extensibility Without Special Cases

Adding a new language should require implementing a parser—not modifying the platform.

Adding a new analyzer should require implementing an analyzer—not rewriting existing analyzers.

Adding a new architectural view should consume existing verified knowledge rather than duplicating logic.

Growth should occur through extension points rather than exceptions.

---

## 9. Simplicity Before Cleverness

Complexity should only exist where it provides measurable value.

Engineering decisions should favor:

- Clear code
- Predictable behavior
- Maintainability
- Explicit contracts

Premature abstractions should be avoided.

The architecture should remain understandable by future contributors.

---

## 10. Security By Design

Security is not a feature.

It is a design constraint.

Examples include:

- Zip validation
- Resource limits
- Parser isolation
- Input hardening
- Safe defaults

Every subsystem should assume hostile input.

---

# Product Identity

Cartograph is **not** trying to become:

- An IDE
- A Compiler
- A Build System
- A Vulnerability Scanner
- A CI Policy Engine
- A Coding Assistant
- A Sourcegraph replacement

Its responsibility is intentionally narrow:

> Understand software architecture.

Everything else builds upon that understanding.

---

# Long-Term Design Philosophy

Cartograph evolves through four layers.

## Layer 1

Language Parsers

↓

Extract verified repository facts.

---

## Layer 2

Verified Knowledge Base

↓

Normalize every language into one deterministic representation.

---

## Layer 3

Architecture Intelligence

↓

Health

Impact

Dependencies

Architecture Models

Future analyzers

---

## Layer 4

AI

↓

Reads verified knowledge.

Explains architecture.

Answers questions.

Never creates facts.

---

# Engineering Rules

Whenever an engineering decision is unclear, prefer the option that best satisfies these rules.

1. Determinism over convenience.
2. Verified facts over inferred knowledge.
3. Simplicity over unnecessary abstraction.
4. One source of truth.
5. Extensibility without special cases.
6. AI explains, never invents.
7. Preserve provenance.
8. Never execute uploaded code.
9. Every insight must be explainable.
10. Security before convenience.

---

# Decision Checklist

Before merging any architectural change, contributors should ask:

- Does this preserve determinism?
- Does it introduce hidden heuristics?
- Does it require executing uploaded code?
- Does it violate provenance?
- Can the result be explained?
- Does it create another source of truth?
- Does it simplify or unnecessarily complicate the architecture?
- Is this consistent with Cartograph's long-term vision?

If the answer to any of these questions is "No," the change should be reconsidered.

---

# Philosophy Statement

> Cartograph exists to understand software architecture through deterministic, verifiable, and explainable analysis.

Every parser, analyzer, visualization, and AI capability must ultimately reinforce that mission.

Technology may evolve.

Languages may change.

Models may improve.

These principles should remain constant.