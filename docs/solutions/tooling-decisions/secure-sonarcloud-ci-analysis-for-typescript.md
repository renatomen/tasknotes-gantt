---
title: Securely wiring SonarQube Cloud CI-based analysis (coverage + token isolation)
date: 2026-06-21
category: docs/solutions/tooling-decisions
module: ci-quality-analysis
problem_type: tooling_decision
component: tooling
severity: medium
related_components:
  - development_workflow
  - testing_framework
applies_when:
  - "Wiring SonarQube Cloud coverage analysis into GitHub Actions CI for a TypeScript/JavaScript project"
  - "Coverage never appears in SonarCloud and sonar-project.properties seems ignored (project on Automatic Analysis)"
  - "A scan step needs SONAR_TOKEN but must not hard-fail on fork or Dependabot PRs (no Actions secrets there)"
  - "Keeping SONAR_TOKEN out of npm ci lifecycle scripts and project-controlled test code"
  - "Configuring Jest coverage under the @swc/jest transform for Sonar ingestion"
tags: [sonarcloud, ci-security, github-actions, code-coverage, secret-management, dependabot]
---

# Securely wiring SonarQube Cloud CI-based analysis (coverage + token isolation)

## Context

The repo had SonarCloud connected via **Automatic Analysis**, but coverage never showed up — Automatic Analysis can't import an LCOV report, and it silently ignores `sonar-project.properties` (so source/test layout and exclusions weren't honored either). The goal was twofold: get real Jest coverage into SonarCloud, **and** do it with a token posture that doesn't leak `SONAR_TOKEN` into project-controlled code. The secure shape took two code-review rounds to land — the first attempt (event-gating only) still left the token exposed to `npm ci`/tests.

Source PRs: #113 (CI-based analysis + coverage), #114 (token isolation — the separate-job pattern), #115 (SHA-pin + Dependabot + least-privilege permissions), #122 (npm security-only).

## Guidance

**1. Switch from Automatic Analysis to CI-based analysis.** In the SonarCloud project, **disable Automatic Analysis** (Administration → Analysis Method) — otherwise the CI scan is *rejected*. Add a `SONAR_TOKEN` repo secret. SonarCloud needs **no** `SONAR_HOST_URL` (only self-hosted Server does).

**2. Split the workflow into two jobs so the token never sits in the environment of code you don't control.** A `test` job runs `npm ci` + Jest and uploads `coverage/lcov.info` as an artifact — **with no secret present**. A `sonar` job (`needs: test`) checks out, downloads the artifact, and runs the scanner with `SONAR_TOKEN` in **step-level `env`** — running no `npm ci` and no tests.

```yaml
permissions:
  contents: read          # least privilege; SonarCloud PR decoration uses its own GitHub App

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha> # vN   (SHA-pinned)
        with: { persist-credentials: false }
      - uses: actions/setup-node@<sha> # vN
        with: { node-version: '20' }
      - run: npm ci --ignore-scripts   # see §7 — skip dependency lifecycle scripts
      - run: npm run test:coverage
      - uses: actions/upload-artifact@<sha> # vN
        with:
          name: coverage-lcov
          path: coverage/lcov.info
          if-no-files-found: error

  sonar:
    needs: test
    runs-on: ubuntu-latest
    # Skip cleanly where no Actions secret exists (fork / Dependabot PRs) —
    # gate on event context, NEVER on the secret value.
    if: >-
      github.event_name == 'push' ||
      (github.event.pull_request.head.repo.full_name == github.repository &&
       github.actor != 'dependabot[bot]')
    steps:
      - uses: actions/checkout@<sha> # vN
        with:
          fetch-depth: 0          # full history for SCM blame / new-code attribution
          persist-credentials: false
      - uses: actions/download-artifact@<sha> # vN
        with: { name: coverage-lcov, path: coverage }
      - uses: SonarSource/sonarqube-scan-action@<sha> # v8.2.0  (third party — SHA-pin)
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}   # step-level, NOT job-level
```

**3. Configure Jest for V8 coverage.** Babel instrumentation never runs under `@swc/jest`, so the V8 provider is required (it maps back through swc's source maps):

```js
coverageProvider: "v8",
coverageReporters: ["lcov", "text-summary"],
collectCoverageFrom: [
  "src/**/*.ts", "!src/**/*.d.ts",
  // non-executable / non-unit-testable — kept in sync with sonar.coverage.exclusions
  "!src/**/types/**", "!src/**/types.ts", "!src/**/index.ts",
  "!src/main.ts", "!src/bases/GanttBasesView.ts",
],
```

**4. Point Sonar at the LCOV and keep exclusions in sync** (`sonar-project.properties`):

```properties
sonar.javascript.lcov.reportPaths=coverage/lcov.info
sonar.coverage.exclusions=**/*.svelte,src/**/*.d.ts,src/**/types/**,src/**/types.ts,src/**/index.ts,src/main.ts,src/bases/GanttBasesView.ts
```

The `sonar.coverage.exclusions` list mirrors Jest's `collectCoverageFrom` negations (Jest globs `.ts` only, so the `*.svelte` entry has no Jest equivalent — it's Sonar-side only). **Only non-executable / non-unit-testable code is excluded** — type-only files, barrels, thin DOM/framework glue. Logic-dense files are *not* excluded; extract their logic into a tested module instead (excluding real logic hides gaps and is metric-gaming).

**5. Harden Dependabot** (`.github/dependabot.yml`): keep the SHA pins from going stale with weekly `github-actions` updates, and make npm **security-only** with `open-pull-requests-limit: 0` (kills routine version-bump PRs; Dependabot *security* PRs still flow). Security updates also require enabling them in repo settings — once, via the API:

```bash
gh api -X PUT repos/<owner>/<repo>/vulnerability-alerts
gh api -X PUT repos/<owner>/<repo>/automated-security-fixes
```

**6. Reading results back (AI / scripted access):** SonarCloud Web API with a **user token in a gitignored `.env`**, `curl -u "$TOKEN:"` (add `--cacert <corp-ca>.pem` on a TLS-inspection-proxy machine). Useful endpoints: `api/measures/component`, `api/issues/search` (facets incl. `impactSoftwareQualities` for the Clean-Code taxonomy), `api/qualitygates/project_status`, and for triage `api/issues/do_transition` (`accept` / `falsepositive`) + `api/issues/add_comment`.

**7. Harden every `npm ci` with `--ignore-scripts`** — the install-side complement to the token isolation in §2. A compromised transitive dependency runs arbitrary code via `postinstall`/`install`/`preinstall` lifecycle scripts during `npm ci`; `--ignore-scripts` skips them. This is **safe for a modern TS toolchain** because the native binaries that *do* matter (rollup, esbuild, `@swc/core`) ship as **`optionalDependencies`**, not install scripts — so build/test/e2e are unaffected. Apply it to *all* `npm ci` (CI, Sonar, and especially an attested **release** build), and let CI verify on a clean runner before trusting it. Two caveats worth knowing: (a) the project's own `prepare` script (e.g. husky) is also skipped — harmless in CI, where git hooks aren't needed; (b) `--ignore-scripts` is orthogonal to npm's optional-dependency bug ([npm/cli#4828](https://github.com/npm/cli/issues/4828)), which can strand a native binary on *repeated local reinstalls* — don't mistake that local-only failure for the flag breaking the build.

## Why This Matters

- **Token isolation is the core security move.** A job-level `SONAR_TOKEN` is in the environment of `npm ci` (which runs arbitrary dependency `postinstall` scripts) and the test run (project-controlled code). One compromised transitive dependency or malicious test could exfiltrate it. Producing the LCOV in a *secret-free* `test` job and consuming only that artifact + source in a `sonar` job that runs no project code confines the secret to the one step that needs it — GitHub Security Lab's "isolate privileged steps from untrusted code" (pwn-request) pattern, applied to a scanner.
- **Fork / Dependabot PRs receive no Actions secrets.** Gating the `sonar` job on **event context** (not the secret value) makes it skip cleanly on those PRs instead of hard-failing on a missing token; the `test` job still runs everywhere and remains the gate.
- **Supply-chain hardening:** `npm ci --ignore-scripts` (§7) blocks the dependency-lifecycle-script execution vector at install time; SHA-pinning the third-party scan action defeats mutable-tag tampering; `contents: read` is least privilege; `persist-credentials: false` keeps the checkout token out of `.git/config`; weekly `github-actions` Dependabot keeps the pins current.
- **The Automatic-Analysis gotcha:** it cannot import coverage, ignores `sonar-project.properties`, and actively *rejects* a CI scan if left enabled. Disabling it is mandatory, not optional — and is the single fix for "coverage never shows up."

## When to Apply

A TypeScript/JavaScript project analyzed on **SonarCloud + GitHub Actions** that wants coverage imported *and* a secure token posture — especially any repo accepting fork or Dependabot PRs, or whose `npm ci`/test step pulls untrusted dependency code. The two-job isolation generalizes to **any secret-bearing CI step** (deploy keys, publish tokens) that should be kept away from project-controlled code.

## Examples

**Token isolation — pattern vs. anti-pattern.**

Anti-pattern (job-level env — token exposed to every step):
```yaml
jobs:
  sonar:
    env:
      SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}   # ← visible to npm ci + tests
    steps:
      - run: npm ci                 # arbitrary postinstall runs WITH the token in env (and unhardened — see §7)
      - run: npm run test:coverage
      - uses: SonarSource/sonarqube-scan-action@<sha>
```
Pattern: the `test` / `sonar` split in Guidance §2 — `SONAR_TOKEN` only on the scan step's `env`, with `npm ci`/tests in the secret-free job.

**Security-only Dependabot** (`open-pull-requests-limit: 0` disables version bumps but lets security PRs through):
```yaml
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    open-pull-requests-limit: 0
```
Contrast with the `github-actions` ecosystem in the same file, which keeps its default limit so weekly bump PRs *do* flow — there the bumps are wanted, to keep the SHA pins current.

## Related

- `docs/plans/2026-06-20-004-chore-maximize-sonarqube-scores-plan.md` — the downstream sibling work (maximizing the *scores* once this pipeline existed: honest coverage scoping, cognitive-complexity and smell burndown).
- `docs/solutions/developer-experience/windows-build-and-e2e-environment-setup.md` — the local (non-CI) build/E2E environment counterpart.
- Source PRs: #113 (CI-based analysis + coverage), #114 (separate-job token isolation), #115 (SHA-pin + Dependabot + permissions), #122 (npm security-only), #137 (`--ignore-scripts` install hardening, §7).
