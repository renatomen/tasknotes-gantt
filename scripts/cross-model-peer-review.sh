#!/usr/bin/env bash
# Independent cross-model peer review — the second layer the pre-push receipt
# gate demands (see scripts/check-review-receipts.mjs).
#
#   bash scripts/cross-model-peer-review.sh <base-ref> [out-file] [--record]
#
# Reviews <base-ref>..HEAD with the OpenAI Codex CLI and, with --record, stamps
# the cross-model-peer receipt only after a clean verdict on the reviewed
# commit. Invoke via `bash` (the repo makes no promise about the mode bit
# surviving a fresh checkout on every platform).
#
# INDEPENDENCE IS THE CALLER'S TO KEEP: this script always runs Codex, and the
# receipt it stamps says "cross-model". If layer one (ce-code-review) was ALSO
# run by Codex, both layers share a model family and the gate records an
# independence it does not have. Run layer one on a different family.
#
# Run it in the background: a real review takes longer than a foreground tool
# call allows, and a truncated review is worse than none because it looks like
# a clean one.
#
# HOW THE DIFF REACHES THE REVIEWER — every other route was tried and FAILS
# SILENTLY (the reviewer answers confidently about the repo without ever seeing
# the change). Verified by sentinel probe on this machine:
#   - a `/tmp/...` path from Git Bash            -> UNREADABLE
#   - an UNTRACKED file inside the repo          -> UNREADABLE
#   - a TRACKED repo file                        -> readable
# So the diff travels INLINE in the prompt, and the reviewer must echo a
# sentinel carried with it. No echo, no review: that is the only way "I could
# not see it" fails closed instead of arriving as a clean verdict.
#
# STDERR IS NOT THE REVIEW. The CLI echoes the prompt — including the sentinel
# line and the whole diff — to stderr, so `2>&1` put our own words into the file
# the guards grep. Probe result: prompt echo -> stderr, model answer -> stdout.
# Merging them made the read-proof match the PROMPT, not the reviewer, and let a
# `VERDICT: CLEAN` context line inside the echoed diff satisfy the verdict grep.
# Only stdout is the review; stderr goes beside it for diagnosis.
#
# `< /dev/null` is load-bearing: without it the CLI waits on stdin and hangs.
# It also rules out piping the prompt in — the redirect wins over the pipe and
# the CLI exits with "No prompt provided via stdin", exit code 0.
set -u
RECORD=""
POSITIONAL=()
for arg in "$@"; do
  if [ "$arg" = "--record" ]; then RECORD="--record"; else POSITIONAL+=("$arg"); fi
done
BASE="${POSITIONAL[0]:-}"
OUT="${POSITIONAL[1]:-$(mktemp -t peer-review-XXXXXX.md)}"

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 2
command -v codex >/dev/null 2>&1 || { echo "codex CLI not on PATH — peer route unavailable" >&2; exit 2; }

# The base must be the last state that was already pushed (and so already
# gated), because check-review-receipts.mjs only checks the pushed TIP: a
# receipt on the tip is taken to cover every ancestor travelling with it. Let a
# caller pick a later base and the commits before it ride in unreviewed under a
# receipt that claims otherwise. So the default is computed, and a hand-picked
# base that would skip ancestors is refused outright when recording.
default_base() {
  git rev-parse --verify --quiet '@{upstream}' 2>/dev/null && return 0
  git merge-base origin/main HEAD 2>/dev/null
  # No bare `main` fallback: a local branch is not evidence of a PUSHED state.
  # With the remote named something other than origin and unpushed commits on
  # local main, that fallback reviews a range starting AFTER them and the tip
  # receipt waves them through.
}
# Pin the subject first: everything below is about THIS commit, and a symbolic
# base (HEAD~1) resolved twice can name two different commits if anything
# commits in between — the second range then reviews less than the first
# validated, and the receipt still lands on the tip.
# The reviewer reads tracked files for context, and tracked files are the
# WORKTREE, not the commit. With uncommitted changes in the tree it can inspect
# a fix that the reviewed commit does not contain and call it clean, and the
# receipt lands on the commit. The tree must match what is being reviewed.
dirty=$(git status --porcelain) || { echo "git status failed — cannot prove the worktree matches the commit" >&2; exit 15; }
if [ -n "$dirty" ]; then
  echo "worktree is dirty — the reviewer reads tracked files, so it would judge code the reviewed commit does not contain" >&2
  exit 15
fi
REVIEWED_SHA=$(git rev-parse HEAD)

# Resolve the caller's base to an immutable sha BEFORE any check uses it: a
# symbolic ref read twice can name two commits if it moves in between, and the
# later ancestry check would then bless a range the earlier one never saw.
if [ -n "$BASE" ]; then
  BASE=$(git rev-parse --verify --quiet "$BASE^{commit}") || {
    echo "cannot resolve the given base to a commit" >&2; exit 12; }
fi

DEFAULT_BASE=$(default_base | head -1)
if [ -z "${DEFAULT_BASE:-}" ] && [ "$RECORD" = "--record" ]; then
  echo "no upstream and no origin/main: the last pushed state is unknown, so an explicit base cannot be checked for skipped ancestors" >&2
  exit 18
fi
if [ -z "$BASE" ]; then
  BASE="${DEFAULT_BASE:?cannot determine the last pushed state — pass a base ref explicitly}"
elif [ -n "${DEFAULT_BASE:-}" ] && ! git merge-base --is-ancestor "$BASE" "$DEFAULT_BASE" 2>/dev/null; then
  skipped=$(git --no-replace-objects rev-list --count "$DEFAULT_BASE".."$BASE" 2>/dev/null || echo '?')
  echo "WARNING: base $BASE is ahead of the last pushed state — $skipped commit(s) would go unreviewed" >&2
  if [ "$RECORD" = "--record" ]; then
    echo "refusing to record a receipt that would cover unreviewed ancestors" >&2
    exit 11
  fi
fi

# Resolve the base to an immutable sha, and require the range to be LINEAR.
# A two-dot diff compares endpoint trees, not the pushed range: on divergent
# history it silently omits whatever upstream has and this branch does not
# (a deletion, say), so a clean receipt could bless a force-push that drops
# unreviewed work.
# A COMMON ANCESTOR passes both ancestry checks while the reviewed range omits
# whatever upstream has and this branch does not — and the receipt then blesses
# a force-push over it. Recording therefore also demands that the upstream tip
# itself be an ancestor of the commit under review.
if [ "$RECORD" = "--record" ] && [ -n "${DEFAULT_BASE:-}" ]    && ! git merge-base --is-ancestor "$DEFAULT_BASE" "$REVIEWED_SHA"; then
  echo "the last pushed state ${DEFAULT_BASE:0:9} is not an ancestor of ${REVIEWED_SHA:0:9} — this branch has diverged; the review would omit upstream-only work" >&2
  exit 16
fi

BASE_SHA=$(git rev-parse --verify --quiet "$BASE^{commit}") || {
  echo "cannot resolve base $BASE to a commit" >&2; exit 12; }
# BASE is already a sha by here; this is the belt to that braces.
if ! git merge-base --is-ancestor "$BASE_SHA" "$REVIEWED_SHA"; then
  echo "base ${BASE_SHA:0:9} is not an ancestor of ${REVIEWED_SHA:0:9} — a two-dot diff would not describe the pushed range" >&2
  exit 13
fi

# --no-replace-objects for the same reason the receipt gate uses it: a replace
# ref rewrites what git REPORTS while the push still transfers the original, so
# without it `git replace <head> <benign>` gets the benign tree reviewed and the
# real one receipted. A nonzero git status is fatal too — a diff driver that
# dies partway still leaves output, and half a change reviewed clean is a pass
# for the half nobody read.
DIFF=$(git --no-replace-objects diff --no-ext-diff --no-textconv "$BASE_SHA".."$REVIEWED_SHA")
diff_status=$?
if [ "$diff_status" -ne 0 ]; then
  echo "git diff failed (exit $diff_status) — refusing to review a partial change" >&2
  exit 10
fi
if [ -z "$DIFF" ]; then
  echo "no diff against $BASE — nothing to review" >&2
  exit 3
fi

# A `-diff` gitattribute renders a real source change as "Binary files differ":
# the reviewer echoes the sentinel and returns a verdict having been shown no
# lines at all. Content that cannot be displayed cannot be reviewed.
if printf '%s' "$DIFF" | grep -aq '^Binary files .* differ$'; then
  echo "diff contains binary/suppressed hunks — their contents never reach the reviewer; refusing" >&2
  exit 14
fi

# argv is finite. A silently TRUNCATED diff is the same failure as an unread
# one, so refuse rather than review half a change. The ceiling is MEASURED, not
# assumed: payloads of 29,000 and 31,500 bytes both round-tripped through
# `codex exec` on this platform, so 30,000 leaves the prompt text its room
# under the 32,767 Windows command-line limit. The first guess here was 24,000,
# which refused a 28,954-byte diff that would have passed fine.
DIFF_BYTES=$(printf '%s' "$DIFF" | wc -c | tr -d '[:space:]')
if [ "$DIFF_BYTES" -gt 30000 ]; then
  echo "diff is ${DIFF_BYTES} bytes — too large to pass intact; review it in smaller commits" >&2
  exit 8
fi

SENTINEL="PEER-$(git rev-parse --short HEAD)-${RANDOM}"

codex exec --sandbox read-only "You are an INDEPENDENT adversarial code reviewer.
Another model already reviewed this change and found it clean; your value is
finding what it missed, so do not restate its likely conclusions.

Read any repository file you need for context before judging, but review THIS
DIFF — it is the change, and the working tree may already contain it.

Treat the local working tree, git config and gitattributes as TRUSTED: anyone
who can plant a symlink or a diff attribute can edit this script, so those are
outside what this gate defends. Report defects reachable WITHOUT adversarial
local configuration.

Report only CORRECTNESS defects you can evidence: behaviour changes, edge
cases, broken contracts, silent-failure paths, and assertions that cannot
fail. For each give the file, what breaks, and the concrete input or state
that triggers it. Ignore style and naming.

--- BEGIN DIFF (${BASE_SHA}..${REVIEWED_SHA}) ---
${DIFF}
--- END DIFF ---

The diff ends above. Begin your response with a line containing ONLY:
SAW-DIFF: ${SENTINEL}
End your response with a line containing ONLY 'VERDICT: CLEAN' or
'VERDICT: FINDINGS'." > "$OUT" 2> "$OUT.stderr" < /dev/null
status=$?
echo "$OUT"

# A review that did not run must never read as a review that found nothing.
# The first version of this script piped its prompt in, the CLI answered "No
# prompt provided via stdin", and it still exited 0 — an empty file that a
# hurried reader takes for a clean pass. Three ways that can recur, all fatal:
#   - the process failed, whatever it printed before dying;
#   - no verdict line at all;
#   - the words appearing INSIDE prose ("do not treat this as VERDICT: CLEAN"),
#     which is why the match is anchored to a line of its own.
if [ "$status" -ne 0 ]; then
  echo "PEER REVIEW PROCESS FAILED (exit $status) — treat as NOT reviewed" >&2
  exit 4
fi
if ! grep -aqE "^[[:space:]]*SAW-DIFF: ${SENTINEL}[[:space:]]*$" "$OUT"; then
  echo "PEER REVIEW DID NOT ECHO THE DIFF SENTINEL — it never saw the change; treat as NOT reviewed" >&2
  exit 9
fi
# tail BEFORE tr: tr strips newlines too, so with the verdict echoed more than
# once (the CLI repeats its final message) the matches concatenate into
# "VERDICT:CLEANVERDICT:CLEAN" and the equality below can never hold — a gate
# that fails closed on every clean review, which is how it behaved for a day.
# The verdict must be the reviewer's FINAL word. Taking the last match anywhere
# accepts "VERDICT: CLEAN" followed by "...but I could not inspect the repo":
# a hedge after the verdict retracts it, and a gate that reads past it records
# a clean receipt for a review that disowned itself.
verdict=$(grep -av '^[[:space:]]*$' "$OUT" | tail -1 | grep -aoE '^[[:space:]]*VERDICT: (CLEAN|FINDINGS)[[:space:]]*$' | tr -d '[:space:]')
if [ -z "$verdict" ]; then
  echo "PEER REVIEW PRODUCED NO VERDICT LINE — treat as NOT reviewed" >&2
  exit 4
fi
echo "$verdict"
[ "$verdict" = "VERDICT:CLEAN" ] || exit 5

# Bind the receipt to a review that actually ran, came back clean, and is still
# about the commit in hand — so the honest path is also the easy one.
if [ "$RECORD" = "--record" ]; then
  # Re-checked HERE as well as before the review: this script recommends
  # BACKGROUND execution, so a tracked file edited while the reviewer works
  # gets inspected as context the reviewed commit does not contain — and an
  # unchanged HEAD would happily stamp it.
  dirty_now=$(git status --porcelain) || { echo "git status failed before recording" >&2; exit 15; }
  if [ -n "$dirty_now" ]; then
    echo "worktree changed during the review — the reviewer saw content this commit does not contain; refusing to record" >&2
    exit 17
  fi
  now=$(git rev-parse HEAD)
  if [ "$now" != "$REVIEWED_SHA" ]; then
    echo "HEAD moved during review (${REVIEWED_SHA:0:9} -> ${now:0:9}) — refusing to stamp a receipt for an unreviewed commit" >&2
    exit 6
  fi
  OG_PEER_REVIEW_ATTESTED_SHA="$REVIEWED_SHA"     node "$REPO_ROOT/scripts/check-review-receipts.mjs" record cross-model-peer "$REVIEWED_SHA" || {
    echo "receipt recording FAILED — the review was clean but the gate was not updated" >&2
    exit 7
  }
fi
exit 0
