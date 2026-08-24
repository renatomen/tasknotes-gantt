#!/usr/bin/env bash
# Stages the maintainability trend block for the peer reviewer's input:
# prefers the already-reviewed script, reader, and registry at the given base
# commit; falls back to the working tree's script only while no base-side copy
# exists. Prints the measurement to stdout; a non-zero exit means the caller
# should print its degrade note instead. Lives outside the review wrapper so
# the wrapper keeps only a call hook (ranked-file placement contract).
set -u
BASE_COMMIT="${1:?base commit}"
HEAD_COMMIT="${2:?head commit}"

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 1
git_nr() { git --no-replace-objects "$@"; }

src_dir=$(mktemp -d -t peer-trend-src-XXXXXX) || exit 1
trap 'rm -rf "$src_dir"' EXIT

if git_nr show "$BASE_COMMIT:scripts/maintainability-trend.mjs" > "$src_dir/maintainability-trend.mjs" 2>/dev/null &&
   git_nr show "$BASE_COMMIT:scripts/maintainability-registry.mjs" > "$src_dir/maintainability-registry.mjs" 2>/dev/null &&
   git_nr show "$BASE_COMMIT:maintainability-registry.json" > "$src_dir/registry.json" 2>/dev/null; then
  node "$src_dir/maintainability-trend.mjs" --registry "$src_dir/registry.json" \
    --base "$BASE_COMMIT" --head "$HEAD_COMMIT" < /dev/null 2>/dev/null
else
  node "$REPO_ROOT/scripts/maintainability-trend.mjs" \
    --base "$BASE_COMMIT" --head "$HEAD_COMMIT" < /dev/null 2>/dev/null
fi
