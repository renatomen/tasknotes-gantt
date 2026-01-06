'use strict';
require('dotenv').config();
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Platform-aware default vault path
const DEFAULT_VAULT = process.platform === 'win32'
  ? 'C:\\Users\\renat\\OneDrive\\@-Notes\\Vaults\\obsidian-gantt'
  : path.join(process.env.HOME || '/home/renato', 'obsidian-test-vaults/obsidian-gantt-test-vault');

const vaultPath = process.env.OBSIDIAN_TEST_VAULT || DEFAULT_VAULT;
const pluginId = 'obsidian-gantt';
const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', pluginId);

(async () => {
  try {
    await fsp.mkdir(pluginDir, { recursive: true });

    const files = ['manifest.json', 'main.js', 'styles.css'];
    for (const file of files) {
      const src = path.join('dist', file);
      const dest = path.join(pluginDir, file);
      if (fs.existsSync(src)) {
        await fsp.copyFile(src, dest);
        console.log(`[install] Copied ${src} -> ${dest}`);
      } else {
        console.warn(`[install] Missing ${src}, skipped`);
      }
    }

    // Ensure data.json exists; do not overwrite if present
    const dataPath = path.join(pluginDir, 'data.json');
    if (!fs.existsSync(dataPath)) {
      await fsp.writeFile(dataPath, '{}', 'utf8');
      console.log(`[install] Created ${dataPath}`);
    } else {
      console.log('[install] data.json already exists; not overwriting');
    }

    console.log(`[install] Installed plugin to ${pluginDir}`);
  } catch (err) {
    console.error('[install] Failed:', err);
    process.exit(1);
  }
})();
