/**
 * User Interaction - Focused on user prompts and interaction only
 * Extracted from oversized ConflictResolver class (312 lines → ~100 lines)
 */

import { syncEvents, SYNC_EVENTS } from "../events/SyncEvents.mjs";

export class UserInteraction {
  constructor(readline = null) {
    this.readline = readline;
    this.responses = new Map(); // Cache user responses for similar conflicts
  }

  /**
   * Initialize readline interface
   */
  async initializeReadline() {
    if (!this.readline) {
      const readlineModule = await import("readline");
      this.readline = readlineModule.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }
    return this.readline;
  }

  /**
   * Prompt user for conflict resolution choice
   */
  async promptForConflictResolution(
    filename,
    githubFile,
    assertThatFile,
    diffOutput
  ) {
    try {
      syncEvents.emit(SYNC_EVENTS.USER_PROMPT_STARTED, {
        filename,
        type: "conflict-resolution",
      });

      // Check if user has already made a similar choice
      const cachedChoice = this.getCachedChoice(filename, diffOutput);
      if (cachedChoice) {
        console.log(
          `\n🔄 Using previous choice for similar conflict: ${cachedChoice}`
        );
        return cachedChoice;
      }

      await this.initializeReadline();

      // Display conflict information
      this.displayConflictInfo(
        filename,
        githubFile,
        assertThatFile,
        diffOutput
      );

      // Get user choice
      const choice = await this.getUserChoice(filename);

      // Cache the choice for similar conflicts
      this.cacheChoice(filename, diffOutput, choice);

      syncEvents.emit(SYNC_EVENTS.USER_CHOICE_MADE, {
        filename,
        choice,
        timestamp: new Date().toISOString(),
      });

      return choice;
    } catch (error) {
      syncEvents.emit(SYNC_EVENTS.USER_INTERACTION_CANCELLED, {
        filename,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Display conflict information to user
   */
  displayConflictInfo(filename, githubFile, assertThatFile, diffOutput) {
    console.log("\n" + "=".repeat(80));
    console.log(`🔥 CONFLICT DETECTED: ${filename}`);
    console.log("=".repeat(80));

    console.log("\n📊 Conflict Summary:");
    console.log(`   GitHub File:    ${githubFile}`);
    console.log(`   AssertThat File: ${assertThatFile}`);

    // Show diff summary
    const diffLines = diffOutput.split("\n");
    const addedLines = diffLines.filter((line) => line.startsWith("+")).length;
    const removedLines = diffLines.filter((line) =>
      line.startsWith("-")
    ).length;

    console.log(`   Lines Added:    ${addedLines}`);
    console.log(`   Lines Removed:  ${removedLines}`);

    // Show first few lines of diff
    console.log("\n📝 Diff Preview:");
    console.log("-".repeat(60));
    const previewLines = diffLines.slice(0, 20);
    previewLines.forEach((line) => {
      if (line.startsWith("+")) {
        console.log(`\x1b[32m${line}\x1b[0m`); // Green for additions
      } else if (line.startsWith("-")) {
        console.log(`\x1b[31m${line}\x1b[0m`); // Red for deletions
      } else {
        console.log(line);
      }
    });

    if (diffLines.length > 20) {
      console.log(`... (${diffLines.length - 20} more lines)`);
    }
    console.log("-".repeat(60));
  }

  /**
   * Get user choice for conflict resolution
   */
  async getUserChoice(filename) {
    const choices = [
      { key: "g", label: "Use GitHub version", value: "github" },
      { key: "a", label: "Use AssertThat version", value: "assertthat" },
      {
        key: "m",
        label: "Manual resolution (create conflict markers)",
        value: "manual",
      },
      { key: "s", label: "Skip this file", value: "skip" },
      { key: "d", label: "Show detailed diff", value: "diff" },
      { key: "q", label: "Quit sync process", value: "quit" },
    ];

    while (true) {
      console.log("\n🤔 How would you like to resolve this conflict?");
      choices.forEach((choice) => {
        console.log(`   [${choice.key}] ${choice.label}`);
      });

      const answer = await this.askQuestion("\nYour choice: ");
      const choice = choices.find((c) => c.key === answer.toLowerCase());

      if (choice) {
        if (choice.value === "diff") {
          await this.showDetailedDiff(filename);
          continue; // Ask again after showing diff
        }
        return choice.value;
      } else {
        console.log(
          "❌ Invalid choice. Please select one of the options above."
        );
      }
    }
  }

  /**
   * Show detailed diff to user
   */
  async showDetailedDiff(filename) {
    console.log("\n📋 Detailed Diff:");
    console.log("=".repeat(80));

    try {
      const { execSync } = await import("child_process");
      const command = `git diff --no-index --color=always "${filename}.github" "${filename}.assertthat"`;
      const result = execSync(command, { encoding: "utf8" });
      console.log(result);
    } catch (error) {
      // git diff returns exit code 1 when files differ
      if (error.stdout) {
        console.log(error.stdout);
      } else {
        console.log("❌ Could not generate detailed diff");
      }
    }

    console.log("=".repeat(80));
  }

  /**
   * Ask a question and wait for user input
   */
  async askQuestion(question) {
    return new Promise((resolve) => {
      this.readline.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Prompt for batch operation choice
   */
  async promptForBatchChoice(conflictCount) {
    await this.initializeReadline();

    console.log(`\n📦 Found ${conflictCount} conflicts to resolve.`);
    console.log("Would you like to:");
    console.log("   [i] Resolve conflicts interactively (recommended)");
    console.log(
      "   [a] Auto-resolve all simple conflicts, prompt for complex ones"
    );
    console.log("   [g] Use GitHub version for all conflicts");
    console.log("   [t] Use AssertThat version for all conflicts");
    console.log("   [s] Skip all conflicts");

    while (true) {
      const answer = await this.askQuestion("\nYour choice: ");

      switch (answer.toLowerCase()) {
        case "i":
          return "interactive";
        case "a":
          return "auto";
        case "g":
          return "github-all";
        case "t":
          return "assertthat-all";
        case "s":
          return "skip-all";
        default:
          console.log("❌ Invalid choice. Please select i, a, g, t, or s.");
      }
    }
  }

  /**
   * Get cached choice for similar conflicts
   */
  getCachedChoice(filename, diffOutput) {
    // Simple caching based on file extension and diff size
    const extension = filename.split(".").pop();
    const diffSize = diffOutput.split("\n").length;
    const cacheKey = `${extension}-${Math.floor(diffSize / 10) * 10}`;

    return this.responses.get(cacheKey);
  }

  /**
   * Cache user choice for similar conflicts
   */
  cacheChoice(filename, diffOutput, choice) {
    const extension = filename.split(".").pop();
    const diffSize = diffOutput.split("\n").length;
    const cacheKey = `${extension}-${Math.floor(diffSize / 10) * 10}`;

    this.responses.set(cacheKey, choice);
  }

  /**
   * Confirm destructive operation
   */
  async confirmDestructiveOperation(operation, details) {
    await this.initializeReadline();

    console.log(`\n⚠️  DESTRUCTIVE OPERATION: ${operation}`);
    console.log("Details:", details);
    console.log("\nThis action cannot be undone.");

    const answer = await this.askQuestion(
      "Are you sure you want to continue? (yes/no): "
    );
    return answer.toLowerCase() === "yes" || answer.toLowerCase() === "y";
  }

  /**
   * Show progress update
   */
  showProgress(current, total, message) {
    const percentage = Math.round((current / total) * 100);
    const progressBar =
      "█".repeat(Math.floor(percentage / 5)) +
      "░".repeat(20 - Math.floor(percentage / 5));

    process.stdout.write(`\r[${progressBar}] ${percentage}% - ${message}`);

    if (current === total) {
      console.log(); // New line when complete
    }
  }

  /**
   * Close readline interface
   */
  close() {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
  }

  /**
   * Get interaction statistics
   */
  getStats() {
    return {
      cachedResponses: this.responses.size,
      responseTypes: Array.from(this.responses.values()).reduce(
        (acc, choice) => {
          acc[choice] = (acc[choice] || 0) + 1;
          return acc;
        },
        {}
      ),
    };
  }

  /**
   * Clear cached responses
   */
  clearCache() {
    this.responses.clear();
  }
}
