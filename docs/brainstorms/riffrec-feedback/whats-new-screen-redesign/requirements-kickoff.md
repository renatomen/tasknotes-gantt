---
date: 2026-07-01
topic: whats-new-screen-redesign
---

# Whats New Screen Redesign

## Problem Frame

The maintainer screen-recorded **TaskNotes' own "What's New" view** (`What's new in TaskNotes 4.11.1`) as a reference design and asked the **TaskNotes Gantt** "What's New" view to match it: card-style collapsible per-release blocks, the full release history scrollable "down to beta 0", prominent version numbering, a current-release indicator, and human-formatted release dates — "just perfectly formatted."

This is a **feature / visual-parity request, not a bug.** The plugin already has a working `<details>`-based What's New view ([src/release/ReleaseNotesView.ts](../../../../src/release/ReleaseNotesView.ts)), so the gap is (1) **visual formatting** (bordered cards, right-aligned chevron, blue "Current" pill, formatted dates, intro copy) and (2) **content/history** — the bundle currently holds only `0.1.0-beta.4` because only one release-notes file exists in `docs/releases/`. See `problem-analysis.md` for the grounded source mapping.

> All extracted frames show TaskNotes' UI (the reference), NOT our plugin's current view. Treat frames as the design target.

Source materials for brainstorm:
- Source materials manifest: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\source-materials.md`
- Analysis: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\analysis.md`
- Problem analysis: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\problem-analysis.md`
- Review prompt with transcript and frames: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\review-prompt.md`

---

## Actors

- A1. User: Operates the product in the recorded session and verbalizes friction.
- A2. Product surface: The UI and backend behavior visible in the recording.
- A3. Brainstorm agent: Uses the evidence bundle to confirm, correct, and group requirements before planning.

---

## Key Flows

- F1. Evidence-backed feedback triage
  - **Trigger:** A feedback zip, video, audio file, or meeting notes file is available.
  - **Actors:** A1, A2, A3
  - **Steps:** Extract or copy the source, transcribe media or read notes, select high-signal moments when video exists, inspect screenshots when available, confirm problems, and write requirements with supporting evidence.
  - **Outcome:** Confirmed product problems are represented as requirements with transcript support and screenshot support when visual evidence exists.
  - **Covered by:** R1, R2, R3

---

## Requirements

**Evidence handling**
- R1. Each confirmed product problem must cite supporting transcript, notes, or moment evidence from the source, including timestamp and screenshot when video is available.
- R2. Transcript claims must be tied to the closest visible interaction or explicitly marked as untimed verbal context.

**Product requirements from this session** (candidates — confirm/regroup in brainstorm)
- R3. **Formatting parity:** Render each release as a bordered, collapsible card matching TaskNotes' "What's New" layout — prominent version number, right-aligned collapse chevron, human-formatted release date, filled "Current" badge for the active version. (problem-analysis §1; frames m1, m3)
- R4. **Full history:** The view lists all releases newest-first, scrollable back to the earliest (beta.0), with older releases collapsed by default. Depends on the release-notes bundle containing the full history (currently only `0.1.0-beta.4`). (problem-analysis §2.1; frame m3)
- R5. **Numbering & order:** Version numbers are displayed prominently and ordered consistently (semver-aware, newest first). (transcript: "pay attention to … the numbering")
- R6. **Dates:** Each release shows its release date, human-formatted, tied to the correct version. (transcript: "the dates, the release dates … perfectly formatted")
- R7. **Current indicator:** Exactly one release is marked "Current" and visually distinguished as a badge. (frame m1)
- R8. **(Lower priority) Intro copy:** Optional header paragraph above the cards (feedback / GitHub / star), matching the reference. (frame m1)

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a feedback source with voice, video, or notes, when the analysis is complete, each promoted issue includes source evidence rather than prose-only claims.
- AE2. **Covers R3.** Given the user reports that a button is weird or unclickable, when requirements are finalized, the requirement identifies the specific control and the expected available/unavailable behavior.

---

## Success Criteria

- A human reviewer can understand what went wrong without rewatching the entire recording.
- `ce-brainstorm` can confirm requirements from linked source evidence before any planning begins.

---

## Scope Boundaries

- The analyzer output is evidence and requirements kickoff material, not final implementation design.
- Automatically detected findings remain candidates until screenshots are inspected.
- Development-only noise, such as profiler requests, should not become product requirements unless it affects the user experience.

---

## Key Decisions

- Evidence first: Requirements should cite moments and screenshots before moving to planning.
- Brainstorm before plan: Use `ce-brainstorm` to refine product behavior when the recording reveals ambiguity.

---

## Dependencies / Assumptions

- Source session URL: `unknown`.
- Source materials manifest: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\source-materials.md`.
- Candidate findings: F1.
- Screenshot evidence: M1: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\frames\m1-6.72s-representative-video-frame.png`; M2: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\frames\m2-20.17s-representative-video-frame.png`; M3: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\frames\m3-33.61s-representative-video-frame.png`; M4: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\frames\m4-47.05s-representative-video-frame.png`; M5: `docs\brainstorms\riffrec-feedback\whats-new-screen-redesign\frames\m5-60.50s-representative-video-frame.png`.

---

## Outstanding Questions

### Resolve Before Planning

- **History backfill (the big one):** TaskNotes shows history back to beta.0, but our bundle has only `0.1.0-beta.4`. Do we author historical release-notes files for 0.1.0-beta.0…beta.3 to populate the list, or accept a shorter list that grows over time? (This is a content decision, not a view change.)
- **Fidelity target:** "exactly as this" — pixel-match TaskNotes' card styling, or match the *pattern* (cards, right chevron, badge, formatted dates) using Obsidian theme variables so it adapts to the user's theme?
- **Date format:** confirm the desired format ("June 26, 2026" vs another) and locale handling.
- **Intro copy (R8):** include the feedback/GitHub/star paragraph, or omit for the plugin?

### Deferred to Planning

- [Technical] Which code paths own the confirmed product behavior?
- [Technical] What regression tests should lock the behavior once fixed?

---

## Next Steps

-> Resume `/ce-brainstorm` to confirm candidate findings and replace generic R-items with product-specific requirements.
