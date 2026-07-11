/**
 * fileFilter unit tests — the local, Obsidian-free file-filter predicate.
 *
 * `matchesFileFilter` re-implements TaskNotes' verified autosuggest-filter
 * semantics (tag, folder, and property dimensions) over a small candidate shape
 * so a companion plugin can scope `[[` suggestions without reaching into
 * TaskNotes' bundled `FileSuggestHelper`. Each dimension is asserted against the
 * source-verified behaviour: any-of + hierarchical + `-`-exclusion tags,
 * path-prefix folders, and case-insensitive key-present/multi-value property
 * matching, all AND-ed together.
 */

import { describe, it, expect } from '@jest/globals';
import {
  matchesFileFilter,
  type FileFilterCandidate,
  type FileFilterConfig,
} from '../../src/bases/fileFilter';

function candidate(overrides: Partial<FileFilterCandidate> = {}): FileFilterCandidate {
  return {
    tags: [],
    path: 'Notes/Example.md',
    frontmatter: {},
    aliases: [],
    title: 'Example',
    ...overrides,
  };
}

describe('matchesFileFilter — no filter', () => {
  it('passes every candidate when the config is undefined', () => {
    expect(matchesFileFilter(candidate(), undefined)).toBe(true);
  });

  it('passes when the config sets no dimensions', () => {
    expect(matchesFileFilter(candidate(), {})).toBe(true);
  });
});

describe('matchesFileFilter — required tags', () => {
  it('passes when the single required tag is present', () => {
    expect(matchesFileFilter(candidate({ tags: ['#ws'] }), { requiredTags: ['ws'] })).toBe(true);
  });

  it('rejects when the single required tag is absent', () => {
    expect(matchesFileFilter(candidate({ tags: ['#other'] }), { requiredTags: ['ws'] })).toBe(false);
  });

  it('passes on ANY one of multiple required tags (union, not intersection)', () => {
    const config: FileFilterConfig = { requiredTags: ['ws', 'team'] };
    expect(matchesFileFilter(candidate({ tags: ['#team'] }), config)).toBe(true);
    expect(matchesFileFilter(candidate({ tags: ['#ws'] }), config)).toBe(true);
    expect(matchesFileFilter(candidate({ tags: ['#unrelated'] }), config)).toBe(false);
  });

  it('matches a hierarchical child tag (#ws/alpha satisfies required ws)', () => {
    expect(matchesFileFilter(candidate({ tags: ['#ws/alpha'] }), { requiredTags: ['ws'] })).toBe(true);
  });

  it('normalizes a leading # so "ws" matches "#ws" in either direction', () => {
    expect(matchesFileFilter(candidate({ tags: ['#ws'] }), { requiredTags: ['ws'] })).toBe(true);
    expect(matchesFileFilter(candidate({ tags: ['ws'] }), { requiredTags: ['#ws'] })).toBe(true);
  });

  it('rejects a note carrying a "-"-prefixed exclusion tag', () => {
    expect(
      matchesFileFilter(candidate({ tags: ['#ws', '#archived'] }), { requiredTags: ['-archived'] }),
    ).toBe(false);
  });

  it('passes when only exclusions are given and none match', () => {
    expect(matchesFileFilter(candidate({ tags: ['#ws'] }), { requiredTags: ['-archived'] })).toBe(
      true,
    );
  });

  it('rejects when an exclusion matches even though an inclusion also matches', () => {
    expect(
      matchesFileFilter(candidate({ tags: ['#ws', '#archived'] }), {
        requiredTags: ['ws', '-archived'],
      }),
    ).toBe(false);
  });
});

describe('matchesFileFilter — folders', () => {
  it('passes when the path is under an included folder', () => {
    expect(
      matchesFileFilter(candidate({ path: 'Projects/Alpha/Note.md' }), {
        includeFolders: ['Projects'],
      }),
    ).toBe(true);
  });

  it('rejects when the path is outside every included folder', () => {
    expect(
      matchesFileFilter(candidate({ path: 'Other/Note.md' }), { includeFolders: ['Projects'] }),
    ).toBe(false);
  });

  it('does not treat a sibling name sharing the prefix as a folder match', () => {
    expect(
      matchesFileFilter(candidate({ path: 'ProjectsX/Note.md' }), { includeFolders: ['Projects'] }),
    ).toBe(false);
  });

  it('normalizes leading/trailing slashes on the include folder', () => {
    expect(
      matchesFileFilter(candidate({ path: 'Projects/Note.md' }), { includeFolders: ['/Projects/'] }),
    ).toBe(true);
  });

  it('passes any path when includeFolders is empty', () => {
    expect(
      matchesFileFilter(candidate({ path: 'Anywhere/Note.md' }), { includeFolders: [] }),
    ).toBe(true);
  });

  it('rejects a path under an excluded folder', () => {
    expect(matchesFileFilter(candidate({ path: 'Archive/Old.md' }), undefined, ['Archive'])).toBe(
      false,
    );
  });

  it('passes a path outside every excluded folder', () => {
    expect(matchesFileFilter(candidate({ path: 'Notes/New.md' }), undefined, ['Archive'])).toBe(
      true,
    );
  });

  it('excludes a path under an excluded folder even when the config would match', () => {
    expect(
      matchesFileFilter(
        candidate({ path: 'Archive/Old.md', tags: ['#ws'] }),
        { requiredTags: ['ws'] },
        ['Archive'],
      ),
    ).toBe(false);
  });
});

describe('matchesFileFilter — property', () => {
  it('passes when the property value equals the expected (case-insensitive)', () => {
    expect(
      matchesFileFilter(candidate({ frontmatter: { status: 'Active' } }), {
        propertyKey: 'status',
        propertyValue: 'active',
      }),
    ).toBe(true);
  });

  it('rejects when the property value differs', () => {
    expect(
      matchesFileFilter(candidate({ frontmatter: { status: 'Done' } }), {
        propertyKey: 'status',
        propertyValue: 'active',
      }),
    ).toBe(false);
  });

  it('rejects when the key is absent from frontmatter', () => {
    expect(
      matchesFileFilter(candidate({ frontmatter: {} }), {
        propertyKey: 'status',
        propertyValue: 'active',
      }),
    ).toBe(false);
  });

  it('with an empty propertyValue passes when the key is present and non-null', () => {
    expect(
      matchesFileFilter(candidate({ frontmatter: { status: 'anything' } }), {
        propertyKey: 'status',
        propertyValue: '',
      }),
    ).toBe(true);
  });

  it('with an empty propertyValue rejects when the key is absent', () => {
    expect(matchesFileFilter(candidate({ frontmatter: {} }), { propertyKey: 'status' })).toBe(false);
  });

  it('with an empty propertyValue rejects when the present value is null', () => {
    expect(
      matchesFileFilter(candidate({ frontmatter: { status: null } }), { propertyKey: 'status' }),
    ).toBe(false);
  });

  it('matches any element of an array-valued frontmatter property', () => {
    expect(
      matchesFileFilter(candidate({ frontmatter: { team: ['Design', 'Eng'] } }), {
        propertyKey: 'team',
        propertyValue: 'eng',
      }),
    ).toBe(true);
    expect(
      matchesFileFilter(candidate({ frontmatter: { team: ['Design', 'Eng'] } }), {
        propertyKey: 'team',
        propertyValue: 'sales',
      }),
    ).toBe(false);
  });

  it('matches a numeric frontmatter property by its string form', () => {
    expect(
      matchesFileFilter(candidate({ frontmatter: { priority: 3 } }), {
        propertyKey: 'priority',
        propertyValue: '3',
      }),
    ).toBe(true);
    expect(
      matchesFileFilter(candidate({ frontmatter: { priority: 3 } }), {
        propertyKey: 'priority',
        propertyValue: '2',
      }),
    ).toBe(false);
  });

  it('matches a boolean frontmatter property by its string form', () => {
    expect(
      matchesFileFilter(candidate({ frontmatter: { active: true } }), {
        propertyKey: 'active',
        propertyValue: 'true',
      }),
    ).toBe(true);
    expect(
      matchesFileFilter(candidate({ frontmatter: { active: false } }), {
        propertyKey: 'active',
        propertyValue: 'true',
      }),
    ).toBe(false);
  });

  it('matches an object frontmatter property by its JSON form', () => {
    expect(
      matchesFileFilter(candidate({ frontmatter: { ref: { id: 1 } } }), {
        propertyKey: 'ref',
        propertyValue: '{"id":1}',
      }),
    ).toBe(true);
    expect(
      matchesFileFilter(candidate({ frontmatter: { ref: { id: 1 } } }), {
        propertyKey: 'ref',
        propertyValue: '{"id":2}',
      }),
    ).toBe(false);
  });
});

describe('matchesFileFilter — combined dimensions', () => {
  const config: FileFilterConfig = {
    requiredTags: ['ws'],
    includeFolders: ['Projects'],
    propertyKey: 'status',
    propertyValue: 'active',
  };

  it('ANDs every present dimension — all satisfied passes', () => {
    expect(
      matchesFileFilter(
        candidate({ tags: ['#ws'], path: 'Projects/Alpha.md', frontmatter: { status: 'Active' } }),
        config,
      ),
    ).toBe(true);
  });

  it('rejects when any single dimension fails', () => {
    expect(
      matchesFileFilter(
        candidate({
          tags: ['#other'],
          path: 'Projects/Alpha.md',
          frontmatter: { status: 'Active' },
        }),
        config,
      ),
    ).toBe(false);
    expect(
      matchesFileFilter(
        candidate({ tags: ['#ws'], path: 'Other/Alpha.md', frontmatter: { status: 'Active' } }),
        config,
      ),
    ).toBe(false);
    expect(
      matchesFileFilter(
        candidate({ tags: ['#ws'], path: 'Projects/Alpha.md', frontmatter: { status: 'Done' } }),
        config,
      ),
    ).toBe(false);
  });
});
