#!/usr/bin/env node

/**
 * Flatten Features Directory Structure
 * 
 * Moves all .feature files from subdirectories to features/ root.
 * This is required because AssertThat cannot organize files in folders.
 * 
 * Usage: node scripts/flatten-features.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const featuresDir = path.join(rootDir, 'features');

/**
 * Find all .feature files recursively
 */
async function findFeatureFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      // Skip if it's the features root directory
      if (fullPath !== featuresDir) {
        const subFiles = await findFeatureFiles(fullPath);
        files.push(...subFiles);
      }
    } else if (entry.isFile() && entry.name.endsWith('.feature')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Generate a flat filename from the original path
 * 
 * Examples:
 * - features/bdd-framework/framework-validation.feature -> framework-validation.feature
 * - features/gantt-visualization/task-rendering.feature -> task-rendering.feature
 */
function generateFlatFilename(filePath) {
  const relativePath = path.relative(featuresDir, filePath);
  const parts = relativePath.split(path.sep);
  
  // If already in root, keep the name
  if (parts.length === 1) {
    return parts[0];
  }
  
  // Use the original filename (last part)
  return parts[parts.length - 1];
}

/**
 * Check for filename conflicts
 */
function checkConflicts(files) {
  const flatNames = new Map();
  const conflicts = [];

  for (const file of files) {
    const flatName = generateFlatFilename(file);
    
    if (flatNames.has(flatName)) {
      conflicts.push({
        name: flatName,
        files: [flatNames.get(flatName), file],
      });
    } else {
      flatNames.set(flatName, file);
    }
  }

  return conflicts;
}

/**
 * Move feature files to root
 */
async function flattenFeatures() {
  console.log('🔍 Finding all feature files...\n');
  
  const allFiles = await findFeatureFiles(featuresDir);
  const filesToMove = allFiles.filter(file => {
    const relativePath = path.relative(featuresDir, file);
    return relativePath.includes(path.sep); // Only files in subdirectories
  });

  console.log(`📊 Found ${allFiles.length} total feature files`);
  console.log(`📦 ${filesToMove.length} files need to be moved\n`);

  if (filesToMove.length === 0) {
    console.log('✅ All feature files are already in the root directory!');
    return;
  }

  // Check for conflicts
  console.log('🔍 Checking for filename conflicts...\n');
  const conflicts = checkConflicts(filesToMove);
  
  if (conflicts.length > 0) {
    console.error('❌ Filename conflicts detected:\n');
    for (const conflict of conflicts) {
      console.error(`   ${conflict.name}:`);
      for (const file of conflict.files) {
        console.error(`      - ${path.relative(rootDir, file)}`);
      }
    }
    console.error('\n⚠️  Please resolve conflicts manually before flattening.');
    process.exit(1);
  }

  console.log('✅ No conflicts detected\n');

  // Move files
  console.log('📁 Moving files to features/ root...\n');
  
  const moves = [];
  for (const file of filesToMove) {
    const flatName = generateFlatFilename(file);
    const newPath = path.join(featuresDir, flatName);
    
    moves.push({
      from: file,
      to: newPath,
      fromRelative: path.relative(rootDir, file),
      toRelative: path.relative(rootDir, newPath),
    });
  }

  // Show what will be moved
  console.log('📋 Files to move:');
  for (const move of moves) {
    console.log(`   ${move.fromRelative} -> ${move.toRelative}`);
  }
  console.log('');

  // Perform moves
  for (const move of moves) {
    await fs.rename(move.from, move.to);
    console.log(`✅ Moved: ${move.toRelative}`);
  }

  console.log('');

  // Remove empty directories
  console.log('🧹 Removing empty subdirectories...\n');
  
  const subdirs = await fs.readdir(featuresDir, { withFileTypes: true });
  for (const entry of subdirs) {
    if (entry.isDirectory()) {
      const dirPath = path.join(featuresDir, entry.name);
      try {
        const contents = await fs.readdir(dirPath);
        if (contents.length === 0) {
          await fs.rmdir(dirPath);
          console.log(`✅ Removed: features/${entry.name}/`);
        } else {
          console.log(`⚠️  Not empty: features/${entry.name}/ (${contents.length} items)`);
        }
      } catch (error) {
        console.error(`❌ Error checking ${entry.name}: ${error.message}`);
      }
    }
  }

  console.log('\n✅ Flattening complete!');
  console.log('\n📝 Next steps:');
  console.log('   1. Review the changes: git status');
  console.log('   2. Update features/README.md if needed');
  console.log('   3. Commit the changes: git add features/ && git commit -m "OG-26 refactor: Flatten features directory structure"');
  console.log('   4. Run initial ID assignment: node scripts/assign-assertthat-ids.mjs');
}

// Run
flattenFeatures().catch(error => {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});

