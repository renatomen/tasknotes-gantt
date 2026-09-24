import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  checkReleaseNoteLinks,
  classifyDestination,
  GRANDFATHERED_NOTES,
  hasExactPath,
  headingIds,
  parseSiteHost,
  releaseNotesToCheck,
  releaseVersionOf,
  repositoryLinkContext,
  type LinkContext,
} from '../../scripts/check-release-note-links.mjs';
import { extractLinkDestinations } from '../../scripts/releaseFiles.mjs';

const REPO_ROOT = resolve('.');
const SCRIPT = join(REPO_ROOT, 'scripts/check-release-note-links.mjs');
const VERSION = '0.1.0-beta.11';
const RAW = 'https://raw.githubusercontent.com/renatomen/tasknotes-gantt';
const ISSUES = 'https://github.com/renatomen/tasknotes-gantt/issues';

const SITE_PAGES: Record<string, string> = {
  'index.md': '# Home\n',
  'features/calendars.md': [
    '# Calendars and working time',
    '## A worked example',
    '## Choosing which calendars shade: Select calendars…',
    '## Days, not hours',
    '```md',
    '## Inside a fence',
    '```',
  ].join('\n'),
  'features/calendar-sets.md': '# Calendar sets\n## Select calendars… { #select-calendars }\n## **Bold** heading\n',
  'features/index.md': '# Features\n',
  'getting-started.md': '# Getting Started\n## Add working time: a worked example\n### 1. The team working week\n',
};
const ASSETS = new Set(['docs/media/gantt-legend-right-v2.png']);

function context(overrides: Partial<LinkContext> = {}): LinkContext {
  return {
    version: VERSION,
    siteHost: 'tngantt.com',
    readSitePage: (path) => SITE_PAGES[path] ?? null,
    assetExists: (repoPath) => ASSETS.has(repoPath),
    ...overrides,
  };
}

function reasonFor(destination: string): string | undefined {
  const result = classifyDestination(destination, context());
  return result.ok ? undefined : result.reason;
}

function note(body: string): string {
  return `<!-- release-date: 2026-09-20 -->\n# TaskNotes Gantt ${VERSION}\n\n${body}\n`;
}

describe('extractLinkDestinations', () => {
  it('returns inline link and image destinations in document order', () => {
    const found = extractLinkDestinations('See [a](https://x.example/1) and ![b](https://x.example/2 "t").');
    expect(found.map((d) => [d.kind, d.destination])).toEqual([
      ['link', 'https://x.example/1'],
      ['image', 'https://x.example/2'],
    ]);
  });

  it('returns autolink, reference-definition and bare-URL destinations in document order', () => {
    const found = extractLinkDestinations('<https://a.example>\n\n[ref]: https://b.example\n\nplain https://c.example here');
    expect(found.map((d) => [d.kind, d.destination])).toEqual([
      ['autolink', 'https://a.example'],
      ['reference', 'https://b.example'],
      ['bare', 'https://c.example'],
    ]);
  });

  it('returns a bare email address, which renderers autolink', () => {
    expect(extractLinkDestinations('write to someone@example.com')).toEqual([
      { kind: 'bare', destination: 'someone@example.com' },
    ]);
  });

  it('reports a malformed inline link as unparsed instead of dropping it', () => {
    const found = extractLinkDestinations('[broken](has a space)');
    expect(found.map((d) => d.kind)).toEqual(['unparsed']);
  });

  it("does not let a malformed link's text swallow the next link's destination", () => {
    const found = extractLinkDestinations('[bad](a b) and [good](https://g.example)');
    expect(found.map((d) => d.kind).sort()).toEqual(['link', 'unparsed']);
  });

  it('examines link syntax inside code instead of trusting a code stripper', () => {
    expect(extractLinkDestinations('```\n[a](x)\n```\n`[b](y)`').map((d) => d.destination)).toEqual(['x', 'y']);
  });

  it('still finds a link that follows an unpaired backtick', () => {
    const found = extractLinkDestinations('Press the ` key.\n\n- [Docs](https://evil.example/)\n\nThen run `npm test`.');
    expect(found).toEqual([{ kind: 'link', destination: 'https://evil.example/' }]);
  });

  it('keeps an image whose alt text contains brackets', () => {
    const found = extractLinkDestinations('![arr[0] view](https://x.example/i.png)');
    expect(found).toEqual([{ kind: 'image', destination: 'https://x.example/i.png' }]);
  });

  it('returns both the image and the link of a linked image', () => {
    const found = extractLinkDestinations('[![alt](https://x.example/i.png)](https://x.example/page)');
    expect(found).toEqual([
      { kind: 'image', destination: 'https://x.example/i.png' },
      { kind: 'link', destination: 'https://x.example/page' },
    ]);
  });

  it.each([
    ['inside a list item', '- [d]: features/calendars'],
    ['inside a blockquote', '> [d]: features/calendars'],
    ['with the destination on the next line', '[d]:\n  features/calendars'],
    ['with an escaped bracket in its label', '[a\\]b]: features/calendars'],
  ])('returns a reference definition %s', (_shape, markdown) => {
    expect(extractLinkDestinations(markdown)).toEqual([{ kind: 'reference', destination: 'features/calendars' }]);
  });

  it('returns an Obsidian wikilink, which the in-app renderer follows', () => {
    expect(extractLinkDestinations('See [[features/calendars]].')).toEqual([
      { kind: 'wikilink', destination: '[[features/calendars]]' },
    ]);
  });

  it('returns a link written inside the title of another link', () => {
    const found = extractLinkDestinations('[x](https://tngantt.com/ "[y](https://evil.example/)")');
    expect(found.map((d) => d.destination)).toEqual(['https://tngantt.com/', 'https://evil.example/']);
  });

  it('reads an angle-bracketed destination as the URL inside the brackets', () => {
    expect(extractLinkDestinations('[x](<https://x.example/a>)')).toEqual([{ kind: 'link', destination: 'https://x.example/a' }]);
  });

  it('keeps an image whose alt text ends in an escaped bracket', () => {
    expect(extractLinkDestinations('![alt\\]](https://x.example/i.png)')).toEqual([
      { kind: 'image', destination: 'https://x.example/i.png' },
    ]);
  });

  it('returns a reference definition with no destination as an empty one', () => {
    expect(extractLinkDestinations('[d]:')).toEqual([{ kind: 'reference', destination: '' }]);
  });

  it('returns a GitHub @mention as the profile it links to', () => {
    expect(extractLinkDestinations('Thanks to @donaldwdci.')).toEqual([
      { kind: 'mention', destination: 'https://github.com/donaldwdci' },
    ]);
  });

  it('returns cross-repository shorthand wrapped in underscore emphasis', () => {
    expect(extractLinkDestinations('_callumalpass/tasknotes#99_')).toEqual([
      { kind: 'shorthand', destination: 'https://github.com/callumalpass/tasknotes/issues/99' },
    ]);
  });

  it('returns a wikilink even when it is quoted in code', () => {
    expect(extractLinkDestinations('```md\n[[a note]]\n```\n')).toEqual([{ kind: 'wikilink', destination: '[[a note]]' }]);
  });

  it('returns a reference definition written in angle brackets as the URL inside them', () => {
    expect(extractLinkDestinations('[d]: <https://x.example/a>')).toEqual([
      { kind: 'reference', destination: 'https://x.example/a' },
    ]);
  });

  it("returns GitHub's owner/repo@sha shorthand as the commit it links to", () => {
    expect(extractLinkDestinations('Fixed in callumalpass/tasknotes@a1b2c3d4e5f6.')).toEqual([
      { kind: 'shorthand', destination: 'https://github.com/callumalpass/tasknotes/commit/a1b2c3d4e5f6' },
    ]);
  });

  it('strips sentence punctuation that trails a bare URL', () => {
    expect(extractLinkDestinations('see https://x.example/page.')).toEqual([
      { kind: 'bare', destination: 'https://x.example/page' },
    ]);
  });

  it.each([
    ['a single quote', "see 'https://x.example/page' now", "https://x.example/page'"],
    ['a double quote', 'see "https://x.example/page" now', 'https://x.example/page"'],
  ])('keeps %s that closes a bare URL, as Obsidian does', (_shape, markdown, destination) => {
    expect(extractLinkDestinations(markdown)).toEqual([{ kind: 'bare', destination }]);
  });

  it('keeps a trailing bracket in a bare URL, as GitHub does', () => {
    expect(extractLinkDestinations('see https://x.example/page] now')).toEqual([
      { kind: 'bare', destination: 'https://x.example/page]' },
    ]);
  });

  it("returns GitHub's user@sha fork-commit shorthand", () => {
    expect(extractLinkDestinations('Fixed in fariasfc@329c001a.')).toEqual([
      { kind: 'fork-commit', destination: 'fariasfc@329c001a' },
    ]);
  });

  it("returns GitHub's cross-repository shorthand as the URL it links to", () => {
    expect(extractLinkDestinations('Fixed upstream in callumalpass/tasknotes#99.')).toEqual([
      { kind: 'shorthand', destination: 'https://github.com/callumalpass/tasknotes/issues/99' },
    ]);
  });
});

describe('site links', () => {
  it('accepts a page URL with a trailing slash when the page file exists', () => {
    expect(classifyDestination('https://tngantt.com/features/calendars/', context())).toEqual({ ok: true, kind: 'site' });
  });

  it('accepts a page URL without a trailing slash when the page file exists', () => {
    expect(reasonFor('https://tngantt.com/features/calendars')).toBeUndefined();
  });

  it('accepts a directory-style URL that resolves to an index.md', () => {
    expect(reasonFor('https://tngantt.com/features/')).toBeUndefined();
  });

  it('accepts the site root, which resolves to index.md', () => {
    expect(reasonFor('https://tngantt.com/')).toBeUndefined();
  });

  it('rejects a site URL whose page does not exist', () => {
    expect(reasonFor('https://tngantt.com/features/calendar/')).toBe('site-page-missing');
  });

  it('rejects a site path that names the .md source instead of the served URL', () => {
    expect(reasonFor('https://tngantt.com/features/calendars.md')).toBe('site-path-noncanonical');
  });

  it('rejects a site path that climbs out with a dot segment', () => {
    expect(reasonFor('https://tngantt.com/features/../index/')).toBe('site-path-noncanonical');
  });

  it('rejects a URL naming an index page, which the site serves only at its directory', () => {
    expect(reasonFor('https://tngantt.com/features/index/')).toBe('site-path-noncanonical');
  });

  it('rejects a site URL carrying a query string', () => {
    expect(reasonFor('https://tngantt.com/features/calendars/?v=1')).toBe('site-path-noncanonical');
  });

  it('rejects the site over plain http', () => {
    expect(reasonFor('http://tngantt.com/features/calendars/')).toBe('foreign-host');
  });

  it('rejects a typo of the site domain', () => {
    expect(reasonFor('https://tnggantt.com/features/calendars/')).toBe('foreign-host');
  });

  it('rejects a lookalike host that only begins with the site domain', () => {
    expect(reasonFor('https://tngantt.com.evil.example/features/calendars/')).toBe('foreign-host');
  });

  it('rejects a bare site path with no host', () => {
    expect(reasonFor('/features/calendars/')).toBe('relative');
  });

  it('rejects a relative link to a docs source file', () => {
    expect(reasonFor('features/calendars.md')).toBe('relative');
  });

  it('rejects an empty destination', () => {
    expect(reasonFor('')).toBe('relative');
  });

  it('rejects another host outright', () => {
    expect(reasonFor('https://svar.dev/svelte/gantt/')).toBe('foreign-host');
  });
});

describe('fragments on site links', () => {
  it('accepts a fragment equal to a plain heading slug', () => {
    expect(reasonFor('https://tngantt.com/getting-started/#add-working-time-a-worked-example')).toBeUndefined();
  });

  it('accepts a fragment equal to a numbered heading slug', () => {
    expect(reasonFor('https://tngantt.com/getting-started/#1-the-team-working-week')).toBeUndefined();
  });

  it('accepts a fragment equal to an explicit attribute-list id', () => {
    expect(reasonFor('https://tngantt.com/features/calendar-sets/#select-calendars')).toBeUndefined();
  });

  it('rejects a fragment that matches no heading on the page', () => {
    expect(reasonFor('https://tngantt.com/features/calendars/#no-such-heading')).toBe('fragment-unverified');
  });

  it('rejects a fragment aimed at a heading whose slug it cannot derive exactly', () => {
    expect(reasonFor('https://tngantt.com/features/calendars/#choosing-which-calendars-shade-select-calendars')).toBe(
      'fragment-unverified',
    );
  });

  it('rejects a fragment aimed at a heading carrying inline markup', () => {
    expect(reasonFor('https://tngantt.com/features/calendar-sets/#bold-heading')).toBe('fragment-unverified');
  });

  it('rejects a fragment that only matches a heading inside a code fence', () => {
    expect(reasonFor('https://tngantt.com/features/calendars/#inside-a-fence')).toBe('fragment-unverified');
  });

  it('rejects an empty fragment', () => {
    expect(reasonFor('https://tngantt.com/features/calendars/#')).toBe('fragment-unverified');
  });
});

describe('headingIds', () => {
  it('collects explicit ids and slugs of canonical headings only', () => {
    expect([...headingIds('# A b\n## Why: now { #why }\n## C *d*\n### 2. E-f\n')].sort()).toEqual(['2-e-f', 'a-b', 'why']);
  });

  it('collects a heading that follows a closed code fence', () => {
    expect(headingIds('```\ncode\n```\n## After the fence\n').has('after-the-fence')).toBe(true);
  });

  it('keeps a fence open across a line of the other fence marker', () => {
    expect(headingIds('```\n~~~\n## Still code\n```\n').has('still-code')).toBe(false);
  });

  it('keeps a fence open across a marker line that carries an info string', () => {
    expect(headingIds('```\n```md\n## Still code\n```\n').has('still-code')).toBe(false);
  });

  it('ignores a heading inside an HTML comment', () => {
    expect(headingIds('<!--\n## Hidden\n-->\n').has('hidden')).toBe(false);
  });

  it('ignores a heading that shares its line with a closing HTML comment', () => {
    expect(headingIds('<!-- c --># Heading\n').has('heading')).toBe(false);
  });

  it('ignores a heading inside the front matter', () => {
    expect(headingIds('---\n# yaml comment\n---\n# Title\n').has('yaml-comment')).toBe(false);
  });

  it('ignores an indented heading, which Python-Markdown does not render as one', () => {
    expect(headingIds('  ## Indented\n').has('indented')).toBe(false);
  });

  it('does not read an attribute list glued to the heading text as an id', () => {
    expect(headingIds('## Glued{#glued}\n').has('glued')).toBe(false);
  });
});

describe('raw image assets', () => {
  it("accepts an image pinned to this note's own version that exists in docs/media", () => {
    expect(classifyDestination(`${RAW}/${VERSION}/docs/media/gantt-legend-right-v2.png`, context())).toEqual({
      ok: true,
      kind: 'asset',
    });
  });

  it('rejects an image pinned to an earlier release tag', () => {
    expect(reasonFor(`${RAW}/0.1.0-beta.10/docs/media/gantt-legend-right-v2.png`)).toBe('asset-wrong-version');
  });

  it('rejects an image pinned to a commit SHA', () => {
    expect(reasonFor(`${RAW}/a1b2c3d4e5/docs/media/gantt-legend-right-v2.png`)).toBe('asset-wrong-version');
  });

  it('rejects an image pinned to main', () => {
    expect(reasonFor(`${RAW}/main/docs/media/gantt-legend-right-v2.png`)).toBe('asset-wrong-version');
  });

  it('rejects an image whose file is absent from docs/media', () => {
    expect(reasonFor(`${RAW}/${VERSION}/docs/media/not-there.png`)).toBe('asset-missing');
  });

  it('rejects an image under the legacy per-release assets folder', () => {
    expect(reasonFor(`${RAW}/${VERSION}/docs/releases/assets/x.gif`)).toBe('asset-outside-media');
  });

  it('rejects an image path that climbs out of docs/media', () => {
    expect(reasonFor(`${RAW}/${VERSION}/docs/media/../../package.json`)).toBe('asset-outside-media');
  });

  it("rejects a raw URL for another repository", () => {
    expect(reasonFor(`https://raw.githubusercontent.com/someone/else/${VERSION}/docs/media/x.png`)).toBe('foreign-host');
  });
});

describe('repository links', () => {
  it("accepts an issue link on this plugin's repository", () => {
    expect(classifyDestination(`${ISSUES}/311`, context())).toEqual({ ok: true, kind: 'repo' });
  });

  it("accepts a pull request link on this plugin's repository", () => {
    expect(reasonFor('https://github.com/renatomen/tasknotes-gantt/pull/490')).toBeUndefined();
  });

  it("accepts a commit link on this plugin's repository", () => {
    expect(reasonFor('https://github.com/renatomen/tasknotes-gantt/commit/329c001a')).toBeUndefined();
  });

  it('rejects a repository URL that only begins with this repository name', () => {
    expect(reasonFor('https://github.com/renatomen/tasknotes-gantt-fork/issues/1')).toBe('foreign-host');
  });

  it("rejects an issue link on another repository", () => {
    expect(reasonFor('https://github.com/callumalpass/tasknotes/issues/1')).toBe('foreign-host');
  });

  it('rejects the repository issue list, which names no single issue', () => {
    expect(reasonFor(ISSUES)).toBe('repo-link-shape');
  });

  it('rejects an issue link carrying a fragment', () => {
    expect(reasonFor(`${ISSUES}/311#issuecomment-1`)).toBe('repo-link-shape');
  });

  it('rejects a non-numeric issue reference', () => {
    expect(reasonFor(`${ISSUES}/abc`)).toBe('repo-link-shape');
  });
});

describe('checkReleaseNoteLinks', () => {
  it('passes a note whose every destination resolves', () => {
    const body = `- A thing. [Read more](https://tngantt.com/features/calendars/) ([#311](${ISSUES}/311))`;
    expect(checkReleaseNoteLinks(note(body), context())).toEqual({ findings: [], checked: 2 });
  });

  it('reports every failing destination, not only the first', () => {
    const body = '[a](/features/calendars/) [b](https://tnggantt.com/) [c](features/x.md)';
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual([
      'relative: /features/calendars/',
      'foreign-host: https://tnggantt.com/',
      'relative: features/x.md',
    ]);
  });

  it('refuses a wikilink, which resolves nowhere outside a vault', () => {
    expect(checkReleaseNoteLinks(note('[[features/calendars]]'), context()).findings).toEqual([
      'wikilink: [[features/calendars]]',
    ]);
  });

  it("refuses GitHub shorthand for another repository's issue", () => {
    expect(checkReleaseNoteLinks(note('See callumalpass/tasknotes#99.'), context()).findings).toEqual([
      'foreign-host: https://github.com/callumalpass/tasknotes/issues/99',
    ]);
  });

  it.each([
    ['a bare URL', 'See https://tngantt.com @evil.example now.'],
    ['a reference definition', '[a]: https://tngantt.com @evil.example'],
    ['a bare URL with an ideographic space', 'See https://tngantt.com　@evil.example now.'],
  ])('reads a non-ASCII space as part of %s, as GitHub does', (_shape, body) => {
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual([
      expect.stringMatching(/^foreign-host: https:\/\/tngantt\.com.@evil\.example$/),
    ]);
  });

  it.each([
    ['an inline destination', 'Docs https://tngantt.com/features/calendars/](https://tngantt.com/)'],
    ['a reference destination', 'Docs https://tngantt.com/features/calendars/]:https://tngantt.com/'],
  ])('reads a bare URL that runs into %s at its full length', (_shape, body) => {
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual(
      expect.arrayContaining([expect.stringMatching(/^site-path-noncanonical: https:\/\/tngantt\.com\/features\/calendars\/\]/)]),
    );
  });

  it.each([
    ['a bare URL after an inline link', '[docs](https://tngantt.com/features/calendars/)https://evil.example/x', 'https://evil.example/x'],
    ['a bare URL after an autolink', '<https://tngantt.com/features/calendars/>https://evil.example/x', 'https://evil.example/x'],
    ['an email after an inline link', '[docs](https://tngantt.com/features/calendars/)evil@evil.example', 'evil@evil.example'],
    ['a broken page after a comma', '[docs](https://tngantt.com/features/calendars/),https://tngantt.com/no-such-page/', 'no-such-page'],
  ])('still examines %s written with no space between', (_shape, body, fragment) => {
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual(
      expect.arrayContaining([expect.stringContaining(fragment)]),
    );
  });

  it.each([
    ['an escaped opening bracket', 'Docs \\[here](https://tngantt.com)@evil.example now.'],
    ['no opening bracket', 'Docs here](https://tngantt.com)@evil.example now.'],
    ['an opening bracket GitHub does not pair', 'Docs [a]b](https://tngantt.com)@evil.example now.'],
  ])('reads the whole run GitHub links when a destination has %s', (_shape, body) => {
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual(
      expect.arrayContaining(['foreign-host: https://tngantt.com)@evil.example']),
    );
  });

  it.each([
    ['after a host', 'Fixed upstream in github.com/octocat/Hello-World#1.'],
    ['after a path', 'Fixed upstream in forks/octocat/Hello-World#1.'],
    ['after a dash', 'Fixed upstream in -octocat/Hello-World#1.'],
    ['before a range', 'Fixed upstream in octocat/Hello-World#1-3.'],
  ])("refuses another repository's shorthand written %s", (_shape, body) => {
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual([
      'foreign-host: https://github.com/octocat/Hello-World/issues/1',
    ]);
  });

  it.each([
    ['bare', 'Upstream fix: callumalpass/tasknotes/issues/1 now.', 'foreign-host: https://github.com/callumalpass/tasknotes/issues/1'],
    ['in parentheses', 'Upstream fix (callumalpass/tasknotes/pull/2).', 'foreign-host: https://github.com/callumalpass/tasknotes/pull/2'],
    ['after a host', 'See github.com/callumalpass/tasknotes/issues/1 now.', 'foreign-host: https://github.com/callumalpass/tasknotes/issues/1'],
    ['for a discussion here', 'See renatomen/tasknotes-gantt/discussions/3 now.', 'repo-link-shape: https://github.com/renatomen/tasknotes-gantt/discussions/3'],
    ['in capitals', 'See callumalpass/tasknotes/Issues/1 and more.', 'foreign-host: https://github.com/callumalpass/tasknotes/issues/1'],
  ])('refuses the owner/repo/issues/N path form %s', (_shape, body, finding) => {
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual([finding]);
  });

  it("accepts the path form for this repository's issue", () => {
    expect(checkReleaseNoteLinks(note('See renatomen/tasknotes-gantt/issues/311 now.'), context()).findings).toEqual([]);
  });

  it('refuses an email whose domain starts with a dot, which GitHub still links', () => {
    expect(checkReleaseNoteLinks(note('Mail foo@.evil.example now.'), context()).findings).toEqual([
      'relative: foo@.evil.example',
    ]);
  });

  it.each([
    ['a backslash-escaped dash', 'Write to support@evil\\-corp.example.', '\\'],
    ['a backslash-escaped underscore', 'Write to support@evil\\_corp.example.', '\\'],
    ['a backslash-escaped @', 'Write to support\\@evil.example.', '\\'],
    ['a backslash-escaped #', 'See octocat/Hello-World\\#1.', '\\'],
    ['a numeric character reference', 'Write to support&#64;evil.example.', '&#64;'],
    ['a hex character reference', 'Write to support&#x40;evil.example.', '&#x40;'],
    ['a named character reference', 'See octocat&sol;Hello-World#1.', '&sol;'],
  ])('refuses %s, which a renderer decodes before linking', (_shape, body, token) => {
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual(
      expect.arrayContaining([`${token}: a renderer decodes it before linking, so links built from it are not examined`]),
    );
  });

  it('accepts a link followed by closing punctuation', () => {
    const body = '(see [Calendars](https://tngantt.com/features/calendars/)).';
    expect(checkReleaseNoteLinks(note(body), context())).toEqual({ findings: [], checked: 1 });
  });

  it('reads a > as part of a bare URL, as GFM does', () => {
    expect(checkReleaseNoteLinks(note('See https://tngantt.com/features/calendars/>next'), context()).findings).toEqual([
      'site-path-noncanonical: https://tngantt.com/features/calendars/>next',
    ]);
  });

  it("refuses @-prefixed shorthand for another repository's issue", () => {
    expect(checkReleaseNoteLinks(note('Fixed upstream in @evil/repo#12.'), context()).findings).toEqual([
      'foreign-host: https://github.com/evil/repo/issues/12',
    ]);
  });

  it('refuses fork-commit shorthand, whose repository the note cannot name', () => {
    expect(checkReleaseNoteLinks(note('Fixed in fariasfc@329c001a.'), context()).findings).toEqual([
      'fork-commit shorthand: fariasfc@329c001a',
    ]);
  });

  it('refuses a bare site URL whose trailing bracket GitHub keeps in the link', () => {
    expect(checkReleaseNoteLinks(note('see https://tngantt.com/features/calendars/] for details'), context()).findings).toEqual([
      'site-path-noncanonical: https://tngantt.com/features/calendars/]',
    ]);
  });

  it('accepts an @mention, which credits a person', () => {
    expect(checkReleaseNoteLinks(note('Thanks to @donaldwdci.'), context())).toEqual({ findings: [], checked: 1 });
  });

  it('flags raw HTML sitting between two backticks in separate paragraphs', () => {
    const body = 'A literal ` backtick.\n\n<a href="//evil.example/x">docs</a>\n\nThen run `npm test`.';
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual([expect.stringContaining('raw HTML')]);
  });

  it('flags raw HTML whose attribute holds a backtick', () => {
    const body = 'See <a title="`" href="https&#58;//evil.example/">the docs</a> for details `';
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('raw HTML')]),
    );
  });

  it('flags raw HTML after a fence opened inside a list item', () => {
    const body = '- item\n  ```\n  code\n\n<img src=x onerror=alert(1)>\n\n```\n';
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual([expect.stringContaining('raw HTML')]);
  });

  it.each([
    ['a broken mailto autolink', 'See <mailto: <img src="//evil.example/p.png"> today.'],
    ['a broken https autolink', 'See <https://tngantt.com/ <img src="//evil.example/p.png"> today.'],
  ])('flags raw HTML that follows %s', (_shape, body) => {
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual(
      expect.arrayContaining([expect.stringContaining('raw HTML')]),
    );
  });

  it('flags an HTML block whose opening tag never closes', () => {
    const body = '<iframe\nsrc=https:evil.example/x\nwidth=800 height=600\n\nText.';
    expect(checkReleaseNoteLinks(note(body), context()).findings).toEqual([expect.stringContaining('raw HTML')]);
  });

  it('accepts a well-formed autolink to the site', () => {
    expect(checkReleaseNoteLinks(note('See <https://tngantt.com/>.'), context())).toEqual({ findings: [], checked: 1 });
  });

  it('flags raw HTML quoted in code, since no model of code is trusted', () => {
    expect(checkReleaseNoteLinks(note('Use `<br>` for breaks.'), context()).findings).toEqual([
      expect.stringContaining('raw HTML'),
    ]);
  });

  it("accepts GitHub shorthand for this repository's issue", () => {
    expect(checkReleaseNoteLinks(note('See renatomen/tasknotes-gantt#311.'), context()).findings).toEqual([]);
  });

  it('flags a note whose release-date line has been blanked', () => {
    const content = note('text').replace('2026-09-20', '');
    expect(checkReleaseNoteLinks(content, context()).findings).toEqual([expect.stringContaining('release-date')]);
  });

  it('flags a second release-date comment, which the bundle would strip and so join the text around it', () => {
    const findings = checkReleaseNoteLinks(note('Guide: https:/<!--release-date:2026-09-20-->/evil.example/guide'), context()).findings;
    expect(findings).toEqual(expect.arrayContaining(['2 release-date comments: stripping the first could join the text around it']));
  });

  it('flags a TeX macro, which Obsidian expands in math before it links', () => {
    const findings = checkReleaseNoteLinks(note('$\\href{https:evil.example/guide}{guide}$'), context()).findings;
    expect(findings).toEqual(expect.arrayContaining([expect.stringContaining('a renderer decodes it before linking')]));
  });

  it('flags raw HTML, whose links it cannot examine', () => {
    const findings = checkReleaseNoteLinks(note('<a href="https://evil.example">x</a>'), context()).findings;
    expect(findings).toEqual(expect.arrayContaining([expect.stringContaining('raw HTML')]));
  });

  it('flags a malformed link rather than passing it unexamined', () => {
    expect(checkReleaseNoteLinks(note('[x](has space)'), context()).findings).toEqual([
      expect.stringContaining('unparsed'),
    ]);
  });
});

describe('releaseVersionOf', () => {
  it("derives the version from the note's file name", () => {
    expect(releaseVersionOf('docs/releases/0.1.0-beta.11.md')).toBe(VERSION);
  });

  it('refuses a file that is not a versioned release note', () => {
    expect(() => releaseVersionOf('docs/releases/unreleased.md')).toThrow(/not a versioned release note/);
  });
});

describe('releaseNotesToCheck', () => {
  it('selects every versioned note except the grandfathered, older and newer alike', () => {
    const files = ['0.1.0-beta.1.md', '0.0.9.md', '0.2.0-rc.1.md', 'unreleased.md', 'RELEASING.md'];
    expect(releaseNotesToCheck(files, ['0.1.0-beta.1.md'])).toEqual(['0.0.9.md', '0.2.0-rc.1.md']);
  });

  it('refuses to run when a grandfathered note is no longer present', () => {
    expect(() => releaseNotesToCheck(['0.2.0.md'], ['0.1.0-beta.1.md'])).toThrow(/no longer present/);
  });

  it('refuses to run when no note is left to check', () => {
    expect(() => releaseNotesToCheck(['0.1.0-beta.1.md', 'unreleased.md'], ['0.1.0-beta.1.md'])).toThrow(/no release notes/);
  });

  it.each(GRANDFATHERED_NOTES)('keeps %s grandfathered only while it still breaks the rule', (name) => {
    const content = readFileSync(join(REPO_ROOT, 'docs/releases', name), 'utf8');
    const { findings } = checkReleaseNoteLinks(content, repositoryLinkContext(releaseVersionOf(name)));
    expect(findings).not.toEqual([]);
  });
});

describe('hasExactPath', () => {
  it('finds a committed file named with its exact case', () => {
    expect(hasExactPath(REPO_ROOT, 'docs/media/bars-default-light.png')).toBe(true);
  });

  it('refuses a committed file named with the wrong case, which the published URL would 404 on', () => {
    expect(hasExactPath(REPO_ROOT, 'docs/media/Bars-Default-Light.png')).toBe(false);
  });

  it('refuses a path that continues past a file', () => {
    expect(hasExactPath(REPO_ROOT, 'docs/media/bars-default-light.png/extra')).toBe(false);
  });

  it('refuses a directory, which is not a page or an image', () => {
    expect(hasExactPath(REPO_ROOT, 'docs/media')).toBe(false);
  });
});

describe('parseSiteHost', () => {
  it('reads the host name from the CNAME contents', () => {
    expect(parseSiteHost('tngantt.com\n')).toBe('tngantt.com');
  });

  it('refuses CNAME contents that are not a host name', () => {
    expect(() => parseSiteHost('https://tngantt.com/')).toThrow(/no host name/);
  });
});

describe('the command', () => {
  function run(...args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, encoding: 'utf8' });
  }

  it('exits 0 on the committed release notes', () => {
    expect(run().status).toBe(0);
  });

  it('exits 1 on a copy of the notes with one link broken', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-links-'));
    try {
      const copy = join(dir, `${VERSION}.md`);
      const original = readFileSync(join(REPO_ROOT, 'docs/releases', `${VERSION}.md`), 'utf8');
      writeFileSync(copy, `${original}\n[broken](https://tnggantt.com/)\n`);
      expect(run(copy).status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 when the named note cannot be read', () => {
    expect(run(join(REPO_ROOT, 'docs/releases/9.9.9.md')).status).toBe(2);
  });

  it('exits 2 when the named file is not a versioned release note', () => {
    expect(run(join(REPO_ROOT, 'docs/releases/unreleased.md')).status).toBe(2);
  });

  it('is run by the pull-request CI workflow', () => {
    const workflow = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toMatch(/^on:\n {2}pull_request:\n/m);
    expect(workflow).toMatch(/^ {8}run: node scripts\/check-release-note-links\.mjs$/m);
  });
});
