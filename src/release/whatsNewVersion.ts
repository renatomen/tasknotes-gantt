/**
 * Pure decision logic for the in-app "What's New" view: should it auto-open after
 * a plugin update? Kept free of any Obsidian dependency so it is exhaustively
 * unit-testable; the thin Obsidian glue (reading manifest/data.json, activating
 * the view) lives in src/main.ts (U6).
 */

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

/** Parse `X.Y.Z` / `X.Y.Z-beta.N`. Returns null for anything malformed. */
export function parseSemver(version: string | undefined | null): Semver | null {
  if (typeof version !== "string") return null;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compare two semver strings. Ascending: < 0 when `a` precedes `b`, 0 when equal,
 * > 0 when `a` follows `b`. Prerelease-aware (`1.2.0-beta.1` < `1.2.0`); returns 0
 * when either version is unparseable (callers treat "can't tell" as "don't act").
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * Compare the prerelease portions of two equal-x.y.z versions. A version with no
 * prerelease (stable) ranks above one that has a prerelease; otherwise compare
 * the dot-separated identifiers left to right.
 */
function comparePrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0; // both stable, or identical prerelease strings
  if (a === null) return 1; // stable follows its prerelease
  if (b === null) return -1;
  const aIds = a.split(".");
  const bIds = b.split(".");
  for (let i = 0; i < Math.max(aIds.length, bIds.length); i++) {
    const c = compareIdentifiers(aIds[i], bIds[i]);
    if (c !== 0) return c;
  }
  return 0;
}

/**
 * Compare two prerelease identifiers. Either may be undefined when one version
 * has fewer parts (the shorter prerelease ranks lower). Two numeric identifiers
 * compare numerically; otherwise the comparison is lexical.
 */
function compareIdentifiers(ai: string | undefined, bi: string | undefined): number {
  if (ai === undefined) return -1;
  if (bi === undefined) return 1;
  if (/^\d+$/.test(ai) && /^\d+$/.test(bi)) return Number(ai) - Number(bi);
  if (ai === bi) return 0;
  return ai < bi ? -1 : 1;
}

/**
 * Decide whether to auto-open the "What's New" view. True only when a valid
 * last-seen version is recorded AND it is strictly older than the current
 * version. An unset or invalid `lastSeen` (fresh install / first run after this
 * feature ships, or corrupted data.json) returns false — the caller records the
 * current version and shows nothing, so the user is never surprised.
 */
export function shouldShowWhatsNew(lastSeen: string | undefined, current: string): boolean {
  if (!lastSeen || !parseSemver(lastSeen) || !parseSemver(current)) return false;
  return compareSemver(lastSeen, current) < 0;
}
