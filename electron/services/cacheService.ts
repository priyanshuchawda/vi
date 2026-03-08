/**
 * Simple In-Memory Cache Manager
 * For storing analysis results and preventing redundant API calls
 *
 * Cache tiers:
 *  L1 — In-memory Map (fastest, lost on restart)
 *  L2 — Local disk JSON  (~/.quickcut/analysis_cache.json)
 *  L3 — DynamoDB (persistent, cross-device; checked only on L1+L2 miss)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { getCloudBackendService } from './cloudBackendService.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CacheManager {
  private cache: Map<string, CacheEntry<unknown>>;
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
      const parsed = JSON.parse(raw) as Record<string, CacheEntry<unknown>>;
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
      const serializable: Record<string, CacheEntry<unknown>> = {};

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
  getChannelAnalysis(channelId: string): unknown | null {
    return this.cache.get(`analysis:${channelId}`);
  }

  /**
   * Cache channel analysis (7 days)
   */
  setChannelAnalysis(channelId: string, analysis: unknown): boolean {
    return this.cache.set(`analysis:${channelId}`, analysis, 604800); // 7 days
  }

  /**
   * Get cached channel metadata
   */
  getChannelMetadata(channelId: string): unknown | null {
    return this.cache.get(`channel:${channelId}`);
  }

  /**
   * Cache channel metadata (7 days)
   */
  setChannelMetadata(channelId: string, metadata: unknown): boolean {
    return this.cache.set(`channel:${channelId}`, metadata, 604800); // 7 days
  }

  /**
   * Get analysis by user ID
   */
  getUserAnalysis(userId: string): unknown | null {
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
      result?: unknown;
      error?: string;
    },
  ): boolean {
    return this.cache.set(`analysis:status:${analysisId}`, status, 3600); // 1 hour
  }

  /**
   * Get analysis job status
   */
  getAnalysisStatus(analysisId: string): unknown | null {
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

  // ── L3 DynamoDB-backed async helpers ──────────────────────────────────────
  // These check L1/L2 first and only hit DynamoDB on a miss (cost-optimized).

  /**
   * Get channel analysis from L1+L2 cache, falling back to DynamoDB (L3).
   * On DDB hit the result is written back into L1/L2 for subsequent fast reads.
   */
  async getChannelAnalysisWithCloud(channelId: string): Promise<unknown | null> {
    // L1 + L2 fast path
    const local = this.getChannelAnalysis(channelId);
    if (local !== null) return local;

    // L3: DynamoDB
    const aws = getCloudBackendService();
    const remote = await aws.getChannelAnalysis(channelId);
    if (remote !== null) {
      // Warm L1/L2 so next read is free
      this.setChannelAnalysis(channelId, remote);
    }
    return remote;
  }

  /**
   * Persist channel analysis to L1/L2 and fire-and-forget write to DynamoDB.
   */
  async setChannelAnalysisWithCloud(channelId: string, data: unknown): Promise<void> {
    this.setChannelAnalysis(channelId, data);
    // Non-blocking DDB write — errors are logged inside the service
    void getCloudBackendService().setChannelAnalysis(channelId, data);
  }

  /**
   * Get the analysis linked to a userId, checking L1/L2 then DynamoDB.
   */
  async getUserAnalysisWithCloud(userId: string): Promise<unknown | null> {
    // L1/L2 fast path
    const local = this.getUserAnalysis(userId);
    if (local !== null) return local;

    // L3: look up user→channel mapping in DDB
    const aws = getCloudBackendService();
    const channelId = await aws.getUserLink(userId);
    if (!channelId) return null;

    // Fetch the actual analysis (L1/L2 → DDB)
    return this.getChannelAnalysisWithCloud(channelId);
  }

  /**
   * Link a userId to a channelId in L1/L2 and DynamoDB.
   */
  async linkUserToChannelWithCloud(userId: string, channelId: string): Promise<boolean> {
    const local = this.linkUserToChannel(userId, channelId);
    try {
      await getCloudBackendService().setUserLink(userId, channelId);
    } catch (error) {
      console.warn('Cloud user-link persistence failed:', error);
    }
    return local;
  }
}

// Global singleton instances
export const globalCache = new CacheManager();
export const analysisCacheService = new AnalysisCacheService(globalCache);
