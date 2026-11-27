/**
 * The committed pin pairs a TaskNotes release with the model version it ships.
 * Both WDIO configs read it with fs. The setup check compares the pin with
 * that release's own package.json on GitHub.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface TaskNotesPin {
  tasknotesVersion: string;
  modelVersion: string;
}

interface TaskNotesPackage {
  dependencies?: Record<string, string>;
}

export function readTaskNotesPin(configDir: string): TaskNotesPin {
  const pinPath = path.join(configDir, 'tasknotes-pin.json');
  const raw: unknown = JSON.parse(fs.readFileSync(pinPath, 'utf8'));
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('tasknotesVersion' in raw) ||
    typeof raw.tasknotesVersion !== 'string' ||
    raw.tasknotesVersion.length === 0 ||
    !('modelVersion' in raw) ||
    typeof raw.modelVersion !== 'string' ||
    raw.modelVersion.length === 0 ||
    raw.modelVersion.startsWith('^')
  ) {
    throw new Error(`${pinPath} must name a TaskNotes release and an exact model version`);
  }
  return { tasknotesVersion: raw.tasknotesVersion, modelVersion: raw.modelVersion };
}

export async function assertPinnedModelMatchesTaskNotesRelease(configDir: string): Promise<void> {
  const pin = readTaskNotesPin(configDir);
  const url = `https://raw.githubusercontent.com/callumalpass/tasknotes/${pin.tasknotesVersion}/package.json`;
  const response = await globalThis.fetch(url);
  if (!response.ok) {
    throw new Error(`TaskNotes ${pin.tasknotesVersion} package.json returned ${response.status}`);
  }
  const packaged = (await response.json()) as TaskNotesPackage;
  const declared = packaged.dependencies?.['@tasknotes/model'];
  if (declared !== pin.modelVersion) {
    throw new Error(
      `pin model ${pin.modelVersion} does not match TaskNotes ${pin.tasknotesVersion} dependency ${declared}`,
    );
  }
}
