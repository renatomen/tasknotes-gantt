---
title: 'A probe sees the fields one call touched — derive a static member list from the declaration'
date: 2026-09-01
category: docs/solutions/best-practices
module: testing / member-list-derivation
problem_type: best_practice
component: testing_framework
severity: high
related_components:
  - development_workflow
  - tooling
applies_when:
  - "A guard must enumerate every member of a static contract - the fields of an interface, the cases of a union, the handlers of a port"
  - "Choosing between deriving that list at run time (Object.keys, a Proxy, reflection) and at compile time (keyof, Record<keyof T, ...>)"
  - "A probe-based census is green but a member may exist that the probed call never reaches"
  - "Adding a field to an interface where every member must have a recorded route, effect, or handler"
  - "Reviewing a test whose name claims completeness over a member list"
symptoms:
  - "A census built from Object.keys of a projection's OUTPUT misses every member nested under one key"
  - "A Proxy over a projection's INPUT misses a member the consumer reads that the producer never supplies"
  - "A Proxy misses a member read only behind a value-guarded branch the probe never entered"
  - "4,021 tests, tsc and svelte-check all green while the live filter reads an unfolded field"
  - "A string index signature widens keyof to string and silently disables a Record<keyof T, ...> completeness gate"
root_cause: wrong_api
resolution_type: test_fix
tags:
  - compile-time-guard
  - keyof
  - derived-member-list
  - runtime-introspection
  - completeness-gate
  - test-quality
  - typecheck
  - review-gates
---

# A probe sees the fields one call touched — derive a static member list from the declaration

## Context

A guard had to prove a composition property: every field the row-visibility predicate reads reaches
the SVAR store on a live refresh, so the filter never decides from a value the store has stopped
agreeing with. That property is only as strong as its member list — it has to run over *the set of
fields the predicate's input can carry*, and this repository's version of that set is spread over
two declarations, which is the seam the limits section returns to. Get the list wrong and the guard is green over a subset,
which is precisely the state the defect it was written for lived in (#470, closed by #473).

Three successive derivations of that list were tried. All three derived it by **observing a call**,
and each was evaded by a different shape.

**1. Enumerate the projection's output keys.** `Object.keys(toRowVisibilityInput(...))`. The
projection nests the source-switcher members under a single `source` key
(`src/bases/rowVisibility.ts:54-65`), so `calendarItemFamily` and `hasRecurringOccupancy` never
appear in that key set at all — the enumeration returns three names for a four-member contract. A
switcher member added tomorrow would ship dead with every guard at this tier green — an e2e
journey that toggles that source would still catch it, minutes later and a tier away.

**2. A `Proxy` recording property reads on the projection's *input*.** Strictly better, and for a
real reason: the input is the store's **flat** `custom` record — `RowVisibilitySource extends
SwitcherRowSource` (`src/bases/rowVisibility.ts:39-42`, `src/bases/sourceSwitcher.ts:34-39`) — and
the projection reads `custom?.calendarItemFamily` and `custom?.hasRecurringOccupancy` directly, so
the proxy does see the members the output hid. Defeated by a shape the first attempt had not
exposed: **a member the predicate consumes that the projection never supplies is never read, so
never recorded.** The session record has this measured — the file's suite and typecheck stayed green
with the predicate reading `undefined`.

**3. The same proxy, defeated again.** A recording proxy has to return *something* for each read, and
it returned `undefined`. A field read that sits behind a value-guarded branch therefore never
executes, so it is never recorded. Per the session record, planting a field read reachable only under
one `calendarItemFamily` value left the whole jest suite plus `tsc` and `svelte-check` green while
the live display filter read a value the store never re-issued. (The suite is 4,021 cases at HEAD,
verified by running it; a git-push-based tooling spec fails intermittently here, unrelated to any of this.)

**The settled mechanism** is a compile-time completeness table
(`test/unit/rowVisibilityLiveSync.test.ts:287-295`):

```ts
type FieldDelivery =
  | { delivery: 'fingerprint' }
  | { delivery: 'row-identity'; why: string };

const FIELD_DELIVERY: Record<keyof RowVisibilitySource, FieldDelivery> = { … };
```

A member added to `RowVisibilitySource` — or to the `SwitcherRowSource` it extends — does not
**compile** until its route to the store is recorded. Re-measured at HEAD, both directions:

| Planted on `RowVisibilitySource` | `npx jest <file>` | `tsc -p tsconfig.test-unit.json` |
|---|---|---|
| `plantedProbeEscapee?: boolean` | 12/12 green | **red** — `TS2741: Property 'plantedProbeEscapee' is missing … but required in type 'Record<keyof RowVisibilitySource, FieldDelivery>'` at `rowVisibilityLiveSync.test.ts(287,7)` |
| `[key: string]: unknown` | 12/12 green | **red** — `TS2322: Type 'true' is not assignable to type 'never'` at `rowVisibilityLiveSync.test.ts(308,7)`, and **nothing** from line 287 |

That second row is the reason the table travels with two companions. Its own summary, in the file
header (`test/unit/rowVisibilityLiveSync.test.ts:25-26`):

> A probe sees the fields some call happens to touch; `keyof` sees the ones that exist.

**Three things the settled table still does not close, and a reader adopting the pattern should adopt
the limits with it.** It is keyed on the projection's INPUT type, so a member added to the predicate's
own input type and consumed there, without the projection ever supplying it, falls outside the key set
— the shape that defeated the second probe, now a stated boundary rather than an unnoticed one. And a
`row-identity` route is carried by a prose `why`: the generated assertions run over the `fingerprint`
entries only, so a member misrouted to `row-identity` is accepted on its author's word. Both are
recorded follow-ups.

Third, and easiest to miss because the table looks like it covers it: the table ranges over a
**type's** members, never over what the code does with them. A member added to both shapes, consumed
by the predicate, fingerprinted, and dutifully recorded in the table — but simply never written by
the projection — satisfies the key set, typechecks, and leaves the suite green while production
reads `undefined` for it forever. Completeness over a declaration is not completeness over a
function body; proving the second needs something that executes the mapping and compares. Unlike
the first two, this one is not a boundary the pattern has to accept: the projection is a plain
exported function now, so that check is writable on the fast tier today. It is not written. A table
that inherits any of these three silently is back to being a mechanism-shaped comment.

## Guidance

**When a guard needs "the set of members X can carry", derive it from the declaration, not from an
observation.** `keyof` over the type. The three evasions above then stop being *possible* over the
type you keyed on, rather than being patched one at a time — a narrower guarantee than "no member
can escape", and the narrowing is load-bearing: it holds for the members of that type, not for a
contract assembled from more than one.

**Scope: this is stated for an interface of string-named members, which is what was measured here.**
Three shapes change what `keyof` gives you, and a table over any of them needs more than the rule
above. Nothing below was needed for this contract; they are named so a reader adopting the pattern
can tell whether they are inside its domain.

| Shape | What `keyof` yields | What a complete table then needs |
|---|---|---|
| A **union** of object types | only the keys common to *every* member — for `{kind:'a';a:number} \| {kind:'b';b:number}` it is `kind` alone, and a `Record<keyof T, V>` omitting `a` and `b` compiles clean (measured, tsc 5.9.2) | distribute it — `T extends unknown ? keyof T : never` — or assert discriminant exhaustiveness instead |
| A **string** index signature, from anywhere up the extends chain | `string \| number`, so the record accepts any set of entries | the literal-key assertion below |
| **Symbol-named** members | the symbols, correctly — but `Object.keys`/`entries`/`values` never visit them, so the runtime companion below skips their routes while staying green | `Reflect.ownKeys`, or keep the contract to string-named members |

A runtime probe answers *what did this execution touch?* A member-list rule asks *what may exist?*
Those coincide only when one call happens to exercise the whole contract, which nothing enforces and
which is exactly what the rule was written because you cannot assume. The three defeats above are
that gap wearing three costumes:

| Evasion shape | What the probe watched | Why it missed |
|---|---|---|
| Wrong object | the projection's **output** | the output regrouped four members into three keys |
| Consumption without supply | the projection's **input** | a member read downstream that this call never reads |
| Unentered branch | the same input, values synthesised | a read guarded by a value the probe never produced |

Patching any one of these leaves the other two live, and there is no argument that the third is the
last — which is the tell that the *shape* is wrong rather than the instance.

**A type-level completeness table degenerates silently, so it needs two companions.** Both are
written here over enumerable string keys — see the scope note above before applying them to a
contract that carries symbols.

- **A literal-key assertion.** `keyof T` widens to include `string` — in fact `string | number`,
  since numeric keys stringify — the moment `T` gains a **string** index signature — from anywhere in its extends chain — and `Record<string, V>` is satisfied by any set of
  entries.

  Be precise about which signature does this, because the wrong test looks reassuring. A numeric or
  symbol index signature also widens `keyof`, but it *adds* `number` or `symbol` beside the
  **string-named** keys rather than absorbing them, so `Record<keyof T, V>` still demands each of
  those. The qualifier is load-bearing: a numerically-named member is absorbed by `[key: number]`,
  and a unique-symbol member by `[key: symbol]` — the gate would then be off with nothing failing —
  so a contract carrying either needs the assertion widened to reject those signatures too. The
  contract here carries only string-named members. Measured on TypeScript 5.9.2: with
  `[key: number]: unknown` planted, the complete table compiles clean — and dropping one member from
  it still fails `TS2741`. Observing that the honest tree still compiles is not evidence the gate is
  off; the gate is tested by removing a member and watching it go red.
  `type LiteralKeys<T> = string extends keyof T ?
  never : true` fails `TS2322` instead (`test/unit/rowVisibilityLiveSync.test.ts:307-308`). It has to
  be *referenced* at run time as well, or it reads as an unused declaration and gets deleted
  (`:324-330`) — and note that the reference case is deliberately not named for the invariant, because
  the jest transform strips types and would tick green with the union already widened.
- **A vacuity floor.** Routing every member to the branch that runs no assertion empties the
  assertion table and leaves the block green under a name still claiming the fold is checked
  (`test/unit/rowVisibilityLiveSync.test.ts:332-343`).

**The transferable half is principle 4, and it is the part worth carrying to the next repo.** This
repository already owned the mechanism: `Record<keyof SvarTask['custom'], FieldCensus<SvarTask>>` at
`test/unit/ganttSync.test.ts:1205` forces a per-field decision at compile time. The three probes
were a weaker **imitation** of a mechanism already in the tree — and the history makes that
sharper rather than softer. `git log -S"Record<keyof" -- test/` returns two commits — the census
in #468, and this branch's reuse of the pattern in #473. The file that went on to imitate it was
created between them, by #472, hours after the census landed. This was not buried prior art that took excavating. It was the
immediately preceding unit of the same workstream, freshly hardened over ten review rounds.
`docs/architecture/principles.md:29` states the rule — *Reuse the owner's mechanism — never imitate,
infer, or rebuild it* — and line 37 names the failure mode it predicts: "Imitating a mechanism
instead of reusing it drifts and multiplies: the audit found four parallel implementations of one
job, each a regression seed." Three defeated probes inside one branch is that prediction coming true
at small scale. The search that would have skipped all three rounds is *"has this repository already
solved 'force a decision per member'?"* — before *"how do I observe the member list?"*.

**Reuse is not the same as re-deriving the right answer independently.** Both censuses arrive at a
`Record<keyof …>`, but the imitation route paid three review rounds to get there and the reuse route
pays one grep. The mechanism was never the hard part; noticing it was owned was.

**This is a distinct failure from the two sibling learnings, and the three questions catch different
things.**

| Question | Catches | Where |
|---|---|---|
| Can this pass while the guard it names is broken? | vacuous, weak, or overstated assertions | [a-test-name-is-a-claim-verify-the-mutation.md](a-test-name-is-a-claim-verify-the-mutation.md) |
| Is the property being protected the right property? | a guard locked onto a mechanism instead of a claim | [assert-the-claim-not-the-mechanism.md](assert-the-claim-not-the-mechanism.md) |
| Where does this rule's member list come from? | a rule that is complete only over what one call touched | this doc |

The probes' assertions observed exactly what they claimed, about exactly the right proposition — over
an incomplete set. That clears the second question but not the first: a test named for *every* field
that passes while a branch-only field goes unfolded is passing while the guard it names is broken,
which is precisely what the name-is-a-claim check exists to catch. What this doc adds is not a defect
that check cannot see — it is why the defect keeps recurring, and the repair: change where the member
list comes from.

## Why This Matters

**Each probe was green when written, and each shipped a hole.** That is the whole cost profile: a
member-list derivation cannot fail loudly, because being short *is* its failure. A guard running over
three of four members reports the same green as one running over four. The only signal is the next
member someone adds, and that signal arrives as a user-visible defect months later — the #470 shape,
which survived roughly two months behind a fully green suite.

**The non-convergence was recognisable before the third round, and it was already documented.**
`CONCEPTS.md:111` (§ Derived member list) names the exact signal:

> The recognition rule is a round naming a **new member of a class an earlier round already fixed**.

Round two named a new member of the class round one had fixed. Round three named a new member of the
class round two had fixed. The entry also names the repair — "restate the rule around its source of
truth" — and its test: "whether a new member is covered without editing the rule, or else trips a
guard." The runtime probes fail that test by construction; the `keyof` table passes it, measured
above as `TS2741`. The repository predicted this correctly and the prediction was not consulted until
after the third round.

**Both degeneracy guards were prior art too (session history).** The session that hardened the
existing census over ten review rounds had already met the same two shapes and fixed them the same
way: it deleted a `delegated` variant from `FieldCensus` precisely because downgrading a field to it
compiled cleanly and ran no assertion, and it found a flat-namespace merge that let one complete
`Record<keyof …>` silently overwrite another's member. It also recorded, in its own words, the
weakness rediscovered here by measurement — that the census "derived its member list but never
checked the decisions recorded in it". The vacuity floor and the routing table's per-member argument
are both answers to questions this repository had already asked and written down.

**A completeness table that has degenerated is worse than none.** The index-signature measurement
above is the proof: with `[key: string]: unknown` planted, the `Record<keyof …>` table raised
*nothing at all* — the only error in the entire program came from the `LiteralKeys` assertion. A
reviewer reading `Record<keyof RowVisibilitySource, FieldDelivery>` sees a mechanism; a reviewer
cannot see that its key union has been widened somewhere up an extends chain. The gate was off and
the file still read as guarded.

**And the routing table is load-bearing, not bookkeeping.** Three of the four members reach the store
through `taskStateKey` (`src/bases/ganttSync.ts:691`, `:706`, `:717`); the fourth,
`calendarItemFamily`, does not, and is sound only because the row's synthetic id embeds the family
(`src/datasource/calendarItems/types.ts:70`), so a change arrives as an add plus a delete with no row
surviving in place. That is a real per-member argument. Whichever mechanism supplies the member list
is deciding whether that argument ever gets demanded.

## When to Apply

- **Whenever a guard, census, or exemption table needs "every member of X".** Fields on a type, cases
  of a union, keys of a config object, members of an interface's extends chain. Ask where the list
  comes from before writing the first assertion, and prefer `keyof` / exhaustive `switch` /
  `Record<Union, …>` over anything that has to run code to find out.
- **The moment you reach for a `Proxy`, a spy, `Object.keys`, or a reflection helper to discover a
  contract.** That is the tell. Discovering *what a call did* is a legitimate use of all four —
  coverage, tracing, diagnostics. Discovering *what a type permits* is not.
- **Before building the instrument, search for one the repository already owns.** Same-shaped guards
  cluster: this repo's second such table was three rounds of rediscovery away from its first. Grep
  the test tree for `Record<keyof` before designing anything.
- **When a review round names a new member of a class an earlier round already fixed.** Stop patching
  and re-derive the list. Both the recognition rule and the repair live at `CONCEPTS.md:111`.
- **Ship the table with its two degeneracy guards, or do not claim it as a gate.** A vacuity floor and
  a literal-key assertion, each mutation-checked. Without them the table is a mechanism-shaped comment.
- **Not for genuinely dynamic member sets** — a user's configured properties, a plugin registry, a
  parsed schema. There the list really is determined at run time, the declaration cannot know it, and
  the guard belongs on the data source rather than on a type. The boundary question is whether adding
  a member requires editing source: if it does, a type can see it.

## Examples

**The three derivations and what each could not see**

```ts
// 1. The projection's OUTPUT. Returns three names for a four-member contract:
//    `toRowVisibilityInput` regroups the switcher members under `source`.
Object.keys(toRowVisibilityInput(row.custom));   // ['isTopLevelPlacement','dateStatus','source']

// 2. The projection's INPUT — flat, so the switcher members are visible. Records
//    only what THIS projection reads; a member the predicate consumes downstream
//    but the projection never supplies is never recorded.
const seen = new Set<string>();
toRowVisibilityInput(new Proxy({}, { get: (_, k) => { seen.add(String(k)); return undefined; } }));

// 3. The same proxy. It answers `undefined` to every read, so a field read that
//    only executes under a particular family value is never reached, never recorded.
if (custom.calendarItemFamily === 'timeblock') return custom.timeblockOnlyField;   // invisible
```

**The declaration-derived replacement** (`test/unit/rowVisibilityLiveSync.test.ts:287-308`)

```ts
const FIELD_DELIVERY: Record<keyof RowVisibilitySource, FieldDelivery> = {
  isTopLevelPlacement: { delivery: 'fingerprint' },
  dateStatus:          { delivery: 'fingerprint' },
  hasRecurringOccupancy: { delivery: 'fingerprint' },
  calendarItemFamily: {
    delivery: 'row-identity',
    why: 'the row synthetic id embeds the family, so a change arrives as an add plus a delete …',
  },
};

// Without this, a string index signature anywhere up the extends chain widens `keyof` to
// `string` and the record above accepts any entries at all — measured: the table
// raised nothing, and this line was the only error in the program.
type LiteralKeys<T> = string extends keyof T ? never : true;
const SOURCE_KEYS_ARE_LITERAL: LiteralKeys<RowVisibilitySource> = true;
```

**The mutation that separates the two mechanisms, in one command each**

```bash
# Add `plantedProbeEscapee?: boolean` to RowVisibilitySource, then:
npx jest test/unit/rowVisibilityLiveSync.test.ts   # 12 passed, 12 total   <- a probe-derived list ends here
npx tsc -p tsconfig.test-unit.json                 # TS2741 at rowVisibilityLiveSync.test.ts(287,7)
```

The suite cannot see it — the jest transform strips types rather than checking them — which is why
the completeness half of this guard is a **typecheck** obligation and has to be stated as one. The
pre-commit hook and CI both run `npm run typecheck`; a contributor running only jest sees nothing.

**The search that would have replaced three rounds with one**

```bash
grep -rn "Record<keyof" test/            # test/unit/ganttSync.test.ts:1205 — the mechanism, already owned
```

**The shape of the trap, in one line**

> A probe reports what one call happened to do; a member-list rule needs what the contract permits.
> Those are the same set only by luck, and a short list reports exactly the same green as a complete
> one.

## Related

- [When review keeps naming a new member of one class, the specification's shape is wrong](../workflow-issues/state-the-rule-derive-the-list.md)
  — the parent rule, and the one this doc extends rather than repeats. It already names "the fields a
  type declares" as an accepted source of truth, and its governance test catches all three probes.
  What it does not say, and what cost three rounds here, is that a runtime probe *has the shape of a
  derivation without the guarantee* — the same distinction it draws about a census committed with no
  completeness assertion over it.
- ["I cannot write a test that executes this" names a seam](../architecture-patterns/a-guard-that-restates-its-subject-names-a-missing-seam.md)
  — what made this guard's evidence obtainable, landed alongside it. Its *Subject and evidence*
  section carries the argument, including which half of this guard is evidenced today and which is
  limit 3 above.
- [A guard on the wrong proposition defends the defect](assert-the-claim-not-the-mechanism.md) — the
  sibling axis. That one asks whether the property being protected is the right property; this one
  asks where the member list it iterates comes from. Both were live in the same branch.
- [A test's name is a claim — and a mutation only counts if it reproduced the defect](a-test-name-is-a-claim-verify-the-mutation.md)
  — the third axis, and the one that does catch these probes. Each generated assertion was truthful
  about what it observed; the enclosing claim to cover *every* field was not, which is that check's
  failure condition. What this doc adds is why the false completeness keeps arising and how to
  remove it, not a defect that check cannot see.
- [Orchestrate an existing tool over rebuilding one](../tooling-decisions/orchestrate-existing-tool-over-rebuilding.md)
  — the same principle-4 shape at the toolchain boundary; this is its in-repo, in-test instance.
- `CONCEPTS.md` § Derived member list — the recognition rule and the repair, both of which applied
  here before the first probe was written.
- Issues: #470 (the defect the guard was written for, closed by #473), #469 (its sibling, closed by
  #472), #474 (the first learning from this branch).
