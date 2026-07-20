# Git Workflow

Version-control conventions for this repo.

## Commits

- Use **conventional commit** prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Make **atomic** commits — one logical change each. Keep refactors in commits separate from feature/behavior changes.
- Write descriptive messages that explain the change and the *why*.
- **Do not credit AI tools** as authors or co-authors on commits, PRs, or issues. No `Co-Authored-By` AI trailers, no "generated with" footers.
- Commit and push **when the work calls for it or the maintainer asks** — don't auto-push partial work.

## Branches

- **Never commit directly to `main`** without explicit confirmation. Branch first.
- Use meaningful branch names: `feat/<short-desc>`, `fix/<short-desc>`, `refactor/<short-desc>`.
- Keep branches short-lived; open a PR and merge rather than letting them drift.

## PRs & Merge

- **Small, focused PRs — always.** Prefer many small PRs over one large one. A plan *unit* is a scope ceiling, not a floor: when a unit has a separable, independently-valuable, independently-testable part (a pure module before the UI that consumes it, a shared helper, a serializer), ship it as its own PR rather than holding it back to land the whole unit at once. A smaller review surface is a feature — it is where reviewers and the second-opinion bots (SonarCloud, Codex) actually catch things. Never batch unrelated changes to save a round-trip.
- Splitting a unit across PRs is the default, not a decision to escalate. Keep going autonomously; do not stop to ask whether to split.
- Open a PR for review; require **passing CI** (build, unit, e2e) before merge.
- **Squash-merge** to keep `main` history linear and one-commit-per-change.
- Delete the branch after merge; sync local `main`.
- For UI-affecting changes, capture a demo image/GIF into `docs/media/` and embed it in the PR body by a branch- or SHA-pinned `raw.githubusercontent` URL — never catbox. → [visual-assets.md](visual-assets.md)

## CI/CD

- Tests, lint, and type-checking run on every push via GitHub Actions.
- A pre-commit hook runs lint + typecheck locally — do not bypass it (`--no-verify`) unless explicitly agreed.
