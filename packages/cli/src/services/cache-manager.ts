/**
 * CacheManager - Local cache management for watch-pr command
 *
 * Provides:
 * - Atomic writes (concurrent-safe)
 * - TTL-based cache freshness
 * - Separate logs (immutable) and extractions (mutable) directories
 * - Cross-platform path handling
 *
 * Cache structure:
 * ${os.tmpdir()}/vibe-validate/<repo-name>/watch-pr/<pr-number>/
 *   ├── logs/             # Immutable log files
 *   │   ├── 123.log
 *   │   └── 456.log
 *   ├── extractions/      # Mutable extraction results
 *   │   ├── 123.json
 *   │   └── 456.json
 *   └── metadata.json     # Complete WatchPRResult
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ErrorExtractorResult } from '@vibe-validate/extractors';

import type { WatchPRResult } from '../schemas/watch-pr-result.schema.js';

/**
 * Default TTL for cached data (5 minutes)
 */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * CacheManager - Manages local cache for watch-pr command
 *
 * Provides concurrent-safe caching with TTL support.
 */
export class CacheManager {
  /** Base cache directory */
  private readonly cacheDir: string;

  /** Logs directory (immutable) */
  private readonly logsDir: string;

  /** Extractions directory (mutable) */
  private readonly extractionsDir: string;

  /**
   * Create a new CacheManager
   *
   * @param repoName - Repository name (e.g., "jdutton/vibe-validate")
   * @param prNumber - PR number
   * @param baseDir - Base directory for cache (defaults to OS temp)
   */
  constructor(repoName: string, prNumber: number, baseDir?: string) {
    // Sanitize repo name for filesystem (replace / with _)
    const sanitizedRepoName = repoName.replaceAll('/', '_');

    // Cache directory: ${baseDir}/vibe-validate/<repo-name>/watch-pr/<pr-number>/
    const base = baseDir ?? os.tmpdir();
    this.cacheDir = path.join(base, 'vibe-validate', sanitizedRepoName, 'watch-pr', String(prNumber));

    // Subdirectories
    this.logsDir = path.join(this.cacheDir, 'logs');
    this.extractionsDir = path.join(this.cacheDir, 'extractions');

    // Create directories synchronously on construction
    this.initDirectories();
  }

  /**
   * Initialize cache directories
   *
   * Creates directory structure if it doesn't exist.
   */
  private initDirectories(): void {
    // Create directories synchronously during construction
    try {
      const fs = require('node:fs');
      fs.mkdirSync(this.logsDir, { recursive: true });
      fs.mkdirSync(this.extractionsDir, { recursive: true });
    } catch (error) {
      // Log error during directory creation (will fail later with more context)
      console.warn('Failed to create cache directories:', error);
    }
  }

  /**
   * Atomic write - Write file atomically using temp file + rename
   *
   * Provides concurrent safety by writing to temp file first, then renaming.
   *
   * @param filePath - Target file path
   * @param content - Content to write
   */
  private async atomicWrite(filePath: string, content: string): Promise<void> {
    // Ensure parent directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Write to temp file first
    // Using crypto for secure random suffix (sonarjs/pseudo-random requirement)
    const crypto = await import('node:crypto');
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const tempPath = `${filePath}.tmp.${Date.now()}.${randomSuffix}`;
    await fs.writeFile(tempPath, content, 'utf8');

    // Atomic rename
    await fs.rename(tempPath, filePath);
  }

  /**
   * Check if a file is fresh (within TTL)
   *
   * @param filePath - File path to check
   * @param ttl - TTL in milliseconds
   * @returns true if file exists and is fresh, false otherwise
   */
  private async isFresh(filePath: string, ttl: number): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      const age = Date.now() - stats.mtimeMs;
      return age < ttl;
    } catch {
      return false;
    }
  }

  /**
   * Save log file (immutable)
   *
   * @param runId - GitHub run ID
   * @param logs - Log content
   * @returns Path to saved log file
   */
  async saveLog(runId: number, logs: string): Promise<string> {
    const logPath = path.join(this.logsDir, `${runId}.log`);
    await this.atomicWrite(logPath, logs);
    return logPath;
  }

  /**
   * Save extraction result (mutable)
   *
   * @param runId - GitHub run ID
   * @param extraction - Extraction result
   */
  async saveExtraction(runId: number, extraction: ErrorExtractorResult): Promise<void> {
    const extractionPath = path.join(this.extractionsDir, `${runId}.json`);
    await this.atomicWrite(extractionPath, JSON.stringify(extraction, null, 2));
  }

  /**
   * Get extraction result
   *
   * @param runId - GitHub run ID
   * @returns Extraction result or null if not found
   */
  async getExtraction(runId: number): Promise<ErrorExtractorResult | null> {
    try {
      const extractionPath = path.join(this.extractionsDir, `${runId}.json`);
      const content = await fs.readFile(extractionPath, 'utf8');
      return JSON.parse(content) as ErrorExtractorResult;
    } catch {
      return null;
    }
  }

  /**
   * Save metadata (complete WatchPRResult)
   *
   * @param data - WatchPRResult data
   */
  async saveMetadata(data: WatchPRResult): Promise<void> {
    const metadataPath = path.join(this.cacheDir, 'metadata.json');
    await this.atomicWrite(metadataPath, JSON.stringify(data, null, 2));
  }

  /**
   * Get metadata (complete WatchPRResult)
   *
   * @returns Metadata or null if not found
   */
  async getMetadata(): Promise<WatchPRResult | null> {
    try {
      const metadataPath = path.join(this.cacheDir, 'metadata.json');
      const content = await fs.readFile(metadataPath, 'utf8');
      return JSON.parse(content) as WatchPRResult;
    } catch {
      return null;
    }
  }

  /**
   * Get or fetch data with caching
   *
   * Generic cache wrapper with TTL support.
   *
   * @param key - Cache key
   * @param fetcher - Function to fetch data if cache is stale/missing
   * @param ttl - TTL in milliseconds (default: 5 minutes)
   * @returns Cached or fetched data
   */
  async getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttl: number = DEFAULT_TTL_MS): Promise<T> {
    const cacheFile = path.join(this.cacheDir, `${key}.json`);

    // Check if cache is fresh
    if (await this.isFresh(cacheFile, ttl)) {
      try {
        const content = await fs.readFile(cacheFile, 'utf8');
        return JSON.parse(content) as T;
      } catch {
        // Cache is corrupt or unreadable - fetch fresh data
      }
    }

    // Fetch fresh data
    const data = await fetcher();

    // Save to cache
    try {
      await this.atomicWrite(cacheFile, JSON.stringify(data, null, 2));
    } catch {
      // Ignore cache write errors - return data anyway
    }

    return data;
  }
}
