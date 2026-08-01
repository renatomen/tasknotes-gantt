## Repository inspected

I selected **`renatomen/tasknotes-gantt`** because it is the Svelte repository with an active SonarQube Cloud configuration.

The latest run on open PR **#336** completed successfully in both workflows:

* **CI**: build, lint, Svelte type-check, unit tests, performance test, build, audit and E2E.
* **SonarQube Cloud**: test coverage and analysis.

## Main finding

Your `.svelte` files **are already being checked properly in CI**. They simply are not represented in SonarQube Cloud.

The repository currently has:

* `eslint-plugin-svelte`
* `svelte-eslint-parser`
* `svelte-check`
* Svelte 5 with runes
* strict TypeScript settings covering `**/*.svelte` files.

The ESLint configuration parses `.svelte` files using `svelte-eslint-parser`, delegates embedded TypeScript to the TypeScript parser, and enables the recommended Svelte rules.

Your main CI workflow then runs both:

```yaml
- name: Lint
  run: npm run lint --if-present

- name: Typecheck
  run: npm run typecheck --if-present
```

The gap is in the Sonar workflow: it generates and transfers only `coverage/lcov.info`; it does not generate or import an ESLint report.

## Highest-return strategy

### 1. Keep ESLint and `svelte-check` as the enforcement mechanism

Do **not** develop a SonarQube plugin.

This repository uses **SonarQube Cloud**, while installable custom plugins are a SonarQube Server mechanism. More importantly, your existing Svelte-native tooling understands Svelte substantially better than a small custom Sonar plugin would.

Your CI already has the right division of responsibility:

* **ESLint**: Svelte-specific rules, code quality and structural problems.
* **`svelte-check`**: Svelte compiler and embedded TypeScript diagnostics.
* **Build and E2E**: compilation and runtime/component integration.

### 2. Make warnings fail CI

Your Svelte ESLint block currently classifies these as warnings:

```js
'@typescript-eslint/no-explicit-any': 'warn',
'@typescript-eslint/no-unused-vars': ['warn', ...]
```

But the current lint command has no warning threshold:

```json
"lint": "eslint . --ext .ts,.svelte"
```

Therefore, warning-only findings do not make the workflow fail. ESLint supports `--max-warnings 0` specifically to make any warning produce a non-zero exit status. ([ESLint - Pluggable JavaScript linter][1])

Change it to:

```json
"lint": "eslint . --ext .ts,.svelte --max-warnings 0"
```

This is the **highest-return single change** because it converts the checks you already run into an unambiguous quality gate.

### 3. Import the same ESLint findings into Sonar

Add a reporting command without changing the existing human-readable lint command:

```json
{
  "scripts": {
    "lint": "eslint . --ext .ts,.svelte --max-warnings 0",
    "lint:report": "eslint . --ext .ts,.svelte --format json --output-file reports/eslint.json"
  }
}
```

SonarQube Cloud directly supports ESLint JSON reports through:

```properties
sonar.eslint.reportPaths=reports/eslint.json
```

([SonarSource Docs][2])

Generate the report in the **unprivileged `test` job**, not the token-bearing Sonar job:

```yaml
- name: Generate ESLint report
  shell: bash
  continue-on-error: true
  run: |
    mkdir -p reports
    npm run lint:report
```

Then extend the existing artifact:

```yaml
- name: Upload analysis reports
  uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
  with:
    name: sonar-inputs
    path: |
      coverage/lcov.info
      reports/eslint.json
    if-no-files-found: error
```

Download `sonar-inputs` in the `sonar` job before scanning.

This preserves the workflow’s excellent security architecture: project-controlled Node code runs without `SONAR_TOKEN`, while the privileged job only downloads generated files and invokes the scanner. That isolation is explicitly documented in the current workflow.

`continue-on-error` is appropriate for the reporting invocation because the separate CI workflow remains the authoritative lint gate. The report should still reach Sonar even when ESLint finds problems.

## One compatibility spike to run

There is a small uncertainty: Sonar’s dedicated ESLint importer is documented for JavaScript and TypeScript, but `.svelte` is not a natively supported Sonar language.

Start with:

```properties
sonar.eslint.reportPaths=reports/eslint.json
```

Then inspect the scanner output for imported `.svelte` issues.

Should Sonar ignore those file paths, use a very small converter:

```text
ESLint JSON
    ↓
Sonar generic external-issue JSON
    ↓
sonar.externalIssuesReportPaths=reports/svelte-sonar.json
```

SonarQube Cloud explicitly provides its generic format for importing results from unsupported analysis tools without a plugin. ([SonarSource Docs][3])

This fallback should be inexpensive because the ESLint JSON already supplies:

* file path
* rule ID
* message
* severity
* line and column ranges

The converter is therefore mapping data, not analysing Svelte.

## What I would not do

### Do not convert the ESLint report to SARIF for Sonar

Although SonarQube Cloud supports SARIF, its SARIF importer classifies imported results under **Security**. That would misleadingly turn ordinary Svelte lint problems into security findings. ([SonarSource Docs][4])

Use the dedicated ESLint importer first and Sonar’s generic issue format second.

### Do not import `svelte-check` initially

Keep `svelte-check` as a required CI check. It already runs on every PR and successfully validates the Svelte components. Turning its output into Sonar issues adds integration work but little additional defect detection.

A converter for `svelte-check` becomes worthwhile only when having every compiler diagnostic visible in the Sonar issue history is an explicit reporting requirement.

### Do not tackle Svelte coverage yet

Your Sonar configuration deliberately excludes `.svelte` files from coverage while still keeping them under `sonar.sources=src`.

That is a separate concern from static checking. Accurate component coverage would require browser/component instrumentation and reliable source-map mapping back to the original Svelte files. It offers less return than strengthening and surfacing the checks you already have.

## Recommended sequence

1. Add `--max-warnings 0` to the existing lint gate.
2. Generate ESLint JSON in the unprivileged Sonar test job.
3. Import it with `sonar.eslint.reportPaths`.
4. Confirm that `.svelte` findings appear in Sonar.
5. Only if they are ignored, add the thin generic-issue converter.
6. Leave `svelte-check` as a separate required CI check.

This gives you **real Svelte-aware analysis, PR enforcement, and central Sonar visibility** without maintaining a custom language plugin.

[1]: https://archive.eslint.org/docs/user-guide/command-line-interface?utm_source=chatgpt.com "Command Line Interface - ESLint - Pluggable JavaScript linter"
[2]: https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/languages/javascript-typescript-css?utm_source=chatgpt.com "JavaScript/TypeScript/CSS | SonarQube Cloud | Sonar Documentation"
[3]: https://docs.sonarsource.com/sonarqube-cloud/enriching/generic-issue-data?utm_source=chatgpt.com "Generic issue data | SonarQube Cloud | Sonar Documentation"
[4]: https://docs.sonarsource.com/sonarqube-cloud/enriching/importing-issues-from-sarif-reports?utm_source=chatgpt.com "SARIF reports | SonarQube Cloud | Sonar Documentation"
