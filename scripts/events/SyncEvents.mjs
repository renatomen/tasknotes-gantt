/**
 * Centralized event definitions for sync operations
 * Enables loose coupling between components via event-driven architecture
 */

export const SYNC_EVENTS = {
  // Configuration Events
  CONFIG_VALIDATED: "config:validated",
  CONFIG_VALIDATION_FAILED: "config:validation-failed",

  // Staging Events
  STAGING_CREATED: "staging:created",
  STAGING_CLEANED: "staging:cleaned",
  STAGING_ERROR: "staging:error",

  // Download Events
  DOWNLOAD_STARTED: "download:started",
  DOWNLOAD_COMPLETED: "download:completed",
  DOWNLOAD_FAILED: "download:failed",

  // Change Detection Events
  CHANGES_DETECTED: "changes:detected",
  CHANGES_CLASSIFIED: "changes:classified",
  CHANGES_ERROR: "changes:error",

  // Validation Events
  VALIDATION_STARTED: "validation:started",
  VALIDATION_COMPLETED: "validation:completed",
  VALIDATION_FAILED: "validation:failed",

  // Conflict Events
  CONFLICTS_DETECTED: "conflicts:detected",
  CONFLICTS_AUTO_RESOLVED: "conflicts:auto-resolved",
  CONFLICTS_REQUIRE_MANUAL: "conflicts:require-manual",
  CONFLICTS_RESOLVED: "conflicts:resolved",

  // User Interaction Events
  USER_PROMPT_STARTED: "user:prompt-started",
  USER_CHOICE_MADE: "user:choice-made",
  USER_INTERACTION_CANCELLED: "user:interaction-cancelled",

  // Progress Events
  PROGRESS_UPDATE: "progress:update",
  PHASE_STARTED: "phase:started",
  PHASE_COMPLETED: "phase:completed",
  PHASE_FAILED: "phase:failed",

  // Sync Events
  SYNC_STARTED: "sync:started",
  SYNC_COMPLETED: "sync:completed",
  SYNC_FAILED: "sync:failed",

  // Cache Events
  CACHE_HIT: "cache:hit",
  CACHE_MISS: "cache:miss",
  CACHE_INVALIDATED: "cache:invalidated",
};

/**
 * Event data structures for type safety and documentation
 */
export const EVENT_SCHEMAS = {
  [SYNC_EVENTS.CONFIG_VALIDATED]: {
    config: "object",
    isValid: "boolean",
    missingFields: "array",
  },

  [SYNC_EVENTS.STAGING_CREATED]: {
    stagingPath: "string",
    timestamp: "string",
  },

  [SYNC_EVENTS.CHANGES_DETECTED]: {
    additions: "array",
    modifications: "array",
    deletions: "array",
    totalChanges: "number",
  },

  [SYNC_EVENTS.CONFLICTS_DETECTED]: {
    simple: "array",
    complex: "array",
    autoResolved: "array",
  },

  [SYNC_EVENTS.PROGRESS_UPDATE]: {
    phase: "string",
    progress: "number", // 0-100
    message: "string",
  },

  [SYNC_EVENTS.PHASE_STARTED]: {
    phase: "string",
    timestamp: "string",
  },

  [SYNC_EVENTS.PHASE_COMPLETED]: {
    phase: "string",
    duration: "number",
    result: "object",
  },

  [SYNC_EVENTS.USER_CHOICE_MADE]: {
    filename: "string",
    choice: "string",
    timestamp: "string",
  },
};

/**
 * Simple event emitter implementation for sync operations
 */
export class SyncEventEmitter {
  constructor() {
    this.listeners = new Map();
    this.eventHistory = [];
    this.maxHistorySize = 1000;
  }

  /**
   * Subscribe to an event
   */
  on(eventName, listener) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(listener);

    return () => this.off(eventName, listener);
  }

  /**
   * Subscribe to an event once
   */
  once(eventName, listener) {
    const unsubscribe = this.on(eventName, (data) => {
      unsubscribe();
      listener(data);
    });
    return unsubscribe;
  }

  /**
   * Unsubscribe from an event
   */
  off(eventName, listener) {
    const listeners = this.listeners.get(eventName);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event
   */
  emit(eventName, data = {}) {
    const eventData = {
      name: eventName,
      data,
      timestamp: new Date().toISOString(),
      id: this.generateEventId(),
    };

    // Add to history
    this.addToHistory(eventData);

    // Notify listeners
    const listeners = this.listeners.get(eventName);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(eventData.data, eventData);
        } catch (error) {
          console.error(`Error in event listener for ${eventName}:`, error);
        }
      });
    }

    return eventData;
  }

  /**
   * Get event history
   */
  getHistory(eventName = null, limit = 100) {
    let history = this.eventHistory;

    if (eventName) {
      history = history.filter((event) => event.name === eventName);
    }

    return history.slice(-limit);
  }

  /**
   * Clear event history
   */
  clearHistory() {
    this.eventHistory = [];
  }

  /**
   * Get all listeners for debugging
   */
  getListeners() {
    const result = {};
    for (const [eventName, listeners] of this.listeners) {
      result[eventName] = listeners.length;
    }
    return result;
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(eventName = null) {
    if (eventName) {
      this.listeners.delete(eventName);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Add event to history with size management
   */
  addToHistory(eventData) {
    this.eventHistory.push(eventData);

    // Maintain history size limit
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Generate unique event ID
   */
  generateEventId() {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Global event emitter instance for sync operations
 */
export const syncEvents = new SyncEventEmitter();

/**
 * Helper function to create event data with validation
 */
export function createEventData(eventName, data) {
  const schema = EVENT_SCHEMAS[eventName];
  if (schema) {
    // Basic validation could be added here
    for (const [key, expectedType] of Object.entries(schema)) {
      if (data[key] !== undefined) {
        const actualType = Array.isArray(data[key])
          ? "array"
          : typeof data[key];
        if (actualType !== expectedType) {
          console.warn(
            `Event ${eventName}: Expected ${key} to be ${expectedType}, got ${actualType}`
          );
        }
      }
    }
  }

  return {
    ...data,
    timestamp: new Date().toISOString(),
  };
}
