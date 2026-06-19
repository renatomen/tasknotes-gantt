---
date: 2026-06-20
plan_id: 002
type: chore
title: "chore: Obsidian plugin scorecard compliance — submission-ready + max health/security"
origin: docs/brainstorms/2026-06-20-plugin-scorecard-compliance-requirements.md
status: completed
reviewed: 2026-06-20
---

# chore: Obsidian plugin scorecard compliance (submission-ready + max scores)

Bring obsidian-gantt to a state where, on community-store listing, it maxes the **controllable** Obsidian scorecard (Hygiene + Review/Security) and passes submission review (origin: [docs/brainstorms/2026-06-20-plugin-scorecard-compliance-requirements.md](docs/brainstorms/2026-06-20-plugin-scorecard-compliance-requirements.md), R1–R13).

---

## Summary

Six bounded, mostly-additive changes: fix the manifest/package identity (drop "Obsidian" from the name → **"TaskNotes Gantt"**, real author, correct `minAppVersion`, reconcile the license to **MIT**, move `dotenv` to dev deps), add `versions.json` + version-bump tooling, add the missing hygiene docs (README with disclosure, CONTRIBUTING, SECURITY), add a tag-triggered **release workflow with GitHub build-provenance attestation**, align ESLint + add CI guards that keep the bundle clean and dependencies vuln-free, and audit the source against the submission-blocking guideline subset. The hard security work is already done — the bundle is network/eval/base64-clean (origin audit) — so this is hygiene, release provenance, and submission mechanics, not a security remediation.

---

## Problem Frame

obsidian-gantt is pre-submission (v0.0.1). The Obsidian community-plugin scorecard scores only *published* plugins, so "max the scorecard" means reaching a state that *would* max it on listing — which also requires clearing submission requirements. The origin audit found the security scans already clean (0 network calls, no `eval`/`atob`/`isPrototypeOf` in `dist/main.js`); the gaps are hygiene docs, release provenance, and manifest correctness. The **organic** Health dimensions (Adoption, Responsiveness, Maintenance velocity) are out of scope — they cannot be engineered.

### Confirmed current state (repo audit + doc-review)
- `manifest.json`: name **"Obsidian Gantt"** (review blocker), `author: "Open Source Community"`, `authorUrl: ""`, `minAppVersion: "1.5.0"` — but `src/bases/register.ts` gates Bases registration on `requireApiVersion('1.10.0')`, so the plugin is non-functional below 1.10.0. `isDesktopOnly: false` — **mobile-validated** (works, minor polish pending), so the value is honest.
- **License conflict:** `LICENSE` file is **GPL v2**; `package.json` declares **GPL-3.0**. Two incompatible claims — resolved to **MIT** (KTD7).
- `package.json`: `name`/`author` mirror the manifest's issues; `description` references **"Dataview integration"** (stale — the plugin integrates Bases + TaskNotes, not Dataview); **`dotenv` is in `dependencies`** but used only by `scripts/` (tree-shaken out of `dist/main.js`) — belongs in `devDependencies`. No `version` bump script.
- Missing at root: `README.md`, `CONTRIBUTING.md`, `versions.json`, `SECURITY.md`.
- `.github/workflows/`: only `ci.yml` (PR-triggered, `windows-latest`, default `pwsh`). No release workflow, no attestation. Actions are floating-tag-pinned (`@v4`), not SHA-pinned.
- `eslint.config.mjs`: present, minimal; `js.configs.recommended` **is** applied (so `no-prototype-builtins` is already on). `@typescript-eslint/recommended` is **not** applied. Runs in CI via `npm run lint`.

---

## Requirements

Traced from the origin doc (R1–R13). Submission-readiness (R1–R5), Hygiene (R6–R8), Review/Security (R9–R12), ESLint (R13). All carried into the units below.

---

## Key Technical Decisions

- **KTD1 — Single source of truth for version/identity via the sample-plugin convention.** Adopt the `obsidianmd/obsidian-sample-plugin` `version-bump.mjs` + `npm version` script so `manifest.json` and `versions.json` stay in lockstep on every release.
- **KTD2 — `minAppVersion` = `1.10.0`, matching the code's own Bases-API gate.** `register.ts` refuses to register below 1.10.0; declaring `1.5.0` admits non-functional installs. (Confirm 1.10.0 is the correct released Bases-API Obsidian version at execution — the value is sourced from the `register.ts` gate, not independently verified; if Bases shipped at 1.9.x, align down so 1.9.x users aren't needlessly excluded.)
- **KTD3 — Release provenance via `actions/attest-build-provenance`, attesting `dist/` assets, with SHA-pinned actions.** The release workflow builds from a tag and creates a GitHub release with the **`dist/`** outputs (`dist/main.js`, `dist/manifest.json`/root `manifest.json`, `dist/styles.css` — vite emits to `dist/`, unlike the sample plugin's root esbuild output), then runs `actions/attest-build-provenance` (`subject-path` → the `dist/` assets) with `permissions: { contents: write, id-token: write, attestations: write }`. **All actions pinned to commit SHAs** (not floating tags) so the attestation can't be poisoned via a moved tag — and a workflow step **asserts an attestation id was produced** (fails if empty) rather than relying on eyeballing.
- **KTD4 — Disclosure over minimization in the README, with Vault Enumeration broken out.** The README discloses **three distinct** access surfaces the scorecard tracks separately — Vault **Read**, Vault **Write**, Vault **Enumeration** (the latter naming the actual APIs: `vault.getAbstractFileByPath`, `metadataCache.getFirstLinkpathDest`, used to resolve wikilinks/open notes; it does *not* iterate all files) — plus the in-process TaskNotes integration, "no network/telemetry", and a `gh attestation verify` provenance-check snippet.
- **KTD5 — Maintain-don't-fix the clean bundle, guarded in CI by call-pattern grep.** The guard greps `dist/main.js` for **call patterns** — `eval(`, `new Function(`, `\.atob(`/`atob(`, `btoa(`, `\bfetch(`, `XMLHttpRequest`, `sendBeacon` — NOT bare keywords (the clean bundle already contains the word "fetch" inside a SVAR comment; a bare `grep fetch` would false-fail). Each pattern is verified to return 0 on the current bundle before committing. The step declares `shell: bash` (CI is `windows-latest`/pwsh; Git Bash ships on the runner).
- **KTD6 — Keep the plugin `id` (`obsidian-gantt`).** Out of scope to change (origin decision): disruptive to the dev-vault install path + e2e, and not a scorecard item. Only the *display name* changes.
- **KTD7 — License = MIT, verified compatible with bundled deps.** Reconcile the GPLv2-LICENSE/GPL-3.0-package.json conflict to **MIT** (replace `LICENSE` text + set `package.json` `"license": "MIT"`). Verified safe: `@svar-ui/svelte-gantt@2.7.0`, `@svar-ui/svelte-toolbar`, and Svelte are all MIT-licensed, so the bundled `main.js` carries no GPL/copyleft obligation that MIT would violate. (SVAR's *other* products are GPL/commercial; the npm packages bundled here are MIT — confirmed in their `package.json`.)
- **KTD8 — Name "TaskNotes Gantt" is endorsed, not just defensible.** The affiliation concern is retired: the TaskNotes author publicly endorsed the companion-plugin announcement and TaskNotes' JS API is designed to encourage companion plugins. The README companion note is a positive mention (not a defensive disclaimer); `authorUrl` is set to a profile that surfaces the relationship. No fallback name needed.

---

## Implementation Units

Dependency order: **U1 → U2** (identity/license must settle before version tooling) ; **U1 → U3** (README documents the settled name/identity) ; **U2 → U4** (release needs `versions.json` + bump flow) ; **U5, U6** are independent of each other and of U1–U4.

### U1. Manifest + package identity, license, and dependency hygiene

- **Goal:** Make plugin identity submission-compliant, self-consistent, and correctly licensed.
- **Requirements:** R1, R2, R4; plus the license + dotenv corrections the review surfaced.
- **Dependencies:** none.
- **Files:** `manifest.json`, `package.json`, `LICENSE`.
- **Approach:** manifest `name` → "TaskNotes Gantt" (KTD8); real `author` + `authorUrl` (profile establishing the TaskNotes-companion relationship — value confirmed at execution); `minAppVersion` → `1.10.0` (KTD2); keep `isDesktopOnly: false` (mobile-validated). Align `package.json` `name`/`author`/`description` with the manifest and **fix the stale "Dataview" reference**. **Set `package.json` `"license": "MIT"` and replace the `LICENSE` file with MIT text** (KTD7). **Move `dotenv` from `dependencies` to `devDependencies`** (scripts-only; not in the bundle). Keep `id` unchanged (KTD6).
- **Patterns to follow:** `obsidianmd/obsidian-sample-plugin` `manifest.json` + MIT `LICENSE` shape.
- **Test scenarios:** `Test expectation: none -- metadata/config only.` Verification by review (below).
- **Verification:** `manifest.json` + `package.json` agree; name contains no "Obsidian"; `minAppVersion` matches the `register.ts` gate; `LICENSE` and `package.json` license agree (MIT); `dotenv` no longer a runtime dep; `npm run build` still succeeds. (AE1, AE5)

### U2. versions.json + version-bump tooling

- **Goal:** Add `versions.json` and a one-command release-version bump that keeps it in sync with the manifest.
- **Requirements:** R3.
- **Dependencies:** U1 (final `minAppVersion`).
- **Files:** `versions.json` (new), `version-bump.mjs` (new), `package.json` (add `"version"` script).
- **Approach:** Adopt the sample-plugin `version-bump.mjs`: on `npm version`, read the new version + manifest `minAppVersion`, write `manifest.json` and append `versions.json`. Seed `versions.json` with the current version → `1.10.0` (or the confirmed value from KTD2).
- **Patterns to follow:** `obsidianmd/obsidian-sample-plugin` `version-bump.mjs` + `versions.json`.
- **Test scenarios:** `Test expectation: none -- build/release tooling; validated by a dry-run bump producing matching manifest+versions entries.`
- **Verification:** a dry-run `npm version patch` updates `manifest.json` and `versions.json` consistently.

### U3. Hygiene docs (README, CONTRIBUTING, SECURITY)

- **Goal:** Close the Hygiene gaps and disclose plugin behavior transparently.
- **Requirements:** R6, R7, R8; R12 (disclosure).
- **Dependencies:** U1 (settled name/identity/license to document).
- **Files:** `README.md` (new), `CONTRIBUTING.md` (new), `SECURITY.md` (new).
- **Approach:** `README.md` — what it does, install/use, a **Transparency/Disclosure** section breaking out Vault **Read** / **Write** / **Enumeration** with the actual APIs (KTD4), the in-process TaskNotes integration, "no network/telemetry", a positive **companion** mention (KTD8), and a short **"Verifying build provenance"** note (`gh attestation verify dist/main.js --repo <owner>/obsidian-gantt`). `CONTRIBUTING.md` — dev setup (fnm Node 20, build, test, e2e), PR conventions. `SECURITY.md` — vulnerability-reporting policy.
- **Patterns to follow:** the existing dev-run setup; GitHub default `SECURITY.md` shape.
- **Test scenarios:** `Test expectation: none -- documentation.`
- **Verification:** all three exist at root; Hygiene shows readme + license + description + contributing present (AE3); enumeration disclosed distinctly (F2).

### U4. Release workflow with build-provenance attestation

- **Goal:** A tag-triggered workflow that builds from source and publishes attested `dist/` release assets.
- **Requirements:** R9, R10.
- **Dependencies:** U2 (versions.json + bump flow).
- **Files:** `.github/workflows/release.yml` (new).
- **Approach:** On a version tag, build (`npm ci` + `npm run build`), create a GitHub release attaching the **`dist/`** outputs, and run `actions/attest-build-provenance` with `subject-path` pointing at the **`dist/`** assets (KTD3) — not root paths (vite emits to `dist/`; copying the sample flow verbatim would attest nothing). `permissions: { contents: write, id-token: write, attestations: write }`. **SHA-pin every action**; **assert the attestation id is non-empty** (fail otherwise). Runner: align with the repo's `windows-latest` or use `ubuntu-latest` for the release job (sample flow is ubuntu) — pick one and make paths/shell consistent.
- **Patterns to follow:** `obsidianmd/obsidian-sample-plugin` `release.yml` (adapted for `dist/` outputs); `actions/attest-build-provenance` docs; SHA-pinning per GitHub hardening / OpenSSF Scorecard.
- **Test scenarios:** `Test expectation: none -- CI workflow; validated by a test tag producing a release with attestations attached.`
- **Verification:** a test tag yields a release whose `dist/main.js`/`dist/styles.css` show a verified GitHub artifact attestation (AE2); the attestation-presence assertion passes; `gh attestation verify` succeeds.

### U5. ESLint confirmation + CI hygiene guards

- **Goal:** Confirm lint covers the scorecard-relevant rule and add CI guards that hold R11/R12 green automatically — **without** pulling in the deferred code-pattern refactor.
- **Requirements:** R13, R11, R12.
- **Dependencies:** none.
- **Files:** `eslint.config.mjs` (only if a named rule is missing), `.github/workflows/ci.yml`.
- **Approach:** **Confirm `no-prototype-builtins` is active** (it already is via `js.configs.recommended`) and check no other *scorecard-relevant* correctness rule is missing. **Do not** blanket-add `@typescript-eslint/recommended` — it would fire dozens of `no-unsafe-*`/`any` errors on Svelte/Bases-shim types and drag in the deferred refactor (origin scope); add individual rules only with a named scorecard justification. Add to `ci.yml`: a **dependency-vuln check** `npm audit --omit=dev --audit-level=high` (dev deps aren't shipped) for R11, and the **bundle-hygiene call-pattern grep** (KTD5, `shell: bash`) for R12.
- **Patterns to follow:** existing `ci.yml` job/step shape.
- **Test scenarios:**
  - The bundle-hygiene step returns 0 matches on the current clean bundle (verify each pattern) and fails when a forbidden call-pattern is injected.
  - `npm run lint` stays green (no ruleset-churn regression).
  - `npm audit --omit=dev --audit-level=high` passes on the current tree (or surfaces a real high+ vuln to fix).
- **Verification:** CI runs lint + vuln-check + bundle-hygiene; all green on current `main`; AE4 holds.

### U6. Submission code-rule audit + submission-PR readiness checklist

- **Goal:** Verify the source passes the submission-blocking guideline subset, and that the repo satisfies the obsidian-releases listing prerequisites.
- **Requirements:** R5, R12.
- **Dependencies:** none.
- **Files:** audit across `src/**`; remediation files determined by findings; the checklist is recorded in this plan / a release doc.
- **Approach:** Audit against the **must-pass** guideline subset only (origin scope): no `innerHTML`/`outerHTML` from dynamic strings; registered views/leaves detach cleanly on `onunload`; no retained global `app`; vault paths via `normalizePath`. **Sentence-case UI text is NOT in scope** (a guideline preference, deferred). Separately, record the **obsidian-releases submission-PR checklist** so "submission-ready" is verifiable: release tag string **==** `manifest.json` version (no leading `v`); the release contains `main.js`+`manifest.json`+`styles.css`; manifest fields non-empty; a README screenshot/demo image present. Decide the **`console.*` posture** (52 calls in `register.ts`/`GanttContainer.svelte`) — gate/strip debug logs or accept (document the decision; a reviewer may note them).
- **Patterns to follow:** Obsidian plugin guidelines + submission requirements; existing view registration in `src/bases/register.ts`.
- **Test scenarios:**
  - If any remediation changes behavior (e.g. view-detach on unload), add/adjust a unit or e2e test asserting the corrected behavior.
  - Otherwise `Test expectation: none -- confirmation audit with no behavioral change` (record findings).
- **Verification:** documented audit result; any violation fixed with a test; plugin loads/unloads cleanly with no leaked views; the submission-PR checklist items are all satisfiable (F3).

---

## Scope Boundaries

### Deferred to Follow-Up Work
- The actual community-store **submission PR** to `obsidianmd/obsidian-releases` (the listing mechanics) — this plan makes the repo submission-*ready* and records the checklist; opening the PR is a separate step.
- **Mobile polish** — the plugin works on mobile (validated) but needs minor improvements; tracked separately, not blocking submission.
- Full plugin-guidelines **code-pattern refactor** beyond the must-pass subset (U6) — incl. sentence-case UI text — origin's option-3 scope.
- `fundingUrl` and other optional manifest niceties.
- Changing the plugin **`id`** (KTD6).

### Outside this product's identity
- Telemetry/analytics or any network call to improve metrics — the plugin is local-only by design.
- Engineering the organic Health dimensions (Adoption/Responsiveness/Maintenance velocity).

---

## Risks & Dependencies

- **`minAppVersion` accuracy (medium).** `1.10.0` is sourced from the `register.ts` gate, not independently confirmed against the Obsidian changelog. If wrong, the store rejects installs or admits non-functional ones. Mitigation: confirm the released Bases-API version at execution (KTD2).
- **Attestation attaches to the wrong path / silently no-ops (medium).** vite emits to `dist/`; copying the sample (root-output) flow would attest nothing, and missing permissions also produce no attestation silently. Mitigation: `dist/`-scoped `subject-path` + attestation-presence assertion + a test-tag dry-run gate (KTD3, U4).
- **Supply-chain via unpinned actions (low–medium).** The release job's `id-token`/`attestations: write` scope makes it a high-value target; a moved action tag could poison the attested build. Mitigation: SHA-pin all actions (KTD3).
- **License relicense correctness (low).** Switching to MIT requires the bundled deps to be MIT-compatible — verified (SVAR gantt/toolbar + Svelte are MIT, KTD7). Author owns the original code, so relicensing is theirs to make.
- **Name affiliation (low — retired).** "TaskNotes Gantt" is endorsed by the TaskNotes author and the JS API encourages companions (KTD8); the prior rejection concern is no longer load-bearing.

---

## Deferred to Implementation
- Exact `author`/`authorUrl` strings; whether to add `fundingUrl`.
- Confirm the precise released Bases-API Obsidian version for `minAppVersion`.
- The release-job runner choice (`windows-latest` vs `ubuntu-latest`) and the matching path/shell details.
- Whether U6 surfaces real remediation (view lifecycle, etc.) or is a clean confirmation; the `console.*` posture decision.
- The README screenshot/demo asset for the submission checklist.

---

## Sources & Research
- Origin requirements: [docs/brainstorms/2026-06-20-plugin-scorecard-compliance-requirements.md](docs/brainstorms/2026-06-20-plugin-scorecard-compliance-requirements.md).
- Obsidian docs (maintainer-provided): Submission requirements, Plugin guidelines, Developer policies, Plugin security; `obsidianmd/obsidian-sample-plugin` (release.yml, version-bump.mjs, versions.json, manifest, ESLint config); `obsidianmd/obsidian-releases` (community-plugins listing PR requirements).
- `actions/attest-build-provenance` (GitHub build provenance); GitHub action SHA-pinning hardening / OpenSSF Scorecard Pinned-Dependencies.
- Repo audit: `manifest.json`, `package.json` (license/dotenv), `LICENSE` (GPLv2), `eslint.config.mjs`, `.github/workflows/ci.yml`, `src/bases/register.ts` (Bases API 1.10.0 gate), `dist/main.js` bundle scan; `@svar-ui/svelte-gantt`/`svelte-toolbar` `package.json` (MIT).
- Doc-review (2026-06-20): coherence, feasibility, security-lens, scope-guardian, adversarial — findings folded in (license, dotenv, dist-path attestation, bundle-grep patterns/shell, SHA-pinning, enumeration disclosure, ESLint scope cap, U6 trim + submission checklist, audit threshold).
