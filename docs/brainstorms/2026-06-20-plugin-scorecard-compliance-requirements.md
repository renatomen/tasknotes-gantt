---
date: 2026-06-20
topic: plugin-health-security-scorecard-compliance
title: Obsidian community-plugin scorecard compliance — submission-ready + max health/security
type: brainstorm-requirements
status: ready-for-planning
---

# Obsidian community-plugin scorecard compliance (submission-ready + max scores)

## Summary

Get **obsidian-gantt** to a state where — the day it is listed in the Obsidian community store — it earns the **maximum controllable** ratings on Obsidian's plugin **Health & Security scorecard**, and where it actually *passes submission review* so it can be listed at all. The plugin is currently pre-submission (v0.0.1): no README, no `versions.json`, no release workflow, a guideline-violating display name. The good news from the audit: the *hard* security dimension is already won — the bundled `main.js` makes **zero network calls** and contains **no `eval`/`new Function`, no `atob`/`btoa`, no `isPrototypeOf`** — so the disclosures/warnings that ding many plugins do not apply. The work is hygiene, submission mechanics, release provenance, ESLint hardening, and honest disclosure.

**Decided:** design toward the published-plugin scorecard *now* (submission-ready + scorecard-max baked in). The display name becomes **"TaskNotes Gantt"** (id stays `obsidian-gantt`). The full plugin-guidelines *code-pattern* audit (innerHTML, view lifecycle, etc.) is **out of primary scope** except the subset that submission review actually enforces.

---

## Problem Frame

Obsidian's community-plugin portal now publishes a **scorecard** with two axes:

- **Health** — Hygiene (readme, license, description, contributing guide), Maintenance (commit/release recency), Responsiveness (issue closure, active contributors), Adoption (installs, stars).
- **Review / Security** — automated scans of the latest *release asset*: build-verified-against-source, GitHub artifact attestation for `main.js`/`styles.css`, vault read/write/enumeration disclosure, vulnerable-dependency check, plus Disclosures (network-call count, base64, dynamic code exec, clipboard) and Warnings (e.g. `Object.prototype` method access).

**Two reframes shape scope:**

1. **The scorecard only runs on *published* plugins.** obsidian-gantt isn't listed, so today it scores nothing. "Max the scorecard" therefore means: reach a state that *would* max it on listing — which also requires clearing **submission requirements** (the prerequisite to being listed).
2. **Health's Adoption / Responsiveness / Maintenance-velocity are organic** — installs, stars, issue-closure rate, contributor count cannot be engineered by a workflow change. They are explicitly **out of scope** as direct targets. What *is* controllable: Hygiene docs, the Review/Security scans, and disclosure.

### Current-state audit (2026-06-20)

**Already compliant / clean:**
- Bundled `dist/main.js`: 0 network calls (`requestUrl`/`fetch`/`XMLHttpRequest`/`WebSocket`), 0 `eval`/`new Function`, 0 `atob`/`btoa`, 0 `isPrototypeOf`. TaskNotes integration is an in-process JS API, not network. (The example scorecard's 28 network calls / 7 base64 / `isPrototypeOf` warning are a *different* plugin's.)
- `LICENSE` present. `eslint.config.mjs` present and run in CI (`ci.yml` → `npm run lint`).

**Gaps (controllable):**
- **Hygiene/submission docs missing:** no `README.md`, no `CONTRIBUTING.md`, no `versions.json`, no `SECURITY.md`.
- **No release workflow** — only PR-triggered `ci.yml`. So no **build-provenance attestation** and no **build-verified-against-source** (both explicit scorecard "Passed" items).
- **manifest.json:** display name **"Obsidian Gantt"** violates the no-"Obsidian"-in-name guideline (review blocker); `author` is generic "Open Source Community"; `authorUrl` empty; **`minAppVersion: 1.5.0` is understated** — the plugin uses the Bases API (register.ts cites "Bases API (1.10.0+)"); `isDesktopOnly: false` claims mobile support that is unverified.

---

## Key Decisions

- **Design toward the published scorecard now (pre-submission).** Bake max-score practices in before listing rather than retrofitting after.
- **Display name → "TaskNotes Gantt"; id stays `obsidian-gantt`.** Dropping "Obsidian" clears the review blocker. The id is not a scorecard item and changing it would break the dev-vault install path + e2e, so it is retained. *Caveat (assumption):* leading with another plugin's name ("TaskNotes" = `callumalpass/tasknotes`) may draw an affiliation question in review; the README must state obsidian-gantt is an **independent companion** to TaskNotes, not an official part of it.
- **Controllable-only target.** Adoption/Responsiveness/Maintenance-velocity are organic and excluded as direct goals; the work targets Hygiene + Review/Security + submission requirements.
- **Submission-review code rules are in scope; the exhaustive code-pattern audit is not.** Only the code rules that block listing (e.g. no `innerHTML` from untrusted strings, proper view detach, no leaked global `app`) are checked; a full plugin-guidelines refactor is deferred (the user's option-3 territory).
- **Honest disclosure over minimization.** The README transparently discloses what the plugin reads/writes/enumerates in the vault and that it integrates with TaskNotes in-process — disclosure is a scorecard value, and the plugin has nothing to hide (no network/telemetry).

---

## Actors

- A1. **Plugin maintainer (the author).** Owns manifest identity, release process, docs, and the eventual community-store submission PR.
- A2. **Obsidian scorecard / automated review scanner.** Scans the released `main.js`/`styles.css`, manifest, repo hygiene, and dependency tree; assigns Health/Review ratings.
- A3. **Obsidian plugin reviewer (human).** Gates the initial community-store submission against the plugin guidelines + submission requirements.
- A4. **End users.** Read the README's disclosures to decide whether to trust/install; benefit from verifiable build provenance.

---

## Requirements

IDs scoped to this feature.

### Submission readiness (prerequisite to being scored)

- R1. The manifest display **name contains no "Obsidian"** and is set to "TaskNotes Gantt"; `author` and `authorUrl` carry real values; `description` is a single concise sentence (current one is acceptable).
- R2. `minAppVersion` reflects the **actual minimum Obsidian version** the plugin requires (the Bases API version it depends on), not an understated value.
- R3. A `versions.json` exists mapping each released plugin version → its `minAppVersion` (required by the community release process).
- R4. `isDesktopOnly` accurately reflects verified platform support (set `true` if mobile is not validated, or validate mobile and keep `false`).
- R5. The repo passes the submission-blocking **code rules** (no `innerHTML`/`outerHTML` from dynamic strings without sanitization, registered views detach cleanly on unload, no retained global `app`, vault paths normalized) — audited, not assumed.

### Hygiene (Health axis — controllable)

- R6. A `README.md` exists describing what the plugin does, install/use, **and a transparency/disclosure section** (vault read/write/enumeration; in-process TaskNotes integration; no network/telemetry; independent-companion disclaimer per the name caveat).
- R7. A `CONTRIBUTING.md` exists (the exact Hygiene gap the portal flags) covering dev setup, build, test, and PR conventions.
- R8. A `SECURITY.md` exists (vulnerability-reporting policy) — supports the security posture and is standard for a trusted plugin.

### Review / Security (the scored scans)

- R9. A **release workflow** builds the plugin from tagged source in CI and publishes `main.js`, `manifest.json`, `styles.css` as release assets — enabling **"build verified against source."**
- R10. The release workflow generates **GitHub artifact attestation (build provenance)** for `main.js` and `styles.css`, so the scorecard's two attestation "Passed" items are earned.
- R11. The dependency tree is **free of known-vulnerable packages** at release time (the scan's "no vulnerable dependencies" pass), with a mechanism to keep it so.
- R12. The released bundle introduces **no undisclosed** network calls, dynamic code execution, base64 obscuring, or clipboard access; any that ever appear (incl. from dependencies) are disclosed in the README. (Today: none — maintain the clean state.)

### ESLint (recommended by the portal)

- R13. ESLint runs in CI and its ruleset covers the scorecard-relevant correctness rules (notably `no-prototype-builtins` for the `isPrototypeOf` warning class), aligned with the Obsidian sample-plugin/recommended config; the build does not regress on new lint errors.

---

## Key Flows

- F1. **Tagged release → attested assets.** Maintainer pushes a version tag → release workflow builds from source, attaches `main.js`/`manifest.json`/`styles.css`, and emits build-provenance attestations → scorecard later verifies build-from-source + attestation. (R9, R10)
- F2. **Reviewer reads the README disclosures.** A reviewer/user opens the README → sees exactly what vault access the plugin uses and that there's no network/telemetry → trust + disclosure pass. (R6, R12)
- F3. **Submission review.** Maintainer opens the community-store PR → manifest name/version/platform + code rules pass review → plugin is listed → scorecard begins scoring. (R1–R5)

---

## Acceptance Examples

- AE1. **Name passes review.** Given the manifest, when a reviewer checks the name, then it is "TaskNotes Gantt" with no "Obsidian" and the listing is not rejected on the name rule. (R1)
- AE2. **Attestation earned.** Given a tagged release, when the scorecard scans the release, then `main.js` and `styles.css` each show a verified GitHub artifact attestation and "build verified against source" passes. (R9, R10)
- AE3. **Hygiene complete.** Given the repo, when the scorecard checks Hygiene, then readme, license, description, and contributing guide are all present (no "Missing contributing guide"). (R6, R7)
- AE4. **Clean security scan.** Given the released bundle, when scanned, then network-call count is 0 (or fully disclosed), and there are no base64/dynamic-code-exec/`isPrototypeOf` warnings. (R12, R13)
- AE5. **Correct minAppVersion.** Given a user on the minimum supported Obsidian version, when they install, then the plugin's Bases features work (minAppVersion is not understated). (R2, R3)

---

## Scope Boundaries

### Deferred for later
- Organic Health dimensions — **Adoption** (installs/stars), **Responsiveness** (issue-closure rate, active contributors), **Maintenance** velocity. Not engineerable; they accrue post-listing.
- A full **plugin-guidelines code-pattern refactor** (exhaustive innerHTML/DOM-API/view-lifecycle/sentence-case-UI audit beyond the submission-blocking subset R5) — the user's option-3 scope, revisit if review surfaces specifics.
- `fundingUrl` and other optional manifest niceties.
- Changing the plugin **`id`** (`obsidian-gantt`) — deferred; disruptive to dev setup and not a scorecard item.

### Outside this product's identity
- Adding telemetry/analytics or any network call to "improve metrics" — the plugin is local-only by design; disclosure-clean beats instrumented.
- Gaming Adoption/Responsiveness numbers.

---

## Dependencies / Assumptions

- **The scorecard is forward-looking** — none of this is measurable until obsidian-gantt is listed; success is defined against the published criteria, verified by local proxies (manifest lint, attestation present in a test release, clean bundle scan).
- **Name affiliation assumption** — "TaskNotes Gantt" uses `callumalpass/tasknotes`'s plugin name; assumed acceptable because the maintainer co-develops TaskNotes, mitigated by an independent-companion disclaimer in the README. If review objects, fall back to a non-"TaskNotes" name.
- **`minAppVersion` value** — the exact minimum is the Obsidian version that shipped the Bases API the plugin uses (register.ts cites 1.10.0+); confirm the precise version at planning.
- **Mobile support unknown** — `isDesktopOnly: false` is currently unverified; either validate on mobile or set `true`.
- **Author identity** — real `author`/`authorUrl` values to be supplied (default: the maintainer's GitHub handle + profile URL).
- GitHub artifact attestation requires `actions/attest-build-provenance` + appropriate `id-token`/`attestations` workflow permissions on a release (not PR) trigger.

## Outstanding Questions

### Resolve before planning
- None blocking. (Objective, name, and controllable-scope are decided.)

### Deferred to planning
- Exact `author`/`authorUrl` strings and whether to add `fundingUrl`.
- The precise `minAppVersion` (confirm the Bases-API Obsidian version) and the mobile-support decision for `isDesktopOnly`.
- Release-workflow shape: adapt the Obsidian sample-plugin `release.yml` vs author a bespoke one; tag-trigger conventions; how `versions.json` is maintained.
- The exact ESLint ruleset delta vs the current `eslint.config.mjs` (which recommended rules to add).
- README disclosure depth (how granular the vault-access disclosure should be).

## Sources / Research

- Obsidian developer docs (provided by maintainer): Submission requirements, Plugin guidelines, Developer policies, Plugin security, Beta-testing, Use Svelte in your plugin, and the `obsidianmd/obsidian-sample-plugin` template (reference for `release.yml`, ESLint config, manifest/versions.json shape).
- Current-state audit: `manifest.json`, `.github/workflows/ci.yml`, `eslint.config.mjs`, `dist/main.js` bundle scan, repo root hygiene files (2026-06-20).
- Bases API minimum: `src/bases/register.ts` ("official Obsidian Bases API (1.10.0+)").
