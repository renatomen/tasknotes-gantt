import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const jest = fileURLToPath(new URL('../node_modules/jest/bin/jest.js', import.meta.url));

for (const timezone of ['America/Los_Angeles', 'UTC', 'Pacific/Auckland']) {
  console.log(`\nTimezone contract: ${timezone}`);
  const result = spawnSync(process.execPath, [
    jest, '--runInBand', '--testMatch', '**/*.timezone.test.ts',
  ], {
    cwd: root,
    env: { ...process.env, TZ: timezone },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
