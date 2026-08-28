/**
 * Structural guard for the diff-sync reactive contract: the sync $effect stays
 * a guard plus a single orchestrator call with direct dependency-establishing
 * reads, and the orchestrator access literal stays a live bridge of bare
 * accessors over same-named component bindings. Svelte's tracking of
 * synchronous transitive reads is framework behavior the repo rests on; what
 * can silently drift is the component's side of that contract — a cached
 * accessor, a snapshotted read, or sync logic re-inlined beside the effect.
 * These pins fail red on that drift even when every runtime test still passes.
 *
 * The component has TWO access literals (`interceptorAccess` is the other),
 * so every assertion here targets `syncOrchestratorAccess` by name and scopes
 * to its extracted source block.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const viewSource = readFileSync(
  resolve(process.cwd(), 'src', 'bases', 'GanttContainer.svelte'),
  'utf8',
);

/** Every member the sync orchestrator reads through the live-access bridge. */
const ACCESS_GET_CENSUS = [
  'syncing',
  'ephemeralSort',
  'api',
  'columns',
  'initialTasks',
  'initialLinks',
  'collapsedIds',
] as const;

/** The members the orchestrator also writes back through the bridge. */
const ACCESS_SET_CENSUS = [
  'syncing',
  'ephemeralSort',
  'columns',
  'initialTasks',
  'initialLinks',
] as const;

const SYNC_CALL = 'syncOrchestrator.syncToGantt(';

/**
 * The moved sync-coordination implementation names: none may be (re)defined in
 * the view, and the collaborators only the module drives may not be imported
 * back into it.
 */
const FORBIDDEN_DEFINITION = /function\s+(syncToGantt|planSyncFromData|applyBulkReseedIfNeeded|applyIncrementalSync|toInputs)\s*\(/;
const FORBIDDEN_COLLABORATORS = /\b(createSvarGanttAdapter|planGanttSync|isGanttSyncNoop|shouldBulkReseed|structuralOpCount|applyIncrementalGanttSync)\b/;

/** Slice the `syncOrchestratorAccess` literal's BODY (between its braces). */
function extractAccessLiteral(source: string): string {
  const declaration = source.indexOf('const syncOrchestratorAccess');
  if (declaration < 0) throw new Error('syncOrchestratorAccess literal not found in view source');
  const start = source.indexOf('= {', declaration);
  if (start < 0) throw new Error('syncOrchestratorAccess literal opener not found');
  const end = source.indexOf('\n  };', start);
  if (end < 0) throw new Error('syncOrchestratorAccess literal end not found');
  return source.slice(start + '= {'.length, end);
}

/** Slice the sync $effect block (its body) around the single orchestrator call. */
function extractSyncEffectBody(source: string): string {
  const callAt = source.indexOf(SYNC_CALL);
  if (callAt < 0) throw new Error('sync orchestrator call not found in view source');
  const opener = '$effect(() => {';
  const start = source.lastIndexOf(opener, callAt);
  if (start < 0) throw new Error('enclosing $effect opener not found before the sync call');
  const end = source.indexOf('});', callAt);
  if (end < 0) throw new Error('enclosing $effect closer not found after the sync call');
  return source.slice(start + opener.length, end);
}

/** The body's statements with comments and blank lines stripped. */
function statementLines(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
}

const countMatches = (source: string, needle: string): number =>
  source.split(needle).length - 1;

const bareGetter = (member: string): RegExp =>
  new RegExp(`get ${member}\\(\\)\\s*\\{\\s*return ${member};`);
const bareSetter = (member: string): RegExp =>
  new RegExp(`set ${member}\\(value\\)\\s*\\{\\s*${member} = value;`);

describe('sync effect source shape', () => {
  it('calls the orchestrator from exactly one site — the sync effect', () => {
    expect(countMatches(viewSource, SYNC_CALL)).toBe(1);
  });

  it('keeps the effect body a guard plus a single call with direct reads of the data store, the switcher revision, and the api', () => {
    const body = extractSyncEffectBody(viewSource);
    expect(statementLines(body)).toEqual([
      'const d = $data;',
      'void switcherRevision;',
      'if (!api) return;',
      'syncOrchestrator.syncToGantt(d);',
    ]);
  });

  it('defines none of the moved sync-coordination functions and imports none of the module-owned collaborators', () => {
    expect(FORBIDDEN_DEFINITION.test(viewSource)).toBe(false);
    expect(FORBIDDEN_COLLABORATORS.test(viewSource)).toBe(false);
  });

  it('the forbidden matchers catch a re-inlined sync function and a re-imported collaborator (mutation case)', () => {
    expect(FORBIDDEN_DEFINITION.test(`${viewSource}\nfunction syncToGantt(d) {}\n`)).toBe(true);
    expect(
      FORBIDDEN_COLLABORATORS.test(`${viewSource}\nconst port = createSvarGanttAdapter(api, {});\n`),
    ).toBe(true);
  });

  it('the single-call pin catches a second orchestrator call site (mutation case)', () => {
    const planted = `${viewSource}\nsyncOrchestrator.syncToGantt(d);\n`;
    expect(countMatches(planted, SYNC_CALL)).toBe(2);
  });
});

describe('sync orchestrator access literal source shape', () => {
  const accessLiteral = extractAccessLiteral(viewSource);

  it('exposes every census getter as a bare read of the same-named component binding', () => {
    for (const member of ACCESS_GET_CENSUS) {
      expect(accessLiteral).toMatch(bareGetter(member));
    }
  });

  it('exposes every census setter as a bare assignment to the same-named component binding', () => {
    for (const member of ACCESS_SET_CENSUS) {
      expect(accessLiteral).toMatch(bareSetter(member));
    }
  });

  it('carries exactly the census members — no extra accessors widen the read set', () => {
    expect(countMatches(accessLiteral, 'get ')).toBe(ACCESS_GET_CENSUS.length);
    expect(countMatches(accessLiteral, 'set ')).toBe(ACCESS_SET_CENSUS.length);
  });

  it('performs no value capture, caching, spread, or snapshotting', () => {
    expect(accessLiteral).not.toMatch(/\.\.\./);
    expect(accessLiteral).not.toMatch(/\$state\.snapshot/);
    expect(accessLiteral).not.toMatch(/\b(const|let)\s/);
    expect(accessLiteral).not.toMatch(/=>/);
  });

  it('is the literal the orchestrator factory receives, by name', () => {
    expect(viewSource).toMatch(/createGanttSyncOrchestrator\(\s*syncOrchestratorAccess,/);
  });

  it('the bare-accessor matcher catches a snapshotted getter (mutation case)', () => {
    const planted = accessLiteral.replace('return syncing;', 'return $state.snapshot(syncing);');
    expect(planted).not.toMatch(bareGetter('syncing'));
    expect(planted).toMatch(/\$state\.snapshot/);
  });

  it('the census count catches a widened read set (mutation case)', () => {
    const planted = accessLiteral.replace(
      'get syncing()',
      'get destroyed() {\n      return destroyed;\n    },\n    get syncing()',
    );
    expect(countMatches(planted, 'get ')).toBe(ACCESS_GET_CENSUS.length + 1);
  });
});
