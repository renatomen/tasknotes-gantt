# Obsidian community-store submission checklist

Status record for the scorecard-compliance work (plan: `docs/plans/2026-06-20-002-chore-plugin-scorecard-compliance-plan.md`). Confirms the submission-blocking code rules and the obsidian-releases listing prerequisites.

## Code-rule audit (must-pass subset) — 2026-06-20

| Rule | Result | Evidence |
|------|--------|----------|
| No `innerHTML`/`outerHTML`/`insertAdjacentHTML` from dynamic strings | **PASS** | No matches in `src/` (rendering goes through Svelte + Obsidian DOM helpers). |
| Registered views detach cleanly on unload | **PASS** | `src/main.ts` `onload` stores the `registerBasesGantt` disposer; `onunload` calls `this.unregisterBases?.()`. |
| No retained global `app` | **PASS** | Only per-instance `this.app = …` fields; no `window.app`/`globalThis.app`. |
| Vault paths via `normalizePath` | **N/A (PASS)** | No manual path construction; paths come resolved from Bases/TaskNotes APIs (`getAbstractFileByPath`, `getFirstLinkpathDest`). |

**`console.*` posture (decision):** `console.warn`/`console.error` calls are intentional diagnostics and are retained. The two informational `console.log` lines in `src/main.ts` (load/unload) are conventional and low-risk; a broader debug-logging cleanup is deferred (out of the must-pass scope). Note: the load/unload log strings still say "Obsidian Gantt" (pre-rename) — cosmetic, console-only.

## obsidian-releases listing prerequisites

Before opening the PR to [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases) (`community-plugins.json`):

- [ ] A GitHub **release** exists whose **tag string equals `manifest.json` `version`** exactly, with **no leading `v`** (the release workflow triggers on `*.*.*` tags — push e.g. `0.0.1`, not `v0.0.1`).
- [ ] The release contains **`main.js`**, **`manifest.json`**, and **`styles.css`** as assets (the release workflow attaches all three).
- [ ] `main.js`/`styles.css` carry a **build-provenance attestation** (the workflow asserts one was produced; verify with `gh attestation verify`).
- [ ] `manifest.json` fields are non-empty and accurate: `id` (`tasknotes-gantt`), `name` ("TaskNotes Gantt", no "Obsidian"), `version`, `minAppVersion` (`1.10.0` — **confirm this is the released Obsidian version that ships the Bases API** before listing), `description`, `author`, `authorUrl`, `isDesktopOnly: false` (mobile-validated).
- [ ] `README.md` includes a **screenshot/GIF** of the Gantt view (add before submitting — not yet present).
- [ ] Root files present: `README.md`, `LICENSE` (MIT), `versions.json`.
- [ ] The `obsidian-releases` PR adds the entry to `community-plugins.json` with id `tasknotes-gantt`.

## Open confirmations carried from the plan

- Confirm `minAppVersion: 1.10.0` against the Obsidian changelog (sourced from the `requireApiVersion('1.10.0')` gate in `src/bases/register.ts`).
- Add the README screenshot asset.
