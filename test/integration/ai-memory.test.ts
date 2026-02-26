/**
 * Integration test for AI Memory Service
 * Tests the actual memory analysis and storage functionality
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { queueMediaAnalysis, isMemoryServiceAvailable } from '../../src/lib/aiMemoryService';
import { useAiMemoryStore } from '../../src/stores/useAiMemoryStore';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

const TEST_VIDEO_PATH = path.join(homedir(), 'Downloads', 'videoplayback.mp4');
const MEMORY_DIR = path.join(homedir(), '.config', 'QuickCut', 'ai_memory');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memory.json');

describe('AI Memory Service Integration', () => {
  let testEntryId: string;
  let videoStats: fs.Stats;

  beforeAll(async () => {
    // Check if test video exists
    if (!fs.existsSync(TEST_VIDEO_PATH)) {
      throw new Error(`Test video not found: ${TEST_VIDEO_PATH}`);
    }

    // Get video file stats
    videoStats = fs.statSync(TEST_VIDEO_PATH);

    // Mock Electron API with correct method names (from preload.ts)
    global.window = {
      electronAPI: {
        readFileAsBase64: async (filePath: string) => {
          const buffer = fs.readFileSync(filePath);
          return buffer.toString('base64');
        },
        memorySave: async (data: any) => {
          if (!fs.existsSync(MEMORY_DIR)) {
            fs.mkdirSync(MEMORY_DIR, { recursive: true });
          }
          fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
        },
        memorySaveMarkdown: async (entry: any) => {
          // Mock markdown save (not needed for this test)
        }
      }
    } as any;

    // Clear existing memory before test
    if (fs.existsSync(MEMORY_FILE)) {
      fs.unlinkSync(MEMORY_FILE);
    }
    
    // Clear zustand store state
    useAiMemoryStore.setState({ entries: [], isAnalyzing: false, analyzingCount: 0 });
  });

  afterAll(() => {
    // Cleanup mock
    delete (global as any).window;
  });

  it('should verify AI Memory service is available', () => {
    expect(isMemoryServiceAvailable()).toBe(true);
  });

  it('should queue video for analysis', () => {
    const store = useAiMemoryStore.getState();
    
    testEntryId = queueMediaAnalysis({
      filePath: TEST_VIDEO_PATH,
      fileName: 'videoplayback.mp4',
      mediaType: 'video',
      mimeType: 'video/mp4',
      fileSize: videoStats.size,
      duration: 15.850667,
    });

    expect(testEntryId).toBeDefined();
    expect(testEntryId).toMatch(/^[0-9a-f-]+$/); // UUID format

    const entry = store.entries.find(e => e.id === testEntryId);
    expect(entry).toBeDefined();
    expect(entry?.fileName).toBe('videoplayback.mp4');
    expect(entry?.status).toMatch(/pending|analyzing/);
  });

  it('should complete analysis within reasonable time', async () => {
    const MAX_WAIT_MS = 120_000; // 2 minutes
    const POLL_INTERVAL_MS = 2_000;
    
    let elapsed = 0;
    let entry;

    console.log('⏳ Waiting for analysis to complete...');

    while (elapsed < MAX_WAIT_MS) {
      // Get fresh state on each iteration
      const currentState = useAiMemoryStore.getState();
      entry = currentState.entries.find(e => e.id === testEntryId);
      
      if (entry?.status === 'completed') {
        console.log(`✅ Analysis completed in ${(elapsed / 1000).toFixed(1)}s`);
        break;
      }

      if (entry?.status === 'failed') {
        throw new Error(`Analysis failed: ${entry.error}`);
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      elapsed += POLL_INTERVAL_MS;

      console.log(`⏳ Status: ${entry?.status} (${(elapsed / 1000).toFixed(0)}s elapsed)`);
    }

    // Final check with fresh state
    const finalState = useAiMemoryStore.getState();
    entry = finalState.entries.find(e => e.id === testEntryId);

    expect(entry?.status).toBe('completed');
    expect(entry?.analysis).toBeDefined();
    expect(entry?.analysis.length).toBeGreaterThan(0);
  }, 150_000); // 2.5 minute timeout for this test

  it('should have valid analysis data', () => {
    const store = useAiMemoryStore.getState();
    const entry = store.entries.find(e => e.id === testEntryId);

    expect(entry).toBeDefined();
    expect(entry?.summary).toBeDefined();
    expect(entry?.summary.length).toBeGreaterThan(0);
    expect(entry?.tags).toBeDefined();
    expect(Array.isArray(entry?.tags)).toBe(true);
    expect(entry?.tags.length).toBeGreaterThan(0);
    expect(entry?.analysis).toBeDefined();
    expect(entry?.analysis.length).toBeGreaterThan(50); // Should have substantial content

    console.log('📊 Analysis Results:');
    console.log(`   Summary: ${entry?.summary}`);
    console.log(`   Tags: ${entry?.tags.join(', ')}`);
    console.log(`   Analysis length: ${entry?.analysis.length} chars`);
  });

  it('should save memory to disk', async () => {
    const store = useAiMemoryStore.getState();
    
    // Trigger save
    store.saveToDisk();

    // Wait a bit for async save
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check file exists
    expect(fs.existsSync(MEMORY_FILE)).toBe(true);

    // Read and validate
    const savedData = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
    expect(savedData.version).toBe(1);
    expect(savedData.entries).toBeDefined();
    expect(Array.isArray(savedData.entries)).toBe(true);
    expect(savedData.entries.length).toBeGreaterThan(0);

    const savedEntry = savedData.entries.find((e: any) => e.id === testEntryId);
    expect(savedEntry).toBeDefined();
    expect(savedEntry.status).toBe('completed');
    expect(savedEntry.analysis).toBeDefined();

    console.log('💾 Memory saved to:', MEMORY_FILE);
    console.log(`   Total entries: ${savedData.entries.length}`);
  });

  it('should retrieve memory context string', () => {
    const store = useAiMemoryStore.getState();
    const context = store.getMemoryContextString();

    expect(context).toBeDefined();
    expect(context.length).toBeGreaterThan(0);
    expect(context).toContain('videoplayback.mp4');

    console.log('📝 Memory context length:', context.length, 'chars');
  });
});
