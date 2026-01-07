/**
 * Domain-specific error types for sync operations
 * Replaces generic Error usage with contextual error information
 */

export abstract class SyncError extends Error {
  public readonly timestamp: Date;
  public readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    this.context = context;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  public toJSON(): Record<string, unknown> {
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
  constructor(message: string, missingFields: string[] = []) {
    super(message, { missingFields });
  }
}

/**
 * Feature file validation errors
 */
export class FeatureValidationError extends SyncError {
  public readonly filePath: string;
  public readonly validationErrors: string[];

  constructor(
    message: string,
    filePath: string,
    validationErrors: string[] = []
  ) {
    super(message, { filePath, validationErrors });
    this.filePath = filePath;
    this.validationErrors = validationErrors;
  }
}

/**
 * Gherkin parsing errors
 */
export class GherkinParseError extends SyncError {
  public readonly filePath: string;
  public readonly parseError: string;

  constructor(message: string, filePath: string, parseError: string) {
    super(message, { filePath, parseError });
    this.filePath = filePath;
    this.parseError = parseError;
  }
}

/**
 * File system operation errors
 */
export class FileSystemError extends SyncError {
  public readonly operation: string;
  public readonly filePath: string;

  constructor(
    message: string,
    operation: string,
    filePath: string,
    originalError?: Error
  ) {
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
  public readonly command: string;
  public readonly exitCode?: number;
  public readonly stderr?: string;

  constructor(
    message: string,
    command: string,
    exitCode?: number,
    stderr?: string
  ) {
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
  public readonly filename: string;
  public readonly conflictType: string;

  constructor(message: string, filename: string, conflictType: string) {
    super(message, { filename, conflictType });
    this.filename = filename;
    this.conflictType = conflictType;
  }
}

/**
 * Staging area operation errors
 */
export class StagingAreaError extends SyncError {
  public readonly operation: string;
  public readonly stagingPath: string;

  constructor(message: string, operation: string, stagingPath: string) {
    super(message, { operation, stagingPath });
    this.operation = operation;
    this.stagingPath = stagingPath;
  }
}

/**
 * AssertThat API errors
 */
export class AssertThatApiError extends SyncError {
  public readonly endpoint: string;
  public readonly statusCode?: number;
  public readonly responseBody?: string;

  constructor(
    message: string,
    endpoint: string,
    statusCode?: number,
    responseBody?: string
  ) {
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
  public readonly interactionType: string;

  constructor(message: string, interactionType: string) {
    super(message, { interactionType });
    this.interactionType = interactionType;
  }
}

/**
 * Sync orchestration errors
 */
export class SyncOrchestrationError extends SyncError {
  public readonly phase: string;
  public readonly partialResults?: Record<string, unknown>;

  constructor(
    message: string,
    phase: string,
    partialResults?: Record<string, unknown>
  ) {
    super(message, { phase, partialResults });
    this.phase = phase;
    this.partialResults = partialResults;
  }
}

/**
 * Error factory for creating appropriate error types
 */
export class SyncErrorFactory {
  public static createConfigurationError(
    missingFields: string[]
  ): SyncConfigurationError {
    const message = `Missing required configuration: ${missingFields.join(", ")}`;
    return new SyncConfigurationError(message, missingFields);
  }

  public static createFeatureValidationError(
    filePath: string,
    errors: string[]
  ): FeatureValidationError {
    const message = `Feature validation failed for ${filePath}: ${errors.join(", ")}`;
    return new FeatureValidationError(message, filePath, errors);
  }

  public static createGitError(command: string, error: { status?: number; stderr?: string }): GitOperationError {
    const message = `Git command failed: ${command}`;
    return new GitOperationError(message, command, error.status, error.stderr);
  }

  public static createFileSystemError(
    operation: string,
    filePath: string,
    originalError: Error
  ): FileSystemError {
    const message = `File system operation '${operation}' failed for ${filePath}: ${originalError.message}`;
    return new FileSystemError(message, operation, filePath, originalError);
  }
}
