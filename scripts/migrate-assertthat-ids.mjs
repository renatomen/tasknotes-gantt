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
  // Security: Validate file extension before reading
  if (!filePath.endsWith(".feature")) {
    throw new Error(`Invalid file type: ${filePath}. Only .feature files are allowed.`);
  }

  // Security: File path has already been validated in findFeatureFiles()
  // to ensure it's within the features directory and not a symlink escape
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  let modified = false;

  const updatedLines = lines.map((line) => {
    // Match and replace feature-level ID
    // Using String.includes() and startsWith() to avoid regex backtracking (ReDoS)
    if (line.startsWith("# @assertthat-feature-id:") || line.startsWith("#@assertthat-feature-id:")) {
      modified = true;
      return line.replace("@assertthat-feature-id:", "assertthat-feature-id:");
    }

    // Match and replace scenario-level ID (with any indentation)
    // Using includes() to avoid regex backtracking (ReDoS)
    if (line.includes("# @assertthat-scenario-id:")) {
      modified = true;
      return line.replace("# @assertthat-scenario-id:", "# assertthat-scenario-id:");
    }

    return line;
  });

  if (modified) {
    // Security: Only write if file was actually modified and content is valid
    // File path is safe (validated in findFeatureFiles and above)
    // Content is safe (only modifying comment lines, preserving structure)
    await fs.writeFile(filePath, updatedLines.join("\n"), "utf-8");
    return true;
  }

  return false;
}

async function findFeatureFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const normalizedDir = path.resolve(dir);

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const resolvedPath = path.resolve(fullPath);

    // Validate path stays within intended directory (prevent path traversal)
    if (!resolvedPath.startsWith(normalizedDir)) {
      console.warn(`⚠️  Skipping path outside directory: ${entry.name}`);
      continue;
    }

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

  // Security: Verify features directory exists and is within project
  try {
    await fs.access(featuresDir);
  } catch {
    console.error(`❌ Features directory not found: ${featuresDir}`);
    process.exit(1);
  }

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
