import { expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const RENDERER_ACTION_HELPERS = [
  'clickRendererAction',
  'clickFullscreenToggle',
] as const;
const LAYOUT_READ_METHODS = new Set([
  'elementFromPoint',
  'getBoundingClientRect',
]);

interface LayoutRead {
  helper: string;
  method: string;
}

function calledMethod(node: ts.Node): string | null {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return null;
  }
  return node.expression.name.text;
}

function inspectRendererActionPreludes(source: string): {
  helpersFound: string[];
  layoutReads: LayoutRead[];
} {
  const sourceFile = ts.createSourceFile(
    'gantt-legend.e2e.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const reads: LayoutRead[] = [];
  const helpersFound: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      !ts.isFunctionDeclaration(node) ||
      !node.name ||
      !node.body ||
      !RENDERER_ACTION_HELPERS.includes(node.name.text as typeof RENDERER_ACTION_HELPERS[number])
    ) {
      ts.forEachChild(node, visit);
      return;
    }
    helpersFound.push(node.name.text);

    let clickPosition = Number.POSITIVE_INFINITY;
    const calls: ts.CallExpression[] = [];
    const collectCalls = (child: ts.Node): void => {
      if (ts.isCallExpression(child)) calls.push(child);
      ts.forEachChild(child, collectCalls);
    };
    collectCalls(node.body);

    for (const call of calls) {
      if (calledMethod(call) === 'click') {
        clickPosition = Math.min(clickPosition, call.getStart(sourceFile));
      }
    }
    for (const call of calls) {
      const method = calledMethod(call);
      if (
        method &&
        LAYOUT_READ_METHODS.has(method) &&
        call.getStart(sourceFile) < clickPosition
      ) {
        reads.push({ helper: node.name.text, method });
      }
    }
  };

  visit(sourceFile);
  return { helpersFound, layoutReads: reads };
}

it('keeps renderer action helpers free of layout reads before click dispatch', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'test/specs/gantt-legend.e2e.ts'),
    'utf8',
  );

  expect(inspectRendererActionPreludes(source)).toEqual({
    helpersFound: [...RENDERER_ACTION_HELPERS],
    layoutReads: [],
  });
});

it('detects discarded layout reads before renderer click dispatch', () => {
  const mutatedSource = `
    async function clickRendererAction(target: HTMLElement): Promise<void> {
      target.getBoundingClientRect();
      document.elementFromPoint(0, 0);
      target.click();
    }
  `;

  expect(inspectRendererActionPreludes(mutatedSource)).toEqual({
    helpersFound: ['clickRendererAction'],
    layoutReads: [
      { helper: 'clickRendererAction', method: 'getBoundingClientRect' },
      { helper: 'clickRendererAction', method: 'elementFromPoint' },
    ],
  });
});
