import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { getCacheManager } from '../utils/cache.js';

// Determine the platform and path to the bundled ffmpeg binary
let ffmpegPath = '';
let ffprobePath = '';

if (app.isPackaged) {
  // Production path
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
  // Development path (relative to project root)
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

// Set the path for fluent-ffmpeg
console.log('FFmpeg Path set to:', ffmpegPath);
console.log('FFprobe Path set to:', ffprobePath);

// Check if paths exist
if (fs.existsSync(ffmpegPath)) {
  ffmpeg.setFfmpegPath(ffmpegPath);
} else {
  console.warn('FFmpeg binary not found at:', ffmpegPath);
}

if (fs.existsSync(ffprobePath)) {
  ffmpeg.setFfprobePath(ffprobePath);
} else {
  console.warn('FFprobe binary not found at:', ffprobePath);
}

export const generateThumbnail = async (filePath: string): Promise<string> => {
  const cache = getCacheManager();
  
  // Check cache first
  const cached = cache.getThumbnail(filePath);
  if (cached) {
    console.log('Thumbnail cache hit:', filePath);
    return cached;
  }

  return new Promise((resolve, reject) => {
    const filename = `thumb_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
    const tempDir = app.getPath('temp');
    const outputPath = path.join(tempDir, filename);

    ffmpeg(filePath)
      .screenshots({
        count: 1,
        timemarks: ['1'], // Take screenshot at 1 second
        folder: tempDir,
        filename: filename,
        size: '320x180' // Standard 16:9 thumbnail size
      })
      .on('end', () => {
        try {
          const data = fs.readFileSync(outputPath);
          const base64 = `data:image/png;base64,${data.toString('base64')}`;
          // Clean up
          fs.unlinkSync(outputPath);
          // Store in cache
          cache.setThumbnail(filePath, base64);
          resolve(base64);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err: Error) => {
        console.error('Thumbnail generation failed:', err);
        reject(err);
      });
  });
};

export const generateWaveform = async (filePath: string): Promise<string> => {
  const cache = getCacheManager();
  
  // Check cache first
  const cached = cache.getWaveform(filePath);
  if (cached) {
    console.log('Waveform cache hit:', filePath);
    return cached;
  }

  return new Promise((resolve, reject) => {
    const filename = `wave_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
    const tempDir = app.getPath('temp');
    const outputPath = path.join(tempDir, filename);

    ffmpeg(filePath)
      .complexFilter([
        'aformat=channel_layouts=mono,showwavespic=s=2048x240:colors=#0ea5e9,scale=2048:120,pad=2048:120:0:(oh-ih)/2:color=black@0[outv]'
      ])
      .outputOptions(['-map [outv]', '-f image2', '-vframes 1'])
      .output(outputPath)
      .on('start', (cmd) => console.log('Waveform command:', cmd))
      .on('end', () => {
        try {
          const data = fs.readFileSync(outputPath);
          const base64 = `data:image/png;base64,${data.toString('base64')}`;
          fs.unlinkSync(outputPath);
          // Store in cache
          cache.setWaveform(filePath, base64);
          resolve(base64);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err: Error) => {
        console.error('Waveform generation failed:', err);
        // Resolve with empty string or handle error gracefully so it doesn't crash the app
        // Just resolve null or empty string to indicate no waveform
        resolve(''); 
      })
      .run();
  });
};

export const convertImageToVideo = (imagePath: string, duration: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const filename = `img_video_${Date.now()}_${Math.random().toString(36).substring(7)}.mp4`;
    const tempDir = app.getPath('temp');
    const outputPath = path.join(tempDir, filename);

    ffmpeg(imagePath)
      .loop(duration)
      .inputFPS(1)
      .fps(30)
      .videoCodec('libx264')
      .outputOptions([
        '-pix_fmt yuv420p',
        '-t ' + duration,
        '-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black'
      ])
      .output(outputPath)
      .on('start', (cmd) => console.log('Image to video conversion command:', cmd))
      .on('end', () => {
        console.log('Image converted to video:', outputPath);
        resolve(outputPath);
      })
      .on('error', (err: Error) => {
        console.error('Image to video conversion failed:', err);
        reject(err);
      })
      .run();
  });
};

export const exportVideo = async (
  clips: any[], 
  eventSender: Electron.WebContents, 
  outputPath: string, 
  format: string = 'mp4',
  resolution?: string, // e.g., '1920x1080', '1280x720', '854x480'
  subtitles?: any[], // Subtitle entries
  subtitleStyle?: any // Subtitle styling
) => {
  return new Promise<boolean>(async (resolve, reject) => {
    // Separate text clips from media clips
    const textClips = clips.filter((clip: any) => clip.mediaType === 'text');
    const mediaClips = clips.filter((clip: any) => clip.mediaType !== 'text');

    // Helper: Check if file is an image
    const isImage = (filePath: string) => {
      const ext = path.extname(filePath).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(ext);
    };

    // Helper: Convert image to video segment with proper duration
    const convertImageSegment = async (imagePath: string, duration: number, outputPath: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        ffmpeg(imagePath)
          .loop(duration)
          .inputFPS(1)
          .fps(30)
          .videoCodec('libx264')
          .outputOptions([
            '-pix_fmt yuv420p',
            '-t ' + duration,
            '-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black'
          ])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err))
          .run();
      });
    };

    // Helper: Build video speed + color effects filter string for a segment
    const buildSegmentVideoFilter = (seg: any): string => {
      const parts: string[] = [];
      const speed = seg.speed ?? 1;
      const fx = seg.effects ?? {};

      if (speed !== 1) {
        // setpts changes video speed; PTS_SPEED = 1/speed
        parts.push(`setpts=${(1 / speed).toFixed(6)}*PTS`);
      }
      // eq filter for brightness/contrast/saturation/gamma
      const br = fx.brightness ?? 0;   // -1 to 1, default 0
      const co = fx.contrast ?? 1;     // 0 to 3,  default 1
      const sa = fx.saturation ?? 1;   // 0 to 3,  default 1
      const ga = fx.gamma ?? 1;        // 0.1–10,  default 1
      if (br !== 0 || co !== 1 || sa !== 1 || ga !== 1) {
        parts.push(`eq=brightness=${br}:contrast=${co}:saturation=${sa}:gamma=${ga}`);
      }
      return parts.join(',');
    };

    // Helper: Build audio speed filter chain for atempo (range 0.5–2.0; chain for outside that)
    const buildAtempoChain = (speed: number): string => {
      if (speed === 1) return '';
      const filters: string[] = [];
      let remaining = speed;
      // Chain atempo filters — each must stay in 0.5–2.0 range
      while (remaining > 2.0) {
        filters.push('atempo=2.0');
        remaining /= 2.0;
      }
      while (remaining < 0.5) {
        filters.push('atempo=0.5');
        remaining /= 0.5;
      }
      filters.push(`atempo=${remaining.toFixed(6)}`);
      return filters.join(',');
    };

    // Helper: Generate drawtext filters for text clips
    const generateTextFilters = (textClips: any[]) => {
      if (textClips.length === 0) return '';
      
      const filters: string[] = [];
      
      textClips.forEach((clip: any) => {
        const props = clip.textProperties;
        if (!props) return;
        
        // Escape text for FFmpeg (replace single quotes and special chars)
        const escapedText = props.text
          .replace(/\\/g, '\\\\\\\\')
          .replace(/'/g, "\\\\'")
          .replace(/:/g, '\\:')
          .replace(/\n/g, '\\n');
        
        // Calculate position
        let x = 'w/2';
        let y = 'h/2';
        
        if (props.position === 'top') {
          y = 'h*0.1';
        } else if (props.position === 'bottom') {
          y = 'h*0.9';
        }
        
        // Text alignment
        if (props.align === 'left') {
          x = 'w*0.1';
        } else if (props.align === 'right') {
          x = 'w*0.9';
        }
        
        // Build drawtext filter
        let drawtextFilter = `drawtext=text='${escapedText}'`;
        drawtextFilter += `:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf`;
        drawtextFilter += `:fontsize=${props.fontSize}`;
        drawtextFilter += `:fontcolor=${props.color}`;
        drawtextFilter += `:x=${x}-text_w/2`;
        drawtextFilter += `:y=${y}-text_h/2`;
        
        if (props.bold) {
          drawtextFilter += `:font=bold`;
        }
        
        if (props.backgroundColor) {
          drawtextFilter += `:box=1:boxcolor=${props.backgroundColor}:boxborderw=10`;
        }
        
        if (props.outline) {
          drawtextFilter += `:borderw=2:bordercolor=${props.outlineColor || '#000000'}`;
        }
        
        // Time-based enable (when to show the text)
        const startTime = clip.startTime;
        const endTime = clip.startTime + clip.duration;
        drawtextFilter += `:enable='between(t,${startTime},${endTime})'`;
        
        filters.push(drawtextFilter);
      });
      
      return filters.join(',');
    };

    const segments = mediaClips.flatMap((clip) => {
      if (clip.segments && clip.isMerged) {
        return clip.segments.map((seg: any) => ({
          path: seg.sourcePath,
          start: seg.sourceStart,
          end: seg.sourceEnd,
          volume: clip.volume ?? 1,
          muted: clip.muted ?? false,
          mediaType: clip.mediaType,
          duration: seg.duration || (seg.sourceEnd - seg.sourceStart),
          fadeIn: clip.fadeIn ?? 0,
          fadeOut: clip.fadeOut ?? 0,
          speed: clip.speed ?? 1,
          effects: clip.effects ?? null,
        }));
      }
      return [{
        path: clip.path,
        start: clip.start,
        end: clip.end,
        volume: clip.volume ?? 1,
        muted: clip.muted ?? false,
        mediaType: clip.mediaType,
        duration: clip.duration || (clip.end - clip.start),
        fadeIn: clip.fadeIn ?? 0,
        fadeOut: clip.fadeOut ?? 0,
        speed: clip.speed ?? 1,
        effects: clip.effects ?? null,
      }];
    });

    if (segments.length === 0) {
      return reject(new Error('No segments to export'));
    }

    const tempDir = app.getPath('temp');
    const tempFiles: string[] = [];

    try {
      // Generate SRT file if subtitles exist
      let subtitleFilePath: string | null = null;
      if (subtitles && subtitles.length > 0) {
        subtitleFilePath = path.join(tempDir, `subtitles_${Date.now()}.srt`);
        
        // Generate SRT content
        const srtContent = subtitles
          .map((sub: any) => {
            const formatTime = (seconds: number): string => {
              const hours = Math.floor(seconds / 3600);
              const minutes = Math.floor((seconds % 3600) / 60);
              const secs = Math.floor(seconds % 60);
              const millis = Math.floor((seconds % 1) * 1000);
              return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${millis.toString().padStart(3, '0')}`;
            };
            
            return `${sub.index}\n${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n${sub.text}\n`;
          })
          .join('\n');
        
        fs.writeFileSync(subtitleFilePath, srtContent, 'utf-8');
        tempFiles.push(subtitleFilePath);
        console.log('Generated subtitle file:', subtitleFilePath);
      }

      // Pre-process images: convert to temporary video files
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (isImage(seg.path)) {
          const tempVideoPath = path.join(tempDir, `export_img_${Date.now()}_${i}.mp4`);
          console.log(`Converting image to video for export: ${seg.path} (${seg.duration}s)`);
          await convertImageSegment(seg.path, seg.duration, tempVideoPath);
          tempFiles.push(tempVideoPath);
          // Replace the segment path with the temp video
          seg.path = tempVideoPath;
          seg.start = 0;
          seg.end = seg.duration;
        }
      }

      const command = ffmpeg();

      // Add each segment as a separate input with input options to trim
      segments.forEach((seg: any) => {
        command
          .input(seg.path)
          .inputOptions([
            `-ss ${seg.start}`,
            `-t ${seg.end - seg.start}`
          ]);
      });

      console.log('Export segments:', segments);

      // Format-specific codec settings
      const formatConfig: { [key: string]: { video: string; audio: string; options: string[] } } = {
        mp4: { video: 'libx264', audio: 'aac', options: ['-preset fast', '-crf 23'] },
        mov: { video: 'libx264', audio: 'aac', options: ['-preset fast', '-crf 23'] },
        avi: { video: 'mpeg4', audio: 'mp3', options: ['-q:v 5'] },
        webm: { video: 'libvpx-vp9', audio: 'libopus', options: ['-crf 30', '-b:v 2M'] },
      };
      
      const config = formatConfig[format] || formatConfig.mp4;

      // Detect stream types from first segment
      let hasVideoStream = false;
      let hasAudioStream = false;

      await new Promise<void>((resolveProbe) => {
        ffmpeg.ffprobe(segments[0].path, (err: any, metadata: any) => {
          if (!err && metadata) {
            hasVideoStream = metadata.streams.some((s: any) => s.codec_type === 'video');
            hasAudioStream = metadata.streams.some((s: any) => s.codec_type === 'audio');
          }
          resolveProbe();
        });
      });

      console.log('Stream detection:', { hasVideoStream, hasAudioStream });

      // SMART STREAM COPYING: Check if we can copy instead of re-encode
      let canUseStreamCopy = false;
      // Disable stream copy if there are text overlays or subtitles (we need to re-encode to burn text)
      if (segments.length === 1 && !resolution && segments[0].volume === 1 && !segments[0].muted && textClips.length === 0 && !subtitleFilePath && (segments[0].speed ?? 1) === 1 && !segments[0].effects) {
        // Check if we're exporting the full clip without cuts
        await new Promise<void>((resolveCheck) => {
          ffmpeg.ffprobe(segments[0].path, (err: any, metadata: any) => {
            if (!err && metadata) {
              const videoDuration = metadata.format.duration;
              const segmentDuration = segments[0].end - segments[0].start;
              const isFullClip = segments[0].start === 0 && Math.abs(videoDuration - segmentDuration) < 0.1;
              
              // Check codec compatibility
              const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
              const audioStream = metadata.streams.find((s: any) => s.codec_type === 'audio');
              
              const isCompatibleCodec = 
                (format === 'mp4' && videoStream?.codec_name === 'h264' && audioStream?.codec_name === 'aac') ||
                (format === 'mov' && videoStream?.codec_name === 'h264' && audioStream?.codec_name === 'aac') ||
                (format === 'webm' && videoStream?.codec_name === 'vp9' && audioStream?.codec_name === 'opus');
              
              if (isFullClip && isCompatibleCodec) {
                canUseStreamCopy = true;
                console.log(' Using stream copy (no re-encoding needed)');
              }
            }
            resolveCheck();
          });
        });
      }

      // Determine target resolution
      let targetWidth = 1920;
      let targetHeight = 1080;
      if (resolution) {
        const [w, h] = resolution.split('x').map(Number);
        targetWidth = w;
        targetHeight = h;
      }

      // Simple concatenation - all inputs are pre-trimmed
      if (segments.length === 1) {
        // Single segment - check if we can use stream copy
        if (canUseStreamCopy) {
          // Use stream copy - ultra-fast, no re-encoding
          command
            .videoCodec('copy')
            .audioCodec('copy')
            .output(outputPath);
        } else {
          // Need to re-encode
          if (hasVideoStream) {
            command.videoCodec(config.video).videoBitrate('5000k');
            if (resolution) {
              command.size(resolution);
            }
            
            // Build video filters
            const videoFilters = [];

            // Speed and color effects for this segment
            const segVideoFilter = buildSegmentVideoFilter(segments[0]);
            if (segVideoFilter) videoFilters.push(segVideoFilter);

            // Apply text overlays if any
            if (textClips.length > 0) {
              const textFilter = generateTextFilters(textClips);
              if (textFilter) {
                videoFilters.push(textFilter);
              }
            }
            
            // Apply subtitles if any
            if (subtitleFilePath) {
              // Escape path for FFmpeg
              const escapedSubPath = subtitleFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');
              videoFilters.push(`subtitles='${escapedSubPath}':force_style='FontSize=${subtitleStyle?.fontSize || 24},PrimaryColour=&H${subtitleStyle?.color?.replace('#', '') || 'FFFFFF'},Alignment=${subtitleStyle?.position === 'top' ? '8' : '2'}'`);
            }
            
            if (videoFilters.length > 0) {
              command.videoFilters(videoFilters.join(','));
            }
          }
          if (hasAudioStream) {
            command.audioCodec(config.audio).audioBitrate('192k');
            const seg = segments[0];
            // Build audio filter chain: volume + optional fades
            const audioFilterParts: string[] = [];
            if (seg.muted) {
              audioFilterParts.push('volume=0');
            } else if (seg.volume !== 1) {
              audioFilterParts.push(`volume=${seg.volume}`);
            }
            if ((seg.fadeIn ?? 0) > 0) {
              audioFilterParts.push(`afade=t=in:st=0:d=${seg.fadeIn}`);
            }
            if ((seg.fadeOut ?? 0) > 0) {
              const fadeOutStart = Math.max(0, seg.duration - seg.fadeOut);
              audioFilterParts.push(`afade=t=out:st=${fadeOutStart}:d=${seg.fadeOut}`);
            }
            // Audio speed (atempo, chained for >2x or <0.5x)
            const atempoChain = buildAtempoChain(seg.speed ?? 1);
            if (atempoChain) audioFilterParts.push(atempoChain);
            if (audioFilterParts.length > 0) {
              command.audioFilters(audioFilterParts.join(','));
            }
          }
          command
            .outputOptions(config.options.filter(Boolean))
            .output(outputPath);
        }
      } else {
        // Multiple segments - concatenate with normalization
        const filterSteps: string[] = [];
        const normalizedStreams: string[] = [];

        segments.forEach((_seg: any, index: number) => {
          const seg = segments[index];

          // Normalize each input: scale to target resolution, set fps, convert pixel format
          if (hasVideoStream) {
            // Speed and color effects per-segment (before scale/fps normalization)
            const segVideoFilter = buildSegmentVideoFilter(seg);
            const baseFilter = `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
            const fullFilter = segVideoFilter ? `${segVideoFilter},${baseFilter}` : baseFilter;
            filterSteps.push(`[${index}:v]${fullFilter}[v${index}]`);
          }
          if (hasAudioStream) {
            // Apply volume control + fade in/out + speed for each segment
            const segDuration = seg.end - seg.start;
            const fadeIn = seg.fadeIn ?? 0;
            const fadeOut = seg.fadeOut ?? 0;

            // Build filter parts: volume, fades, speed, then normalize
            const parts: string[] = [];
            if (seg.muted) {
              parts.push('volume=0');
            } else if (seg.volume !== 1) {
              parts.push(`volume=${seg.volume}`);
            }
            if (fadeIn > 0) {
              parts.push(`afade=t=in:st=0:d=${fadeIn}`);
            }
            if (fadeOut > 0) {
              const fadeOutStart = Math.max(0, segDuration - fadeOut);
              parts.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
            }
            // Audio speed (atempo chain)
            const atempoChain = buildAtempoChain(seg.speed ?? 1);
            if (atempoChain) parts.push(atempoChain);

            parts.push('aresample=48000', 'aformat=sample_rates=48000:channel_layouts=stereo');
            filterSteps.push(`[${index}:a]${parts.join(',')}[a${index}]`);
          }
          
          if (hasVideoStream && hasAudioStream) {
            normalizedStreams.push(`[v${index}][a${index}]`);
          } else if (hasVideoStream) {
            normalizedStreams.push(`[v${index}]`);
          } else if (hasAudioStream) {
            normalizedStreams.push(`[a${index}]`);
          }
        });

        // Now concat the normalized streams
        const concatParams = [];
        if (hasVideoStream) concatParams.push('v=1');
        if (hasAudioStream) concatParams.push('a=1');
        
        const outputMaps = [];
        if (hasVideoStream) outputMaps.push('[outv]');
        if (hasAudioStream) outputMaps.push('[outa]');
        
        filterSteps.push(
          `${normalizedStreams.join('')}concat=n=${segments.length}:${concatParams.join(':')}${outputMaps.join('')}`
        );

        // Apply text overlays after concatenation
        if (textClips.length > 0 && hasVideoStream) {
          const textFilter = generateTextFilters(textClips);
          if (textFilter) {
            // Chain text filters after concat output
            filterSteps.push(`[outv]${textFilter}[outv_text]`);
            // Update output maps to use the text-filtered stream
            const outvIndex = outputMaps.indexOf('[outv]');
            if (outvIndex !== -1) {
              outputMaps[outvIndex] = '[outv_text]';
            }
          }
        }

        // Apply subtitles after text overlays
        if (subtitleFilePath && hasVideoStream) {
          const currentOutput = textClips.length > 0 ? '[outv_text]' : '[outv]';
          const escapedSubPath = subtitleFilePath.replace(/\\/g, '/').replace(/:/g, '\\:');
          filterSteps.push(`${currentOutput}subtitles='${escapedSubPath}':force_style='FontSize=${subtitleStyle?.fontSize || 24},PrimaryColour=&H${subtitleStyle?.color?.replace('#', '') || 'FFFFFF'},Alignment=${subtitleStyle?.position === 'top' ? '8' : '2'}'[outv_final]`);
          // Update output maps
          const outvIndex = outputMaps.indexOf(currentOutput);
          if (outvIndex !== -1) {
            outputMaps[outvIndex] = '[outv_final]';
          }
        }

        console.log('Concat filter with normalization:', filterSteps);

        command.complexFilter(filterSteps);
        
        if (hasVideoStream) {
          // Determine final video map based on what filters were applied
          let videoMap = '[outv]';
          if (subtitleFilePath) {
            videoMap = '[outv_final]';
          } else if (textClips.length > 0) {
            videoMap = '[outv_text]';
          }
          command.outputOptions([`-map ${videoMap}`]);
          command.videoCodec(config.video).videoBitrate('5000k');
        }
        if (hasAudioStream) {
          command.outputOptions(['-map [outa]']);
          command.audioCodec(config.audio).audioBitrate('192k');
        }
        
        command
          .outputOptions(config.options.filter(Boolean))
          .output(outputPath);
      }

      command
        .on('start', (cmd) => {
          console.log('FFmpeg command:', cmd);
        })
        .on('progress', (progress) => {
          if (eventSender) {
            eventSender.send('export:progress', progress.percent);
          }
        })
        .on('end', () => {
          // Clean up temp files
          tempFiles.forEach(file => {
            try {
              fs.unlinkSync(file);
            } catch (err) {
              console.warn('Failed to delete temp file:', file, err);
            }
          });
          resolve(true);
        })
        .on('error', (err: Error) => {
          console.error('FFmpeg error:', err);
          // Clean up temp files on error
          tempFiles.forEach(file => {
            try {
              fs.unlinkSync(file);
            } catch {
              // Ignore cleanup errors
            }
          });
          reject(err);
        })
        .run();
    } catch (error) {
      // Clean up temp files on error
      tempFiles.forEach(file => {
        try {
          fs.unlinkSync(file);
        } catch {
          // Ignore cleanup errors
        }
      });
      reject(error);
    }
  });
};

export default ffmpeg;
