# Cartograph Product Bible

# Volume I — Product DNA

## Document 03 — Experience Goals

**Status:** Freeze Candidate  
**Version:** 2.1

**Depends On**

- Document 01 — Vision
- Document 02 — Design Values

---

> **"Every interaction should leave people understanding their software more clearly than before."**

---

# Introduction

People do not come to Cartograph because they want to view dependency graphs.

They come because they want to understand software.

Sometimes that software is unfamiliar.

Sometimes it is overwhelming.

Sometimes it is their own code after months away.

Sometimes it belongs to an entirely different team.

The repository changes.

The user's need for understanding does not.

This document defines the experience Cartograph promises to create, independent of implementation details, interface layouts, or future technologies.

Interfaces will evolve.

Features will evolve.

Visual design will evolve.

The experience should remain recognizable.

---

# The Experience Philosophy

Cartograph exists to reduce the effort required to understand software.

Not by reducing the complexity of the software itself.

But by reducing the unnecessary complexity involved in discovering, navigating, and understanding it.

Every interaction should leave users with:

- greater orientation,
- greater clarity,
- greater confidence,
- and a stronger mental model than before.

The product succeeds when users begin thinking less about Cartograph and more about their repository.

---

# Why People Arrive

Different people arrive for different reasons.

A student wants to understand an unfamiliar open-source project.

A developer has joined a new company.

A maintainer is investigating architectural drift.

A researcher is studying a large repository.

An engineer returns after several months and no longer remembers how everything fits together.

An evaluator wants to understand whether Cartograph itself is trustworthy.

Their goals differ.

Their uncertainty is shared.

Cartograph's responsibility begins with recognizing that uncertainty and gradually replacing it with understanding.

---

# The Human Journey

Understanding rarely appears all at once.

People build mental models through exploration.

Cartograph should intentionally support that progression.

```
Uncertainty
        ↓
Orientation
        ↓
Curiosity
        ↓
Exploration
        ↓
Recognition
        ↓
Understanding
        ↓
Confidence
        ↓
Accomplishment
```

Recognition represents the moment when isolated observations begin forming meaningful patterns.

Users stop seeing individual files, nodes, or relationships and begin recognizing architectural structures, recurring concepts, and familiar design patterns.

Recognition bridges exploration and genuine understanding.

Every feature should strengthen at least one transition.

No feature should reverse one.

---

# Experience Framework

This document describes experience through three complementary lenses.

Each exists for a different purpose.

## Experience Invariants

Enduring truths that should remain valid regardless of how Cartograph evolves.

These are promises made to every user.

---

## Experience Principles

Design heuristics used while creating interactions and experiences.

When experience principles conflict, decisions should follow the **Design Decision Hierarchy** defined in **Document 02 — Design Values**.

---

## Experience Moments

Critical moments where users are especially sensitive to the quality of the experience.

These deserve disproportionate care during design and implementation.

---

# Experience Invariants

## Users should never feel lost.

Orientation is fundamental.

Users should always understand where they are, what they are looking at, and how they reached that point.

---

## Users should never need to understand Cartograph before understanding their repository.

The interface should always remain easier to understand than the software it explains.

Complexity belongs to the repository.

Not to Cartograph.

---

## Every interaction should increase understanding.

Every meaningful interaction should answer a question, reveal context, or strengthen a mental model.

Interactions that merely consume attention should not exist.

---

## The repository remains the hero.

The interface exists to support understanding.

It should never compete with the repository for attention.

---

## Users should leave more capable than when they arrived.

Cartograph exists to improve human understanding—not replace it.

Confidence should remain after the browser is closed.

---

# The Experience of Truth and Uncertainty

Understanding depends upon trust.

Trust depends upon honesty.

Cartograph should distinguish between what it knows, what it infers, and what it cannot determine.

The experience of uncertainty is just as important as the experience of certainty.

Users should never mistake incomplete analysis for incorrect analysis.

Likewise, they should never mistake confidence for proof.

Whenever uncertainty exists, the interface should communicate it clearly without undermining trust in verified information.

The experience should naturally distinguish three different states.

## Verified

Cartograph has deterministic evidence.

Users should feel confident relying upon it.

---

## Inferred

Cartograph has reasonable evidence but cannot guarantee correctness.

Users should understand why the inference exists.

Confidence should always remain proportional to evidence.

---

## Unknown

Cartograph cannot determine the answer.

This is not failure.

It is an honest representation of reality.

Unknown information should be presented clearly, respectfully, and without unnecessary alarm.

---

The exact experience of future AI-generated insights remains an intentional open question.

As Cartograph evolves, users should always be able to distinguish deterministic analysis, heuristic inference, and AI-assisted reasoning.

The interaction model for AI-generated understanding will be defined separately and remains tracked in the Open Questions Register.

Truth builds trust.

Honest uncertainty preserves it.

---

# Experience Moments

## Arriving

The product should immediately reduce uncertainty.

Users should understand what Cartograph does and why it exists before interacting with it.

---

## Beginning Understanding

Beginning analysis should feel like beginning exploration rather than completing setup.

The experience should communicate progress without overwhelming users with implementation details.

---

## Repository Processing

Repository processing is an active part of the understanding experience rather than idle waiting.

The system should communicate meaningful progress.

Whenever appropriate, it should educate users about what is happening rather than merely displaying activity.

Users should feel:

- informed,
- reassured,
- curious,
- confident.

Never:

- forgotten,
- abandoned,
- uncertain whether progress is occurring.

---

## First Orientation

This is one of Cartograph's defining moments.

Success is not when the graph appears.

Success is when users immediately understand something they did not understand before.

The interface should prioritize orientation before exploration.

Users should know:

- where they are,
- what they are seeing,
- where they should begin.

Cartograph should strive for an **"Ah..."** moment rather than a **"Wow..."** moment.

Wonder fades.

Understanding remains.

---

## Exploration

Exploration should feel natural rather than mechanical.

Every interaction should answer one meaningful question while encouraging another.

Curiosity should consistently lead toward greater understanding.

---

## Returning

Returning should never feel like starting over.

Users should regain orientation quickly and reconnect with the mental model they previously built.

The product should help users answer:

- Where am I?
- What do I already understand?
- Where should I continue?

Whenever additional historical context is available, Cartograph should use that context to accelerate orientation without making that capability a requirement of the experience.

Regardless of how a repository is revisited, users should immediately feel that their previous understanding remains valuable.

---

## Continuing Beyond Cartograph

The product's influence should extend beyond the current session.

Users should leave believing:

> "I know where to begin."

Not:

> "I know how to operate Cartograph."

---

# Experience Principles

## Reduce Friction

Remove unnecessary decisions.

Every avoidable interaction increases cognitive load.

---

## Preserve Momentum

Avoid interrupting exploration unnecessarily.

Interruptions should occur only when they protect truth, trust, or understanding.

---

## Make Progress Visible

Users should always feel that understanding is increasing.

Progress should never become invisible.

---

## Earn Attention

The interface should never demand attention.

It should earn attention by revealing something valuable.

Animations.

Highlights.

Notifications.

Panels.

Every element should justify the attention it requests.

---

## Respect Mental Energy

People arrive with limited attention.

Cartograph should invest that attention in understanding software—not understanding the tool.

---

## Experience Matures With Familiarity

The experience should mature alongside the user's understanding.

New users should feel welcomed without becoming overwhelmed.

Returning users should discover additional depth without needing to relearn the product.

Expertise should feel like uncovering new capabilities rather than adapting to an increasingly complex interface.

The interface should remain familiar while the user's understanding continues to grow.

---

# Experience Debt

Experience Debt is created whenever users spend unnecessary mental effort operating Cartograph instead of understanding their software.

Examples include:

- unnecessary dialogs,
- hidden navigation,
- confusing terminology,
- unexplained waiting,
- loss of orientation,
- excessive configuration,
- inconsistent interactions,
- unnecessary visual noise.

Like technical debt, experience debt compounds.

Small inconveniences accumulate into friction.

Experience debt often accumulates gradually through individually small decisions.

Reducing experience debt should be treated as continuous product maintenance rather than an occasional redesign effort.

---

# Measuring Success

Cartograph should not measure success solely by engagement or interaction.

Instead, successful experiences produce observable outcomes.

Users should:

- regain orientation quickly,
- navigate intentionally rather than randomly,
- ask increasingly specific questions,
- recognize architectural patterns,
- understand why relationships exist,
- appropriately trust verified information,
- appropriately question uncertain information,
- leave with greater confidence than when they arrived.

These are experience outcomes rather than analytics metrics.

---

# Relationship to Other Documents

This document builds upon:

- Document 01 — Vision
- Document 02 — Design Values

This document informs:

- User Journeys
- Information Architecture
- Workspace Architecture
- Interaction Language
- Motion Language
- Screen Specifications

Shared architectural and product questions remain documented in the Open Questions Register.

---

# Closing Statement

Software is inherently complex.

Understanding it should not be.

Cartograph cannot remove the complexity of a repository.

It can remove the unnecessary complexity of discovering, navigating, and understanding it.

Every interaction should help users invest less effort in operating the tool and more effort in building an accurate mental model of their software.

The product succeeds not when people remember Cartograph.

It succeeds when they remember what they learned.