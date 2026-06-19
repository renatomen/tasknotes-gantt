# Security Policy

## Reporting a vulnerability

If you discover a security issue in TaskNotes Gantt, please report it **privately** rather than opening a public issue:

- Use GitHub's [private vulnerability reporting](../../security/advisories/new) for this repository, or
- Contact the maintainer directly via the profile at https://github.com/renatomen.

Please include reproduction steps and the affected version. You can expect an initial response within a reasonable timeframe, and coordinated disclosure once a fix is available.

## Scope and security posture

TaskNotes Gantt runs entirely on-device:

- **No network requests, no telemetry, no analytics.** The plugin makes no outbound connections.
- **No dynamic code execution.** It does not use `eval`, `new Function`, or load remote code.
- **Local data only.** It reads notes in the active Base and writes changes back to the task notes you edit on the chart (dates and dependency `blockedBy` edges), via the Obsidian and TaskNotes APIs. See the "Transparency & disclosure" section of the [README](README.md) for the exact vault access.

## Supported versions

This plugin is in early development; security fixes target the latest released version.
