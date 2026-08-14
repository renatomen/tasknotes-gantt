---
title: Governing Docs Port - Plan
type: docs
date: 2026-08-14
topic: governing-docs-port
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Governing Docs Port - Plan

## Goal Capsule

- **Objective:** Establish this repo's governing documentation layer — engineering charter, architecture principles, architecture decisions, internal strategy, and a rewritten AGENTS.md — by mirroring the sibling `capability` repo's structure, adjusted to this repo's reality, so the maintainability campaign and later feature work judge against written principles instead of scattered lore.
- **Authority hierarchy:** The maintainer (product manager) arbitrates content — the principles set and strategy content are his calls. The sibling repo at `../capability` is the structural reference; its `docs/engineering/practices.md` is the authoritative charter text. This repo's existing gates and mechanisms outrank any ported text that would change them.
- **Stop conditions:** Stop for maintainer arbitration if any unit would alter a review-gate script, hook, or CI workflow; if evidence invalidates a session-settled decision; or if drafting a principle requires choosing product behavior the corpus does not settle.
- **Execution profile:** U6 lands first — the ce-strategy interview is the run's single upfront human-input session, then its PR proceeds autonomously. U1–U5 follow as one docs PR through the two-layer receipt gate, fully autonomous.
- **Tail ownership:** Agent-led throughout — every PR merges on green gates (CI, both receipts, zero unresolved Codex threads) without waiting, per the maintainer's 2026-08-14 grant. Both former arbitration points were resolved upfront: the principles 7+4 split (KTD4) and strategy content (approved in the U6 interview).

---

## Product Contract

### Summary

Port capability's governing-docs structure into this repo: the Farley engineering charter near-verbatim with a rewritten repo binding, an obsidian-gantt principles doc authored in capability's principle-plus-governance-test form, an architecture-decisions doc, an internal STRATEGY.md produced via the ce-strategy skill, and AGENTS.md rewritten as the short always-apply distillation that points at all of it.

### Problem Frame

The repo's guidance is broad but scattered and rule-shaped. Eleven `docs/conventions/` files and three `docs/architecture/` files state rules without rationale or governance tests; the Farley framing lives in `docs/reports/` and `docs/solutions/` entries rather than a charter; no principles document and no internal strategy document exist. The repo's own post-mortem names the cost: "not a lack of guidance; it is the absence of an operational stopping rule" (`docs/reports/2026-08-08-atomic-change-path-to-production-process-failure.md`).

The maintainability campaign is about to make judgment-heavy calls — what to extract, what file size is appropriate, when a review loop is finished — and the sibling `capability` repo already carries a proven structure for anchoring exactly this kind of judgment.

### Key Decisions

- KD1. **Mirror capability's structure; adjust only where this repo's reality differs.** (session-settled: user-directed — chosen over inventing a bespoke structure: capability's docs are a working codification of Farley's teachings.) Governs R1–R6.
- KD2. **Port the charter near-verbatim; rewrite only its repo-binding section.** Capability wrote it project-agnostic for exactly this transfer. (session-settled: user-directed — chosen over re-synthesizing from Farley sources.) Governs R2, R7–R9.
- KD3. **Author this repo's principles fresh in capability's form.** Capability's 18 principles are product-specific and do not transfer; the form (statement + governance test) does. (session-settled: user-approved — chosen over adapting their 18 principle-by-principle.) Governs R3.
- KD4. **Produce STRATEGY.md with the ce-strategy skill.** (session-settled: user-directed — chosen over pointing at the public vision page: an internal decision anchor and a public page serve different readers.) Governs R5.
- KD5. **Add the layer above the existing conventions; keep them.** (session-settled: user-approved — chosen over consolidating the 11 conventions files: additive, low churn, conventions keep working.) Governs R1, R6.
- KD6. **Adapt Farley to this repo's operating model: a product manager supervising AI coding agents.** Peer review means one agent reviewing another agent's code; the human sits at strategic arbitration points (product decisions, finding arbitration, principle changes), by exception — never as another developer in the loop. (session-settled: user-directed.) Governs R7, R8.
- KD7. **Record charter-vs-repo conflicts as named divergences with revisit triggers.** Never resolved by editing the charter's practice text or changing working mechanisms. (session-settled: user-approved.) Governs R8.
- KD8. **Ship no new enforcement mechanisms with this port.** Candidate mechanisms (e.g. an import-boundary lint gate) are recorded in `docs/backlog.md` instead — the bound-work lesson. (session-settled: user-approved.) Governs R9; see Scope Boundaries.
- KD9. **Strategy lands first as its own small PR; the port follows as one docs PR; every PR merges on green autonomously.** Strategy content is independent of the port, so the one human-input session (the ce-strategy interview) runs upfront and everything after ships hands-off. Green means CI passing, both local receipts, and zero unresolved Codex threads. (session-settled: user-directed 2026-08-14 — revised from port-first so the autonomous tail has zero human touchpoints; merge-on-green explicitly granted.) Governs R5.

### Requirements

**Structure and content**

- R1. `AGENTS.md` is rewritten in capability's shape: a short always-apply contract carrying a "Where truth lives" index, the always-apply standards, and a shared review-guidelines rubric — deferring depth to the governing docs and keeping the existing per-section links into `docs/conventions/`.
- R2. `docs/engineering/practices.md` carries the Farley charter — philosophy, practices E1–E12 (each as principle → mechanism → governance test), and the named-divergences-from-Farley section — near-verbatim from `../capability/docs/engineering/practices.md`, plus a binding-to-this-repository section rewritten for this repo (R7–R9).
- R3. `docs/architecture/principles.md` carries this repo's own governing principles, each in capability's form: a statement plus a governance test where one is expressible. Candidate sources are the repo's hard-won implicit principles: property-agnostic field mappings; adapters extract raw values, views format; lossless RFC 5545/7953/9253 mapping; SVAR-first with signed-off exceptions; e2e against real Obsidian as a first-class gate; file size judged by principled decision, never line count alone; mechanism over memory. The final set is maintainer-reviewed before landing.
- R4. An architecture-decisions record exists under `docs/architecture/` in capability's form — structural decisions with rationale, including rejected alternatives. It complements and never duplicates `docs/architecture/overview.md` (the *where*) and `docs/architecture/standards-alignment.md` (the *what-must-hold*).
- R5. A root `STRATEGY.md` exists as the internal decision anchor — product in one paragraph, audiences in order, positioning, hard boundaries, deferred-deliberately — produced with the ce-strategy skill and seeded from `website/docs/vision-and-philosophy.md`, `README.md`, and settled project decisions. The public website page stays as-is.
- R6. The `docs/conventions/` files remain authoritative for operational detail; the new layer cites them rather than restating them.

**Adaptations — the repo binding**

- R7. The charter binding names this repo's actual review layers with each layer's one-sentence purpose: spec-time ce-doc-review; the local two-layer pre-push receipt gate (ce-code-review plus an independent cross-model peer — agent reviewing agent); the GitHub-hosted Codex reviewer as the final PR gate; SonarCloud static analysis. It changes no mechanism.
- R8. The binding records this repo's divergences from the charter, each with rationale and a revisit trigger:
  - E4 (coverage): targets are allowed as forcing functions; the violation is manufacturing assertion-free tests or gaming the metric to beat it, never the target itself.
  - E7 (merges): agent-led merges proceed on green gates — CI green, both local receipts, zero unresolved Codex threads — with the maintainer intervening by exception as product owner.
  - E11 (reviewer benchmarking): deferred; bound honestly as not implemented.
  - E9 (boundaries): where a full facade over the Obsidian plugin API is impractical, DI-seamed mocks are the accepted adaptation; SVAR stays behind the SVAR-first rules.
- R9. The binding encodes the repo's operational stopping rules: findings judged by class, not round count; acknowledged-findings receipts terminate review loops; tool-hardening bounded per `docs/solutions/workflow-issues/bound-work-on-the-review-tool-itself.md`; a lightweight spec satisfies E1 for repository infrastructure.

**Review rubric**

- R10. AGENTS.md's review-guidelines section is the one shared rubric for every review layer and the human: the purpose of review (defects that matter; style belongs to linters), what to review against (the governing plan, the principles' governance tests, the charter's practice tests), and severity classes. It documents the implemented gate's semantics and alters no script, hook, or workflow.

**Vocabulary**

- R11. `CONCEPTS.md` gains the port's canonical vocabulary — engineering charter, governance test, named divergence — following its existing entry format.

### Acceptance Examples

- AE1. **Covers R8.** Given the charter has landed, when a change meets the Sonar new-code coverage target using tests without meaningful assertions, then the E4 divergence text classifies the change as a violation despite the metric passing.
- AE2. **Covers R8.** Given a PR with green CI, both local receipts, and zero unresolved Codex threads, when no exception requiring product judgment was raised, then the implementing agent merges without waiting for the maintainer.
- AE3. **Covers R9.** Given a review finding about the gate tooling itself that does not break the everyday path, when the finding is judged, then it is recorded in `docs/backlog.md` rather than fixed in-session.

### Success Criteria

- A fresh contributor or agent session can locate the governing basis for any judgment call — file size, extraction, review severity, merge — from AGENTS.md in one hop.
- The refactor campaign's slice plans can cite principles and practices by name instead of re-arguing them.

### Scope Boundaries

- No changes to review-gate scripts, hooks, or CI workflows; gate findings continue to be recorded in `docs/backlog.md`.
- capability's design brief is not ported — SVAR and the Obsidian theme govern design here; revisit on demand.
- The E11 reviewer-benchmark corpus is not built.
- No new enforcement mechanisms; the import-boundary lint gate is recorded in `docs/backlog.md` as a candidate ratchet for when extractions define stable boundaries.
- The refactor slices themselves are separate planned work.
- The public website and historical `docs/brainstorms/`, `docs/reports/` artifacts are unchanged.
- The atomic-change contract's proposed budgets (`docs/reports/2026-08-08-atomic-change-path-to-production-process-failure.md`) stay a recorded proposal — the charter binding encodes the class-based stopping rule instead (KTD5).

### Dependencies / Assumptions

- The `capability` repo is readable at the sibling path `../capability` (source of the charter text).
- The ce-strategy skill is available for R5.
- Assumption, maintainer-confirmed: the charter's philosophy section (agents amplify discipline; the human's scarce resource is judgment) matches this repo's intended operating model.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

This plan owns the governing-docs layer only. The breakdown below is the current understanding of the surrounding campaign, not a committed roadmap.

- **Enables:** GanttContainer slice 2 (`docs/plans/2026-08-12-001-refactor-wire-svar-interceptors-plan.md`, committed on branch `docs/plan-wire-svar-interceptors`) — the refactor proceeds after this layer lands and is judged against it.
  - Then slice 3: the ~1,400-line style block out of `src/bases/GanttContainer.svelte` into `src/bases/styles/`.
  - Then re-measure and plan per file — `src/controller/GanttController.ts` and `src/bases/register.ts` are the likely next two.
- **Can proceed independently of:** pushing the already-committed `ef16f89` on `test/peer-wrapper-suite` (needs review receipts; immediate housekeeping).
- **Still to decide:** post-refactor feature selection — the maintainer names features; STRATEGY.md (R5) anchors that choice.

### Sources / Research

- Structural reference (studied 2026-08-14): `../capability/AGENTS.md`, `../capability/STRATEGY.md`, `../capability/docs/architecture/principles.md` (18 principles; 17 carry governance tests), `../capability/docs/architecture/architecture.md`, `../capability/docs/engineering/practices.md` (states "Written project-agnostic so it transfers to other projects"), `../capability/docs/design/design-brief.md`.
- This repo's grounding: `docs/solutions/workflow-issues/bound-work-on-the-review-tool-itself.md`, `docs/solutions/tooling-decisions/layered-pre-push-review-gate.md`, `docs/reports/2026-07-27-002-rebuild-vs-refactor-gap-analysis.md` (Farley-lens grading), `docs/reports/2026-08-08-atomic-change-path-to-production-process-failure.md` (the stopping-rule diagnosis), `website/docs/vision-and-philosophy.md`, the `docs/conventions/` and `docs/architecture/` inventories, and the enforcement mechanisms in `.husky/` and `eslint.config.mjs` (cognitive-complexity 15; assertions-in-tests).
- Principle and stopping-rule harvest (2026-08-14, seeds U2/U1 content): `docs/solutions/architecture-patterns/property-agnostic-field-resolution.md`, `docs/solutions/architecture-patterns/resolve-config-defaults-at-one-seam.md`, `docs/solutions/architecture-patterns/view-display-options-in-presentation-not-derivation.md`, `docs/solutions/architecture-patterns/shared-derivation-prevents-inert-schema-fields.md`, `docs/solutions/tooling-decisions/orchestrate-existing-tool-over-rebuilding.md`, `docs/solutions/conventions/tasknotes-owns-task-identification.md`, `docs/solutions/tooling-decisions/test-at-the-fastest-level-not-redundant-e2e.md`, `docs/solutions/best-practices/a-test-name-is-a-claim-verify-the-mutation.md`, `docs/solutions/logic-errors/all-day-event-boundaries-floating-not-instant.md`, `docs/solutions/workflow-issues/run-behavior-neutral-refactoring-as-releasable-reviewed-slices.md`, `docs/reports/2026-08-10-svar-conformance-and-maintainability-audit.md`.

---

## Planning Contract

**Product Contract preservation:** unchanged, except the former Outstanding Questions section — both deferred items are resolved by KTD1 (architecture-record placement) and KTD4 (principles-set process) — and one Scope Boundaries addition recording the KTD5 arbitration.

### Key Technical Decisions

- KTD1. **The architecture-decisions record is a new `docs/architecture/architecture.md`.** Keeps capability parity and the existing three-way split: `overview.md` stays the *where*, `standards-alignment.md` the *what-must-hold*, the new file the *why-this-structure*. (session-settled: user-approved — chosen over extending `overview.md`: the map and the decisions record would blur.)
- KTD2. **Charter port fidelity rule.** Philosophy, E1–E12, and the named-divergences section travel verbatim; the only rewritten section is "Binding to this repository", and this repo's divergences (R8) live inside it as a named subsection, each with rationale and revisit trigger. Two sanctioned delta classes apply inside the verbatim zone (session-settled: user-directed — chosen over strict verbatim, which would import another repo's history as this repo's own): durable rulings carry over attributed to the maintainer — the same person behind both repos — with their original date; origin-local incident evidence is replaced with this repo's own equivalent incidents. The charter's running text never names the origin repo; lineage lives in one provenance line in the binding, pinned to the source commit hash, where each applied delta is also listed — so the diff against the source stays mechanically auditable and future re-syncs are mechanical.
- KTD3. **The review rubric adopts P0/P1/P2 severity vocabulary but not capability's machine-parsed verdict contract.** `VERDICT: CLEAN|BLOCK` belongs to capability's CI parser; this repo's settled-outcome semantics are receipts and acknowledged findings (`CONCEPTS.md` § Review gate). Adopting the parser contract would change gate mechanics, which KD8 and R10 forbid. (session-settled: user-approved.)
- KTD4. **The principles content ships as a maintainer-approved 7+4 split — one owner per rule.** `docs/architecture/principles.md` carries seven architecture principles: property-agnostic field resolution at one seam; derivation pure and visibility-free; one derivation authority; reuse the owner's mechanism, with the capability-vs-requirement exception test; verify at the fastest reliable level, with this repo's tier map; lossless RFC mapping routed by semantic role; file size by semantic cohesion (KTD7). The four practice-shaped items are owned by the charter's repo binding as bindings of the E-practices they instantiate, cross-cited from the principles doc: a test's name is a claim (E4/E5), complexity ceiling 15 as an already-mechanized gate (E8/E2), mechanism over memory (the charter's own meta-principle — binding adds this repo's worked examples), and the per-unit-PR landing cadence (KTD8, E2/E3). Nothing dropped. (session-settled: user-approved 2026-08-14 — the split chosen over shipping all eleven flat in principles.md, which would duplicate charter-owned rules.) Cites R3.
- KTD5. **The charter binding arbitrates the corpus's one live conflict by encoding the class-based stopping rule.** Universal two-layer receipts stand with no exemptions; proportionality comes from batch size, finding-class triage, and acknowledgement — not round-count budgets. The atomic-change report's proposed budgets stay recorded, undecided. (session-settled: user-directed — "judge findings by class, not by round count"; chosen over codifying the proposed 30-min/2-attempt budgets.) Cites R9.
- KTD6. **The principles doc codifies the reconciled verification-tier ordering.** "Fastest reliable evidence first, then the mapped integration journey the boundary requires" — naming the vitest-browser probe (`npm run probe:svar`) as the middle tier and WDIO real-Obsidian for integration boundaries (writes, menus, Bases config). This is the corpus's own reconciliation (`docs/solutions/workflow-issues/run-behavior-neutral-refactoring-as-releasable-reviewed-slices.md`); codifying it stops the three source docs being cited against each other. Cites R3.
- KTD7. **The file-size principle is drafted falsifiably.** Semantic cohesion decides appropriateness — never line count alone — with churn share and separable-concern count as the violation-recognition metrics, so a "decomposition closeout" claim is itself testable (the 2026-08-10 audit superseded the #374 closeout on exactly those metrics). Cites R3.
- KTD8. **Per-unit-PR landing cadence is the repo norm, encoded in the governing docs.** Every implementation plan declares a landing strategy; the default is one PR per unit or named unit-cluster, merged on green before the next starts — typically shippable within ~2 hours, with 4 hours as the re-slice trigger. Semantic cohesion may override slicing with a written reason (a split that leaves the product incoherent is worse than a bigger PR). The rule is directional: slicing finer than a unit is always autonomous; landing coarser — one PR spanning multiple units — needs the written cohesion reason, or maintainer consultation, by exception. This rule caps PR size and branch lifetime; it never terminates a review loop — that remains KTD5's class-based stopping rule, and the two are kept visibly distinct in the charter text. (session-settled: user-directed — chosen over day-long single-PR lfg runs; norm-by-default with consult-on-exception.) Governs R1, R2, R3; instantiated by U1, U2, U4.

### Sequencing

Three landing tranches, each merged on green autonomously (KD9): first U6 as its own small PR (the ce-strategy interview is the run's single upfront human-input session); then U1–U5 as one docs PR. Within the port PR: U1, U2, U3 are independent and may proceed in parallel; U4 needs all three (its links must resolve); U5 needs U1 (its terms).

---

## Implementation Units

### U1. Port the engineering charter

- **Goal:** The Farley charter exists at `docs/engineering/practices.md` with a truthful binding to this repo.
- **Requirements:** R2, R7, R8, R9.
- **Dependencies:** none.
- **Files:** `docs/engineering/practices.md` (new).
- **Approach:**
  1. Copy philosophy, E1–E12, and the named-divergences section verbatim from `../capability/docs/engineering/practices.md` (KTD2).
  2. Apply KTD2's sanctioned deltas: attribute durable rulings to the maintainer with their original date (e.g. E1's plans-must-not-obstruct-tooling ruling, 2026-07-26); replace origin-local incident evidence with this repo's equivalents (E1's spec-invented-while-coding evidence → the 1,168-line bespoke-analyzer incident; E6's layered-review evidence → the four P1s that eleven single-reviewer rounds missed). List each delta in the binding's provenance line, which pins the source commit hash; the running text never names the origin repo.
  3. Rewrite "Binding to this repository" per R7: name each review layer with its one-sentence purpose, the pipeline gates (pre-commit lint+typecheck+volatile-ref guard, pre-push receipts, CI build+e2e, Sonar), and the specs/learnings bindings (`docs/plans/`, `docs/solutions/`, `CONCEPTS.md`).
  4. Add the repo-divergences subsection per R8 (E4, E7, E9, E11 — each with rationale and revisit trigger), phrased for the KD6 operating model.
  5. Encode the operational stopping rules per R9 and KTD5.
  6. Encode the per-unit-PR landing cadence (KTD8) as this repo's E2/E3 mechanism in the binding: plans declare a landing strategy; the default is one PR per unit or unit-cluster merged on green; deviations are consulted with justification, by exception; stated as distinct from the KTD5 review-loop stopping rule. The governance test: a branch older than a workday, or a PR whose diff spans multiple plan units, without a written cohesion reason, is a violation.
  7. Bind the remaining KTD4 charter-owned items: a test's name is a claim under E4/E5 (assertion discipline, the mutation-check protocol); complexity ceiling 15 under E8/E2 listed with the pipeline gates (already an eslint error); mechanism-over-memory worked examples from this repo under the philosophy's meta-principle.
- **Patterns to follow:** capability's charter format — each practice as principle → mechanism → governance test.
- **Test scenarios:** Test expectation: none — documentation; behavior is unchanged.
- **Verification:** E-section text diffs clean against the source except the sanctioned deltas, each listed in the binding's provenance with the source commit hash pinned; the running text nowhere names the origin repo; every mechanism the binding names exists in the repo (spot-check each script, hook, and workflow named); AE1 and AE3 are answerable from the text alone.

### U2. Author the principles doc

- **Goal:** This repo's governing principles exist at `docs/architecture/principles.md`, each with a governance test where expressible.
- **Requirements:** R3.
- **Dependencies:** none.
- **Files:** `docs/architecture/principles.md` (new).
- **Approach:**
  1. Draft the KTD4 seven architecture principles, each as statement + governance test, using the harvested draft tests as the starting point.
  1b. Cross-cite the charter's binding for the four practice-shaped items KTD4 assigns there; principles.md never restates them (one owner per rule).
  2. Carry the reuse-exception test (capability against the requirement, not built-in vs. home-grown) inside the reuse principle, with fullscreen and the MIT Pro gate as the two worked exception cases.
  3. Codify the KTD6 verification-tier ordering and the KTD7 falsifiable file-size principle.
  4. Cite each principle's source solutions docs sparingly — the solutions layer stays the depth record (per R6's cite-don't-restate rule).
- **Patterns to follow:** `../capability/docs/architecture/principles.md` form; this repo's vocabulary from `CONCEPTS.md`.
- **Test scenarios:** Test expectation: none — documentation.
- **Verification:** every principle carries a governance test or an explicit note that none is expressible; no principle restates a conventions file (cites instead); the maintainer trim happens at PR review.

### U3. Author the architecture-decisions record

- **Goal:** The durable structural decisions and their rationale exist at `docs/architecture/architecture.md`.
- **Requirements:** R4.
- **Dependencies:** none.
- **Files:** `docs/architecture/architecture.md` (new).
- **Approach:**
  1. Record the durable subset with rationale and rejected alternatives: Bases owns the matched seed set / TaskNotes enriches; adapters extract raw values, views format; controller–view–datasource boundaries; SVAR bundled at build time and the MIT Pro gate never patched; calendar bundled-but-extractable; the drag pipeline's derivation authority with echo/cascade/fence semantics; the RFC boundary.
  2. Record the standing rebuild-vs-refactor verdict with its named falsifier (post-planner drift at the same rate reopens the question).
  3. Cite `overview.md` and `standards-alignment.md` for the *where* and the *what-must-hold*; duplicate neither.
- **Patterns to follow:** `../capability/docs/architecture/architecture.md` — decisions-with-rationale form, including a Provenance section naming source docs.
- **Test scenarios:** Test expectation: none — documentation.
- **Verification:** each decision names its rationale and, where one was weighed, the rejected alternative; no content duplicates the three sibling architecture docs (`overview.md`, `standards-alignment.md`, `calendar-rfc-mapping.md`).

### U4. Rewrite AGENTS.md

- **Goal:** AGENTS.md is the short always-apply distillation in capability's shape, pointing at the new layer.
- **Requirements:** R1, R6, R10.
- **Dependencies:** U1, U2, U3.
- **Files:** `AGENTS.md`.
- **Approach:**
  1. Restructure to capability's shape: Project → Where truth lives → How we work → Always-apply standards → Review guidelines.
  2. "Where truth lives" indexes: `STRATEGY.md` (landed first by U6), `CONCEPTS.md`, `docs/architecture/principles.md`, `docs/architecture/architecture.md` (+ `overview.md`, `standards-alignment.md`, `calendar-rfc-mapping.md`), `docs/engineering/practices.md`, `docs/plans/`, `docs/solutions/`, `docs/backlog.md`.
  3. Keep the existing per-section links into `docs/conventions/` (R6) and the existing always-apply content that survives (testing, TypeScript, naming, git, comments, visual assets). Add the per-unit-PR landing cadence (KTD8) to the always-apply standards so every session inherits it without being told.
  4. Write the Review guidelines rubric per R10 and KTD3: purpose, review-against (plan requirements, principles' governance tests, charter practice tests), P0/P1/P2 severity — documenting the receipts/acknowledgement semantics rather than a verdict parser. The rubric's check-list includes: does this PR span multiple plan units without a written cohesion reason (KTD8)?
- **Patterns to follow:** `../capability/AGENTS.md`; keep the file loadable-short (capability holds theirs under ~50 dense lines).
- **Test scenarios:** Test expectation: none — documentation.
- **Verification:** every link resolves in the working tree; the rubric names only mechanisms that exist; `CLAUDE.md` still reads `@AGENTS.md` unchanged.

### U5. Vocabulary and backlog entries

- **Goal:** The port's canonical terms and its deferred mechanism candidate are recorded where they belong.
- **Requirements:** R11.
- **Dependencies:** U1.
- **Files:** `CONCEPTS.md`, `docs/backlog.md`.
- **Approach:**
  1. Add "Engineering charter", "Governance test", and "Named divergence" to `CONCEPTS.md`, following the existing entry format (likely alongside § Review gate).
  2. Add the backlog entry for the import-boundary lint gate (dependency-cruiser-class), stating its trigger: adopt when refactor extractions define stable module boundaries worth mechanically enforcing (KD8).
  3. Add two accepted gate findings from PR #420's Codex review (recorded per the bound-work stopping rule, threads resolved with this destination named): layer-1 acknowledgements store a clean-shaped receipt (`record ce-code-review` has no `--acknowledged` path, so accepted layer-1 findings read as clean); the peer wrapper's `[out-file]` accepts unprotected in-repo paths that only three root-level gitignore patterns guard.
  4. Promote the dependency-flake root cause from session memory to `docs/solutions/` (category `integration-issues` or `test-failures`): the starter-note active-leaf steal documented in `test/specs/gantt-dependency-types.e2e.ts` — two existing solution docs already cite a `docs/solutions/` entry for it that does not exist.
- **Test scenarios:** Test expectation: none — documentation.
- **Verification:** CONCEPTS entries match the file's established format; the backlog entry names its adoption trigger.

### U6. Produce STRATEGY.md via ce-strategy

- **Goal:** The internal strategy anchor exists at `STRATEGY.md`, landed as the run's first PR.
- **Requirements:** R5.
- **Dependencies:** none — lands first (KD9); U4 indexes it afterwards.
- **Files:** `STRATEGY.md` (new).
- **Approach:**
  1. Run the ce-strategy skill interactively with the maintainer, upfront — the run's single human-input session.
  2. Seed from `website/docs/vision-and-philosophy.md`, `README.md`, and settled project decisions: TaskNotes is the system of record; standalone mode is a read-only viewer; calendar stays bundled-but-extractable; pace is deliberately sustainable; no features until the maintainability campaign concludes.
- **Execution note:** interview first; the commit, receipts, PR, and merge-on-green proceed autonomously after the maintainer approves content in-session.
- **Test scenarios:** Test expectation: none — documentation.
- **Verification:** STRATEGY.md exists in ce-strategy's shape; the maintainer approved the content in-session; U4 later links it from AGENTS.md.

---

## Verification Contract

| Gate | Command / mechanism | Applies to |
|---|---|---|
| Lint + typecheck | `npm run lint && npm run typecheck` (pre-commit hook) | every commit |
| Full unit suite | `npx jest` (entire suite, before every push — standing rule; expected green and unchanged, the diff is docs-only) | U1–U5 PR |
| Review receipts | both layers recorded per pushed tip (`node scripts/check-review-receipts.mjs`, `scripts/cross-model-peer-review.sh`) | every push |
| Document review | ce-doc-review on each authored doc | U1–U4 |
| Final PR gate | zero unresolved Codex review threads; CI green | U1–U5 PR |
| Maintainer arbitration | resolved upfront 2026-08-14: principles 7+4 split approved (KTD4); strategy content approved in the U6 interview session | U2, U6 |

The change is not e2e-observable (no `src/` diff); if the PR's CI e2e job reds anyway, apply the flake protocol — re-run before diagnosing, record the observation in `docs/backlog.md`.

---

## Definition of Done

- R1–R4, R6–R11 satisfied and the U1–U5 PR merged on green gates with both receipts and zero unresolved Codex threads.
- R5 satisfied: STRATEGY.md produced via ce-strategy, maintainer-approved, linked from AGENTS.md.
- The principles set was trimmed/approved by the maintainer at PR review.
- No review-gate script, hook, or CI workflow changed anywhere in the diff.
- No abandoned drafts or scratch files remain in the tree.
