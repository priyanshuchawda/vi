import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { Model, Recognizer, setLogLevel } from 'vosk-koffi';

// Configure FFmpeg paths
function configureFfmpeg() {
  let ffmpegPath = '';
  let ffprobePath = '';

  if (app.isPackaged) {
    const platform = process.platform;
    let platformFolder = '';
    let binaryName = 'ffmpeg';
    let probeName = 'ffprobe';

    if (platform === 'darwin') {
      platformFolder = 'ffmpeg-mac';
    } else if (platform === 'win32') {
      platformFolder = 'ffmpeg-win';
      binaryName = 'ffmpeg.exe';
      probeName = 'ffprobe.exe';
    } else if (platform === 'linux') {
      platformFolder = 'ffmpeg-linux';
    }

    ffmpegPath = path.join(process.resourcesPath, 'resources', platformFolder, binaryName);
    ffprobePath = path.join(process.resourcesPath, 'resources', platformFolder, probeName);
  } else {
    const platform = process.platform;
    let platformFolder = '';
    let binaryName = 'ffmpeg';
    let probeName = 'ffprobe';

    if (platform === 'darwin') {
      platformFolder = 'ffmpeg-mac';
    } else if (platform === 'win32') {
      platformFolder = 'ffmpeg-win';
      binaryName = 'ffmpeg.exe';
      probeName = 'ffprobe.exe';
    } else if (platform === 'linux') {
      platformFolder = 'ffmpeg-linux';
    }

    ffmpegPath = path.join(app.getAppPath(), 'resources', platformFolder, binaryName);
    ffprobePath = path.join(app.getAppPath(), 'resources', platformFolder, probeName);
  }

  if (fs.existsSync(ffmpegPath)) {
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log('FFmpeg path set for transcription:', ffmpegPath);
  } else {
    console.warn('FFmpeg binary not found at:', ffmpegPath);
  }

  if (fs.existsSync(ffprobePath)) {
    ffmpeg.setFfprobePath(ffprobePath);
  } else {
    console.warn('FFprobe binary not found at:', ffprobePath);
  }
}

// Configure FFmpeg on module load
configureFfmpeg();

// Suppress Vosk logs
setLogLevel(-1);

// Cache the model instance for reuse
let cachedModel: Model | null = null;

/**
 * Get the Vosk model path based on whether app is packaged
 */
function getModelPath(): string {
  const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const modelPath = path.join(basePath, 'resources', 'vosk-model', 'vosk-model-en-us-0.22-lgraph');
  console.log('Using Vosk model:', modelPath);
  return modelPath;
}

/**
 * Get or create the Vosk model instance
 */
function getModel(): Model {
  if (cachedModel) {
    return cachedModel;
  }

  const modelPath = getModelPath();

  if (!fs.existsSync(modelPath)) {
    throw new Error(`Vosk model not found at ${modelPath}. Please download the model from https://alphacephei.com/vosk/models`);
  }

  console.log('Loading Vosk model from:', modelPath);
  cachedModel = new Model(modelPath);
  console.log('Vosk model loaded successfully');

  return cachedModel;
}

/**
 * Transcribe audio using Node.js Vosk (vosk-koffi)
 */
async function transcribeWithVosk(audioPath: string): Promise<TranscriptionResult> {
  return new Promise((resolve, reject) => {
    try {
      const model = getModel();

      // Create recognizer with word timestamps enabled
      const recognizer = new Recognizer({
        model,
        sampleRate: 16000,
      });
      recognizer.setWords(true);

      // Read the WAV file
      const audioBuffer = fs.readFileSync(audioPath);

      // Skip WAV header (44 bytes for standard WAV)
      const audioData = audioBuffer.subarray(44);

      const results: Array<{ result: Array<{ word: string; start: number; end: number; conf?: number }>; text: string }> = [];
      const fullText: string[] = [];

      // Process audio in chunks (8000 samples = 0.5 seconds at 16kHz, 16-bit = 16000 bytes)
      const chunkSize = 16000; // 0.5 seconds of 16-bit audio at 16kHz
      let offset = 0;

      while (offset < audioData.length) {
        const chunk = audioData.subarray(offset, Math.min(offset + chunkSize, audioData.length));
        offset += chunkSize;

        if (recognizer.acceptWaveform(chunk)) {
          const resultStr = recognizer.resultString();
          if (resultStr) {
            try {
              const result = JSON.parse(resultStr);
              if (result.text) {
                results.push(result);
                fullText.push(result.text);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Get final result
      const finalResultStr = recognizer.resultString();
      if (finalResultStr) {
        try {
          const finalResult = JSON.parse(finalResultStr);
          if (finalResult.text) {
            results.push(finalResult);
            fullText.push(finalResult.text);
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Free the recognizer
      recognizer.free();

      // 1. Collect all words from all results into a single timeline
      const allWords: Array<{ word: string; start: number; end: number; conf?: number }> = [];
      results.forEach(r => {
        if (r.result) {
          allWords.push(...r.result);
        }
      });

      // 2. Group words into subtitle-friendly segments
      // Constraints: Max ~40-50 chars or ~2-3 seconds, split on gaps > 0.5s
      const segments: TranscriptionSegment[] = [];
      let segmentId = 1;

      if (allWords.length > 0) {
        let currentSegmentWords: typeof allWords = [];
        let currentSegmentCharCount = 0;
        let lastWordEnd = 0;

        for (const wordObj of allWords) {
          const timeSinceLastWord = wordObj.start - lastWordEnd;
          const wordLen = wordObj.word.length;

          // Decide whether to start a new segment
          const isGap = currentSegmentWords.length > 0 && timeSinceLastWord > 0.8; // >0.8s silence
          const isTooLong = currentSegmentCharCount + wordLen > 42; // >42 chars (standard subtitle width)

          if (isGap || isTooLong) {
            // Commit current segment
            if (currentSegmentWords.length > 0) {
              segments.push({
                id: segmentId++,
                start: currentSegmentWords[0].start,
                end: currentSegmentWords[currentSegmentWords.length - 1].end,
                text: currentSegmentWords.map(w => w.word).join(' '),
                words: [...currentSegmentWords],
              });
            }
            // Start new segment
            currentSegmentWords = [wordObj];
            currentSegmentCharCount = wordLen;
          } else {
            // Add to current
            currentSegmentWords.push(wordObj);
            currentSegmentCharCount += (currentSegmentWords.length > 1 ? 1 : 0) + wordLen; // +1 for space
          }

          lastWordEnd = wordObj.end;
        }

        // Push final segment
        if (currentSegmentWords.length > 0) {
          segments.push({
            id: segmentId++,
            start: currentSegmentWords[0].start,
            end: currentSegmentWords[currentSegmentWords.length - 1].end,
            text: currentSegmentWords.map(w => w.word).join(' '),
            words: [...currentSegmentWords],
          });
        }
      }

      resolve({
        text: fullText.join(' ').trim(),
        segments,
        words: allWords,
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Check if video has an audio stream
 */
async function hasAudioStream(videoPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      // Check if any stream is audio
      const hasAudio = metadata.streams.some(stream => stream.codec_type === 'audio');
      resolve(hasAudio);
    });
  });
}

/**
 * Extract audio from video file to WAV format for transcription
 */
async function extractAudio(videoPath: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      // First, check if video has audio stream
      const hasAudio = await hasAudioStream(videoPath);
      if (!hasAudio) {
        reject(new Error('This video does not contain an audio track. Please select a video with audio to generate captions.'));
        return;
      }

      // Use userData directory instead of temp, as it's more reliable
      const tempDir = path.join(app.getPath('userData'), 'temp');

      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const audioPath = path.join(tempDir, `audio_${Date.now()}.wav`);

      console.log('Extracting audio to:', audioPath);
      console.log('From video:', videoPath);

      ffmpeg(videoPath)
        .output(audioPath)
        .audioCodec('pcm_s16le') // 16-bit PCM audio
        .audioFrequency(16000) // Vosk expects 16kHz audio
        .audioChannels(1) // Mono audio
        .format('wav')
        .on('start', (commandLine) => {
          console.log('FFmpeg command:', commandLine);
        })
        .on('end', () => {
          console.log('Audio extraction complete:', audioPath);
          resolve(audioPath);
        })
        .on('error', (err: Error, stdout, stderr) => {
          console.error('Audio extraction failed:', err.message);
          if (stderr) console.error('FFmpeg stderr:', stderr);
          reject(new Error(`FFmpeg error: ${err.message}`));
        })
        .run();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Transcribe audio from a video file using Vosk (pure Node.js)
 */
export async function transcribeVideo(
  videoPath: string,
  progressCallback?: (progress: { status: string; progress?: number }) => void
): Promise<TranscriptionResult> {
  let audioPath: string | null = null;

  try {
    // Report status
    progressCallback?.({ status: 'Extracting audio...', progress: 10 });

    // Extract audio from video
    audioPath = await extractAudio(videoPath);

    // Transcribe with Vosk (Node.js native)
    progressCallback?.({ status: 'Transcribing with Vosk...', progress: 50 });
    const result = await transcribeWithVosk(audioPath);

    // Clean up temporary audio file
    if (audioPath && fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    progressCallback?.({ status: 'Complete', progress: 100 });

    return result;
  } catch (error) {
    // Clean up on error
    if (audioPath && fs.existsSync(audioPath)) {
      try {
        fs.unlinkSync(audioPath);
      } catch (e) {
        console.error('Failed to clean up audio file:', e);
      }
    }
    console.error('Transcription error:', error);
    throw error;
  }
}

/**
 * Transcribe audio from multiple video clips in a timeline
 */
export async function transcribeTimeline(
  clips: Array<{ path: string; startTime: number; duration: number }>,
  progressCallback?: (progress: { status: string; progress?: number; clip?: number }) => void
): Promise<TranscriptionResult> {
  const allSegments: TranscriptionSegment[] = [];
  const allWords: TranscriptionWord[] = [];
  let fullText = '';
  let globalSegmentId = 1;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];

    progressCallback?.({
      status: `Transcribing clip ${i + 1} of ${clips.length}...`,
      progress: Math.round((i / clips.length) * 100),
      clip: i + 1,
    });

    try {
      const clipResult = await transcribeVideo(clip.path, (subProgress) => {
        const overallProgress = (i / clips.length) * 100 + (subProgress.progress || 0) / clips.length;
        progressCallback?.({
          status: `Clip ${i + 1}/${clips.length}: ${subProgress.status}`,
          progress: Math.round(overallProgress),
          clip: i + 1,
        });
      });

      // Adjust timestamps based on clip position in timeline and reassign segment IDs
      const adjustedSegments = clipResult.segments.map(seg => ({
        id: globalSegmentId++,
        start: seg.start + clip.startTime,
        end: seg.end + clip.startTime,
        text: seg.text,
        words: seg.words?.map(w => ({
          ...w,
          start: w.start + clip.startTime,
          end: w.end + clip.startTime,
        })),
      }));

      // Adjust word timestamps
      const adjustedWords = clipResult.words.map(w => ({
        ...w,
        start: w.start + clip.startTime,
        end: w.end + clip.startTime,
      }));

      allSegments.push(...adjustedSegments);
      allWords.push(...adjustedWords);
      fullText += (fullText ? ' ' : '') + clipResult.text;
    } catch (error) {
      console.error(`Failed to transcribe clip ${i + 1}:`, error);
      // Continue with other clips even if one fails
    }
  }

  progressCallback?.({ status: 'Complete', progress: 100 });

  return {
    text: fullText,
    segments: allSegments,
    words: allWords,
  };
}

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  conf?: number;
}

export interface TranscriptionSegment {
  id: number;
  start: number; // Start time in seconds
  end: number; // End time in seconds
  text: string;
  words?: TranscriptionWord[];
}

export interface TranscriptionResult {
  text: string; // Full transcription text
  segments: TranscriptionSegment[]; // Timestamped segments
  words: TranscriptionWord[]; // Word-level timestamps
}
