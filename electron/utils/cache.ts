import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { app } from 'electron';

const MAX_CACHE_SIZE_MB = 500; // 500MB max cache
const CACHE_DIR_NAME = '.quickcut';

export interface CacheEntry {
  key: string;
  filePath: string;
  type: 'thumbnail' | 'waveform';
  timestamp: number;
  size: number;
}

export class CacheManager {
  private cacheDir: string;
  private thumbsDir: string;
  private waveformsDir: string;
  private metadataDir: string;
  private indexPath: string;
  private index: Map<string, CacheEntry>;

  constructor() {
    // Use user's home directory for cache
    const homeDir = app.getPath('home');
    this.cacheDir = path.join(homeDir, CACHE_DIR_NAME, 'cache');
    this.thumbsDir = path.join(this.cacheDir, 'thumbs');
    this.waveformsDir = path.join(this.cacheDir, 'waveforms');
    this.metadataDir = path.join(this.cacheDir, 'metadata');
    this.indexPath = path.join(this.metadataDir, 'cache_index.json');
    this.index = new Map();

    this.initCache();
  }

  private initCache() {
    // Create cache directories if they don't exist
    [this.cacheDir, this.thumbsDir, this.waveformsDir, this.metadataDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Load existing index
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = fs.readFileSync(this.indexPath, 'utf-8');
        const entries: CacheEntry[] = JSON.parse(data);
        entries.forEach(entry => {
          this.index.set(entry.key, entry);
        });
        console.log(`Cache initialized with ${this.index.size} entries`);
      }
    } catch (error) {
      console.warn('Failed to load cache index:', error);
      this.index = new Map();
    }
  }

  /**
   * Generate a cache key based on file path, size, and modification time
   */
  public getCacheKey(filePath: string): string {
    try {
      const stats = fs.statSync(filePath);
      const hash = crypto.createHash('md5')
        .update(filePath + stats.size + stats.mtimeMs)
        .digest('hex');
      return hash;
    } catch {
      // If file doesn't exist or can't be accessed, generate key from path only
      return crypto.createHash('md5').update(filePath).digest('hex');
    }
  }

  /**
   * Get cached thumbnail data URI
   */
  public getThumbnail(filePath: string): string | null {
    const key = this.getCacheKey(filePath);
    const entry = this.index.get(key);
    
    if (entry && entry.type === 'thumbnail') {
      const cachePath = path.join(this.thumbsDir, `${key}.png`);
      if (fs.existsSync(cachePath)) {
        try {
          const data = fs.readFileSync(cachePath);
          return `data:image/png;base64,${data.toString('base64')}`;
        } catch (error) {
          console.warn('Failed to read cached thumbnail:', error);
          return null;
        }
      }
    }
    
    return null;
  }

  /**
   * Store thumbnail in cache
   */
  public setThumbnail(filePath: string, base64Data: string): void {
    const key = this.getCacheKey(filePath);
    const cachePath = path.join(this.thumbsDir, `${key}.png`);
    
    try {
      // Extract base64 data (remove data:image/png;base64, prefix if present)
      const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      
      fs.writeFileSync(cachePath, buffer);
      
      const entry: CacheEntry = {
        key,
        filePath,
        type: 'thumbnail',
        timestamp: Date.now(),
        size: buffer.length
      };
      
      this.index.set(key, entry);
      this.saveIndex();
      
      // Run cleanup if cache is getting large
      this.cleanupIfNeeded();
    } catch (error) {
      console.warn('Failed to cache thumbnail:', error);
    }
  }

  /**
   * Get cached waveform data URI
   */
  public getWaveform(filePath: string): string | null {
    const key = this.getCacheKey(filePath);
    const entry = this.index.get(key);
    
    if (entry && entry.type === 'waveform') {
      const cachePath = path.join(this.waveformsDir, `${key}.png`);
      if (fs.existsSync(cachePath)) {
        try {
          const data = fs.readFileSync(cachePath);
          return `data:image/png;base64,${data.toString('base64')}`;
        } catch (error) {
          console.warn('Failed to read cached waveform:', error);
          return null;
        }
      }
    }
    
    return null;
  }

  /**
   * Store waveform in cache
   */
  public setWaveform(filePath: string, base64Data: string): void {
    const key = this.getCacheKey(filePath);
    const cachePath = path.join(this.waveformsDir, `${key}.png`);
    
    try {
      // Extract base64 data
      const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      
      fs.writeFileSync(cachePath, buffer);
      
      const entry: CacheEntry = {
        key,
        filePath,
        type: 'waveform',
        timestamp: Date.now(),
        size: buffer.length
      };
      
      this.index.set(key, entry);
      this.saveIndex();
      
      this.cleanupIfNeeded();
    } catch (error) {
      console.warn('Failed to cache waveform:', error);
    }
  }

  /**
   * Save index to disk
   */
  private saveIndex(): void {
    try {
      const entries = Array.from(this.index.values());
      fs.writeFileSync(this.indexPath, JSON.stringify(entries, null, 2));
    } catch (error) {
      console.warn('Failed to save cache index:', error);
    }
  }

  /**
   * Clean up old cache entries if cache size exceeds limit
   */
  private cleanupIfNeeded(): void {
    const totalSize = Array.from(this.index.values())
      .reduce((sum, entry) => sum + entry.size, 0);
    
    const totalSizeMB = totalSize / (1024 * 1024);
    
    if (totalSizeMB > MAX_CACHE_SIZE_MB) {
      console.log(`Cache size (${totalSizeMB.toFixed(2)}MB) exceeds limit, cleaning up...`);
      this.cleanup(MAX_CACHE_SIZE_MB * 0.7); // Clean to 70% of max
    }
  }

  /**
   * Clean up cache to target size using LRU strategy
   */
  public cleanup(targetSizeMB: number = MAX_CACHE_SIZE_MB * 0.7): void {
    // Sort entries by timestamp (oldest first)
    const entries = Array.from(this.index.values())
      .sort((a, b) => a.timestamp - b.timestamp);
    
    let currentSize = entries.reduce((sum, entry) => sum + entry.size, 0);
    const targetSize = targetSizeMB * 1024 * 1024;
    
    for (const entry of entries) {
      if (currentSize <= targetSize) break;
      
      // Delete file
      const cachePath = entry.type === 'thumbnail'
        ? path.join(this.thumbsDir, `${entry.key}.png`)
        : path.join(this.waveformsDir, `${entry.key}.png`);
      
      try {
        if (fs.existsSync(cachePath)) {
          fs.unlinkSync(cachePath);
          currentSize -= entry.size;
          this.index.delete(entry.key);
          console.log(`Deleted cache entry: ${entry.key} (${entry.type})`);
        }
      } catch (error) {
        console.warn('Failed to delete cache file:', error);
      }
    }
    
    this.saveIndex();
    console.log(`Cache cleanup complete. New size: ${(currentSize / (1024 * 1024)).toFixed(2)}MB`);
  }

  /**
   * Clear all cache
   */
  public clearAll(): void {
    try {
      // Delete all files in cache directories
      const deleteDir = (dir: string) => {
        if (fs.existsSync(dir)) {
          fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            fs.unlinkSync(filePath);
          });
        }
      };
      
      deleteDir(this.thumbsDir);
      deleteDir(this.waveformsDir);
      
      // Clear index
      this.index.clear();
      this.saveIndex();
      
      console.log('Cache cleared');
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  public getStats(): { entries: number; sizeMB: number } {
    const totalSize = Array.from(this.index.values())
      .reduce((sum, entry) => sum + entry.size, 0);
    
    return {
      entries: this.index.size,
      sizeMB: totalSize / (1024 * 1024)
    };
  }
}

// Singleton instance
let cacheManager: CacheManager | null = null;

export const getCacheManager = (): CacheManager => {
  if (!cacheManager) {
    cacheManager = new CacheManager();
  }
  return cacheManager;
};
