# Codex review backlog

Every unresolved Codex (`chatgpt-codex-connector[bot]`) review comment since 2026-07-17. Codex is the final merge gate — resolve each item one of four ways: **fix**, **superseded** (a later commit already handles it — verify), **moot** (feature dropped), or **wrong** (reply on the thread with justification, get Codex to agree). Done = all resolved.

**Status 2026-07-26 (evening): the original 94-thread backlog is fully dispatched.** 61 were closed by the merged campaign units (U1–U6, U7, U9); the remaining 33 were closed this session — 22 verified-and-resolved with line-level citations against `main`, and the rest fixed in four gated PRs (below) or recorded as deliberate deferrals. To re-reconcile, query each PR's `reviewThreads{isResolved, comments{databaseId}}` (via `gh api --jq`, never a standalone `jq` — it is not installed here).

Status legend: 🔲 to triage · 🔧 to fix (confirmed real) · ✅ fixed (thread close pending) · ♻️ superseded · 🚫 moot · ✋ pushed back (Codex wrong)

## Fix PRs (each Codex-gated; merged on zero unresolved + green CI)

| PR | Closes | State |
|----|--------|-------|
| #335 | #304 + #305 (create→open routing race) | **MERGED** `d86505e`. 13 review rounds; one ✋ push-back (round 13 asked to re-add the deadline round 1 ordered removed — contradiction documented on the thread). Design ended as a plugin-owned lifetime with bounded child `Component` scopes. Source threads closed with citations. |
| #336 | #314 ×3 (inferred-drag mode / cascade / WDIO write spec) | **MERGED** `445f861` (shrunk to proven core per `docs/plans/2026-07-27-001-refactor-drag-derivation-authority-plan.md` U1). Round-14's six threads: two fixed (sibling mirroring at shrink correction+rollback; duplicated comment deleted), two reverted (null-fallback, projected-range echo — branch fixes; root lands with the derivation authority), two structural-deferred with plan citations. Clean Codex pass on final head `a9f30d0`; #314 source threads closed with citations. Earlier history: 11 review rounds, all threads resolved at `e3f9963`; at the gate. The estimate-only cascade projects with the READ path (real stretch, blocking facts re-windowed per grown estimate), undo restores the view's `defaultDurationDays`, and the "don't ask again" mode is now READ LIVE from Bases config at gesture time — the pending-copy mechanism is deleted, because it could not distinguish a stale pre-refresh value from an explicit re-enable. 9-case real-Obsidian write spec drives actual SVAR resizes. Sonar `new_coverage` (50.4%) is the known jest-only-lcov FN — this round moved logic into the Svelte drag handler, which only the e2e exercises. |
| #337 | #277 conflict attribution + #281 fetched-context identity | **MERGED** `5e9b639`. 4 rounds; banner names disagreeing calendars by path identity (not display name), fetched rows gain calendar identity + liveness (association watch, absence is a value) + picker consistency. Source threads closed with citations. |
| #338 | #297 DST offset hint + #264 probe segment shape | Threads resolved at `f131534`; at the gate. The heartbeat is extracted and unit-tested, AND proven through the real form: a WDIO case skews the renderer's clock into NZ daylight time, fires the recorded tick, and asserts the rendered hint moves 12:00→13:00, then that closing disposes it. Verified non-vacuous (fails with the form's `$effect` removed). |

## Resolved this session (verified against main, thread closed with citation)

#267 ×3 (33caedb) · #268 ×2 (2ba78e1) · #274 ×2 (5b81edb) · #276 ×2 (3e55fe3) · #277 picker row (3e55fe3) · #283 (47b97e2) · #285 (5b81edb) · #290 (ab3345b) · #294 ×2 (ab3345b) · #296 ×2 (e3a6517) · #298 (e3a6517) · #299 (ab3345b) · #303 (d6f1d07) · #309 (5b81edb) · #312 (47b97e2) · #301 (#334)

## Deliberate deferrals (thread open by design)

| PR | Location | Finding | Record |
|----|----------|---------|--------|
| #266 | plan-doc:295 | Refresh the evaluated-date stylesheet on viewport pan/zoom | `docs/backlog.md` ("Deferred Codex review threads"); reply posted naming the record |

Two further provenance questions surfaced by the #336 review are recorded in
`docs/backlog.md` ("Inferred-edge undo: authorship vs appearance") for one
maintainer decision: whether an undo should un-author the date/estimate the
choice materialised, which needs a patch path that can clear a field.
