---
title: "Build-provenance attestation requires a public repo (GitHub Actions release pipeline)"
date: 2026-06-23
category: docs/solutions/tooling-decisions
module: release-pipeline / ci
problem_type: tooling_decision
component: tooling
severity: medium
resolution_type: config_change
applies_when:
  - "Adding actions/attest-build-provenance to a GitHub Actions release/tag workflow"
  - "Releasing an Obsidian (or similar) community plugin from a personal GitHub account"
  - "A tag-triggered release run fails at the attestation step on a private repo"
  - "Deciding repo visibility for a project distributed via GitHub Releases + BRAT"
related_components:
  - development_workflow
tags:
  - github-actions
  - build-provenance
  - attestation
  - release-pipeline
  - repo-visibility
  - brat
  - obsidian-plugin
  - ci
---

# Build-provenance attestation requires a public repo

## Context

While standing up the community-release pipeline for `tasknotes-gantt`, the
release workflow (`.github/workflows/release.yml`) attests the built artifacts
with `actions/attest-build-provenance`, and a follow-up step asserts an
attestation id was actually produced (fail-closed). The repository was still
**private** at this point.

A **beta-tag CI dry run** (push a throwaway `X.Y.Z-beta.N` tag on a scratch
branch, watch the run, then delete the tag — nothing published) was used to
validate the workflow before any real release depended on it. Every step passed
— tag-format guard, notes-file verification, build, bundle hygiene — **until
attestation**, which hard-failed.

## Guidance

**`actions/attest-build-provenance` (and the OIDC `id-token: write` it relies on)
is not available on user-owned PRIVATE repositories.** The step fails with:

```
Error: Failed to persist attestation: Feature not available for user-owned
private repositories. To enable this feature, please make this repository public.
```

The fix is a **repo-visibility decision, not a workflow change**: make the
repository **public**. Build-provenance attestation is available for public
repos (and for org/enterprise plans); on a personal account it is gated to
public repos. Once public, the attestation step and the assert-attestation guard
pass, and the release completes (a draft release/pre-release is created for the
maintainer to publish).

Crucially, going public is **not a workaround** — it is a prerequisite for the
whole distribution model anyway:

- The **Obsidian community store** only lists plugins from public repos.
- **BRAT** (beta distribution) fetches release assets from the repo, so beta
  testers also need it public.
- Attestation then works as a bonus, with no code change.

So there is nothing to "fix" in the pipeline. The release flow simply cannot
complete end-to-end until the repo is public — which it must be to ship.

## Why This Matters

- **It's a hard release blocker that only surfaces at release time.** The
  workflow looks correct and passes locally/in PR CI; the failure appears only
  when a tag triggers the real release job. Without a dry run you discover it
  during your first actual release.
- **It's non-obvious.** The feature works on public and org repos, so it's easy
  to assume it works everywhere; the personal-private restriction is a GitHub
  platform limitation, not a misconfiguration you can fix in YAML.
- **The dry run is what made it cheap.** Pushing a throwaway beta tag and
  watching CI surfaced the constraint with zero user impact (no published
  release), exactly when a dry run is supposed to: before the real thing depends
  on it. Treat "push a disposable pre-release tag and watch the release job" as
  the standard pre-flight for any new release workflow.

## When to Apply

- Before relying on a GitHub Actions release pipeline that uses
  `actions/attest-build-provenance` from a personal account.
- When a tagged release run fails at "Attest build provenance" with the
  private-repo error above.
- When deciding repo visibility for anything distributed via GitHub Releases +
  BRAT or the Obsidian community store — make it public early so the release
  pipeline (and a dry run of it) works end-to-end.

## Examples

**The release-workflow steps that depend on a public repo** (`release.yml`):

```yaml
permissions:
  contents: write       # create the release + upload assets
  id-token: write       # OIDC token for provenance signing  ← public-repo gated
  attestations: write   # write the attestation

# ...
- name: Attest build provenance
  id: attest
  uses: actions/attest-build-provenance@<pinned-sha>   # v4.1.0
  with:
    subject-path: |
      dist/main.js
      dist/styles.css
      manifest.json
- name: Assert attestation was produced
  run: |
    if [ -z "${{ steps.attest.outputs.attestation-id }}" ]; then
      echo "::error::No attestation id was produced; aborting release."
      exit 1
    fi
```

**The dry run that surfaced it** (safe — creates only a draft, then deleted):

```bash
git checkout -b chore/release-dry-run
# ...author a throwaway docs/releases/X.Y.Z-beta.0.md, then:
npm version X.Y.Z-beta.0
git push origin X.Y.Z-beta.0          # triggers the Release workflow
gh run watch <run-id> --exit-status   # ← fails at "Attest build provenance" while private
# cleanup:
gh release delete X.Y.Z-beta.0 --yes --cleanup-tag   # (no release was created here; just the tag)
git push origin --delete X.Y.Z-beta.0 2>/dev/null || true
```

**Resolution:** GitHub → repo **Settings → General → Danger Zone → Change
visibility → Public**. Re-running the same dry run after going public completes
all steps and lets you verify provenance on the draft's assets before publishing:

```bash
gh attestation verify dist/main.js --repo <owner>/<repo>   # exit 0 = verified
```

## Related

- [secure-sonarcloud-ci-analysis-for-typescript.md](secure-sonarcloud-ci-analysis-for-typescript.md)
  — the companion CI-hardening conventions this release workflow inherits
  (SHA-pin third-party actions, `npm ci --ignore-scripts` on the attested build,
  least-privilege `permissions`). Note the attestation step is the deliberate
  exception that needs `id-token: write` + `attestations: write` on top of that
  doc's `contents: read` baseline.
- `docs/RELEASING.md` — the maintainer runbook (beta → prod, the publish gate,
  `gh attestation verify` before publishing) that this constraint feeds into.
- Origin: `docs/brainstorms/2026-06-23-community-release-pipeline-requirements.md`
  and `docs/plans/2026-06-23-001-feat-community-release-pipeline-plan.md`.
