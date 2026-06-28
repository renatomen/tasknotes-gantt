---
title: "Vault-as-code: reproduce real-data-only bugs with a generated faithful fixture, without leaking private data"
date: 2026-06-28
category: developer-experience
module: gantt-perf-harness
problem_type: developer_experience
component: testing_framework
severity: high
applies_when:
  - "A bug reproduces only on a large real/private vault, never on hand-made synthetic data"
  - "You need a fast, deterministic e2e/perf repro of a real-data-shaped bug"
  - "You want to commit a repro generator or perf fixture but the source data is private"
tags:
  - vault-as-code
  - repro
  - fixture
  - private-data
  - secret-redaction
  - faithful-generation
  - issue-161
  - testing-framework
---

# Vault-as-code: reproduce real-data-only bugs with a generated faithful fixture, without leaking private data

## Context

Some bugs live only on the real vault. The #161 U6 search→clear render loop was one: it fired
on the maintainer's large production vault but on **no** hand-made synthetic vault, even ones
built to "look like" it. A lossy clone that captured a handful of notes reproduced only ~6 of 13
bars and never triggered the loop — close-but-not-faithful data simply does not exercise the bug.

That leaves a hard tension. To reproduce the bug you need data with the **same shape** as the
real vault (files, folders, frontmatter, and the relationship graph that drives companion
expansion). But the real vault is private, and you want the repro to be **committable** — a
fixture other developers and CI can run. Capturing the real data verbatim into the repo solves
reproduction and creates a privacy leak in the same move.

The resolution is **vault-as-code**: a self-contained *generator* that reproduces the real
vault's structure from a baked description, so the repro is faithful and deterministic — paired
with a deliberate split that keeps the private payload out of the committed artifact.

## Guidance

**1. Generate a faithful structure; don't clone a lossy sample.** Reproducing a real-data bug
requires the dimensions the bug actually depends on to match *exactly*, not approximately. For
#161 those were: the same file paths and folder tree, the same frontmatter on every note, and —
critically — the **full** relationship graph, including notes that are *not* TaskNotes items
(parents/children with `isActionable: false`). The matched/companion-expanded set is a property
of the whole graph; drop the non-actionable nodes and the expansion (and the bug) changes.

**2. Strip only the dimension you can prove is irrelevant — and exploit it.** The bug depends on
frontmatter and relationships, not note *body* text. So bodies are generated **empty**. This is
both safe (proven: the loop still reproduces) and a speed win — blank bodies index far faster
than real prose (the real-vault index throttle was note bodies, not antivirus), which is what
makes a production-scale vault runnable inside a WDIO e2e at all. The move is legitimate only
because the stripped dimension was demonstrated not to matter to *this* bug.

**3. Replicate the dependency plugin's config, not just the notes.** Relationships resolve
through TaskNotes' field mappings (`projects → "in"`, `taskPropertyName → "isActionable"`,
`blockedBy → "blockedBy"`). A vault with perfect frontmatter but the wrong `data.json` resolves a
*different* graph and reproduces nothing. The generator bakes and writes the plugin `data.json`
too. (Caught early because fidelity was tested first — see guidance 5.)

**4. Make "vault-as-code" literal: the generator never reads the original at runtime.** The
algorithm consults the real vault **once**, at authoring time, to bake a fixture (`extract`).
From then on `generate` builds the vault purely from the baked fixture — delete the original and
it still regenerates byte-faithfully. Three subcommands keep the phases honest:

```
node scripts/vault-as-code.mjs extract  <real-vault> <fixture.json>   # consult original ONCE → bake
node scripts/vault-as-code.mjs generate <fixture.json> <out-vault>    # self-contained → vault
node scripts/vault-as-code.mjs verify    <fixture.json> <vault>       # fidelity + redaction gate
```

**5. Test fidelity before testing the bug.** The first deliverable is *not* a repro — it's proof
the generated vault is indistinguishable from the original in every dimension the bug cares about
(file set, folder tree, per-note frontmatter, plugin config). `verify` is that gate. Only once
fidelity passes does reproducing the loop mean anything; a bug that "reproduces" on infidelitous
data is measuring the wrong thing.

**6. A self-contained generator that bakes real data IS a leak vector — split it.** This is the
non-obvious part. "Self-contained" and "no private data in the repo" are in direct tension:
anyone who clones a self-contained generator whose fixture holds real frontmatter can regenerate
the private vault exactly. Resolve it by separating two artifacts:

- **Committed:** the generator algorithm (`scripts/vault-as-code.mjs`) + redacted plugin config.
- **Gitignored:** the baked fixture holding real frontmatter (`test/fixtures/*.vaultcode.json`).

Redact secrets during `extract` (a `TASKNOTES_SECRET_KEYS` set: auth tokens, license keys, OAuth
secrets, calendar sync tokens/integrations, webhooks). Then make `verify` **assert the redaction
stayed empty** — privacy becomes a test, not a hope. A committable, *anonymized* fixture (titles
and folder names rewritten while preserving the graph, status/date distributions, and the matched
set) is a separate, deliberate follow-up — not something a "self-contained generator" gives you
for free.

## Why This Matters

Without a faithful repro, a real-data-only bug is debugged by guesswork against production: slow,
non-deterministic, and impossible to gate in CI. Vault-as-code converted #161 U6 from
"reproduces only on the maintainer's machine, sometimes" into a fast, deterministic WDIO spec —
which is what made root-causing the loop and *proving* the fix (~388k → ~781 DOM mutations per
swing) possible at all.

The privacy split matters because the easy version of this technique is a quiet disaster. A
generator that "just works after clone" is exactly the property that publishes someone's private
notes the day it's committed. Treating the self-contained generator as a leak vector — and making
secret-redaction an asserted invariant rather than a manual step — is what lets the repro
infrastructure be shared without shipping the data it was built from.

## When to Apply

- A bug, freeze, or perf regression reproduces **only** on a large real vault and resists every
  synthetic reproduction. Faithful generation is the unlock; approximate clones waste time.
- You want a **committable** perf/realistic e2e fixture but the seed data is private — build the
  extract/generate/verify split with secret redaction from the start.
- You're tempted to commit a "self-contained" generator that bakes real data. Stop: that is a
  leak. Gitignore the real fixture; commit only the algorithm + redacted config until an
  anonymized fixture exists.

## Examples

**Fidelity-first, three-phase shape (`scripts/vault-as-code.mjs`):**

```
extract  →  bake real frontmatter + plugin config into a fixture, redacting TASKNOTES_SECRET_KEYS
generate →  rebuild the full vault (every note, empty body) + write plugin data.json, from fixture only
verify   →  diff generated-vs-source file set / frontmatter / plugin config  AND  assert secrets == ∅
```

**The gitignore split that resolves the leak tension (`.gitignore`):**

```
test/fixtures/maintest.vaultcode.json   # real frontmatter — NEVER committed
test/fixtures/maintest-profile.json     # structural profile — NEVER committed
```

…while `scripts/vault-as-code.mjs` (the algorithm) and the redacted config *are* committed.

**Privacy-as-a-test (the key inversion):** `verify` doesn't just check the vault renders — it
re-reads the redacted config and fails if any `TASKNOTES_SECRET_KEYS` value is non-empty. A leak
regression turns the build red instead of shipping silently.

**In one line:** to reproduce a real-data bug, *generate* a structure-faithful vault from a baked
fixture (empty bodies, real graph, real plugin config) — and because a self-contained generator
that bakes real data is a leak vector, commit the algorithm, gitignore the fixture, and make
secret-redaction an assertion.

## Related

- [match-harness-execution-model-to-bug-trigger.md](./match-harness-execution-model-to-bug-trigger.md)
  — sibling #161 harness learning. That one says *aim the harness at the bug's actual trigger*
  (the dynamic resultset path a static base-open can't reach); this one says *make the data
  faithful enough to fire that trigger*. Trigger fidelity and data fidelity are both required —
  a harness that drives search→clear over infidelitous data still reproduces nothing.
- [test-at-the-fastest-level-not-redundant-e2e.md](../tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md)
  — same methodological family: hard-to-reproduce is a signal; build the cheapest harness that
  actually exercises the behavior, here a fast generated vault rather than driving production.
- [gantt-bases-getvalue-renotify-storm.md](../integration-issues/gantt-bases-getvalue-renotify-storm.md)
  — a related #161 engine that "reproduces ONLY on the real production-data vault, NOT on
  synthetic generated vaults." Documents *why* naive synthetic vaults miss it; vault-as-code is
  the technique that closes part of that gap by raising synthetic fidelity to real-vault levels.
- [svar-gantt-diff-sync-interactions.md](../integration-issues/svar-gantt-diff-sync-interactions.md)
  — the diff-sync architecture whose large-diff pathology (#161 U6) this fixture was built to
  reproduce and gate; its bulk-reseed fix is what the generated repro verified.
- GitHub `#161` — the render-loop issue this infrastructure served. `#172` — the bulk-reseed fix
  validated against the generated vault.
