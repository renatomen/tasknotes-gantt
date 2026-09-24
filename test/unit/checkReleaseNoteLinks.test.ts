import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  checkReleaseNoteLinks,
  classifyDestination,
  headingIds,
  releaseNotesToCheck,
  releaseVersionOf,
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

  it('ignores destinations inside fenced and inline code', () => {
    expect(extractLinkDestinations('```\n[a](x)\n```\n`[b](y)`')).toEqual([]);
  });

  it('keeps an image whose alt text contains brackets', () => {
    const found = extractLinkDestinations('![arr[0] view](https://x.example/i.png)');
    expect(found).toEqual([{ kind: 'image', destination: 'https://x.example/i.png' }]);
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
    expect(checkReleaseNoteLinks(note(body), context()).findings).toHaveLength(3);
  });

  it('flags a note whose release-date line has been blanked', () => {
    const content = note('text').replace('2026-09-20', '');
    expect(checkReleaseNoteLinks(content, context()).findings).toEqual([expect.stringContaining('release-date')]);
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
  it('selects the baseline note and every later one, skipping older and unversioned files', () => {
    const files = ['0.1.0-beta.9.md', '0.1.0-beta.10.md', '0.1.0-beta.11.md', '0.2.0.md', 'unreleased.md', 'RELEASING.md'];
    expect(releaseNotesToCheck(files, '0.1.0-beta.10')).toEqual(['0.1.0-beta.10.md', '0.1.0-beta.11.md', '0.2.0.md']);
  });

  it('refuses to run when the baseline note itself is missing', () => {
    expect(() => releaseNotesToCheck(['0.1.0-beta.11.md'], '0.1.0-beta.10')).toThrow(/baseline/);
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
