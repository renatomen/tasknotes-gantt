/**
 * OG-45 Phase 4: Sync Transaction
 * 
 * Provides transaction-based rollback and safety mechanisms:
 * - Transaction lifecycle (begin, commit, rollback)
 * - File backup before modifications
 * - Automatic restoration on rollback
 * - Transaction logging for audit trail
 * - Cleanup on successful commit
 */

import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";

/**
 * SyncTransaction - Manages transactional sync operations with rollback support
 */
export class SyncTransaction {
  /**
   * Constructor with dependency injection
   * 
   * @param {Object} config - Configuration object
   * @param {Object} eventBus - Event bus for progress tracking
   * @param {Object} fsModule - File system module (for testing)
   */
  constructor(config, eventBus, fsModule = null) {
    this.validateDependencies(config);

    this.config = config;
    this.eventBus = eventBus;
    this.fs = fsModule || fs;

    // Transaction state
    this.transactionId = randomUUID();
    this.active = false;
    this.committed = false;
    this.rolledBack = false;
    this.startTime = null;
    this.endTime = null;

    // Backup tracking
    this.backups = new Map(); // originalPath -> backupPath
    this.operations = [];

    // Paths
    this.backupPath = config.sync?.backupPath || "./backups";
    this.transactionLogPath =
      config.sync?.transactionLogPath || "./transaction-log.json";
  }

  /**
   * Validate constructor dependencies
   */
  validateDependencies(config) {
    if (!config) {
      throw new Error("Configuration required");
    }
  }

  /**
   * Begin a new transaction
   */
  async begin() {
    if (this.active) {
      throw new Error("Transaction already active");
    }

    this.active = true;
    this.startTime = new Date().toISOString();

    // Create backup directory
    const txBackupPath = path.join(this.backupPath, this.transactionId);
    await this.fs.mkdir(txBackupPath, { recursive: true });

    // Write initial transaction log
    await this.writeTransactionLog();

    // Emit event
    this.emitEvent("TRANSACTION_STARTED", {
      transactionId: this.transactionId,
      startTime: this.startTime,
    });
  }

  /**
   * Commit the transaction (success)
   */
  async commit() {
    if (!this.active) {
      throw new Error("No active transaction");
    }

    this.active = false;
    this.committed = true;
    this.endTime = new Date().toISOString();

    // Write final transaction log
    await this.writeTransactionLog();

    // Cleanup backup files (transaction successful)
    await this.cleanupBackups();

    // Emit event
    this.emitEvent("TRANSACTION_COMMITTED", {
      transactionId: this.transactionId,
      endTime: this.endTime,
      backupCount: this.backups.size,
      operationCount: this.operations.length,
    });
  }

  /**
   * Rollback the transaction (failure)
   */
  async rollback() {
    if (!this.active) {
      throw new Error("No active transaction");
    }

    this.active = false;
    this.rolledBack = true;
    this.endTime = new Date().toISOString();

    // Restore all backed up files
    await this.restoreBackups();

    // Write final transaction log
    await this.writeTransactionLog();

    // Emit event
    this.emitEvent("TRANSACTION_ROLLED_BACK", {
      transactionId: this.transactionId,
      endTime: this.endTime,
      filesRestored: this.backups.size,
    });
  }

  /**
   * Backup a file before modification
   * 
   * @param {string} filePath - Path to file to backup
   */
  async backupFile(filePath) {
    if (!this.active) {
      throw new Error("No active transaction");
    }

    try {
      // Check if file exists
      await this.fs.stat(filePath);

      // Create backup path
      const fileName = path.basename(filePath);
      const txBackupPath = path.join(this.backupPath, this.transactionId);
      const backupFilePath = path.join(txBackupPath, `${fileName}.backup`);

      // Copy file to backup location
      await this.fs.copyFile(filePath, backupFilePath);

      // Track backup
      this.backups.set(filePath, backupFilePath);

      // Emit event
      this.emitEvent("FILE_BACKED_UP", {
        originalPath: filePath,
        backupPath: backupFilePath,
        transactionId: this.transactionId,
      });
    } catch (error) {
      if (error.code === "ENOENT") {
        // File doesn't exist, skip backup
        return;
      }
      throw error;
    }
  }

  /**
   * Add an operation to the transaction log
   * 
   * @param {string} type - Operation type (upload, download, etc.)
   * @param {Object} details - Operation details
   */
  async addOperation(type, details) {
    this.operations.push({
      type,
      details,
      timestamp: new Date().toISOString(),
    });

    // Update transaction log
    await this.writeTransactionLog();
  }

  /**
   * Restore all backed up files
   */
  async restoreBackups() {
    const txBackupPath = path.join(this.backupPath, this.transactionId);

    try {
      // Read backup directory
      await this.fs.readdir(txBackupPath, {
        withFileTypes: true,
      });

      // Restore each backup
      for (const [originalPath, backupPath] of this.backups.entries()) {
        try {
          await this.fs.copyFile(backupPath, originalPath);

          this.emitEvent("FILE_RESTORED", {
            originalPath,
            backupPath,
            transactionId: this.transactionId,
          });
        } catch (error) {
          // Log error but continue restoring other files
          this.emitEvent("FILE_RESTORE_FAILED", {
            originalPath,
            error: error.message,
          });
        }
      }
    } catch (error) {
      this.emitEvent("RESTORE_FAILED", {
        error: error.message,
        transactionId: this.transactionId,
      });
      throw error;
    }
  }

  /**
   * Cleanup backup files after successful commit
   */
  async cleanupBackups() {
    const txBackupPath = path.join(this.backupPath, this.transactionId);

    try {
      // Read backup directory
      const backupFiles = await this.fs.readdir(txBackupPath, {
        withFileTypes: true,
      });

      // Delete each backup file
      for (const file of backupFiles) {
        if (!file.isDirectory()) {
          const filePath = path.join(txBackupPath, file.name);
          await this.fs.unlink(filePath);
        }
      }

      // Note: We don't delete the backup directory itself for safety
      // It can be cleaned up later by a maintenance task
    } catch (error) {
      // Cleanup errors are non-fatal
      this.emitEvent("CLEANUP_FAILED", {
        error: error.message,
        transactionId: this.transactionId,
      });
    }
  }

  /**
   * Write transaction log to disk
   */
  async writeTransactionLog() {
    const log = {
      transactionId: this.transactionId,
      startTime: this.startTime,
      endTime: this.endTime,
      status: this.committed
        ? "committed"
        : this.rolledBack
        ? "rolled_back"
        : "active",
      backups: Array.from(this.backups.entries()).map(([original, backup]) => ({
        original,
        backup,
      })),
      operations: this.operations,
    };

    await this.fs.writeFile(
      this.transactionLogPath,
      JSON.stringify(log, null, 2),
      "utf8"
    );
  }

  /**
   * Check if transaction is active
   */
  isActive() {
    return this.active;
  }

  /**
   * Check if transaction is committed
   */
  isCommitted() {
    return this.committed;
  }

  /**
   * Check if transaction is rolled back
   */
  isRolledBack() {
    return this.rolledBack;
  }

  /**
   * Get backup count
   */
  getBackupCount() {
    return this.backups.size;
  }

  /**
   * Emit event if event bus is available
   * 
   * @param {string} eventName - Event name
   * @param {Object} data - Event data
   */
  emitEvent(eventName, data) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(eventName, data);
    }
  }

  /**
   * Get transaction statistics
   */
  getStats() {
    return {
      transactionId: this.transactionId,
      active: this.active,
      committed: this.committed,
      rolledBack: this.rolledBack,
      backupCount: this.backups.size,
      operationCount: this.operations.length,
      startTime: this.startTime,
      endTime: this.endTime,
    };
  }
}

