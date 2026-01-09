#!/usr/bin/env node

/**
 * Migration script: Remove @ prefix from assertthat ID comments
 * Changes format from:
 *   # @assertthat-feature-id: abc
 *   # @assertthat-scenario-id: xyz
 * To:
 *   # assertthat-feature-id: abc
 *   # assertthat-scenario-id: xyz
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrateFeatureFile(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  let modified = false;

  const updatedLines = lines.map((line) => {
    // Match and replace feature-level ID
    if (line.match(/^#\s*@assertthat-feature-id:\s*(.+)$/)) {
      modified = true;
      return line.replace(/^#\s*@assertthat-feature-id:/, "# assertthat-feature-id:");
    }

    // Match and replace scenario-level ID (with any indentation)
    if (line.match(/^(\s*)#\s*@assertthat-scenario-id:\s*(.+)$/)) {
      modified = true;
      return line.replace(/^(\s*)#\s*@assertthat-scenario-id:/, "$1# assertthat-scenario-id:");
    }

    return line;
  });

  if (modified) {
    await fs.writeFile(filePath, updatedLines.join("\n"), "utf-8");
    return true;
  }

  return false;
}

async function findFeatureFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findFeatureFiles(fullPath)));
    } else if (entry.name.endsWith(".feature")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const featuresDir = path.resolve(__dirname, "../features");

  console.log("🔄 Migrating assertthat ID format in feature files...\n");

  const featureFiles = await findFeatureFiles(featuresDir);
  console.log(`📋 Found ${featureFiles.length} feature file(s)\n`);

  let migratedCount = 0;

  for (const filePath of featureFiles) {
    const relativePath = path.relative(process.cwd(), filePath);
    const wasModified = await migrateFeatureFile(filePath);

    if (wasModified) {
      console.log(`✅ ${relativePath}`);
      migratedCount++;
    } else {
      console.log(`⏭️  ${relativePath} (no changes needed)`);
    }
  }

  console.log(`\n🎉 Migration complete: ${migratedCount}/${featureFiles.length} files updated`);
}

main().catch((error) => {
  console.error("❌ Migration failed:", error);
  process.exit(1);
});
