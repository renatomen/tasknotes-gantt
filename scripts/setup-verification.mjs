#!/usr/bin/env node
/**
 * Development Environment Setup Verification Script
 * Verifies that all required tools and dependencies are properly installed
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const REQUIRED_NODE_VERSION = 18;
const TEST_VAULT_PATH =
  "C:/Users/renato/obsidian-test-vaults/obsidian-gantt-test-vault";

console.log("🔧 Obsidian Gantt - Development Environment Verification\n");

/**
 * Check if a command exists and is accessible
 */
function checkCommand(command, description) {
  try {
    const result = execSync(command, { encoding: "utf8", stdio: "pipe" });
    console.log(`✅ ${description}: ${result.trim()}`);
    return true;
  } catch (error) {
    console.log(`❌ ${description}: Not found or error`);
    return false;
  }
}

/**
 * Check Node.js version meets requirements
 */
function checkNodeVersion() {
  try {
    const version = execSync("node --version", { encoding: "utf8" }).trim();
    const majorVersion = parseInt(version.replace("v", "").split(".")[0]);

    if (majorVersion >= REQUIRED_NODE_VERSION) {
      console.log(
        `✅ Node.js version: ${version} (>= ${REQUIRED_NODE_VERSION} required)`
      );
      return true;
    } else {
      console.log(
        `❌ Node.js version: ${version} (>= ${REQUIRED_NODE_VERSION} required)`
      );
      return false;
    }
  } catch (error) {
    console.log(`❌ Node.js: Not found`);
    return false;
  }
}

/**
 * Check if directory exists or can be created
 */
function checkDirectory(dirPath, description) {
  try {
    if (existsSync(dirPath)) {
      console.log(`✅ ${description}: ${dirPath} (exists)`);
      return true;
    } else {
      mkdirSync(dirPath, { recursive: true });
      console.log(`✅ ${description}: ${dirPath} (created)`);
      return true;
    }
  } catch (error) {
    console.log(`❌ ${description}: ${dirPath} (cannot create)`);
    return false;
  }
}

/**
 * Check if package.json dependencies are installed
 */
function checkDependencies() {
  try {
    if (!existsSync("node_modules")) {
      console.log(`❌ Dependencies: node_modules not found - run 'npm ci'`);
      return false;
    }

    // Check for key dependencies
    const keyDeps = [
      "node_modules/@svar-ui/svelte-gantt",
      "node_modules/svelte",
      "node_modules/vite",
      "node_modules/typescript",
    ];

    const missing = keyDeps.filter((dep) => !existsSync(dep));
    if (missing.length > 0) {
      console.log(
        `❌ Dependencies: Missing ${missing.length} key dependencies`
      );
      return false;
    }

    console.log(`✅ Dependencies: All key dependencies installed`);
    return true;
  } catch (error) {
    console.log(`❌ Dependencies: Error checking dependencies`);
    return false;
  }
}

/**
 * Main verification function
 */
async function verifySetup() {
  console.log("📋 Checking Prerequisites...\n");

  const checks = [
    () => checkNodeVersion(),
    () => checkCommand("npm --version", "npm"),
    () => checkCommand("git --version", "Git"),
    () => checkDirectory(TEST_VAULT_PATH, "Test Vault Directory"),
    () => checkDirectory("dist", "Build Output Directory"),
    () => checkDependencies(),
  ];

  const results = checks.map((check) => check());
  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log(`\n📊 Verification Results: ${passed}/${total} checks passed\n`);

  if (passed === total) {
    console.log("🎉 All checks passed! Your development environment is ready.");
    console.log("\n🚀 Next steps:");
    console.log("   npm run build     # Build the plugin");
    console.log("   npm run test      # Run tests");
    console.log("   npm run dev       # Start development mode");
  } else {
    console.log("⚠️  Some checks failed. Please address the issues above.");
    console.log("\n📖 Setup Guide: project/repo-setup.md");
  }

  return passed === total;
}

// Run verification
verifySetup().catch(console.error);
