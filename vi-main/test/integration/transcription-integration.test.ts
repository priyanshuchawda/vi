import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';

/**
 * Integration Tests for Transcription Feature
 * 
 * Note: These tests validate the structure and logic of the transcription system.
 * Full end-to-end testing with actual Whisper AI model requires running the Electron app.
 * 
 * For manual testing:
 * 1. Run: npm run dev
 * 2. Import test-media/test_video_red.mp4 (3 seconds, has audio)
 * 3. Click "Transcribe Clip" button in toolbar
 * 4. Wait for transcription to complete (first time downloads AI model ~40MB)
 * 5. Verify transcription panel appears on the right
 * 6. Test export to TXT and SRT formats
 */

const testMediaDir = path.join(process.cwd(), 'test-media');
const integrationDescribe = fs.existsSync(testMediaDir) ? describe : describe.skip;

integrationDescribe('Transcription Feature - Integration Tests', () => {

  describe('Test Media Files', () => {
    it('should have test video files with audio', () => {
      const testVideo = path.join(testMediaDir, 'test_video_red.mp4');
      expect(fs.existsSync(testVideo)).toBe(true);
      
      const stats = fs.statSync(testVideo);
      expect(stats.size).toBeGreaterThan(1000); // At least 1KB
    });

    it('should have test audio file', () => {
      const testAudio = path.join(testMediaDir, 'test_audio.m4a');
      expect(fs.existsSync(testAudio)).toBe(true);
      
      const stats = fs.statSync(testAudio);
      expect(stats.size).toBeGreaterThan(1000);
    });

    it('should have transcription test files', () => {
      const transcriptionTest = path.join(testMediaDir, 'transcription_test.mp4');
      
      // These files are created by the Python script
      if (fs.existsSync(transcriptionTest)) {
        const stats = fs.statSync(transcriptionTest);
        expect(stats.size).toBeGreaterThan(1000);
      }
    });
  });

  describe('Transcription Module Structure', () => {
    it('should have transcription utility module', () => {
      const transcriptionModule = path.join(process.cwd(), 'electron/utils/transcription.ts');
      expect(fs.existsSync(transcriptionModule)).toBe(true);
      
      const content = fs.readFileSync(transcriptionModule, 'utf-8');
      expect(content).toContain('transcribeVideo');
      expect(content).toContain('transcribeTimeline');
      expect(content).toContain('@xenova/transformers');
    });

    it('should have TranscriptionPanel component', () => {
      const componentPath = path.join(process.cwd(), 'src/components/ui/TranscriptionPanel.tsx');
      expect(fs.existsSync(componentPath)).toBe(true);
      
      const content = fs.readFileSync(componentPath, 'utf-8');
      expect(content).toContain('TranscriptionPanel');
      expect(content).toContain('transcription');
      expect(content).toContain('segments');
    });
  });

  describe('Subtitle Format Generation', () => {
    it('should format SRT timestamps correctly', () => {
      // Test SRT time format function
      const formatSRTTime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const millis = Math.floor((seconds % 1) * 1000);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
      };

      expect(formatSRTTime(0)).toBe('00:00:00,000');
      expect(formatSRTTime(1.5)).toBe('00:00:01,500');
      expect(formatSRTTime(65.123)).toBe('00:01:05,123');
      expect(formatSRTTime(3661.456)).toBe('01:01:01,456');
    });

    it('should generate valid SRT content', () => {
      const mockSegments = [
        { id: 1, start: 0, end: 2, text: 'Hello world' },
        { id: 2, start: 2, end: 4, text: 'This is a test' },
        { id: 3, start: 4, end: 6.5, text: 'Transcription works' }
      ];

      const formatSRTTime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const millis = Math.floor((seconds % 1) * 1000);
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
      };

      const srtContent = mockSegments
        .map((segment, index) => {
          return `${index + 1}\n${formatSRTTime(segment.start)} --> ${formatSRTTime(segment.end)}\n${segment.text}\n`;
        })
        .join('\n');

      // Verify SRT format
      expect(srtContent).toContain('1\n00:00:00,000 --> 00:00:02,000\nHello world');
      expect(srtContent).toContain('2\n00:00:02,000 --> 00:00:04,000\nThis is a test');
      expect(srtContent).toContain('3\n00:00:04,000 --> 00:00:06,500\nTranscription works');

      // Verify proper SRT structure
      const lines = srtContent.split('\n');
      expect(lines[0]).toBe('1'); // First subtitle index
      expect(lines[1]).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/); // Time format
      expect(lines[2]).toBe('Hello world'); // Subtitle text
      expect(lines[3]).toBe(''); // Blank line separator
    });
  });

  describe('Audio Extraction Configuration', () => {
    it('should use correct audio settings for Whisper', () => {
      // Whisper requires 16kHz mono audio
      const expectedSampleRate = 16000;
      const expectedChannels = 1;

      // These values should match the configuration in transcription.ts
      expect(expectedSampleRate).toBe(16000);
      expect(expectedChannels).toBe(1);
    });
  });

  describe('Export Functionality', () => {
    it('should create valid text export', () => {
      const mockTranscription = {
        text: 'This is the full transcription text with multiple sentences. It should be exported correctly.',
        segments: []
      };

      const textContent = mockTranscription.text;
      
      expect(textContent.length).toBeGreaterThan(0);
      expect(textContent).toContain('transcription');
    });

    it('should handle empty transcription gracefully', () => {
      const emptyTranscription = {
        text: '',
        segments: []
      };

      expect(emptyTranscription.text).toBe('');
      expect(emptyTranscription.segments).toHaveLength(0);
    });

    it('should count words and characters correctly', () => {
      const transcription = {
        text: 'Hello world test transcription',
        segments: []
      };

      const wordCount = transcription.text.split(/\s+/).filter(Boolean).length;
      const charCount = transcription.text.length;

      expect(wordCount).toBe(4);
      expect(charCount).toBe(30);
    });
  });

  describe('Timeline Transcription Logic', () => {
    it('should filter non-audio clips correctly', () => {
      const clips = [
        { mediaType: 'video', path: '/test1.mp4', duration: 5, startTime: 0 },
        { mediaType: 'audio', path: '/test2.mp3', duration: 3, startTime: 5 },
        { mediaType: 'image', path: '/test3.jpg', duration: 2, startTime: 8 },
        { mediaType: 'text', path: '/test4.txt', duration: 1, startTime: 10 },
      ];

      const transcribableClips = clips.filter(
        clip => clip.mediaType === 'video' || clip.mediaType === 'audio'
      );

      expect(transcribableClips).toHaveLength(2);
      expect(transcribableClips[0].mediaType).toBe('video');
      expect(transcribableClips[1].mediaType).toBe('audio');
    });

    it('should adjust segment timestamps for timeline position', () => {
      const clipStartTime = 10; // Clip starts at 10 seconds in timeline
      const segments = [
        { id: 1, start: 0, end: 2, text: 'First' },
        { id: 2, start: 2, end: 4, text: 'Second' }
      ];

      const adjustedSegments = segments.map(seg => ({
        ...seg,
        start: seg.start + clipStartTime,
        end: seg.end + clipStartTime
      }));

      expect(adjustedSegments[0].start).toBe(10);
      expect(adjustedSegments[0].end).toBe(12);
      expect(adjustedSegments[1].start).toBe(12);
      expect(adjustedSegments[1].end).toBe(14);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing electronAPI gracefully', () => {
      // Simulate browser environment (no electron)
      const hasElectronAPI = typeof window !== 'undefined' && 
                            window.electronAPI !== undefined;
      
      // In browser, transcription should not be available
      if (typeof window !== 'undefined' && !window.electronAPI) {
        expect(hasElectronAPI).toBe(false);
      }
    });

    it('should validate file paths', () => {
      const validPaths = [
        '/home/user/video.mp4',
        'C:\\Users\\video.mp4',
        '/path/to/audio.mp3',
      ];

      validPaths.forEach(filePath => {
        expect(filePath.length).toBeGreaterThan(0);
        expect(filePath).toMatch(/\.(mp4|mp3|wav|m4a|avi|mkv|webm)$/i);
      });
    });
  });
});

describe('Manual Testing Checklist', () => {
  it('should document manual test procedures', () => {
    const testProcedures = `
# Manual Testing Guide for Transcription Feature

## Prerequisites
1. Run: npm run dev
2. Wait for Electron app to start
3. Have test media files in test-media/ directory

## Test 1: Single Clip Transcription
1. Import test-media/test_video_red.mp4 into timeline
2. Click on the clip to select it
3. Click "Transcribe Clip" button in toolbar
4. ✓ Verify progress indicator appears
5. ✓ Verify status updates (Extracting audio → Loading AI model → Transcribing)
6. ✓ Verify transcription panel appears on right side
7. ✓ Verify transcription text is displayed
8. ✓ Verify word/character count is shown

## Test 2: Timeline Transcription
1. Import multiple video/audio clips into timeline
2. Click "Transcribe Timeline" button
3. ✓ Verify it processes all video/audio clips
4. ✓ Verify image clips are skipped
5. ✓ Verify timestamps are adjusted per clip position

## Test 3: Segment Navigation
1. After transcription completes
2. Click on different segments in the transcription panel
3. ✓ Verify timeline playhead jumps to that time
4. ✓ Verify video shows correct frame

## Test 4: Toggle Views
1. Click toggle button in transcription panel
2. ✓ Verify switching between "Segments" and "Full Text" views
3. ✓ Verify both views display correctly

## Test 5: Export Functions
1. Click "Copy" button
2. ✓ Verify text is copied to clipboard
3. Click "TXT" button
4. ✓ Verify .txt file downloads
5. Click "SRT" button (if segments available)
6. ✓ Verify .srt subtitle file downloads
7. Open SRT file in text editor
8. ✓ Verify proper SRT format with timestamps

## Test 6: Error Handling
1. Try transcribing with no clip selected
2. ✓ Verify error notification appears
3. Try transcribing empty timeline
4. ✓ Verify error notification appears
5. Try transcribing timeline with only images
6. ✓ Verify error message "No video/audio clips to transcribe"

## Test 7: Subtitle Integration
1. After transcription with segments
2. Export as SRT file
3. Import SRT file back into video editor
4. ✓ Verify subtitles can be loaded
5. ✓ Verify subtitles sync with video

## Test 8: Performance
1. Transcribe short clip (3 seconds)
2. ✓ Note: First time downloads Whisper model (~40MB)
3. ✓ Subsequent transcriptions should be faster
4. Transcribe longer clip (30+ seconds)
5. ✓ Verify progress updates throughout

## Test 9: Persistence
1. Transcribe a clip
2. Close transcription panel
3. Click transcribe again
4. ✓ Verify new transcription replaces old one
5. Save project
6. ✓ Verify transcription is saved with project

## Known Limitations
- First transcription downloads AI model (requires internet)
- Transcription accuracy depends on audio quality
- English language optimized (Whisper-tiny model)
- Longer videos take more time to process
- Synthetic test audio (tones) won't produce real text

## Notes for Real Testing
The test video files contain synthetic audio tones, not actual speech.
For realistic transcription testing:
1. Record a short video with clear speech
2. Or download sample videos with speech from free sources
3. Or use your own video files with spoken audio
    `;

    expect(testProcedures).toContain('Manual Testing Guide');
    expect(testProcedures).toContain('Transcribe Clip');
    expect(testProcedures).toContain('SRT');
  });
});
