/**
 * The installed model package and the e2e pin name the same exact version.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';

function readJson(path: string): { dependencies?: Record<string, string>; modelVersion?: string } {
  return JSON.parse(readFileSync(path, 'utf8')) as {
    dependencies?: Record<string, string>;
    modelVersion?: string;
  };
}

describe('TaskNotes model pin', () => {
  it('requires package.json to depend on exactly the pin model version', () => {
    const pin = readJson('test/wdio/tasknotes-pin.json');
    const pkg = readJson('package.json');
    const declared = pkg.dependencies?.['@tasknotes/model'];

    expect(declared).toBe(pin.modelVersion);
    expect(declared?.startsWith('^')).toBe(false);
  });
});
