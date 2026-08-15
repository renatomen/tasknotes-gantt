---
title: Extract the SVAR interceptor wiring out of the view - Plan (superseded)
type: refactor
date: 2026-08-12
superseded_by: docs/plans/2026-08-15-002-refactor-svar-interceptor-extraction-plan.md
---

# Extract the SVAR interceptor wiring out of the view - Plan (superseded)

Superseded by [2026-08-15-002-refactor-svar-interceptor-extraction-plan.md](2026-08-15-002-refactor-svar-interceptor-extraction-plan.md). Do not execute this plan.

The full original text is preserved unchanged on origin branch `docs/plan-wire-svar-interceptors` at commit `3c62bbe`.

Why superseded: its closure census was stale (7 named bindings and "ten intercepts" against a measured 10+1 bindings and 9 call sites / 14 registrations); three of the bindings are Svelte 5 `$state` runes, so its state-holder extraction (KTD2) would break rune reactivity; its echo test could not distinguish the `syncing` guard from the `eventSource` guard; and its deferred `collapsedIds` question contradicted its own R1/U1. The successor reverses the state-holder decision in favor of a live accessor bridge and consumes all three acknowledged peer findings (PR #425 Known Residuals).
