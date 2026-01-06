/**
 * Domain-specific error types for sync operations
 * Replaces generic Error usage with contextual error information
 */

export class SyncError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.context = context;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * Configuration-related errors
 */
export class SyncConfigurationError extends SyncError {
  constructor(message, missingFields = []) {
    super(message, { missingFields });
  }
}

/**
 * Feature file validation errors
 */
export class FeatureValidationError extends SyncError {
  constructor(message, filePath, validationErrors = []) {
    super(message, { filePath, validationErrors });
    this.filePath = filePath;
    this.validationErrors = validationErrors;
  }
}

/**
 * Gherkin parsing errors
 */
export class GherkinParseError extends SyncError {
  constructor(message, filePath, parseError) {
    super(message, { filePath, parseError });
    this.filePath = filePath;
    this.parseError = parseError;
  }
}

/**
 * File system operation errors
 */
export class FileSystemError extends SyncError {
  constructor(message, operation, filePath, originalError) {
    super(message, {
      operation,
      filePath,
      originalError: originalError?.message,
    });
    this.operation = operation;
    this.filePath = filePath;
  }
}

/**
 * Git operation errors
 */
export class GitOperationError extends SyncError {
  constructor(message, command, exitCode, stderr) {
    super(message, { command, exitCode, stderr });
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Conflict resolution errors
 */
export class ConflictResolutionError extends SyncError {
  constructor(message, filename, conflictType) {
    super(message, { filename, conflictType });
    this.filename = filename;
    this.conflictType = conflictType;
  }
}

/**
 * Staging area operation errors
 */
export class StagingAreaError extends SyncError {
  constructor(message, operation, stagingPath) {
    super(message, { operation, stagingPath });
    this.operation = operation;
    this.stagingPath = stagingPath;
  }
}

/**
 * AssertThat API errors
 */
export class AssertThatApiError extends SyncError {
  constructor(message, endpoint, statusCode, responseBody) {
    super(message, { endpoint, statusCode, responseBody });
    this.endpoint = endpoint;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/**
 * User interaction errors
 */
export class UserInteractionError extends SyncError {
  constructor(message, interactionType) {
    super(message, { interactionType });
    this.interactionType = interactionType;
  }
}

/**
 * Sync orchestration errors
 */
export class SyncOrchestrationError extends SyncError {
  constructor(message, phase, partialResults) {
    super(message, { phase, partialResults });
    this.phase = phase;
    this.partialResults = partialResults;
  }
}

/**
 * Error factory for creating appropriate error types
 */
export class SyncErrorFactory {
  static createConfigurationError(missingFields) {
    const message = `Missing required configuration: ${missingFields.join(", ")}`;
    return new SyncConfigurationError(message, missingFields);
  }

  static createFeatureValidationError(filePath, errors) {
    const message = `Feature validation failed for ${filePath}: ${errors.join(", ")}`;
    return new FeatureValidationError(message, filePath, errors);
  }

  static createGitError(command, error) {
    const message = `Git command failed: ${command}`;
    return new GitOperationError(message, command, error.status, error.stderr);
  }

  static createFileSystemError(operation, filePath, originalError) {
    const message = `File system operation '${operation}' failed for ${filePath}: ${originalError.message}`;
    return new FileSystemError(message, operation, filePath, originalError);
  }
}
