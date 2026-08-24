/**
 * Structural guard: the lifecycle-diagnostics implementation lives in the seam
 * module, and the two junction files keep only call hooks — the accessor
 * literal, the listener-attach effect, and the mount-capture properties. A
 * regression that re-inlines diagnostics (or snapshots the live bindings)
 * must fail here even when every runtime test still passes.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const viewSource = readFileSync(
  resolve(process.cwd(), 'src', 'bases', 'GanttContainer.svelte'),
  'utf8',
);
const registerSource = readFileSync(
  resolve(process.cwd(), 'src', 'bases', 'register.ts'),
  'utf8',
);

/**
 * Diagnostics-implementation names that must never reappear in a junction
 * file: the debug-log module's lifecycle surface (beyond the logging
 * allowlist) and its sink global. The seam module is their only importer.
 */
const FORBIDDEN_IMPLEMENTATION_TOKENS = new RegExp(
  String.raw`\b(captureGanttLifecycle|classifyViewportSettlement` +
    String.raw`|currentGanttLifecycleCaptureGeneration|currentGanttLifecyclePhase` +
    String.raw`|isGanttLifecycleCaptureActive|renderedScaleCellIdentity` +
    String.raw`|ganttLifecycleErrorFacts|createGanttLifecycleCollector` +
    String.raw`|ganttLifecycleControl)\b|__tnGanttLifecycle`,
);

// Scoped to the diagnostic capture family: product code may legitimately name
// a function `capture*` (e.g. the drag planner's `captureBarBefore`).
const CAPTURE_FUNCTION_DEFINITION =
  /function\s+capture(Lifecycle|Viewport|Mount|Undelivered|Gantt)\w*\s*\(/;
const DIAGNOSTIC_INTERFACE_DEFINITION = /interface\s+Diagnostic\w*/;

/**
 * Every member the seam reads through the view's live-access bridge. A getter
 * must return the same-named component binding — a snapshot or a renamed
 * source would keep the shape while killing liveness.
 */
const VIEW_ACCESS_CENSUS = [
  'hostGeneration',
  'destroyed',
  'api',
  'rootEl',
  'controllerGeneration',
  'treatmentScopeClass',
  'mountToken',
  'legendSession',
  'isMaximized',
] as const;

/**
 * Named hook-site budgets: every call on the seam object in the view
 * (the listener-attach effect's `attachRoot` included), and the two
 * mount-capture properties' call sites in the registration.
 */
const VIEW_HOOK_SITE_COUNT = 17;
const REGISTER_HOOK_SITE_COUNT = 8;

const countMatches = (source: string, matcher: RegExp): number =>
  [...source.matchAll(matcher)].length;

describe('lifecycle-diagnostics seam structure', () => {
  it('junction files carry none of the diagnostics implementation tokens', () => {
    expect(FORBIDDEN_IMPLEMENTATION_TOKENS.test(viewSource)).toBe(false);
    expect(FORBIDDEN_IMPLEMENTATION_TOKENS.test(registerSource)).toBe(false);
  });

  it('the forbidden-token matcher catches a re-inlined capture call (mutation case)', () => {
    const planted = `${viewSource}\ncaptureGanttLifecycle({ event: 'planted' });\n`;
    expect(FORBIDDEN_IMPLEMENTATION_TOKENS.test(planted)).toBe(true);
    const plantedGlobal = `${registerSource}\nconst sink = '__tnGanttLifecycle';\nvoid sink;\n`;
    expect(FORBIDDEN_IMPLEMENTATION_TOKENS.test(plantedGlobal)).toBe(true);
  });

  it('junction files define no capture functions and no diagnostic view-state interfaces', () => {
    for (const source of [viewSource, registerSource]) {
      expect(CAPTURE_FUNCTION_DEFINITION.test(source)).toBe(false);
      expect(DIAGNOSTIC_INTERFACE_DEFINITION.test(source)).toBe(false);
    }
  });

  it('the view builds the seam from a live accessor literal whose getters return same-named bindings', () => {
    expect(viewSource).toContain('const lifecycleDiagnostics = createGanttLifecycleDiagnostics({');
    for (const member of VIEW_ACCESS_CENSUS) {
      expect(viewSource).toMatch(
        new RegExp(`get ${member}\\(\\)\\s*\\{\\s*return ${member};`),
      );
    }
    // A spread would snapshot the members and kill liveness.
    expect(viewSource).not.toMatch(/createGanttLifecycleDiagnostics\(\s*\{\s*\.\.\./);
  });

  it('the view keeps exactly the budgeted hook sites, the attachRoot effect included', () => {
    expect(countMatches(viewSource, /\blifecycleDiagnostics\.\w+\(/g)).toBe(VIEW_HOOK_SITE_COUNT);
    // The attach call must live inside a $effect rune: a bare arrow expression
    // holding the same call parses, lints, and typechecks — and never runs.
    expect(viewSource).toMatch(
      /\$effect\(\(\) => \{\s*const root = rootEl;\s*if \(!root\) return;\s*return lifecycleDiagnostics\.attachRoot\(root\);\s*\}\);/,
    );
  });

  it('the registration keeps exactly the budgeted mount-capture call sites', () => {
    expect(
      countMatches(registerSource, /this\.captureMountLifecycle(?:Error)?\(/g),
    ).toBe(REGISTER_HOOK_SITE_COUNT);
  });

  it('junction files import from the debug-log module only the logging allowlist', () => {
    const debugLogImport = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]*debugLog['"]/g;
    const importedNames = (source: string): string[] =>
      [...source.matchAll(debugLogImport)].flatMap((match) =>
        match[1]
          .split(',')
          .map((name) => name.trim().replace(/^type\s+/, ''))
          .filter((name) => name.length > 0),
      );
    expect(importedNames(viewSource)).toEqual(['dlog']);
    expect(importedNames(registerSource).sort()).toEqual(['dlog', 'isGanttDebugEnabled']);
  });

  it('junction files reach the seam module only through its factory exports', () => {
    expect(viewSource).toMatch(
      /import\s*\{\s*createGanttLifecycleDiagnostics\s*\}\s*from\s*['"]\.\/ganttLifecycleDiagnostics['"]/,
    );
    expect(registerSource).toMatch(
      /import\s*\{\s*createMountLifecycleCapture\s*\}\s*from\s*['"]\.\/ganttLifecycleDiagnostics['"]/,
    );
  });
});
