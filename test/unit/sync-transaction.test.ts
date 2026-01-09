/**
 * OG-45 Phase 4: Sync Transaction Tests
 * Test-driven development for rollback and safety mechanisms
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { Mock } from "jest-mock";
import { SyncTransaction } from "../../scripts/api/SyncTransaction.mjs";

interface FileSystemError extends Error {
  code?: string;
}

// Mock dependencies
const mockFs = {
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readFile: jest.fn(),
  copyFile: jest.fn(),
  unlink: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn(),
};

const mockEventBus = {
  emit: jest.fn(),
};

const mockConfig = {
  sync: {
    backupPath: "./backups",
    transactionLogPath: "./transaction-log.json",
  },
};

describe("SyncTransaction", () => {
  let transaction: SyncTransaction;

  beforeEach(() => {
    jest.clearAllMocks();
    transaction = new SyncTransaction(mockConfig, mockEventBus, mockFs);
  });

  describe("Constructor", () => {
    it("should create transaction with dependencies", () => {
      expect(transaction).toBeDefined();
      expect(transaction.config).toBe(mockConfig);
      expect(transaction.eventBus).toBe(mockEventBus);
    });

    it("should throw error when config is missing", () => {
      expect(() => {
        new SyncTransaction(null, mockEventBus, mockFs);
      }).toThrow("Configuration required");
    });

    it("should generate unique transaction ID", () => {
      const tx1 = new SyncTransaction(mockConfig, mockEventBus, mockFs);
      const tx2 = new SyncTransaction(mockConfig, mockEventBus, mockFs);

      expect(tx1.transactionId).toBeDefined();
      expect(tx2.transactionId).toBeDefined();
      expect(tx1.transactionId).not.toBe(tx2.transactionId);
    });
  });

  describe("Transaction Lifecycle", () => {
    it("should start transaction and create log", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await transaction.begin();

      expect(transaction.isActive()).toBe(true);
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining("backups"),
        expect.objectContaining({ recursive: true })
      );
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "TRANSACTION_STARTED",
        expect.objectContaining({
          transactionId: transaction.transactionId,
        })
      );
    });

    it("should commit transaction successfully", async () => {
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);

      await transaction.begin();
      await transaction.commit();

      expect(transaction.isActive()).toBe(false);
      expect(transaction.isCommitted()).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "TRANSACTION_COMMITTED",
        expect.objectContaining({
          transactionId: transaction.transactionId,
        })
      );
    });

    it("should rollback transaction on failure", async () => {
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);

      await transaction.begin();
      await transaction.rollback();

      expect(transaction.isActive()).toBe(false);
      expect(transaction.isRolledBack()).toBe(true);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "TRANSACTION_ROLLED_BACK",
        expect.objectContaining({
          transactionId: transaction.transactionId,
        })
      );
    });

    it("should throw error when committing inactive transaction", async () => {
      await expect(transaction.commit()).rejects.toThrow(
        "No active transaction"
      );
    });

    it("should throw error when rolling back inactive transaction", async () => {
      await expect(transaction.rollback()).rejects.toThrow(
        "No active transaction"
      );
    });
  });

  describe("File Backup", () => {
    it("should backup file before modification", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true });

      await transaction.begin();
      await transaction.backupFile("./features/test.feature");

      expect(mockFs.copyFile).toHaveBeenCalledWith(
        "./features/test.feature",
        expect.stringContaining("test.feature")
      );
      expect(transaction.getBackupCount()).toBe(1);
    });

    it("should track multiple file backups", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true });

      await transaction.begin();
      await transaction.backupFile("./features/test1.feature");
      await transaction.backupFile("./features/test2.feature");
      await transaction.backupFile("./features/test3.feature");

      expect(transaction.getBackupCount()).toBe(3);
    });

    it("should skip backup for non-existent files", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      const enoentError: FileSystemError = new Error("File not found");
      enoentError.code = "ENOENT";
      mockFs.stat.mockRejectedValue(enoentError);

      await transaction.begin();
      await transaction.backupFile("./features/nonexistent.feature");

      expect(mockFs.copyFile).not.toHaveBeenCalled();
      expect(transaction.getBackupCount()).toBe(0);
    });

    it("should emit backup events", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true });

      await transaction.begin();
      await transaction.backupFile("./features/test.feature");

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "FILE_BACKED_UP",
        expect.objectContaining({
          originalPath: "./features/test.feature",
        })
      );
    });
  });

  describe("File Restoration", () => {
    it("should restore files on rollback", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: "test.feature.backup", isDirectory: () => false },
      ]);

      await transaction.begin();
      await transaction.backupFile("./features/test.feature");
      await transaction.rollback();

      expect(mockFs.copyFile).toHaveBeenCalledWith(
        expect.stringContaining("test.feature.backup"),
        "./features/test.feature"
      );
    });

    it("should restore multiple files on rollback", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: "test1.feature.backup", isDirectory: () => false },
        { name: "test2.feature.backup", isDirectory: () => false },
      ]);

      await transaction.begin();
      await transaction.backupFile("./features/test1.feature");
      await transaction.backupFile("./features/test2.feature");
      await transaction.rollback();

      // Should restore both files
      const copyFileCalls = (mockFs.copyFile as Mock).mock.calls;
      const restoreCalls = copyFileCalls.filter(
        (call) => !call[1].includes("backups")
      );
      expect(restoreCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("should emit restoration events", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: "test.feature.backup", isDirectory: () => false },
      ]);

      await transaction.begin();
      await transaction.backupFile("./features/test.feature");
      await transaction.rollback();

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "FILE_RESTORED",
        expect.any(Object)
      );
    });
  });

  describe("Transaction Log", () => {
    it("should write transaction log on begin", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await transaction.begin();

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("transaction-log.json"),
        expect.any(String),
        "utf8"
      );
    });

    it("should update transaction log on commit", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await transaction.begin();
      await transaction.commit();

      const writeFileCalls = (mockFs.writeFile as Mock).mock.calls;
      const logWrites = writeFileCalls.filter((call) =>
        call[0].includes("transaction-log.json")
      );
      expect(logWrites.length).toBeGreaterThanOrEqual(2); // begin + commit
    });

    it("should include operation details in log", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);

      await transaction.begin();
      await transaction.addOperation("upload", {
        file: "test.feature",
        status: "success",
      });

      const writeFileCalls = (mockFs.writeFile as Mock).mock.calls;
      // Find the last write to transaction log (after addOperation)
      const logWrites = writeFileCalls.filter((call) =>
        call[0].includes("transaction-log.json")
      );
      const lastLogWrite = logWrites[logWrites.length - 1];
      const logContent = JSON.parse(lastLogWrite[1]);

      expect(logContent.operations).toBeDefined();
      expect(logContent.operations.length).toBe(1);
      expect(logContent.operations[0].type).toBe("upload");
      expect(logContent.operations[0].details.file).toBe("test.feature");
    });
  });

  describe("Cleanup", () => {
    it("should cleanup backup files on successful commit", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.unlink.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: "test.feature.backup", isDirectory: () => false },
      ]);

      await transaction.begin();
      await transaction.backupFile("./features/test.feature");
      await transaction.commit();

      expect(mockFs.unlink).toHaveBeenCalled();
    });

    it("should preserve backup files on rollback", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true });
      mockFs.readdir.mockResolvedValue([
        { name: "test.feature.backup", isDirectory: () => false },
      ]);

      await transaction.begin();
      await transaction.backupFile("./features/test.feature");
      
      const unlinkCallsBefore = (mockFs.unlink as Mock).mock.calls.length;
      await transaction.rollback();
      const unlinkCallsAfter = (mockFs.unlink as Mock).mock.calls.length;

      // Backups should not be deleted on rollback (preserved for safety)
      expect(unlinkCallsAfter).toBe(unlinkCallsBefore);
    });
  });

  describe("Error Handling", () => {
    it("should handle backup failures gracefully", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockRejectedValue(new Error("Disk full"));
      mockFs.stat.mockResolvedValue({ isFile: () => true });

      await transaction.begin();

      await expect(
        transaction.backupFile("./features/test.feature")
      ).rejects.toThrow("Disk full");
    });

    it("should handle rollback failures gracefully", async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.copyFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isFile: () => true });
      mockFs.readdir.mockRejectedValue(new Error("Cannot read backup dir"));

      await transaction.begin();
      await transaction.backupFile("./features/test.feature");

      await expect(transaction.rollback()).rejects.toThrow(
        "Cannot read backup dir"
      );
    });
  });
});

