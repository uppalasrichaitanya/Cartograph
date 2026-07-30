# Document 04 — Interaction Philosophy

**Status:** Draft v1.0

---

# Introduction

Every product is ultimately defined by the interactions it creates.

A product's vision explains why it exists.
Its values explain what it chooses to prioritize.
Its experience goals explain how people should feel while using it.

Interaction philosophy answers a different question.

> **How does understanding actually emerge through the product?**

This question is fundamental to Cartograph.

Cartograph does not exist simply to visualize repositories.
It does not exist merely to analyze source code.
It does not exist to generate explanations.

It exists to help people understand software.

That understanding is never created by a graph alone.
Nor by a search result.
Nor by an animation.
Nor by an AI explanation.

Understanding emerges through the continuous relationship between a person's curiosity and the repository's structure.

Interaction is the medium through which that relationship is built.

Every search, every selection, every transition, every visualization, every piece of feedback, and every future capability ultimately participates in this process.

This document establishes the philosophy that governs those interactions.

It defines what interaction exists to accomplish, the responsibilities every interaction carries, and the principles that should guide interaction design throughout Cartograph's lifetime.

It is intentionally independent of specific technologies, visual styles, or implementation details.

Interaction methods will evolve.

Input devices will change.

Representations will improve.

New capabilities—including future AI-assisted experiences—will emerge.

The responsibilities of interaction should remain recognizable regardless of those changes.

---

# What Interaction Is

Interaction is often misunderstood as the act of operating software.

Buttons.

Menus.

Keyboard shortcuts.

Drag-and-drop.

Gestures.

Animations.

These are not interaction.

They are mechanisms through which interaction becomes possible.

Interaction itself is something deeper.

Interaction is the ongoing exchange between human curiosity and software structure.

A person approaches a repository carrying uncertainty.

The repository contains relationships, constraints, architecture, and behavior that already exist, whether the person understands them or not.

Cartograph exists to reduce the distance between those two states.

Every meaningful interaction should move someone from uncertainty toward understanding.

Importantly, interaction should not be measured by how much the interface changes.

It should be measured by how much the user's understanding changes.

Opening a graph is not valuable because a graph appeared.

It is valuable if the person now understands relationships they previously could not explain.

Searching for a symbol is not valuable because search completed successfully.

It is valuable if uncertainty was reduced.

Likewise, an interaction that changes application state without improving understanding should be able to justify why it exists.

Throughout this document, the word **conversation** is occasionally used as a conceptual model.

It describes the exchange of intent, evidence, and understanding that occurs through interaction.

It does **not** imply that Cartograph is fundamentally a conversational or chat-based product.

Whether interaction occurs through graphs, search, structured navigation, future AI assistance, or capabilities that do not yet exist, every interaction remains governed by the same principles established throughout the Product Bible:

- deterministic analysis should remain distinguishable from generated reasoning,
- confidence should remain proportional to evidence,
- and understanding should always take precedence over convenience.

Interaction is therefore not the operation of software.

Interaction is the process through which understanding is progressively constructed.

---

# The Purpose of Interaction

Every interaction in Cartograph exists to serve one objective.

> **To help people construct increasingly accurate mental models of a software system.**

Understanding is rarely delivered all at once.

Instead, it grows through many small interactions.

Every interaction changes the person's internal representation of the repository.

Some interactions answer questions.

Some preserve orientation.

Some reveal relationships.

Some reinforce confidence.

Some simply remove friction so that thinking can continue uninterrupted.

Regardless of their form, every interaction should contribute to the same outcome:

A clearer understanding than existed before.

This has an important consequence.

Interaction should never be evaluated solely by efficiency.

A workflow can be fast while producing poor understanding.

Likewise, an interaction may require deliberate attention while enabling significantly deeper comprehension.

Efficiency matters.

Understanding matters more.

The purpose of interaction is therefore not to minimize effort at all costs.

It is to ensure that every unit of effort invested produces meaningful understanding in return.

Whenever interaction introduces cost, that cost should purchase greater clarity.

Whenever interaction demands attention, that attention should strengthen the user's mental model.

Whenever interaction interrupts existing understanding, it should do so only because something more valuable becomes possible afterward.

These ideas underpin every principle that follows.

---

# The Four Purposes of Interaction

Not every interaction exists for the same reason.

Before evaluating whether an interaction is good, it is necessary to understand what role that interaction is intended to play.

Cartograph recognizes four fundamental purposes of interaction.

These are classifications rather than priorities.

An interaction may contribute to several purposes simultaneously, but it should always have one primary responsibility.

The interaction principles described later in this document apply equally to all four.

---

## 1. Asking

Every exploration begins with a question.

Sometimes that question is explicit.

> "Where is this function used?"

Sometimes it is only partially formed.

> "This module feels important."

> "I don't understand this dependency."

> "Something here seems unusual."

Searching, selecting, filtering, zooming, expanding a relationship, or opening a new representation are not merely interface operations.

They are questions expressed through interaction.

Asking interactions exist to reduce the effort required to express curiosity.

Their responsibility is to transform intention into exploration.

Good asking interactions respect the way people naturally think.

They should never require users to translate their curiosity into arbitrary interface mechanics.

People should feel that they are investigating the repository rather than learning how to operate Cartograph.

Examples include:

- Searching for files, symbols, or concepts.
- Selecting nodes or relationships.
- Filtering information.
- Focusing a particular subsystem.
- Opening alternative representations.
- Beginning new paths of exploration.

The quality of an asking interaction is measured by how naturally people can express meaningful questions.

---

## 2. Answering

Questions deserve answers.

However, answers carry responsibilities beyond simply presenting information.

Every answer changes what someone believes about the repository.

Incorrect answers damage understanding.

Uncertain answers presented as certain damage trust.

Incomplete answers presented as complete discourage further exploration.

Answering interactions therefore exist not only to reduce uncertainty, but also to communicate the quality of that reduction.

An answer may take many forms.

It may be:

- a structural relationship,
- a dependency graph,
- a search result,
- a statistical summary,
- a file,
- a metric,
- a visual representation,
- or, in the future, an AI-assisted explanation.

Regardless of representation, every answer should communicate two things simultaneously:

**What is known.**

**How confidently it is known.**

Verified structural facts, inferred relationships, unknown information, and future generated reasoning should never become visually or conceptually indistinguishable.

Understanding depends upon receiving information.

Trust depends upon understanding the confidence that information deserves.

Answering interactions therefore exist to strengthen both.

---

## 3. Guiding

Repositories are rarely explored in straight lines.

People continuously change perspective.

They move between overview and detail.

They compare subsystems.

They follow dependencies.

They switch representations.

They temporarily leave one line of reasoning before returning to another.

Without guidance, this freedom quickly becomes disorientation.

Guiding interactions exist to preserve orientation throughout exploration.

They help answer questions such as:

- Where am I?
- How does this relate to what I'm already exploring?
- What surrounds this component?
- How can I return to where I was?
- Which direction should I investigate next?

Good guidance never controls exploration.

Instead, it provides confidence that exploration remains understandable.

Orientation is more than navigation.

It is the confidence that one's current understanding remains connected to the larger structure of the repository.

Every guiding interaction should strengthen that confidence.

---

## 4. Confirming

Interaction is communication.

Communication requires acknowledgement.

People should never wonder whether the product understood their intent.

Nor should they wonder whether important actions completed successfully.

Confirmation interactions reinforce predictability.

They communicate that an interaction has occurred, that the system's state is understood, or that uncertainty has been intentionally preserved.

Examples include:

- Analysis completion.
- Successful exports.
- Saved preferences.
- Recoverable destructive actions.
- Visible confidence indicators.
- Clear differentiation between verified information and generated reasoning.

Unlike the previous three purposes, confirmation does not exist independently.

It supports asking, answering, and guiding.

Its responsibility is not to create understanding directly.

Its responsibility is to ensure that understanding remains trustworthy, predictable, and dependable.

Without confirmation, every other interaction becomes less reliable.

With appropriate confirmation, people can focus their attention on understanding the repository rather than questioning the interface itself.

---

The four purposes above describe **what interactions exist to accomplish.**

The remainder of this document defines **how every interaction should behave**, regardless of which purpose it primarily serves.

# The Principles of Good Interaction

The Four Purposes describe **what** an interaction exists to accomplish.

The following principles define **how every interaction should behave**, regardless of which purpose it primarily serves.

Unlike the Four Purposes, these principles are not classifications.

They are responsibilities.

Every interaction—whether it is asking, answering, guiding, or confirming—should be evaluated against them.

These principles intentionally avoid prescribing specific interface patterns.

Buttons, gestures, keyboard shortcuts, graphs, future AI interfaces, and interaction methods that do not yet exist are all implementations.

The philosophy beneath them should remain stable.

Whenever two principles appear to conflict, the conflict should be resolved using the **Design Decision Hierarchy** established in **Document 02 – Design Values**.

The purpose of these principles is not to eliminate judgment.

It is to ensure that judgment remains consistent.

---

# Principle 1 — Begin with Intent

Every meaningful interaction begins before a person touches the interface.

It begins with intent.

People do not approach repositories wanting to operate software.

They approach repositories because they are trying to answer a question, solve a problem, investigate a relationship, or make a decision.

Interaction should therefore begin where people begin.

Not with interface mechanics.

With intent.

Navigation, search, filtering, selection, comparison, and visualization are valuable only because they help express intent.

When users spend more effort translating their curiosity into interface operations than exploring the repository itself, interaction has failed.

Good interaction reduces the distance between intention and exploration.

Great interaction makes that distance almost disappear.

### Requires

- Interactions built around meaningful developer questions.
- Navigation that exists to support exploration rather than becoming the objective itself.
- Multiple representations selected because they answer different questions—not because they are visually different.
- Interfaces that adapt naturally to the way developers investigate software.

### Forbids

- Workflows that require people to learn interface mechanics before they can begin understanding software.
- Features introduced because they are fashionable rather than useful.
- Navigation patterns that become obstacles instead of tools.
- Interactions whose primary purpose is showcasing the interface itself.

---

# Principle 2 — Respect Human Attention

Attention is the resource from which understanding is constructed.

Every interruption competes with reasoning.

Every unnecessary decision consumes cognitive capacity that could otherwise be invested in understanding software.

Interaction should therefore spend attention deliberately.

Complexity already exists within the repository.

The interface should not create additional complexity simply because it can.

Respecting attention does not mean removing capability.

It means ensuring that capability never demands more mental effort than the understanding it provides.

A powerful interface is not one that exposes every possible option immediately.

It is one that allows people to think continuously.

### Requires

- Recognition before recall whenever possible.
- Predictable interaction patterns.
- Minimal unnecessary context switching.
- Stable workflows that preserve concentration.
- Interfaces that support sustained reasoning.

### Forbids

- Decorative interaction that competes with understanding.
- Interruptions without meaningful purpose.
- Requiring memory where recognition would suffice.
- Interface complexity introduced only because of implementation constraints.

---

# Principle 3 — Build Understanding Progressively

Understanding is accumulated.

Rarely delivered.

People seldom arrive needing complete knowledge of a repository.

Instead, they seek enough understanding to answer the question immediately in front of them.

Each answer naturally changes what they ask next.

Interaction should support this progression.

Information should become available when it becomes meaningful.

This principle is frequently misunderstood as hiding complexity.

It is not.

Progressive understanding is about preserving comprehension, not restricting access.

Experts should never feel constrained.

Beginners should never feel overwhelmed.

Every layer of understanding should remain connected to the next.

### Requires

- Progressive disclosure driven by context rather than arbitrary interface states.
- Smooth transitions between overview and detail.
- Connected levels of abstraction.
- Exploration that naturally deepens understanding.

### Forbids

- Presenting complete complexity before sufficient context exists.
- Permanently hiding advanced capabilities.
- Interfaces that assume expertise by default.
- Simplification that removes meaning instead of reducing initial complexity.

---

# Principle 4 — Preserve Orientation

Understanding depends upon relationships.

Relationships depend upon orientation.

People cannot confidently reason about what they cannot mentally locate.

Orientation extends beyond navigation.

It includes spatial orientation, structural orientation, conceptual orientation, and continuity throughout exploration.

Every interaction should preserve the user's ability to answer fundamental questions:

Where am I?

How is this connected to what I already know?

What changed in my perspective?

How do I return?

Orientation protects previously constructed mental models.

Disorientation forces them to be rebuilt.

Good interaction therefore treats continuity as a responsibility rather than a convenience.

### Requires

- Stable visual landmarks.
- Predictable transitions between representations.
- Persistent structural context.
- Easily recoverable exploration paths.
- Motion that reinforces rather than replaces spatial understanding.

### Forbids

- Abrupt context changes without explanation.
- Interfaces that require users to mentally restart exploration.
- Motion that prioritizes spectacle over continuity.
- Navigation patterns that erase previously established understanding.

---

# Principle 5 — Communicate with Honesty

Interaction is communication.

Communication establishes trust.

Trust depends upon honesty.

Every representation is incomplete.

Graphs emphasize relationships.

Source code emphasizes implementation.

Statistics emphasize patterns.

Future generated explanations may emphasize interpretation.

Each representation reveals certain truths while concealing others.

Interaction therefore carries an obligation not only to communicate information, but also to communicate the confidence that information deserves.

Cartograph's commitment is not certainty.

Its commitment is transparency.

Verified structural facts.

Reasonable inference.

Unknown information.

Future generated reasoning.

Each deserves distinct treatment.

Users should always understand:

What the product knows.

What it reasonably believes.

What it cannot determine.

What has been generated to assist understanding.

Understanding grows through evidence.

Trust grows through honesty.

### Requires

- Confidence proportional to evidence.
- Clear distinction between deterministic analysis and future generated reasoning.
- Visible acknowledgement of uncertainty.
- Evidence that remains independently inspectable.

### Forbids

- False certainty.
- Concealing uncertainty for the sake of simplicity.
- Equal visual treatment for unequal confidence.
- Asking users to trust conclusions without showing why those conclusions deserve trust.

---

# Principle 6 — Encourage Discovery

Answering questions is necessary.

Encouraging better questions is transformative.

Good interaction supports curiosity without attempting to control it.

Discovery should never feel random.

Nor should it become an endless chain of unrelated recommendations.

Instead, interaction should reveal opportunities that naturally emerge from the user's current understanding.

Every meaningful discovery should strengthen the mental model already being constructed.

Unexpected architectural insight should feel inevitable in retrospect.

Not accidental.

### Requires

- Relevant adjacent relationships.
- Context-sensitive opportunities for exploration.
- Discovery grounded in the current task.
- Exploration that expands rather than distracts.

### Forbids

- Novelty introduced solely for delight.
- Recommendations disconnected from current understanding.
- Endless exploration without direction.
- Interaction patterns that reward curiosity while weakening focus.

---

# Principle 7 — Strengthen Independent Thinking

Cartograph exists to strengthen human understanding.

Not replace it.

Every interaction should leave people more capable than they were before.

This principle becomes increasingly important as future AI capabilities evolve.

Generated reasoning should expand understanding.

It should never become a substitute for understanding.

People should retain the ability to question, verify, refine, and extend every conclusion the product presents.

Convenience should never come at the cost of intellectual independence.

A successful interaction is one that eventually becomes unnecessary because the person has learned.

### Requires

- Explanations that teach rather than merely answer.
- Opportunities for verification.
- Interfaces that encourage investigation.
- AI assistance grounded in evidence and transparent uncertainty.

### Forbids

- Opaque conclusions.
- Features that discourage independent reasoning.
- Generated content presented as unquestionable authority.
- Optimizing convenience by reducing understanding.

---

# Principle 8 — Earn Every Interaction

Interaction is never free.

Every click asks for attention.

Every animation asks for time.

Every transition asks for interpretation.

Every notification asks for interruption.

Every setting asks for memory.

Every panel asks for visual space.

These costs become worthwhile only when they purchase greater understanding.

Interaction should therefore justify its own existence.

Every interaction should strengthen at least one of the following:

- Understanding.
- Orientation.
- Trust.
- Focus.
- Discovery.
- Independent reasoning.

If an interaction contributes to none of these responsibilities, it should not exist.

Restraint is therefore not the absence of design.

It is evidence of deliberate design.

### Requires

- Continuous evaluation of interaction value.
- Simplicity without sacrificing capability.
- Features with explicit purpose.
- Deliberate use of interaction rather than habitual use.

### Forbids

- Decorative interaction.
- Features without meaningful responsibility.
- Interface patterns copied because they are familiar elsewhere.
- Visual spectacle used as a substitute for product quality.

# Cognitive Cost

## Every Interaction Has a Cost

Interaction is never free.

Every interaction asks something of the person using it.

A click asks for attention.

A transition asks for interpretation.

A notification asks for interruption.

A setting asks for memory.

A confirmation asks for judgment.

An explanation asks for cognitive effort.

These costs are not inherently undesirable.

In many cases they are necessary.

The responsibility of interaction design is therefore not to eliminate cost.

It is to ensure that the understanding gained always exceeds the interaction required.

Interaction becomes wasteful when people spend more effort operating the interface than understanding the repository.

It becomes valuable when every investment of attention produces greater clarity in return.

Cognitive cost should therefore be treated as a design resource rather than something to minimize indiscriminately.

Some interactions deserve more attention because they communicate important truths.

Others should become nearly invisible because requiring attention would provide no additional value.

Understanding should always remain the primary investment.

---

## Low Cognitive Cost

Low cognitive cost interactions are performed frequently.

They should become almost invisible through familiarity.

These interactions support exploration without interrupting reasoning.

Examples include:

- Selecting nodes.
- Panning and zooming.
- Hovering relationships.
- Basic filtering.
- Expanding information already expected.
- Moving between closely related views.

Characteristics:

- Immediate.
- Predictable.
- Recoverable.
- Minimal explanation.
- Consistent behavior.

People should rarely think about these interactions directly.

Instead, they should become extensions of exploration itself.

---

## Medium Cognitive Cost

Medium cognitive cost interactions change perspective rather than simply revealing information.

They ask people to reinterpret what they already know.

Examples include:

- Switching representations.
- Comparing architectural views.
- Applying complex filters.
- Investigating dependency paths.
- Moving between different levels of abstraction.

These interactions deserve more guidance because they ask people to rebuild context rather than merely continue existing exploration.

Characteristics:

- Preserve orientation.
- Explain perspective changes.
- Maintain continuity.
- Keep previous understanding usable.

Medium-cost interactions should never feel like beginning again.

They should feel like seeing the same repository from a more appropriate perspective.

---

## High Cognitive Cost

High cognitive cost interactions significantly affect understanding, confidence, or trust.

These interactions deserve the greatest design care because mistakes made here have disproportionate consequences.

Examples include:

- Beginning repository analysis.
- Exporting architectural reports.
- Destructive actions.
- Significant workspace changes.
- Future AI-generated architectural reasoning.
- Interactions that communicate uncertainty.

High-cost interactions should communicate clearly:

- What is happening.
- Why it matters.
- How confident the product is.
- Whether the interaction can be reversed.
- What the user should reasonably expect next.

Interaction should never attempt to hide important complexity simply because it requires attention.

Some moments deserve deliberate thought.

Good interaction recognizes which moments those are.

---

# Silence Is Also Interaction

Interaction is often associated with visible activity.

Clicks.

Motion.

Feedback.

Animations.

Notifications.

Cartograph adopts a broader understanding.

The absence of visible interaction is itself a design decision.

Silence communicates confidence.

Whitespace communicates hierarchy.

Stable layouts communicate predictability.

Consistent positioning communicates memory.

Motion withheld communicates restraint.

An interface that constantly seeks attention eventually teaches people to ignore it.

An interface that competes with understanding eventually becomes another problem to solve.

Good interaction earns attention.

Great interaction understands when attention should remain undisturbed.

Not every successful action requires celebration.

Not every completed process deserves animation.

Not every state change requires notification.

Restraint is not the absence of design.

It is one of the clearest demonstrations of confidence in a product.

The objective is never to create an interface that feels inactive.

The objective is to ensure that activity always carries meaning.

When interaction remains quiet, it should be because understanding does not require interruption.

---

# Interaction Debt

Every interaction teaches expectations.

Those expectations accumulate over time.

Interaction debt emerges whenever previous interaction decisions make future understanding more difficult.

Unlike visual inconsistency, interaction debt compounds.

Each additional inconsistency increases the effort required to perform every future task.

Examples include:

- Hidden functionality.
- Multiple competing workflows.
- Inconsistent behaviors.
- Unpredictable navigation.
- Interruptions during reasoning.
- Features that expose implementation details rather than solving user problems.
- Interface patterns that require memorization instead of recognition.

Interaction debt is often invisible while it is being created.

People rarely notice the first inconsistency.

They notice the accumulated friction produced by many inconsistencies.

Reducing interaction debt should therefore be treated with the same seriousness as reducing technical debt.

Both improve the quality of every future decision.

Whenever a new interaction is proposed, designers should ask not only:

> "Does this solve today's problem?"

but also:

> "What expectations will this teach over the next five years?"

The latter question often matters more.

---

# Decision Framework

Interaction principles become valuable only when they influence decisions.

Whenever a new interaction is proposed, modified, or removed, it should be evaluated against the following questions.

## 1. Does it begin with genuine user intent?

Does this interaction exist because people naturally ask for it?

Or because the interface expects it?

---

## 2. Does it improve understanding?

After completing this interaction, will someone understand the repository more clearly than before?

If not, why does it exist?

---

## 3. Does it preserve trust?

Does the interaction honestly communicate confidence, evidence, and uncertainty?

Could it accidentally imply greater certainty than the product possesses?

---

## 4. Does it preserve orientation?

Will people still understand where they are, how they arrived there, and how this interaction relates to their existing mental model?

---

## 5. Does it respect attention?

Is every moment of cognitive effort justified by a meaningful improvement in understanding?

Could unnecessary interaction be removed without reducing capability?

---

## 6. Does it encourage worthwhile discovery?

Does it reveal genuinely meaningful opportunities for deeper understanding?

Or merely encourage exploration without purpose?

---

## 7. Does it strengthen independent thinking?

Will people leave this interaction more capable of reasoning about the repository on their own?

Or more dependent upon Cartograph?

---

When multiple principles appear to conflict, those conflicts should not be resolved arbitrarily.

Instead, designers should apply the **Design Decision Hierarchy** established in **Document 02 – Design Values**.

Interaction philosophy explains the responsibilities of interaction.

Document 02 explains how competing responsibilities should be prioritized.

Together they provide a consistent framework for design decisions.

# Measuring Good Interaction

Interaction quality should never be evaluated solely by efficiency.

A fast interaction is not necessarily a good interaction.

A visually impressive interaction is not necessarily a meaningful interaction.

Likewise, reducing the number of clicks required to complete a task does not automatically improve understanding.

The objective of interaction is not merely to help people complete actions.

It is to help people develop increasingly accurate mental models of the software they are exploring.

For this reason, the success of interaction should be evaluated by its outcomes rather than its mechanics.

Good interaction enables people to:

- Ask increasingly precise questions.
- Reach meaningful answers without unnecessary effort.
- Build confidence supported by evidence rather than assumption.
- Maintain orientation while exploring unfamiliar repositories.
- Recover context quickly after interruptions or time away.
- Discover architectural relationships that were previously unclear.
- Distinguish verified information from inference, uncertainty, and generated reasoning.
- Develop stronger independent reasoning about the repository itself.

Perhaps the strongest measure of successful interaction is not what people accomplish while using Cartograph.

It is what they remain capable of explaining after they leave it.

If the product enables people to reason more accurately about software without relying upon the interface itself, interaction has succeeded.

---

# Relationship to Other Documents

The Product Bible is intentionally structured as a progression rather than a collection of independent documents.

Each document answers a different question while building upon those that precede it.

**Document 01 – Vision** establishes why Cartograph exists and the problem it seeks to solve.

**Document 02 – Design Values** establishes the values that guide design decisions and the hierarchy used to resolve conflicts between them.

**Document 03 – Experience Goals** describes the qualities the overall experience should create for the people using Cartograph.

This document explains how interaction realizes those commitments.

The documents that follow extend this philosophy into more specialized disciplines.

**Motion Language** explains how movement should reinforce understanding, preserve orientation, and communicate change.

**Visual Language** explains how hierarchy, typography, color, spacing, and composition communicate structural meaning.

**Information Architecture** defines how different representations cooperate without fragmenting understanding.

**Workspace Philosophy** defines how repositories should be organized, explored, and revisited over time.

**AI Philosophy** establishes how generated reasoning complements deterministic structural analysis while remaining transparent about confidence and evidence.

These future documents should elaborate upon the philosophy established here.

They should never contradict it.

Where shared concepts such as Trust, Attention, Orientation, Cognitive Cost, and Understanding appear across multiple Product Bible documents, they should ultimately be consolidated into a dedicated Canonical Concepts reference to ensure consistent definitions throughout the system.

---

# Closing Statement

Every interaction changes something.

Sometimes it changes the product.

More importantly, it changes the person's understanding.

That is Cartograph's responsibility.

Interaction should never exist merely to operate software.

It should exist to make software easier to reason about.

Every search should clarify.

Every transition should preserve orientation.

Every visualization should communicate honestly.

Every explanation should strengthen understanding.

Every moment of restraint should protect attention.

Every interaction should leave someone with a mental model that is more accurate than the one they possessed before.

When interaction succeeds, curiosity becomes exploration.

Exploration becomes understanding.

Understanding becomes confidence.

Confidence becomes thoughtful action.

Eventually, the interface begins to disappear.

The repository—not the product—becomes the focus.

People stop thinking about how to use Cartograph.

They begin thinking more clearly about their software.

That is the highest responsibility interaction can fulfill.

It is the standard by which every interaction within Cartograph should ultimately be judged.