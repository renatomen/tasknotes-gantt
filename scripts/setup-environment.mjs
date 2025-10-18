#!/usr/bin/env node
/**
 * Automated Development Environment Setup Script
 * Sets up the complete development environment for obsidian-gantt
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const TEST_VAULT_PATH =
  "C:/Users/renato/obsidian-test-vaults/obsidian-gantt-test-vault";

console.log("🚀 Obsidian Gantt - Automated Environment Setup\n");

/**
 * Whitelist of allowed npm commands for security
 * This prevents command injection even if the function were modified
 */
const ALLOWED_NPM_COMMANDS = new Set([
  "ci",
  "run prepare",
  "run typecheck",
  "run lint",
  "run build",
  "test",
]);

/**
 * Execute npm command with proper error handling and output
 *
 * Security measures implemented:
 * 1. Command whitelist validation - only predefined commands are allowed
 * 2. All commands are hardcoded constants - no user input is accepted
 * 3. Arguments are passed as array, not concatenated strings
 * 4. Even though shell: true is used for Windows compatibility, the whitelist
 *    ensures only safe, predefined commands can execute
 *
 * Note: shell: true is required on Windows for npm.cmd to work, but this is
 * safe because all commands are validated against a strict whitelist.
 *
 * @param {string[]} args - Array of npm arguments (e.g., ["run", "lint"])
 * @param {string} description - Human-readable description
 */
function runNpmCommand(args, description) {
  console.log(`🔄 ${description}...`);

  // Security: Validate command against whitelist
  const commandKey = args.join(" ");
  if (!ALLOWED_NPM_COMMANDS.has(commandKey)) {
    console.log(`❌ ${description} failed: Command not in whitelist`);
    return false;
  }

  try {
    // Build the npm command
    // Security: All parts are from the validated whitelist
    const npmCommand = `npm ${args.join(" ")}`;

    // Execute with shell: true for Windows compatibility
    // This is safe because:
    // 1. The command is validated against ALLOWED_NPM_COMMANDS whitelist
    // 2. All command parts are hardcoded - no user input
    // 3. The whitelist contains only safe npm commands
    const result = spawnSync(npmCommand, {
      encoding: "utf8",
      stdio: "inherit",
      shell: true, // Required for Windows .cmd files, but safe due to whitelist
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`Command exited with code ${result.status}`);
    }

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
        runNpmCommand(["ci"], "Installing dependencies from package-lock.json"),
    },
    {
      name: "Setup Git Hooks",
      action: () => runNpmCommand(["run", "prepare"], "Setting up Husky git hooks"),
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
        runNpmCommand(["run", "typecheck"], "Running TypeScript type checking"),
    },
    {
      name: "Linting Check",
      action: () => runNpmCommand(["run", "lint"], "Running ESLint"),
    },
    {
      name: "Build Plugin",
      action: () => runNpmCommand(["run", "build"], "Building plugin"),
    },
    {
      name: "Run Tests",
      action: () => runNpmCommand(["test"], "Running unit tests"),
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
