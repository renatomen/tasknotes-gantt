/**
 * Display selection state for calendars: which calendars/sets shade this
 * view's background, persisted per-view as wikilink text under
 * `tngantt_displayCalendars` and re-resolved live on every pass — stored
 * strings are best-effort (Obsidian link maintenance rewrites markdown, not
 * config strings), so a link that stops resolving is flagged for the picker
 * rather than silently purged.
 *
 * The legacy `tngantt_highlightWeekends` toggle and the built-in default row
 * are one state with two keys: while no selection is stored the default row
 * derives from the legacy key; once stored, toggling the default row writes
 * both keys, and a legacy-key flip observed on re-resolve is treated as a
 * default-row toggle and written back to the new key. Both keys therefore
 * always agree, so existing weekend-shading consumers keep reading the
 * legacy key unchanged.
 *
 * Pure module: resolution is injected, writes are returned as values.
 */

export interface MemberToggles {
  readonly [link: string]: boolean;
}

export interface SelectionEntry {
  link: string;
  enabled: boolean;
  members?: MemberToggles;
}

export interface DisplaySelection {
  /** True when display derives from task associations (no explicit entry list). */
  auto: boolean;
  /** True when the view has a stored `tngantt_displayCalendars` value. */
  stored: boolean;
  /** The built-in default row (weekend shading). */
  defaultRow: boolean;
  /** Explicit entries; empty while auto. */
  entries: SelectionEntry[];
}

export function readDisplaySelection(raw: unknown, legacyValue: unknown): DisplaySelection {
  const legacyDefault = legacyValue !== false;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { auto: true, stored: false, defaultRow: legacyDefault, entries: [] };
  }
  const record = raw as Record<string, unknown>;
  const defaultRow = typeof record.default === 'boolean' ? record.default : legacyDefault;
  const entries = Array.isArray(record.entries) ? record.entries.flatMap(parseEntry) : null;
  return entries === null
    ? { auto: true, stored: true, defaultRow, entries: [] }
    : { auto: false, stored: true, defaultRow, entries };
}

function parseEntry(value: unknown): SelectionEntry[] {
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  if (typeof record.link !== 'string' || typeof record.enabled !== 'boolean') return [];
  const entry: SelectionEntry = { link: record.link, enabled: record.enabled };
  const members = parseMembers(record.members);
  if (members) entry.members = members;
  return [entry];
}

function parseMembers(value: unknown): MemberToggles | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const toggles: Record<string, boolean> = {};
  for (const [link, enabled] of Object.entries(value)) {
    if (typeof enabled === 'boolean') toggles[link] = enabled;
  }
  return toggles;
}

/** The persisted shape; an auto selection omits `entries` so auto survives. */
export function serializeSelection(selection: DisplaySelection): unknown {
  return selection.auto
    ? { default: selection.defaultRow }
    : {
        default: selection.defaultRow,
        entries: selection.entries.map((entry) =>
          entry.members ? { ...entry, members: { ...entry.members } } : { ...entry },
        ),
      };
}

export interface SelectionWrites {
  displayCalendars: unknown;
  highlightWeekends: boolean;
}

export function setDefaultRow(
  selection: DisplaySelection,
  enabled: boolean,
): { selection: DisplaySelection; writes: SelectionWrites | null } {
  if (selection.defaultRow === enabled) return { selection, writes: null };
  const updated: DisplaySelection = { ...selection, stored: true, defaultRow: enabled };
  return {
    selection: updated,
    writes: { displayCalendars: serializeSelection(updated), highlightWeekends: enabled },
  };
}

/**
 * The reverse alias direction: a re-resolve that observes the legacy key
 * differing from the STORED default-row state treats the flip as a
 * default-row toggle and writes the new key. Guarded — agreement, an absent
 * legacy key, or an unstored selection (legacy is the source then) all no-op.
 */
export function reconcileLegacyFlip(
  selection: DisplaySelection,
  legacyValue: unknown,
): { selection: DisplaySelection; write: unknown | null } {
  if (!selection.stored || legacyValue === undefined || legacyValue === null) {
    return { selection, write: null };
  }
  const legacyOn = legacyValue !== false;
  if (legacyOn === selection.defaultRow) return { selection, write: null };
  const updated: DisplaySelection = { ...selection, defaultRow: legacyOn };
  return { selection: updated, write: serializeSelection(updated) };
}

export function setEntryEnabled(
  selection: DisplaySelection,
  link: string,
  enabled: boolean,
): { selection: DisplaySelection; write: unknown | null } {
  const existing = selection.entries.find((entry) => entry.link === link);
  if (existing?.enabled === enabled) return { selection, write: null };
  const entries = existing
    ? selection.entries.map((entry) => (entry.link === link ? { ...entry, enabled } : entry))
    : [...selection.entries, { link, enabled }];
  return withEntries(selection, entries);
}

export function setMemberEnabled(
  selection: DisplaySelection,
  setLink: string,
  memberLink: string,
  enabled: boolean,
): { selection: DisplaySelection; write: unknown | null } {
  const existing = selection.entries.find((entry) => entry.link === setLink);
  if (existing?.members?.[memberLink] === enabled) return { selection, write: null };
  const entries = existing
    ? selection.entries.map((entry) =>
        entry.link === setLink
          ? { ...entry, members: { ...entry.members, [memberLink]: enabled } }
          : entry,
      )
    : [...selection.entries, { link: setLink, enabled: true, members: { [memberLink]: enabled } }];
  return withEntries(selection, entries);
}

function withEntries(
  selection: DisplaySelection,
  entries: SelectionEntry[],
): { selection: DisplaySelection; write: unknown } {
  const updated: DisplaySelection = { ...selection, auto: false, stored: true, entries };
  return { selection: updated, write: serializeSelection(updated) };
}

/**
 * First explicit toggle from auto: seed the entry list from the currently
 * auto-displayed links (all enabled) so the visible set does not jump.
 */
export function materializeSelection(
  selection: DisplaySelection,
  autoLinks: readonly string[],
): DisplaySelection {
  if (!selection.auto) return selection;
  return {
    ...selection,
    auto: false,
    entries: autoLinks.map((link) => ({ link, enabled: true })),
  };
}

export type ResolvedTarget =
  | { kind: 'calendar'; path: string }
  | { kind: 'set'; path: string; members: { link: string; path: string }[] }
  | null;

export interface EffectiveDisplay {
  paths: Set<string>;
  flagged: { link: string; reason: string }[];
}

/**
 * The union of vault paths an explicit selection displays; `null` while auto
 * (display then derives from task associations, the pre-selection behaviour).
 * A set member is included unless its toggle is explicitly off.
 */
export function effectiveDisplayPaths(
  selection: DisplaySelection,
  resolve: (link: string) => ResolvedTarget,
): EffectiveDisplay | null {
  if (selection.auto) return null;
  const paths = new Set<string>();
  const flagged: { link: string; reason: string }[] = [];
  for (const entry of selection.entries) {
    if (!entry.enabled) continue;
    const target = resolve(entry.link);
    if (target === null) {
      flagged.push({ link: entry.link, reason: 'link does not resolve' });
    } else if (target.kind === 'calendar') {
      paths.add(target.path);
    } else {
      for (const member of target.members) {
        if (entry.members?.[member.link] !== false) paths.add(member.path);
      }
    }
  }
  return { paths, flagged };
}
