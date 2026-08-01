---
title: Keep ESLint authoritative when Sonar cannot accurately import Svelte
date: 2026-07-31
category: docs/solutions/tooling-decisions
module: ci-quality-analysis
problem_type: tooling_decision
component: tooling
severity: medium
related_components:
  - development_workflow
  - testing_framework
applies_when:
  - Trying to expose Svelte ESLint findings in SonarQube Cloud
  - Evaluating an external-issue route for a file type Sonar does not natively analyze
  - Considering SARIF, generic reports, or proxy files as a compatibility bridge
  - A dashboard would become more complete numerically but less accurate semantically
tags:
  - sonarqube-cloud
  - svelte
  - eslint
  - external-issues
  - sarif
  - quality-reporting
  - tool-adoption
  - semantic-accuracy
---

# Keep ESLint authoritative when Sonar cannot accurately import Svelte

## Context

SonarQube Cloud does not natively analyze this repository's `.svelte` files. ESLint does: the
project uses `svelte-eslint-parser`, `eslint-plugin-svelte`, and `eslint-plugin-sonarjs`, including
a cognitive-complexity ceiling of 15 for Svelte components.

The project evaluated whether Sonar could reuse those findings without another analyzer or bespoke
tooling. The preferred experiment generated ESLint's native JSON and configured
`sonar.eslint.reportPaths`. A controlled report contained one known cognitive-complexity finding
from `src/bases/GanttContainer.svelte`, produced without a source edit by temporarily lowering the
rule's allowed complexity from 15 to 14.

The scanner accepted the report and completed successfully, but its analysis payload contained no
external issue for the Svelte finding. A separate TypeScript control scan at a temporary threshold
of 0 produced an `external-issues` payload, establishing that report generation, credentials, and
the importer were active in the same session. The scanner log named the exact Svelte JSON path while
importing external issues, so the negative was not inferred from exit status alone. The original
probe did not use a mixed same-scan control; future probes must do so before attributing a negative
specifically to Svelte. Registering `.svelte` as an HTML suffix made Sonar run its HTML sensor on
the component, but the dedicated ESLint importer still emitted no Svelte external issue.

Follow-up probes registered `.svelte` first with `sonar.javascript.file.suffixes` and then with
`sonar.typescript.file.suffixes`. Each scan produced 21 parser failures because the native
JavaScript/TypeScript analyzer tried to parse Svelte markup as JavaScript/JSX. Each scan still
exited successfully, and immediate inspection found no `external-issues-*.pb` file. Because those
runs lacked a contemporaneous positive control, that absence cannot be attributed specifically to
the file type. Registering `.svelte` as a JavaScript or TypeScript suffix is still rejected as
tested because Sonar failed to parse the source correctly; this result does not make a claim about
future native Svelte parsing.

The probe ran on 2026-07-31 from `origin/main` at commit `54acfe2`, with the repository's locked
ESLint 9.36.0 toolchain. It tested `sonar.eslint.reportPaths` directly and then repeated the scan
with `.svelte` added to `sonar.html.file.suffixes`. SonarQube Cloud is continuously updated, so the
date and source commit are the available baseline. The original scanner version was not retained;
the follow-up JavaScript/TypeScript suffix probes used `@sonar/scan` 4.3.5. A future probe must
capture the scanner version banner and analysis date.

Payload inspection compared the completed scanner work directories before cleanup. The direct and
HTML-suffix Svelte runs produced no `.scannerwork/scanner-report/external-issues-*.pb` file, while
the separate TypeScript control in that session produced a non-empty file. The later JavaScript- and
TypeScript-suffix probes used `@sonar/scan` 4.3.5 without a contemporaneous native-language control.
A future probe must retain its scanner work directory long enough to record that file's presence and
size for a mixed same-scan control before trusting the scanner exit status or UI result.

The 2026-07-31 probes used temporary analysis branches in the existing Sonar project. Those branches
were deleted through the Sonar API after inspection; no probe-only property was merged.

This completed the compatibility spike proposed in the earlier
[Svelte, Sonar, and CI report](<../../reports/2026-07-27 - Svelte - Sonar - CI - Improvement for consideration.md>).

## Guidance

Keep ESLint as the authoritative maintainability and complexity gate for Svelte. Treat Sonar import
as an optional reporting projection, not as a substitute for the analyzer that understands the
source. The evaluated projection is Svelte cognitive-complexity reporting, not an assertion that
Sonar can represent every `eslint-plugin-svelte` rule.

Adopt an import route only after a controlled positive probe proves all of the following:

1. A known Svelte finding is present in Sonar's submitted analysis payload and visible in SonarQube
   Cloud.
2. The finding is attached to the real `.svelte` source file at the same line and range ESLint
   reported.
3. Its quality domain, issue type, and severity preserve the ESLint rule's meaning.
4. Removing the deliberate finding removes that issue from both the submitted payload and SonarQube
   Cloud while the native-language control remains present. A green scan alone does not satisfy this
   criterion.
5. The route does not duplicate source, duplicate issues from Sonar's native analyzer, inflate
   metrics, or require a project-owned converter.
6. The route succeeds in the production-shaped two-job topology: a secret-free job generates a
   Svelte-only report, and the secret-bearing Sonar job consumes that artifact from its own
   checkout. Exercise this in an isolated local simulation by recreating the consuming checkout at
   the same absolute path after generation, matching the GitHub-hosted jobs' workspace-path
   invariant, or use a scratch repository workflow. In the local simulation, stage the generated
   report and `sonar-probe.properties` outside the checkout before recreating it, then copy both
   into the fresh checkout, mirroring artifact upload and download. Recheck the scratch project key
   and organization in the copied settings before scanning, then confirm the resolved scratch
   identity in the scanner startup log and abort immediately on any mismatch. Never open a probe PR
   in this repository.
7. Standard scanner output provides a health signal that distinguishes a genuinely empty Svelte
   report from a failed or silently dropped import, without adding a permanent fake issue.

Run future uploaded compatibility probes only against a scratch Sonar project, never this
repository's production project key or analysis history. Work in a disposable git worktree. Copy
`sonar-project.properties` to an untracked `sonar-probe.properties` at that worktree's root, replace
its project key and organization with scratch values, and append the probe-only properties. Invoke
the standard
[SonarScanner CLI](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/scanners/sonarscanner-cli)
from the same root with `-Dproject.settings=sonar-probe.properties`. The temporary file replaces,
rather than overlays, the committed settings while preserving the production source and exclusion
shape. Use a scratch-scoped analysis token that cannot access the production project, and revoke it
after the probe. If the scanner version cannot verify the settings override, no scratch key is
available, or the token is not isolated, do not upload the probe.

During the compatibility probe, use one mixed report containing the deliberate Svelte finding and
the TypeScript control so the same scan proves the report was read. Record the scanner log's report
path and each control's payload result immediately after the scan, before cleanup. A local
same-checkout probe is only a fast compatibility check; criterion 6 must still pass before adoption.
The artifact adopted for routine reporting must contain only `.svelte` findings so Sonar does not
duplicate findings it already analyzes natively in TypeScript. Keep every probe artifact inside the
disposable worktree except the temporary staging directory required by criterion 6. Remove both the
worktree and the entire staging directory after inspection.

Do not disguise copied components with suffixes such as `.svelte.html` or maintain a shadow source
tree just to make Sonar accept them. That reports against generated surrogates, fragments source
identity, and risks counting the same code under the wrong language. Indexing the real `.svelte`
file as HTML also failed the narrower compatibility test: it did not make the JavaScript/TypeScript
ESLint importer attach the finding. Registering `.svelte` directly as JavaScript or TypeScript is
also rejected as tested: both variants produced 21 parser failures. Their missing payload files were
observed without a contemporaneous positive control and are not treated as file-type evidence.

Do not use SARIF for ordinary maintainability findings.
[SonarQube Cloud's SARIF documentation](https://docs.sonarsource.com/sonarqube-cloud/enriching/importing-issues-from-sarif-reports/)
states that imported SARIF issues receive the Security software quality. A cognitive-complexity
finding would therefore corrupt the security statistics.

Do not adopt an inaccurate generic formatter merely because Sonar accepts its shape. In this
session's ESLint 9 probe, the tested `eslint-formatter-sonarqube` 1.0.0 release required an explicit
`index.js` entry point and mapped the known cognitive-complexity finding to `CRITICAL BUG`. That is
not representative maintainability reporting.

[Sonar's generic issue format](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/importing-external-issues/generic-issue-data)
could express a more accurate mapping, but producing it would make this project own a
rule-and-severity translation layer. Do not hand-roll that converter unless accurate central
reporting becomes a separately approved requirement with contract tests and an explicit ownership
plan.

Revisit this decision when SonarQube Cloud supports Svelte natively or a maintained adapter can
preserve real source paths and issue semantics. Any future report must still follow the
token-isolated pipeline in
[Secure SonarCloud CI analysis for TypeScript](secure-sonarcloud-ci-analysis-for-typescript.md):
generate project-controlled artifacts without `SONAR_TOKEN`, then let the secret-bearing job consume
those artifacts without executing project code.

## Why This Matters

A successful scanner exit is not proof that external issues were imported. All four Svelte scans
(direct import plus HTML, JavaScript, and TypeScript suffix mappings) completed successfully with no
Svelte issue visible. The direct and HTML-suffix negatives were confirmed at payload level against
the session's native-language control; the JavaScript and TypeScript suffix routes are rejected
independently because they produced 21 parser failures. A mixed same-scan positive control is
essential before attributing any future negative specifically to the unsupported file type.

Representative reporting is more important than maximizing dashboard counts. Treating a Svelte
component as HTML, a complexity finding as a security issue, or a maintainability issue as a
critical bug makes trend data and quality-gate results less trustworthy.

Keeping enforcement in ESLint preserves fast, deterministic feedback with minimal configuration. It
also follows the repository's broader decision to
[orchestrate an existing capable tool rather than rebuild it](orchestrate-existing-tool-over-rebuilding.md).

## When to Apply

- A Svelte-aware linter is already authoritative but Sonar lacks native Svelte analysis.
- `sonar.eslint.reportPaths` reports success without evidence that a Svelte issue was serialized.
- A proposed suffix, proxy-file, generic-report, or SARIF workaround changes source identity or
  issue meaning.
- Central visibility is being weighed against adding a converter or stale formatter to an otherwise
  standard toolchain.

## Examples

Use a deliberate Svelte finding and a native-language control:

```text
GanttContainer.svelte known complexity finding
  -> ESLint JSON contains the finding
  -> Sonar scan succeeds
  -> submitted analysis contains no Svelte external issue

debugLog.ts known complexity findings at a temporary threshold of 0
  -> same ESLint JSON format
  -> submitted analysis contains the TypeScript external issues
```

The separate-scan control showed that the importer was active in the session, but it did not isolate
the incompatible file type. A mixed same-scan report is required for that. Do not infer success from
the scanner exit code.

Reject mappings that change meaning:

```text
sonarjs/cognitive-complexity
  intended: maintainability / complexity violation
  rejected generic formatter result: CRITICAL BUG
  rejected SARIF result: Security issue
```

Keep the present responsibility split explicit:

```text
Svelte source -> ESLint + svelte-check -> required CI gates
TypeScript source -> ESLint + tests + SonarQube Cloud
Sonar dashboard -> no claim of native Svelte analysis
```
