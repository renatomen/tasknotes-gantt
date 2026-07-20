import { describe, expect, it } from '@jest/globals';
import { editFrontmatterKeys } from '../../src/editor/frontmatterEdit';

const doc = (frontmatter: string, body = '\nBody paragraph.\n'): string =>
  `---\n${frontmatter}\n---\n${body}`;

describe('editFrontmatterKeys — targeted, comment-preserving key edits', () => {
  it('replaces a scalar value, leaving every other line byte-identical', () => {
    const original = doc(
      [
        'tngantt: calendar',
        '# a hand-authored comment',
        'description: Old text',
        'color: "#2a9d8f"  # inline note',
      ].join('\n'),
    );
    const next = editFrontmatterKeys(original, { description: 'New text' });
    expect(next).toContain('description: New text');
    expect(next).toContain('# a hand-authored comment');
    expect(next).toContain('color: "#2a9d8f"  # inline note');
    expect(next).toContain('\nBody paragraph.\n');
  });

  it('touches nothing when no value changed', () => {
    const original = doc('tngantt: calendar\ndescription: Same');
    expect(editFrontmatterKeys(original, { description: 'Same' })).toBe(original);
  });

  it('appends a key that was absent, before the closing fence', () => {
    const original = doc('tngantt: calendar\ndescription: Text');
    const next = editFrontmatterKeys(original, { color: '#4c6ef5' });
    expect(next).toContain('color: "#4c6ef5"');
    // The original keys and body survive.
    expect(next).toContain('description: Text');
    expect(next.indexOf('color:')).toBeLessThan(next.lastIndexOf('---'));
  });

  it('quotes a value that YAML would otherwise mangle', () => {
    const original = doc('tngantt: calendar');
    const next = editFrontmatterKeys(original, { pattern: 'FREQ=WEEKLY;BYDAY=MO,TU' });
    expect(next).toContain('pattern: "FREQ=WEEKLY;BYDAY=MO,TU"');
  });

  it('replaces a whole list block, not just its first line', () => {
    const original = doc(
      [
        'tngantt: calendar',
        'non_working:',
        '  - date: 2026-01-01',
        '    name: New Year',
        '  - date: 2026-02-06',
        'color: "#000000"',
      ].join('\n'),
    );
    const next = editFrontmatterKeys(original, {
      non_working: [{ date: '2026-12-25', name: 'Christmas' }],
    });
    expect(next).toContain('  - date: "2026-12-25"');
    expect(next).not.toContain('2026-01-01');
    expect(next).not.toContain('2026-02-06');
    // The key AFTER the list is preserved intact.
    expect(next).toContain('color: "#000000"');
  });

  it('removes a key when its new value is undefined', () => {
    const original = doc('tngantt: calendar\ncolor: "#111"\npattern: "FREQ=DAILY"');
    const next = editFrontmatterKeys(original, { color: undefined });
    expect(next).not.toContain('color:');
    expect(next).toContain('pattern: "FREQ=DAILY"');
  });

  it('serializes a string list as a YAML block sequence', () => {
    const original = doc('tngantt: calendar');
    const next = editFrontmatterKeys(original, { working_hours: ['09:00-17:00'] });
    expect(next).toContain('working_hours:');
    expect(next).toContain('  - "09:00-17:00"');
  });

  it('creates a frontmatter block when the file has none', () => {
    const bare = 'Just body text, no frontmatter.\n';
    const next = editFrontmatterKeys(bare, { tngantt: 'calendar' });
    expect(next.startsWith('---\n')).toBe(true);
    expect(next).toContain('tngantt: calendar');
    expect(next).toContain('Just body text, no frontmatter.');
  });

  it('leaves the body content untouched, including a body that contains ---', () => {
    const original = doc('tngantt: calendar\ndescription: A', '\nBody with a --- rule inside.\n');
    const next = editFrontmatterKeys(original, { description: 'B' });
    expect(next).toContain('Body with a --- rule inside.');
    expect(next).toContain('description: B');
  });
});

describe('Codex-found data-loss cases', () => {
  it('quotes a wikilink set member so YAML reads it as a string, not a flow seq', () => {
    const original = doc('tngantt: calendar-set');
    const next = editFrontmatterKeys(original, { calendars: ['[[NZ Holidays]]'] });
    expect(next).toContain('  - "[[NZ Holidays]]"');
    expect(next).not.toContain('  - [[NZ Holidays]]');
  });

  it('swallows a comment INSIDE a list when replacing it, leaving no orphan items', () => {
    const original = doc(
      [
        'tngantt: calendar',
        'non_working:',
        '  - date: 2026-01-01',
        '  # mid-list hand note',
        '  - date: 2026-02-06',
        'color: "#000000"',
      ].join('\n'),
    );
    const next = editFrontmatterKeys(original, {
      non_working: [{ date: '2026-12-25', name: 'Christmas' }],
    });
    // The old entries — and the stranded comment — are gone; nothing YAML would
    // still read as a list item survives.
    expect(next).not.toContain('2026-01-01');
    expect(next).not.toContain('2026-02-06');
    expect(next).not.toContain('mid-list hand note');
    expect(next).toContain('  - date: "2026-12-25"');
    expect(next).toContain('color: "#000000"');
  });

  it('escapes an embedded newline so a multiline description keeps its breaks', () => {
    const original = doc('tngantt: calendar');
    const next = editFrontmatterKeys(original, { description: 'First line\nSecond line' });
    // Escaped inside the double-quoted scalar and kept on one physical line: a
    // *literal* newline there folds to a space in YAML, silently losing the break.
    expect(next).toContain('description: "First line\\nSecond line"');
    expect(next).not.toContain('description: "First line\nSecond line"');
  });

  it('edits CRLF frontmatter in place, preserving the newline convention', () => {
    // A note saved with Windows line endings must not be mistaken for
    // frontmatter-less and have a duplicate LF block prepended.
    const original = '---\r\ntngantt: calendar\r\ndescription: Old\r\n---\r\n\r\nBody.\r\n';
    const next = editFrontmatterKeys(original, { description: 'New' });
    expect(next.startsWith('---\r\n')).toBe(true);
    expect(next).toContain('description: New\r\n');
    expect((next.match(/tngantt: calendar/g) ?? []).length).toBe(1);
    // No second, LF-delimited fence prepended.
    expect(next).not.toContain('---\n');
  });

  it('detects the newline from the opening fence, not a CRLF body line', () => {
    // LF frontmatter, but a CRLF line pasted into the body must not make the
    // editor treat the note as CRLF and prepend a duplicate block.
    const original = '---\ntngantt: calendar\ndescription: Old\n---\n\nPasted\r\nline.\n';
    const next = editFrontmatterKeys(original, { description: 'New' });
    expect(next.startsWith('---\ntngantt: calendar')).toBe(true);
    expect(next).toContain('description: New\n');
    expect((next.match(/tngantt: calendar/g) ?? []).length).toBe(1);
  });

  it('quotes a string YAML would retype as bool/null/number/date so it stays a string', () => {
    const original = doc('tngantt: calendar');
    expect(editFrontmatterKeys(original, { description: 'true' })).toContain('description: "true"');
    expect(editFrontmatterKeys(original, { description: 'null' })).toContain('description: "null"');
    expect(editFrontmatterKeys(original, { description: '2026-04-10' })).toContain(
      'description: "2026-04-10"',
    );
    expect(editFrontmatterKeys(original, { description: '42' })).toContain('description: "42"');
  });

  it('serializes a Date value as an ISO date, not a JS Date string', () => {
    // Obsidian hands unquoted range dates back as Date objects; a raw {start,end}
    // passthrough must reserialize them as ISO, or the schema rejects the range.
    const original = doc('tngantt: calendar');
    const next = editFrontmatterKeys(original, {
      non_working: [
        {
          start: new Date(Date.UTC(2026, 11, 29)),
          end: new Date(Date.UTC(2027, 0, 2)),
          name: 'Shutdown',
        },
      ],
    });
    expect(next).toContain('start: "2026-12-29"');
    expect(next).toContain('end: "2027-01-02"');
    expect(next).not.toContain('GMT');
  });

  it('serializes a scalar or null list item without throwing', () => {
    const original = doc('tngantt: calendar');
    const next = editFrontmatterKeys(original, { non_working: [null, { date: '2026-01-01' }] });
    expect(next).toContain('  - null');
    expect(next).toContain('  - date: "2026-01-01"');
  });

  it('keeps a comment that trails the whole frontmatter with the block after it', () => {
    // A comment that belongs to the NEXT key must not be swallowed by the key
    // before it.
    const original = doc(
      ['tngantt: calendar', 'description: A', '# belongs to color', 'color: "#111"'].join('\n'),
    );
    const next = editFrontmatterKeys(original, { description: 'B' });
    expect(next).toContain('# belongs to color');
    expect(next).toContain('color: "#111"');
    expect(next).toContain('description: B');
  });
});
