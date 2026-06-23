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
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1; // stable follows its prerelease
  if (pb.prerelease === null) return -1;
  const aIds = pa.prerelease.split(".");
  const bIds = pb.prerelease.split(".");
  for (let i = 0; i < Math.max(aIds.length, bIds.length); i++) {
    const ai = aIds[i];
    const bi = bIds[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const d = Number(ai) - Number(bi);
      if (d !== 0) return d;
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
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
