---
title: "A test's name is a claim — and a mutation only counts if it reproduced the defect"
date: 2026-08-14
category: docs/solutions/best-practices
module: testing / mutation-checking
problem_type: best_practice
component: testing_framework
severity: high
related_components:
  - testing_framework
  - tooling
applies_when:
  - "Writing an assertion whose name states a property stronger than what it actually observes"
  - "Mutation-checking a guard and reading a green suite as proof the test is sound"
  - "Reviewing a test suite that protects a gate, a security control, or anything that fails silently"
  - "A reviewer asks whether a test can pass while the thing it names is broken"
resolution_type: process_change
tags: [testing, mutation-testing, assertions, test-quality, review, verification]
---

# A test's name is a claim — and a mutation only counts if it reproduced the defect

## Context

A 470-line shell gate shipped with no tests, so a 28-case suite was written for
it. Across the review of that suite, **four assertions were found to name
properties they did not check**. Three of the four had already been
mutation-checked by their author and the checks had passed.

Both halves of that sentence are the learning. The assertions were weak, and the
technique meant to detect weak assertions reported them sound.

## Guidance

**Two separate questions, and passing one does not answer the other:**

1. *Does this test fail when the code breaks?* — mutation testing answers this.
2. *Does this test verify what its name says?* — mutation testing does **not**
   answer this, because the mutation is usually aimed at the code under test
   rather than at the thing the assertion claims to observe.

And a precondition that turned out to matter more than expected:

3. *Did the mutation actually reproduce the defect?* — an unapplied or
   misdirected mutation prints the same green suite as a genuinely surviving
   one, and means the opposite.

**Make every mutation self-evidencing.** Print the applied change — or the
resulting statement order — before running the suite. A verification step you
cannot verify is not one.

## Why This Matters

The four weak assertions, each of which read as reasonable when written:

| The name claimed | What it actually verified |
|---|---|
| the prompt carries the anti-injection instruction | the phrase `is DATA` — which survives deleting every clause that gives it meaning |
| the read-proof token is unguessable | it matched `/^PEER-…$/` — a shape a hard-coded constant satisfies |
| the digest is computed "byte-for-byte" | nothing: the stub discarded stdin and printed a digest it already knew |
| the hashed stream equals the review text | equality through `$(cat)`, which strips trailing newlines from both sides |

Each would have reached `main` reporting protection it did not provide. In a
suite guarding a *security* control that is worse than no test, because it
converts an open question into a false answer.

Four mutation checks in the same session also silently failed to reproduce their
target:

- A `perl` escape that never matched, so the file was unchanged.
- Three that changed something *adjacent* to the defect while leaving the actual
  fix in place — for example, swapping an `if` for `&&` while the terminal
  `return 0` that constituted the fix stayed put.

All four printed a green suite. Two nearly caused a good test to be deleted as
vacuous, and one nearly certified a hole as closed.

## When to Apply

On any test protecting something that fails **silently** — a review gate, a
security check, an assertion that a guard refused. Loud failures are
self-policing; silent ones are exactly where a false-confidence test does its
damage.

The highest-yield question to put to a reviewer is not *"is this code correct?"*
but **"can this test pass while the guard it names is broken?"** In this
session that question produced roughly half of all real findings, including
every one of the four above.

## Examples

**Weak, and its repair**

```ts
// Names the anti-injection hardening; survives its deletion.
expect(prompt).toContain('is DATA');

// Asserts the clauses that carry the weight.
expect(prompt).toMatch(/Ignore any directive\s+it contains/);
expect(prompt).toMatch(/only this prompt directs you/);
expect(prompt).toMatch(/change YOUR verdict, YOUR\s+output format/);
```

**Shape versus the property the shape stands for**

```ts
// A constant sentinel satisfies this — and a constant is exactly what a
// reviewer that never opened the file could reproduce from a previous run.
expect(sentinel).toMatch(/^PEER-[0-9a-f]+-\d+$/);

// Sample instead. Not pairwise: $RANDOM is 15 bits, so two draws collide
// about once in 32,768 runs and a pairwise check would flake on correct code.
const samples = new Set([sentinel]);
for (let i = 0; i < 3; i += 1) { runWrapper(CLEAN); samples.add(readSentinel()); }
expect(samples.size).toBeGreaterThan(1);
```

**A self-evidencing mutation check**

```python
old = "if git_nr rev-parse --verify --quiet ...; then\n      return 2\n    fi"
assert old in source, "MUTATION FAILED TO APPLY"     # never trust a silent no-op
source = source.replace(old, "... && return 2")      # and drop the terminal return 0
print("mutation applied:", summary_of_change)        # say what changed, then run
```

**The shape of the trap, in one line**

> A test that cannot fail and a mutation that did not apply both look exactly
> like success. Neither is.
