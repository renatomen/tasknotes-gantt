#!/usr/bin/env node
/**
 * Automated Development Environment Setup Script
 * Sets up the complete development environment for obsidian-gantt
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const TEST_VAULT_PATH =
  "C:/Users/renato/obsidian-test-vaults/obsidian-gantt-test-vault";

console.log("🚀 Obsidian Gantt - Automated Environment Setup\n");

/**
 * Execute command with proper error handling and output
 */
function runCommand(command, description, options = {}) {
  console.log(`🔄 ${description}...`);
  try {
    execSync(command, {
      encoding: "utf8",
      stdio: "inherit",
      ...options,
    });
    console.log(`✅ ${description} completed\n`);
    return true;
  } catch (error) {
    console.log(`❌ ${description} failed:`, error.message);
    return false;
  }
}

/**
 * Create directory if it doesn't exist
 */
function ensureDirectory(dirPath, description) {
  console.log(`📁 ${description}...`);
  try {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
      console.log(`✅ Created: ${dirPath}\n`);
    } else {
      console.log(`✅ Already exists: ${dirPath}\n`);
    }
    return true;
  } catch (error) {
    console.log(`❌ Failed to create ${dirPath}:`, error.message);
    return false;
  }
}

/**
 * Main setup function
 */
async function setupEnvironment() {
  console.log("📋 Starting automated setup...\n");

  const steps = [
    {
      name: "Install Dependencies",
      action: () =>
        runCommand("npm ci", "Installing dependencies from package-lock.json"),
    },
    {
      name: "Setup Git Hooks",
      action: () => runCommand("npm run prepare", "Setting up Husky git hooks"),
    },
    {
      name: "Create Test Vault",
      action: () =>
        ensureDirectory(TEST_VAULT_PATH, "Creating test vault directory"),
    },
    {
      name: "Create Build Directory",
      action: () => ensureDirectory("dist", "Creating build output directory"),
    },
    {
      name: "TypeScript Check",
      action: () =>
        runCommand("npm run typecheck", "Running TypeScript type checking"),
    },
    {
      name: "Linting Check",
      action: () => runCommand("npm run lint", "Running ESLint"),
    },
    {
      name: "Build Plugin",
      action: () => runCommand("npm run build", "Building plugin"),
    },
    {
      name: "Run Tests",
      action: () => runCommand("npm test", "Running unit tests"),
    },
  ];

  let completed = 0;
  let failed = [];

  for (const step of steps) {
    console.log(`📦 Step ${completed + 1}/${steps.length}: ${step.name}`);

    if (step.action()) {
      completed++;
    } else {
      failed.push(step.name);
      console.log(`⚠️  Continuing with remaining steps...\n`);
    }
  }

  console.log("📊 Setup Summary:");
  console.log(`   ✅ Completed: ${completed}/${steps.length} steps`);

  if (failed.length > 0) {
    console.log(`   ❌ Failed: ${failed.join(", ")}`);
    console.log("\n⚠️  Some steps failed, but you can continue development.");
    console.log(
      "   Check the errors above and run individual commands as needed."
    );
  } else {
    console.log("\n🎉 Setup completed successfully!");
  }

  console.log("\n🚀 Development Commands:");
  console.log(
    "   npm run dev       # Start development mode (watch + auto-install)"
  );
  console.log("   npm run build     # Build for production");
  console.log("   npm run test      # Run unit tests");
  console.log("   npm run e2e:local # Run E2E tests (requires Obsidian)");
  console.log("   npm run lint      # Run linting");
  console.log("   npm run format    # Format code");

  console.log("\n📖 Documentation:");
  console.log("   project/repo-setup.md           # Complete setup guide");
  console.log("   project/PRD-svar-obsidian-gantt.md # Product requirements");

  return failed.length === 0;
}

// Run setup
setupEnvironment().catch(console.error);
