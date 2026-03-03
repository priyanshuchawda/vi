/**
 * Simple In-Memory Cache Manager
 * For storing analysis results and preventing redundant API calls
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CacheManager {
  private cache: Map<string, CacheEntry<any>>;
  private readonly cacheFilePath: string;

  constructor() {
    this.cache = new Map();
    const baseDir = path.join(os.homedir(), '.quickcut');
    this.cacheFilePath = path.join(baseDir, 'analysis_cache.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      const dir = path.dirname(this.cacheFilePath);
      fs.mkdirSync(dir, { recursive: true });

      if (!fs.existsSync(this.cacheFilePath)) {
        return;
      }

      const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, CacheEntry<any>>;
      const now = Date.now();

      for (const [key, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.expiresAt === 'number' && entry.expiresAt > now) {
          this.cache.set(key, entry);
        }
      }
    } catch (error) {
      console.warn('Cache load error:', error);
    }
  }

  private saveToDisk(): void {
    try {
      const now = Date.now();
      const serializable: Record<string, CacheEntry<any>> = {};

      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt > now) {
          serializable[key] = entry;
        }
      }

      fs.writeFileSync(this.cacheFilePath, JSON.stringify(serializable, null, 2), 'utf-8');
    } catch (error) {
      console.warn('Cache save error:', error);
    }
  }

  /**
   * Get value from cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.saveToDisk();
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set value in cache with TTL (in seconds)
   */
  set<T>(key: string, value: T, ttlSeconds: number): boolean {
    try {
      const expiresAt = Date.now() + ttlSeconds * 1000;
      this.cache.set(key, { value, expiresAt });
      this.saveToDisk();
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Delete key from cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) this.saveToDisk();
    return deleted;
  }

  /**
   * Check if key exists and is not expired
   */
  exists(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.saveToDisk();
      return false;
    }

    return true;
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.saveToDisk();
  }

  /**
   * Get remaining TTL in seconds
   */
  getTTL(key: string): number {
    const entry = this.cache.get(key);
    if (!entry) {
      return -1;
    }

    const remaining = Math.floor((entry.expiresAt - Date.now()) / 1000);
    return Math.max(0, remaining);
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }
}

/**
 * Analysis Cache Service
 * Specialized cache operations for channel analysis
 */
export class AnalysisCacheService {
  private cache: CacheManager;

  constructor(cache: CacheManager) {
    this.cache = cache;
  }

  /**
   * Get cached channel analysis
   */
  getChannelAnalysis(channelId: string): any | null {
    return this.cache.get(`analysis:${channelId}`);
  }

  /**
   * Cache channel analysis (7 days)
   */
  setChannelAnalysis(channelId: string, analysis: any): boolean {
    return this.cache.set(`analysis:${channelId}`, analysis, 604800); // 7 days
  }

  /**
   * Get cached channel metadata
   */
  getChannelMetadata(channelId: string): any | null {
    return this.cache.get(`channel:${channelId}`);
  }

  /**
   * Cache channel metadata (7 days)
   */
  setChannelMetadata(channelId: string, metadata: any): boolean {
    return this.cache.set(`channel:${channelId}`, metadata, 604800); // 7 days
  }

  /**
   * Get analysis by user ID
   */
  getUserAnalysis(userId: string): any | null {
    const channelId = this.cache.get<string>(`user:channel:${userId}`);
    if (!channelId) {
      return null;
    }
    return this.getChannelAnalysis(channelId);
  }

  /**
   * Link user to their channel analysis
   */
  linkUserToChannel(userId: string, channelId: string): boolean {
    return this.cache.set(`user:channel:${userId}`, channelId, 2592000); // 30 days
  }

  /**
   * Set analysis job status
   */
  setAnalysisStatus(
    analysisId: string,
    status: {
      status: 'pending' | 'completed' | 'failed';
      progress: number;
      result?: any;
      error?: string;
    },
  ): boolean {
    return this.cache.set(`analysis:status:${analysisId}`, status, 3600); // 1 hour
  }

  /**
   * Get analysis job status
   */
  getAnalysisStatus(analysisId: string): any | null {
    return this.cache.get(`analysis:status:${analysisId}`);
  }

  /**
   * Invalidate channel cache
   */
  invalidateChannel(channelId: string): void {
    this.cache.delete(`analysis:${channelId}`);
    this.cache.delete(`channel:${channelId}`);
  }

  /**
   * Clear all analysis cache
   */
  clearAll(): void {
    this.cache.clear();
  }
}

// Global singleton instances
export const globalCache = new CacheManager();
export const analysisCacheService = new AnalysisCacheService(globalCache);
