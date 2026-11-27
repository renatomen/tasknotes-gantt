export function readTaskNotesPin(configDir: string): {
  tasknotesVersion: string;
  modelVersion: string;
};

export function assertPinnedModelMatchesTaskNotesRelease(configDir: string): Promise<void>;
