/**
 * SVAR "Pro"-feature render probe (spike). Mounts the raw SVAR <Gantt> (default
 * templates) per feature and RECORDS whether the documented DOM hook appears —
 * a "does-not-render" is a valid verdict, not a failure, so per-feature checks
 * are soft-recorded. Only two things are hard-gated: harness sanity (a plain
 * task draws a bar) and a negative control (absent input => hook absent). The
 * verdicts are written to test/probe/.results/verdicts.json for U5.
 */
import { test, expect, vi, afterAll } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { server } from 'vitest/browser';
import SvarFeatureProbeHost from './SvarFeatureProbeHost.svelte';
import { PLAIN, BATTERY, type ProbeCase } from './fixtures';

interface Verdict {
  key: string;
  rendered: boolean;
  matchedHooks: string[];
  keywordMatches: string[];
  bars: number;
  /** All unique `wx-*` class tokens present — the actual DOM vocabulary SVAR drew. */
  wxClasses: string[];
  note: string;
}

const verdicts: Verdict[] = [];

async function mountCase(c: ProbeCase): Promise<HTMLElement> {
  const screen = render(SvarFeatureProbeHost, {
    props: { tasks: c.tasks, links: c.links ?? [], ...(c.props ?? {}) },
  });
  const container = screen.container as HTMLElement;
  await vi.waitFor(
    () => {
      const done = container.querySelector('.og-probe-host[data-render-complete="true"]');
      const failed = container.querySelector('.og-probe-host[data-render-failed]');
      if (failed) throw new Error(`probe host never settled for ${c.key}`);
      expect(done).not.toBeNull();
    },
    { timeout: 10000, interval: 50 },
  );
  return container;
}

/** Collect class names anywhere in the subtree that contain `keyword`. */
function keywordScan(container: HTMLElement, keyword: string): string[] {
  const hits = new Set<string>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (cls.toLowerCase().includes(keyword.toLowerCase())) {
      for (const token of cls.split(/\s+/)) {
        if (token.toLowerCase().includes(keyword.toLowerCase())) hits.add(token);
      }
    }
  }
  return Array.from(hits);
}

function allWxClasses(container: HTMLElement): string[] {
  const set = new Set<string>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
    const cls = typeof el.className === 'string' ? el.className : '';
    for (const token of cls.split(/\s+/)) {
      if (token.startsWith('wx-')) set.add(token);
    }
  }
  return Array.from(set).sort();
}

function recordVerdict(container: HTMLElement, c: ProbeCase): Verdict {
  const matchedHooks = c.hooks.filter((sel) => container.querySelector(sel) !== null);
  const keywordMatches = c.classKeyword ? keywordScan(container, c.classKeyword) : [];
  const bars = container.querySelectorAll('.wx-bar').length;
  const rendered = matchedHooks.length > 0;
  const v: Verdict = {
    key: c.key,
    rendered,
    matchedHooks,
    keywordMatches,
    bars,
    wxClasses: allWxClasses(container),
    note: rendered
      ? `rendered — hooks: ${matchedHooks.join(', ')}`
      : keywordMatches.length
        ? `no documented hook, but class scan found: ${keywordMatches.join(', ')}`
        : 'no documented hook and no keyword match',
  };
  // eslint-disable-next-line no-console
  console.log(`[PROBE] ${c.key}: rendered=${rendered} bars=${bars} ${v.note}`);
  verdicts.push(v);
  return v;
}

test('HARNESS SANITY: a plain task renders a bar (hard gate)', async () => {
  const container = await mountCase(PLAIN);
  expect(container.querySelectorAll('.wx-bar').length).toBeGreaterThan(0);
});

test('NEGATIVE CONTROL: a plain task shows no segment/marker hooks (hard gate)', async () => {
  const container = await mountCase(PLAIN);
  expect(container.querySelector('.wx-segment')).toBeNull();
  expect(container.querySelector('.wx-marker')).toBeNull();
});

// Soft-recorded per-feature verdicts. Absence is DATA — these do not fail the
// suite when a feature does not render.
for (const c of BATTERY) {
  test(`RECORD: ${c.key}`, async () => {
    const container = await mountCase(c);
    const v = recordVerdict(container, c);
    // The only assertion is that the harness itself worked (a bar drew); the
    // feature verdict is recorded, never asserted.
    expect(v.bars).toBeGreaterThan(0);
  });
}

afterAll(async () => {
  const summary = {
    generatedAt: '__set-by-reader__',
    svar: '@svar-ui/svelte-gantt (bundled build)',
    verdicts,
  };
  try {
    await server.commands.writeFile(
      'test/probe/.results/verdicts.json',
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  } catch {
    /* results persistence is best-effort; the console [PROBE] lines are the record */
  }
});
