/**
 * Caching layer for expensive operations
 * Improves performance by avoiding redundant file reads, git operations, and validations
 */

import { syncEvents, SYNC_EVENTS } from "../events/SyncEvents.mjs";

/**
 * Generic cache implementation with TTL and size limits
 */
export class Cache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.defaultTTL || 5 * 60 * 1000; // 5 minutes
    this.cache = new Map();
    this.timers = new Map();
  }

  /**
   * Get value from cache
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      syncEvents.emit(SYNC_EVENTS.CACHE_MISS, { key });
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.delete(key);
      syncEvents.emit(SYNC_EVENTS.CACHE_MISS, { key, reason: "expired" });
      return undefined;
    }

    // Update access time
    entry.lastAccessed = Date.now();
    syncEvents.emit(SYNC_EVENTS.CACHE_HIT, { key });
    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key, value, ttl = this.defaultTTL) {
    // Enforce size limit
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry = {
      value,
      createdAt: Date.now(),
      lastAccessed: Date.now(),
      ttl,
    };

    this.cache.set(key, entry);

    // Set expiration timer
    if (ttl > 0) {
      const timer = setTimeout(() => {
        this.delete(key);
      }, ttl);
      this.timers.set(key, timer);
    }

    return value;
  }

  /**
   * Delete value from cache
   */
  delete(key) {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
    return this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.cache.clear();
    syncEvents.emit(SYNC_EVENTS.CACHE_INVALIDATED, { reason: "manual-clear" });
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: this.calculateHitRate(),
      entries: Array.from(this.cache.keys()),
    };
  }

  /**
   * Check if entry is expired
   */
  isExpired(entry) {
    if (entry.ttl <= 0) return false;
    return Date.now() - entry.createdAt > entry.ttl;
  }

  /**
   * Evict least recently used entry
   */
  evictLRU() {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.delete(oldestKey);
    }
  }

  /**
   * Calculate hit rate (placeholder - would need hit/miss tracking)
   */
  calculateHitRate() {
    // This would require tracking hits/misses over time
    return 0;
  }
}

/**
 * Specialized cache for file operations
 */
export class FileCache extends Cache {
  constructor(options = {}) {
    super({
      maxSize: 500,
      defaultTTL: 2 * 60 * 1000, // 2 minutes for files
      ...options,
    });
  }

  /**
   * Cache file content with path-based key
   */
  cacheFileContent(filePath, content) {
    const key = `file:${filePath}`;
    return this.set(key, content);
  }

  /**
   * Get cached file content
   */
  getFileContent(filePath) {
    const key = `file:${filePath}`;
    return this.get(key);
  }

  /**
   * Cache file stats
   */
  cacheFileStats(filePath, stats) {
    const key = `stats:${filePath}`;
    return this.set(key, stats);
  }

  /**
   * Get cached file stats
   */
  getFileStats(filePath) {
    const key = `stats:${filePath}`;
    return this.get(key);
  }

  /**
   * Invalidate file-related cache entries
   */
  invalidateFile(filePath) {
    this.delete(`file:${filePath}`);
    this.delete(`stats:${filePath}`);
    syncEvents.emit(SYNC_EVENTS.CACHE_INVALIDATED, { filePath });
  }
}

/**
 * Specialized cache for Git operations
 */
export class GitCache extends Cache {
  constructor(options = {}) {
    super({
      maxSize: 200,
      defaultTTL: 30 * 1000, // 30 seconds for git operations
      ...options,
    });
  }

  /**
   * Cache git diff result
   */
  cacheDiff(file1, file2, options, result) {
    const key = `diff:${file1}:${file2}:${JSON.stringify(options)}`;
    return this.set(key, result);
  }

  /**
   * Get cached git diff result
   */
  getDiff(file1, file2, options) {
    const key = `diff:${file1}:${file2}:${JSON.stringify(options)}`;
    return this.get(key);
  }

  /**
   * Cache git merge result
   */
  cacheMerge(baseFile, theirFile, strategy, result) {
    const key = `merge:${baseFile}:${theirFile}:${strategy}`;
    return this.set(key, result);
  }

  /**
   * Get cached git merge result
   */
  getMerge(baseFile, theirFile, strategy) {
    const key = `merge:${baseFile}:${theirFile}:${strategy}`;
    return this.get(key);
  }
}

/**
 * Specialized cache for validation results
 */
export class ValidationCache extends Cache {
  constructor(options = {}) {
    super({
      maxSize: 300,
      defaultTTL: 10 * 60 * 1000, // 10 minutes for validation results
      ...options,
    });
  }

  /**
   * Cache feature validation result
   */
  cacheValidation(filePath, fileHash, result) {
    const key = `validation:${filePath}:${fileHash}`;
    return this.set(key, result);
  }

  /**
   * Get cached validation result
   */
  getValidation(filePath, fileHash) {
    const key = `validation:${filePath}:${fileHash}`;
    return this.get(key);
  }

  /**
   * Cache parsed feature data
   */
  cacheFeatureData(filePath, fileHash, data) {
    const key = `feature:${filePath}:${fileHash}`;
    return this.set(key, data);
  }

  /**
   * Get cached feature data
   */
  getFeatureData(filePath, fileHash) {
    const key = `feature:${filePath}:${fileHash}`;
    return this.get(key);
  }
}

/**
 * Central cache manager that coordinates all cache types
 */
export class CacheManager {
  constructor(options = {}) {
    this.fileCache = new FileCache(options.file);
    this.gitCache = new GitCache(options.git);
    this.validationCache = new ValidationCache(options.validation);
    this.enabled = options.enabled !== false;
  }

  /**
   * Enable/disable all caching
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.clearAll();
    }
  }

  /**
   * Clear all caches
   */
  clearAll() {
    this.fileCache.clear();
    this.gitCache.clear();
    this.validationCache.clear();
  }

  /**
   * Get comprehensive cache statistics
   */
  getStats() {
    return {
      enabled: this.enabled,
      file: this.fileCache.getStats(),
      git: this.gitCache.getStats(),
      validation: this.validationCache.getStats(),
      total: {
        entries:
          this.fileCache.getStats().size +
          this.gitCache.getStats().size +
          this.validationCache.getStats().size,
      },
    };
  }

  /**
   * Invalidate caches related to a specific file
   */
  invalidateFile(filePath) {
    this.fileCache.invalidateFile(filePath);
    // Could also invalidate related git and validation caches
  }

  /**
   * Warm up cache with commonly accessed data
   */
  async warmUp(commonFiles = []) {
    if (!this.enabled) return;

    // This would pre-load commonly accessed files
    // Implementation would depend on specific use cases
  }
}

/**
 * Global cache manager instance
 */
export const cacheManager = new CacheManager();
