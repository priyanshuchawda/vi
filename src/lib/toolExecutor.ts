import { useProjectStore } from '../stores/useProjectStore';
import { useAiMemoryStore } from '../stores/useAiMemoryStore';
import type { FunctionCall, ToolResult } from './videoEditingTools';
import { isReadOnlyTool, isToolAllowedInMode, type RuntimeToolMode } from './toolCapabilityMatrix';
import { retrieveRelevantMemory } from './memoryRetrieval';
import type { ExportFormat, ExportResolution } from '../stores/useProjectStore';

type ToolErrorCategory =
  | 'plan_error'
  | 'validation_error'
  | 'execution_error'
  | 'media_limit'
  | 'tool_missing'
  | 'constraint_violation';

interface ValidationResult {
  valid: boolean;
  error?: string;
  errorType?: ToolErrorCategory;
  recoveryHint?: string;
  adjustments?: string[];
}

interface PreflightIssue {
  index: number;
  name: string;
  message: string;
  errorType: ToolErrorCategory;
  recoveryHint?: string;
}

interface ExecutionPolicy {
  mode?: 'strict_sequential' | 'hybrid';
  maxReadOnlyBatchSize?: number;
  stopOnFailure?: boolean;
}

type RecoveryReasonCode =
  | 'arg_normalization_retry'
  | 'state_inspection'
  | 'constraint_recompile_retry'
  | 'fallback_readonly_recovery'
  | 'recovery_exhausted';

interface RecoveryEvent {
  index: number;
  name: string;
  code: RecoveryReasonCode;
  success: boolean;
  message: string;
}

interface RecoveryPolicy extends ExecutionPolicy {
  maxAttemptsPerOperation?: number;
}

interface ExecuteWithRecoveryResult {
  results: ToolResult[];
  recoveryEvents: RecoveryEvent[];
}

type ToolLifecycleState = 'pending' | 'running' | 'completed' | 'error';

interface ToolExecutionLifecycleEvent {
  call: FunctionCall;
  index: number;
  total: number;
  state: ToolLifecycleState;
  result?: ToolResult;
}

type ToolExecutionHookName = 'tool.execute.before' | 'tool.execute.after';

interface ToolExecutionHookEvent {
  call: FunctionCall;
  index: number;
  total: number;
  event: ToolExecutionHookName;
  result?: ToolResult;
}

interface ExecutionLifecycleContext {
  mode?: RuntimeToolMode;
  onLifecycle?: (event: ToolExecutionLifecycleEvent) => void;
  onHook?: (event: ToolExecutionHookEvent) => void;
}

interface CaptionScriptBlockInput {
  start_time?: number;
  end_time?: number;
  text?: string;
  voiceover?: string;
  on_screen_text?: string;
}

interface NormalizedCaptionBlock {
  start: number;
  end: number;
  text: string;
}

/**
 * Tool Executor - Maps AI function calls to actual video editing operations
 *
 * This class handles validation, execution, and result collection for all
 * video editing tools exposed to AI AI.
 */
export class ToolExecutor {
  private static parseTimestampToken(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const seconds = Number(trimmed);
      return Number.isFinite(seconds) ? seconds : null;
    }

    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const hours = match[3] ? Number(match[1]) : 0;
    const minutes = match[3] ? Number(match[2]) : Number(match[1]);
    const seconds = match[3] ? Number(match[3]) : Number(match[2]);
    return hours * 3600 + minutes * 60 + seconds;
  }

  private static coerceScriptBlocks(input: unknown): CaptionScriptBlockInput[] {
    if (Array.isArray(input)) {
      return input.filter(
        (item) => typeof item === 'object' && item !== null,
      ) as CaptionScriptBlockInput[];
    }

    if (typeof input !== 'string' || !input.trim()) return [];
    const lines = input.split(/\n+/).map((line) => line.trim());
    const blocks: CaptionScriptBlockInput[] = [];

    for (const line of lines) {
      const match = line.match(
        /^\[(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.+)$/,
      );
      if (!match) continue;
      blocks.push({
        start_time: this.parseTimestampToken(match[1]) ?? undefined,
        end_time: this.parseTimestampToken(match[2]) ?? undefined,
        text: match[3].replace(/^(voiceover|on-screen text|caption)\s*:\s*/i, '').trim(),
      });
    }

    return blocks;
  }

  private static normalizeCaptionBlocks(
    input: CaptionScriptBlockInput[],
    totalDuration: number,
  ): {
    blocks: NormalizedCaptionBlock[];
    dropped: number;
  } {
    const minDuration = 0.8;
    const maxDuration = Math.max(1, totalDuration);
    const sorted = input
      .map((block) => {
        const start = this.parseTimestampToken(block.start_time) ?? 0;
        const end = this.parseTimestampToken(block.end_time) ?? start + 2;
        const text = String(block.on_screen_text || block.text || block.voiceover || '').trim();
        return { start, end, text };
      })
      .filter((block) => block.text.length > 0)
      .sort((a, b) => a.start - b.start);

    const normalized: NormalizedCaptionBlock[] = [];
    let dropped = 0;
    let cursor = 0;

    for (const block of sorted) {
      let start = Math.max(0, Math.min(block.start, maxDuration - 0.1));
      let end = Math.max(start + minDuration, block.end);

      if (start < cursor) start = cursor;
      if (end <= start) end = start + minDuration;
      if (end > maxDuration) end = maxDuration;
      if (end - start < minDuration) {
        if (start + minDuration <= maxDuration) {
          end = start + minDuration;
        } else {
          dropped += 1;
          continue;
        }
      }

      if (start >= maxDuration) {
        dropped += 1;
        continue;
      }

      normalized.push({ start, end, text: block.text.slice(0, 160) });
      cursor = end;
    }

    return { blocks: normalized, dropped };
  }

  private static buildCaptionFitReport(
    blocks: NormalizedCaptionBlock[],
    totalDuration: number,
    maxCharsPerSecond: number,
    minCaptionDuration: number,
  ): {
    issues: string[];
    warnings: string[];
    fitScore: number;
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const duration = Math.max(0.1, block.end - block.start);
      const cps = block.text.length / duration;

      if (duration < minCaptionDuration) {
        issues.push(
          `Caption ${i + 1} duration ${duration.toFixed(1)}s is below ${minCaptionDuration}s`,
        );
      }
      if (cps > maxCharsPerSecond) {
        issues.push(
          `Caption ${i + 1} is too dense (${cps.toFixed(1)} chars/sec > ${maxCharsPerSecond})`,
        );
      }
      if (block.end > totalDuration + 0.01) {
        issues.push(`Caption ${i + 1} exceeds timeline duration`);
      }
      if (i > 0 && block.start < blocks[i - 1].end - 0.01) {
        issues.push(`Caption ${i + 1} overlaps caption ${i}`);
      }
      if (block.text.length > 68) {
        warnings.push(`Caption ${i + 1} text is long (${block.text.length} chars)`);
      }
    }

    const penalty = issues.length * 0.14 + warnings.length * 0.04;
    const fitScore = Math.max(0, Number((1 - penalty).toFixed(2)));

    return { issues, warnings, fitScore };
  }

  private static extractMemoryKeywords(limit: number): string[] {
    const memory = useAiMemoryStore.getState().getCompletedEntries();
    const bag = new Set<string>();

    for (const entry of memory) {
      for (const tag of entry.tags || []) {
        const token = String(tag || '')
          .trim()
          .toLowerCase();
        if (token && token.length >= 3) bag.add(token);
        if (bag.size >= limit) return Array.from(bag);
      }
      const summaryTokens = String(entry.summary || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4);
      for (const token of summaryTokens) {
        bag.add(token);
        if (bag.size >= limit) return Array.from(bag);
      }
    }

    return Array.from(bag);
  }

  private static extractMemoryPhrases(limit: number): string[] {
    const memory = useAiMemoryStore.getState().getCompletedEntries();
    const phrases: string[] = [];
    const seen = new Set<string>();

    for (const entry of memory) {
      const summary = String(entry.summary || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (summary) {
        const parts = summary
          .split(/[.!?]/)
          .map((part) => part.trim())
          .filter((part) => part.length >= 10 && part.length <= 90);
        for (const part of parts) {
          const key = part.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          phrases.push(part);
          if (phrases.length >= limit) return phrases;
        }
      }
    }

    return phrases;
  }

  private static toPunchyCaption(input: string, fallback: string): string {
    const cleaned = String(input || '')
      .replace(/[^a-zA-Z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return fallback;
    const words = cleaned.split(' ');
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const word of words) {
      const key = word.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(word);
      if (deduped.length >= 3) break;
    }
    const text = deduped
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
    return text || fallback;
  }

  private static pickToneLexicon(tone: string): {
    opening: string[];
    middle: string[];
    ending: string[];
  } {
    const lower = tone.toLowerCase();
    if (/\b(cinematic|attractive|viral|high|hype|energetic)\b/.test(lower)) {
      return {
        opening: [
          'A bold idea sparked the run',
          'It started with one high-stakes challenge',
          'One problem, one shot, one team',
        ],
        middle: [
          'We iterated fast and sharpened every demo beat',
          'Every feedback loop made the solution stronger',
          'Pressure turned into precision execution',
          'We kept pace while others slowed down',
        ],
        ending: [
          'That momentum is exactly how we won',
          'Result: judges nodding, team exploding, title secured',
          'From build to victory, the finish was ours',
        ],
      };
    }

    return {
      opening: [
        'We began with a clear problem to solve',
        'The challenge looked tough from minute one',
        'We started by focusing on what matters most',
      ],
      middle: [
        'Step by step, the product became more reliable',
        'We improved each part with quick practical iterations',
        'The demo improved with every small refinement',
        'Team coordination kept the whole flow tight',
      ],
      ending: [
        'That consistency is what secured the win',
        'The final demo made the decision easy',
        'In the end, execution made the difference',
      ],
    };
  }

  private static formatSeconds(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const mm = Math.floor(safe / 60)
      .toString()
      .padStart(2, '0');
    const ss = (safe % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  }

  private static buildIntroScriptFromContext(args: Record<string, unknown>): {
    title: string;
    blocks: Array<{
      start_time: number;
      end_time: number;
      voiceover: string;
      on_screen_text: string;
    }>;
    formatted: string;
    targetDuration: number;
  } {
    const store = useProjectStore.getState();
    const clipNames = store.clips
      .slice()
      .sort((a, b) => a.startTime - b.startTime)
      .map((clip) => clip.name)
      .filter(Boolean);
    const keywords = this.extractMemoryKeywords(10);
    const memoryPhrases = this.extractMemoryPhrases(8);
    const objective = String(args.objective || 'how I won the hackathon').trim();
    const tone = String(args.tone || 'energetic').trim();
    const requestedDuration = Number(args.target_duration || 16);
    const targetDuration = Math.max(
      8,
      Math.min(180, Number.isFinite(requestedDuration) ? requestedDuration : 16),
    );
    const requestedBeatCount = Number(args.beat_count || Math.round(targetDuration / 2.8));
    const beatCount = Math.max(
      4,
      Math.min(8, Number.isFinite(requestedBeatCount) ? requestedBeatCount : 6),
    );
    const beatDuration = targetDuration / beatCount;
    const lexicon = this.pickToneLexicon(tone);

    const title = `Hackathon Win Intro (${targetDuration}s)`;
    const visualHints = clipNames.slice(0, beatCount);
    const fallbackHints = [
      'the challenge',
      'rapid build',
      'demo moment',
      'judges reaction',
      'winning announcement',
    ];
    const blocks: Array<{
      start_time: number;
      end_time: number;
      voiceover: string;
      on_screen_text: string;
    }> = [];
    const usedLines = new Set<string>();
    const usedCaptions = new Set<string>();

    const uniqueLine = (candidates: string[], fallback: string): string => {
      for (const candidate of candidates) {
        const key = candidate.toLowerCase();
        if (!usedLines.has(key)) {
          usedLines.add(key);
          return candidate;
        }
      }
      usedLines.add(fallback.toLowerCase());
      return fallback;
    };

    const uniqueCaption = (candidate: string, fallback: string): string => {
      const normalized = candidate.toLowerCase();
      if (!usedCaptions.has(normalized)) {
        usedCaptions.add(normalized);
        return candidate;
      }
      let attempt = 2;
      let next = `${candidate} ${attempt}`;
      while (usedCaptions.has(next.toLowerCase()) && attempt < 10) {
        attempt += 1;
        next = `${candidate} ${attempt}`;
      }
      if (!usedCaptions.has(next.toLowerCase())) {
        usedCaptions.add(next.toLowerCase());
        return next;
      }
      usedCaptions.add(fallback.toLowerCase());
      return fallback;
    };

    for (let i = 0; i < beatCount; i++) {
      const start = Number((i * beatDuration).toFixed(2));
      const end = Number(((i + 1) * beatDuration).toFixed(2));
      const visual = visualHints[i] || fallbackHints[i] || `moment ${i + 1}`;
      const keyword = keywords[i] || keywords[0] || 'innovation';
      const memoryPhrase = memoryPhrases[i] || '';
      const opener = lexicon.opening[i % lexicon.opening.length];
      const middle = lexicon.middle[i % lexicon.middle.length];
      const ending = lexicon.ending[i % lexicon.ending.length];

      const voiceover =
        i === 0
          ? uniqueLine(
              [`${opener}: ${objective}.`, `From concept to spotlight, this is ${objective}.`],
              `From idea to victory: ${objective}.`,
            )
          : i === beatCount - 1
            ? uniqueLine(
                [`${ending}.`, `Final frame: ${objective}, delivered with confidence.`],
                `That is how we turned pressure into a winning finish.`,
              )
            : uniqueLine(
                [
                  `${middle} around ${visual}.`,
                  `In ${visual}, ${memoryPhrase || `we focused on ${keyword} and executed cleanly`}.`,
                  `Through ${visual}, ${keyword} became our edge.`,
                ],
                `We kept momentum through ${visual}.`,
              );

      const baseCaption =
        i === 0
          ? 'Hackathon Victory'
          : i === beatCount - 1
            ? 'Built To Win'
            : this.toPunchyCaption(`${keyword} ${visual}`, 'Winning Momentum');
      const onScreen = uniqueCaption(baseCaption, `Beat ${i + 1}`);

      blocks.push({
        start_time: start,
        end_time: i === beatCount - 1 ? Number(targetDuration.toFixed(2)) : end,
        voiceover,
        on_screen_text: onScreen,
      });
    }

    const formatted = blocks
      .map(
        (block) =>
          `[${this.formatSeconds(block.start_time)} - ${this.formatSeconds(block.end_time)}] Voiceover: ${block.voiceover}\nOn-screen text: ${block.on_screen_text}`,
      )
      .join('\n\n');

    return { title: `${title} | Tone: ${tone}`, blocks, formatted, targetDuration };
  }

  /**
   * Normalize clip bounds to valid source ranges.
   * This prevents hard failures when AI asks to extend beyond source media.
   */
  private static normalizeClipBounds(
    clip: { start: number; end: number; sourceDuration: number },
    newStart?: number,
    newEnd?: number,
  ): {
    valid: boolean;
    error?: string;
    start: number;
    end: number;
    adjusted: boolean;
    adjustmentNotes: string[];
  } {
    const notes: string[] = [];
    let start = newStart !== undefined ? Number(newStart) : Number(clip.start);
    let end = newEnd !== undefined ? Number(newEnd) : Number(clip.end);
    const max = Number(clip.sourceDuration);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return {
        valid: false,
        error: 'new_start/new_end must be finite numbers',
        start: clip.start,
        end: clip.end,
        adjusted: false,
        adjustmentNotes: [],
      };
    }

    // Clamp to valid source range
    if (start < 0) {
      notes.push(`new_start ${start.toFixed(1)}s clamped to 0.0s`);
      start = 0;
    }
    if (start > max) {
      notes.push(`new_start ${start.toFixed(1)}s clamped to ${max.toFixed(1)}s`);
      start = max;
    }
    if (end < 0) {
      notes.push(`new_end ${end.toFixed(1)}s clamped to 0.0s`);
      end = 0;
    }
    if (end > max) {
      notes.push(`new_end ${end.toFixed(1)}s clamped to ${max.toFixed(1)}s`);
      end = max;
    }

    // Ensure strictly positive duration after clamping.
    if (start >= end) {
      const epsilon = 0.1;
      if (newStart !== undefined && newEnd === undefined) {
        end = Math.min(max, start + epsilon);
        notes.push(`new_end auto-adjusted to ${end.toFixed(1)}s to keep positive duration`);
      } else if (newEnd !== undefined && newStart === undefined) {
        start = Math.max(0, end - epsilon);
        notes.push(`new_start auto-adjusted to ${start.toFixed(1)}s to keep positive duration`);
      } else {
        return {
          valid: false,
          error:
            'Resulting clip bounds are invalid after normalization (start must be less than end)',
          start,
          end,
          adjusted: notes.length > 0,
          adjustmentNotes: notes,
        };
      }
    }

    return {
      valid: true,
      start,
      end,
      adjusted: notes.length > 0,
      adjustmentNotes: notes,
    };
  }

  /**
   * Validate a function call before execution
   */
  private static validateFunctionCall(call: FunctionCall): ValidationResult {
    const state = useProjectStore.getState();

    switch (call.name) {
      case 'split_clip': {
        const { clip_id, time_in_clip } = call.args;
        const clip = state.clips.find((c) => c.id === clip_id);
        if (!clip)
          return {
            valid: false,
            error: `Clip with ID "${clip_id}" not found on timeline`,
          };
        if (time_in_clip <= 0 || time_in_clip >= clip.duration) {
          return {
            valid: false,
            error: `Split time must be between 0 and ${clip.duration.toFixed(1)}s (clip duration)`,
          };
        }
        return { valid: true };
      }

      case 'set_clip_volume': {
        const { volume, clip_ids } = call.args;
        if (volume < 0 || volume > 1) {
          return {
            valid: false,
            error: 'Volume must be between 0.0 (silent) and 1.0 (full volume)',
          };
        }
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return { valid: false, error: 'Must provide at least one clip ID' };
        }
        // Check clips exist (unless "all")
        if (!clip_ids.includes('all')) {
          const missing = clip_ids.filter((id: string) => !state.clips.find((c) => c.id === id));
          if (missing.length > 0) {
            return {
              valid: false,
              error: `Clips not found: ${missing.join(', ')}`,
            };
          }
        }
        return { valid: true };
      }

      case 'delete_clips': {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return {
            valid: false,
            error: 'Must provide at least one clip ID to delete',
          };
        }
        return { valid: true };
      }

      case 'move_clip': {
        const { clip_id, start_time } = call.args;
        const clip = state.clips.find((c) => c.id === clip_id);
        if (!clip)
          return {
            valid: false,
            error: `Clip with ID "${clip_id}" not found`,
            errorType: 'validation_error',
            recoveryHint:
              'Call get_timeline_info first to get current clip IDs, then retry with a valid clip_id.',
          };
        if (start_time < 0) {
          return {
            valid: false,
            error: 'Start time cannot be negative',
            errorType: 'constraint_violation',
            recoveryHint: 'Use start_time >= 0.',
          };
        }
        return { valid: true };
      }

      case 'merge_clips': {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length < 2) {
          return {
            valid: false,
            error: 'Must provide at least 2 clip IDs to merge',
          };
        }
        const missing = clip_ids.filter((id: string) => !state.clips.find((c) => c.id === id));
        if (missing.length > 0) {
          return {
            valid: false,
            error: `Clips not found: ${missing.join(', ')}`,
          };
        }
        return { valid: true };
      }

      case 'toggle_clip_mute': {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return { valid: false, error: 'Must provide at least one clip ID' };
        }
        const missing = clip_ids.filter((id: string) => !state.clips.find((c) => c.id === id));
        if (missing.length > 0) {
          return {
            valid: false,
            error: `Clips not found: ${missing.join(', ')}`,
          };
        }
        return { valid: true };
      }

      case 'select_clips': {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return { valid: false, error: 'Must provide at least one clip ID' };
        }
        // "all" is allowed
        if (!clip_ids.includes('all')) {
          const missing = clip_ids.filter((id: string) => !state.clips.find((c) => c.id === id));
          if (missing.length > 0) {
            return {
              valid: false,
              error: `Clips not found: ${missing.join(', ')}`,
            };
          }
        }
        return { valid: true };
      }

      case 'copy_clips': {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return {
            valid: false,
            error: 'Must provide at least one clip ID to copy',
          };
        }
        const missing = clip_ids.filter((id: string) => !state.clips.find((c) => c.id === id));
        if (missing.length > 0) {
          return {
            valid: false,
            error: `Clips not found: ${missing.join(', ')}`,
          };
        }
        return { valid: true };
      }

      case 'undo_action': {
        if (!state.canUndo()) {
          return { valid: false, error: 'Nothing to undo' };
        }
        return { valid: true };
      }

      case 'redo_action': {
        if (!state.canRedo()) {
          return { valid: false, error: 'Nothing to redo' };
        }
        return { valid: true };
      }

      case 'set_playhead_position': {
        const { time } = call.args;
        if (time < 0) {
          return {
            valid: false,
            error: 'Time cannot be negative',
            errorType: 'constraint_violation',
            recoveryHint: 'Use time >= 0.',
          };
        }
        const totalDuration = state.getTotalDuration();
        if (time > totalDuration) {
          return {
            valid: false,
            error: `Time ${time.toFixed(1)}s exceeds timeline duration ${totalDuration.toFixed(1)}s`,
            errorType: 'constraint_violation',
            recoveryHint: `Use a time between 0 and ${totalDuration.toFixed(1)}s.`,
          };
        }
        return { valid: true };
      }

      case 'update_clip_bounds': {
        const { clip_id, new_start, new_end } = call.args;
        const clip = state.clips.find((c) => c.id === clip_id);
        if (!clip)
          return {
            valid: false,
            error: `Clip with ID "${clip_id}" not found`,
            errorType: 'validation_error',
            recoveryHint: 'Call get_timeline_info first and use a valid clip_id.',
          };

        const normalized = this.normalizeClipBounds(clip, new_start, new_end);
        if (!normalized.valid) {
          return {
            valid: false,
            error: normalized.error,
            errorType: 'constraint_violation',
            recoveryHint: 'Adjust new_start/new_end to a valid source range.',
          };
        }

        // Mutate call args to normalized values so execution uses safe bounds.
        call.args.new_start = normalized.start;
        call.args.new_end = normalized.end;
        return {
          valid: true,
          adjustments: normalized.adjustmentNotes,
        };
      }

      case 'get_clip_details': {
        const { clip_id } = call.args;
        const clip = state.clips.find((c) => c.id === clip_id);
        if (!clip) return { valid: false, error: `Clip with ID "${clip_id}" not found` };
        return { valid: true };
      }

      // ==================== SUBTITLE VALIDATION ====================

      case 'add_subtitle': {
        const { text, start_time, end_time } = call.args;
        if (!text || text.trim().length === 0) {
          return { valid: false, error: 'Subtitle text cannot be empty' };
        }
        if (start_time < 0) {
          return { valid: false, error: 'Start time cannot be negative' };
        }
        if (end_time <= start_time) {
          return { valid: false, error: 'End time must be after start time' };
        }
        return { valid: true };
      }

      case 'update_subtitle': {
        const { index, start_time, end_time } = call.args;
        if (index < 1 || index > state.subtitles.length) {
          return {
            valid: false,
            error: `Subtitle ${index} not found. Valid range: 1-${state.subtitles.length}`,
          };
        }
        if (start_time !== undefined && start_time < 0) {
          return { valid: false, error: 'Start time cannot be negative' };
        }
        if (start_time !== undefined && end_time !== undefined && end_time <= start_time) {
          return { valid: false, error: 'End time must be after start time' };
        }
        return { valid: true };
      }

      case 'delete_subtitle': {
        const { index } = call.args;
        if (index < 1 || index > state.subtitles.length) {
          return {
            valid: false,
            error: `Subtitle ${index} not found. Valid range: 1-${state.subtitles.length}`,
          };
        }
        return { valid: true };
      }

      // ==================== TRANSCRIPTION VALIDATION ====================

      case 'transcribe_clip': {
        const { clip_id } = call.args;
        if (clip_id === 'active') {
          if (!state.activeClipId) {
            return { valid: false, error: 'No clip is currently selected' };
          }
        } else {
          const clip = state.clips.find((c) => c.id === clip_id);
          if (!clip) {
            return {
              valid: false,
              error: `Clip with ID "${clip_id}" not found`,
            };
          }
        }
        return { valid: true };
      }

      case 'apply_transcript_edits': {
        const { deletion_ranges } = call.args;
        if (!Array.isArray(deletion_ranges) || deletion_ranges.length === 0) {
          return {
            valid: false,
            error: 'Must provide at least one deletion range',
          };
        }
        for (const range of deletion_ranges) {
          if (range.start < 0 || range.end <= range.start) {
            return {
              valid: false,
              error: 'Invalid deletion range: end must be after start',
            };
          }
        }
        return { valid: true };
      }

      // ==================== PROJECT MANAGEMENT VALIDATION ====================

      case 'set_export_settings': {
        const { format, resolution } = call.args;
        const validFormats = ['mp4', 'mov', 'avi', 'webm'];
        const validResolutions = ['1920x1080', '1280x720', '854x480', 'original'];

        if (format && !validFormats.includes(format)) {
          return {
            valid: false,
            error: `Invalid format. Valid options: ${validFormats.join(', ')}`,
          };
        }
        if (resolution && !validResolutions.includes(resolution)) {
          return {
            valid: false,
            error: `Invalid resolution. Valid options: ${validResolutions.join(', ')}`,
          };
        }
        return { valid: true };
      }

      // ==================== SEARCH & ANALYSIS VALIDATION ====================

      case 'search_clips_by_content': {
        const { query } = call.args;
        if (!query || query.trim().length === 0) {
          return { valid: false, error: 'Search query cannot be empty' };
        }
        return { valid: true };
      }

      case 'get_clip_analysis': {
        const { clip_id } = call.args;
        const clip = state.clips.find((c) => c.id === clip_id);
        if (!clip) {
          return { valid: false, error: `Clip with ID "${clip_id}" not found` };
        }
        return { valid: true };
      }

      case 'ask_clarification': {
        const { question, options } = call.args;
        if (typeof question !== 'string' || question.trim().length === 0) {
          return { valid: false, error: 'question is required' };
        }
        if (!Array.isArray(options) || options.length < 2) {
          return { valid: false, error: 'options must include at least two choices' };
        }
        return { valid: true };
      }

      case 'generate_intro_script_from_timeline': {
        const targetDuration = Number(call.args?.target_duration);
        const objective = String(call.args?.objective || '').trim();
        if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
          return {
            valid: false,
            error: 'target_duration must be a positive number',
          };
        }
        if (targetDuration > 180) {
          return {
            valid: false,
            error: 'target_duration cannot exceed 180 seconds',
          };
        }
        if (!objective) {
          return {
            valid: false,
            error: 'objective is required',
          };
        }
        return { valid: true };
      }

      case 'apply_script_as_captions': {
        const blocks = this.coerceScriptBlocks(call.args?.script_blocks);
        if (!Array.isArray(blocks) || blocks.length === 0) {
          return {
            valid: false,
            error: 'script_blocks must contain at least one caption block',
          };
        }
        const hasText = blocks.some((block) =>
          String(block.text || block.on_screen_text || block.voiceover || '').trim(),
        );
        if (!hasText) {
          return {
            valid: false,
            error: 'script_blocks must include text/voiceover content',
          };
        }
        return { valid: true };
      }

      case 'preview_caption_fit': {
        const cps = call.args?.max_chars_per_second;
        const minDuration = call.args?.min_caption_duration;
        if (cps !== undefined && (!Number.isFinite(cps) || cps <= 0)) {
          return {
            valid: false,
            error: 'max_chars_per_second must be a positive number',
          };
        }
        if (minDuration !== undefined && (!Number.isFinite(minDuration) || minDuration <= 0)) {
          return {
            valid: false,
            error: 'min_caption_duration must be a positive number',
          };
        }
        return { valid: true };
      }

      case 'get_timeline_info':
      case 'paste_clips':
      case 'update_subtitle_style':
      case 'get_subtitles':
      case 'clear_all_subtitles':
      case 'transcribe_timeline':
      case 'get_transcription':
      case 'save_project':
      case 'get_project_info':
      case 'get_all_media_analysis':
      case 'find_highlights':
      case 'generate_chapters':
        // No validation needed for these
        return { valid: true };

      case 'set_clip_speed': {
        const { clip_id, speed } = call.args;
        if (!clip_id) return { valid: false, error: 'clip_id is required' };
        if (typeof speed !== 'number' || speed < 0.25 || speed > 8.0) {
          return {
            valid: false,
            error: 'speed must be a number between 0.25 and 8.0',
          };
        }
        const clip = useProjectStore.getState().clips.find((c) => c.id === clip_id);
        if (!clip) return { valid: false, error: `Clip ${clip_id} not found` };
        return { valid: true };
      }

      case 'apply_clip_effect': {
        const { clip_id } = call.args;
        if (!clip_id) return { valid: false, error: 'clip_id is required' };
        const clip = useProjectStore.getState().clips.find((c) => c.id === clip_id);
        if (!clip) return { valid: false, error: `Clip ${clip_id} not found` };
        return { valid: true };
      }

      default:
        return {
          valid: false,
          error: `Unknown function: ${call.name}`,
          errorType: 'tool_missing',
          recoveryHint: 'Use only supported tools from toolConfig.',
        };
    }
  }

  /**
   * Execute a single function call
   */
  private static executeSingle(call: FunctionCall): ToolResult {
    const store = useProjectStore.getState();

    try {
      switch (call.name) {
        case 'get_timeline_info': {
          const clips = store.clips.map((c) => ({
            id: c.id,
            name: c.name,
            path: c.path,
            startTime: c.startTime,
            duration: c.duration,
            sourceDuration: c.sourceDuration,
            trackIndex: c.trackIndex ?? 0,
            volume: c.volume ?? 1,
            muted: c.muted ?? false,
            selected: store.selectedClipIds.includes(c.id),
            mediaType: c.mediaType,
          }));

          return {
            name: call.name,
            result: {
              success: true,
              message: `Retrieved ${clips.length} clip(s) from timeline`,
              data: {
                clips,
                totalDuration: store.getTotalDuration(),
                selectedCount: store.selectedClipIds.length,
                currentTime: store.currentTime,
                isPlaying: store.isPlaying,
                canUndo: store.canUndo(),
                canRedo: store.canRedo(),
              },
            },
          };
        }

        case 'ask_clarification': {
          const question = String(call.args?.question || 'Need clarification');
          const options = Array.isArray(call.args?.options) ? call.args.options : [];
          return {
            name: call.name,
            result: {
              success: true,
              message: 'Clarification requested',
              data: {
                question,
                options,
                context: call.args?.context,
              },
            },
          };
        }

        case 'split_clip': {
          const { clip_id, time_in_clip } = call.args;
          const clip = store.clips.find((c) => c.id === clip_id);
          if (!clip) throw new Error(`Clip ${clip_id} not found`);

          store.splitClip(clip_id, time_in_clip);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Split "${clip.name}" at ${time_in_clip.toFixed(1)}s`,
            },
          };
        }

        case 'delete_clips': {
          const { clip_ids } = call.args;
          const requestedIds: string[] = Array.isArray(clip_ids) ? clip_ids : [];
          const deletedIds: string[] = [];
          const missingIds: string[] = [];
          const deletedNames: string[] = [];

          for (const id of requestedIds) {
            const clipName = store.clips.find((c) => c.id === id)?.name;
            const didRemove = store.removeClip(id);
            if (didRemove) {
              deletedIds.push(id);
              deletedNames.push(clipName || id);
            } else {
              missingIds.push(id);
            }
          }

          const deletedCount = deletedIds.length;
          const requestedCount = requestedIds.length;
          const wasPartial = missingIds.length > 0 && deletedCount > 0;
          const success = deletedCount > 0;

          return {
            name: call.name,
            result: {
              success,
              message: success
                ? `Deleted ${deletedCount}/${requestedCount} clip(s): ${deletedNames.join(', ')}${wasPartial ? ` (missing: ${missingIds.join(', ')})` : ''}`
                : `No clips were deleted. Missing clip IDs: ${missingIds.join(', ')}`,
              ...(success
                ? {}
                : {
                    error: `No matching clips found for requested IDs`,
                    errorType: 'validation_error',
                    recoveryHint: 'Call get_timeline_info to refresh clip IDs, then retry.',
                  }),
              data: {
                requested_count: requestedCount,
                deleted_count: deletedCount,
                deleted_ids: deletedIds,
                missing_ids: missingIds,
              },
            },
          };
        }

        case 'move_clip': {
          const { clip_id, start_time, track_index } = call.args;
          const clip = store.clips.find((c) => c.id === clip_id);
          if (!clip) throw new Error(`Clip ${clip_id} not found`);

          store.moveClipToTime(clip_id, start_time, track_index);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Moved "${clip.name}" to ${start_time.toFixed(1)}s${track_index !== undefined ? ` on track ${track_index}` : ''}`,
            },
          };
        }

        case 'merge_clips': {
          const { clip_ids } = call.args;
          const clipNames = clip_ids.map(
            (id: string) => store.clips.find((c) => c.id === id)?.name || id,
          );

          // Select the clips first
          store.selectClips(clip_ids);
          // Then merge them
          store.mergeSelectedClips();

          return {
            name: call.name,
            result: {
              success: true,
              message: `Merged ${clip_ids.length} clips: ${clipNames.join(', ')}`,
            },
          };
        }

        case 'copy_clips': {
          const { clip_ids } = call.args;
          // Select clips first
          store.selectClips(clip_ids);
          // Then copy
          store.copyClips();

          return {
            name: call.name,
            result: {
              success: true,
              message: `Copied ${clip_ids.length} clip(s) to clipboard`,
            },
          };
        }

        case 'paste_clips': {
          store.pasteClips();
          const copiedCount = store.copiedClips.length;

          return {
            name: call.name,
            result: {
              success: true,
              message: `Pasted ${copiedCount} clip(s) to timeline`,
            },
          };
        }

        case 'set_clip_volume': {
          const { clip_ids, volume } = call.args;

          // Handle "all" keyword
          const targetIds = clip_ids.includes('all') ? store.clips.map((c) => c.id) : clip_ids;

          targetIds.forEach((id: string) => store.setClipVolume(id, volume));

          const volumePct = Math.round(volume * 100);
          return {
            name: call.name,
            result: {
              success: true,
              message: `Set volume to ${volumePct}% for ${targetIds.length} clip(s)`,
            },
          };
        }

        case 'toggle_clip_mute': {
          const { clip_ids } = call.args;
          clip_ids.forEach((id: string) => store.toggleClipMute(id));

          return {
            name: call.name,
            result: {
              success: true,
              message: `Toggled mute for ${clip_ids.length} clip(s)`,
            },
          };
        }

        case 'select_clips': {
          const { clip_ids } = call.args;
          const targetIds = clip_ids.includes('all') ? store.clips.map((c) => c.id) : clip_ids;

          store.selectClips(targetIds);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Selected ${targetIds.length} clip(s)`,
            },
          };
        }

        case 'undo_action': {
          if (!store.canUndo()) throw new Error('Nothing to undo');
          store.undo();

          return {
            name: call.name,
            result: {
              success: true,
              message: 'Undid last action',
            },
          };
        }

        case 'redo_action': {
          if (!store.canRedo()) throw new Error('Nothing to redo');
          store.redo();

          return {
            name: call.name,
            result: {
              success: true,
              message: 'Redid last action',
            },
          };
        }

        case 'set_playhead_position': {
          const { time } = call.args;
          store.setCurrentTime(time);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Moved playhead to ${time.toFixed(1)}s`,
            },
          };
        }

        case 'update_clip_bounds': {
          const { clip_id, new_start, new_end } = call.args;
          const clip = store.clips.find((c) => c.id === clip_id);
          if (!clip) throw new Error(`Clip ${clip_id} not found`);

          const normalized = this.normalizeClipBounds(clip, new_start, new_end);
          if (!normalized.valid) {
            throw new Error(
              normalized.error || `Failed to normalize clip bounds for "${clip.name}"`,
            );
          }

          const updates: Partial<typeof clip> = {
            start: normalized.start,
            end: normalized.end,
            duration: normalized.end - normalized.start,
          };

          store.updateClip(clip_id, updates);

          const adjustmentSuffix = normalized.adjusted
            ? ` (auto-adjusted: ${normalized.adjustmentNotes.join('; ')})`
            : '';

          return {
            name: call.name,
            result: {
              success: true,
              message: `Updated bounds for "${clip.name}" (duration: ${updates.duration?.toFixed(1)}s)${adjustmentSuffix}`,
            },
          };
        }

        case 'get_clip_details': {
          const { clip_id } = call.args;
          const clip = store.clips.find((c) => c.id === clip_id);
          if (!clip) throw new Error(`Clip ${clip_id} not found`);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Retrieved details for "${clip.name}"`,
              data: {
                id: clip.id,
                name: clip.name,
                path: clip.path,
                mediaType: clip.mediaType,
                duration: clip.duration,
                sourceDuration: clip.sourceDuration,
                sourceStart: clip.start,
                sourceEnd: clip.end,
                timelineStart: clip.startTime,
                timelineEnd: clip.startTime + clip.duration,
                trackIndex: clip.trackIndex ?? 0,
                volume: clip.volume ?? 1,
                muted: clip.muted ?? false,
                locked: clip.locked ?? false,
                selected: store.selectedClipIds.includes(clip.id),
              },
            },
          };
        }

        // ==================== SUBTITLE EXECUTION ====================

        case 'add_subtitle': {
          const { text, start_time, end_time } = call.args;
          const newSubtitle = {
            index: store.subtitles.length + 1,
            startTime: start_time,
            endTime: end_time,
            text: text.trim(),
          };

          store.setSubtitles([...store.subtitles, newSubtitle]);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Added subtitle "${text}" from ${start_time.toFixed(1)}s to ${end_time.toFixed(1)}s`,
              data: { subtitle: newSubtitle },
            },
          };
        }

        case 'update_subtitle': {
          const { index, text, start_time, end_time } = call.args;
          const subtitles = [...store.subtitles];
          const subtitle = subtitles[index - 1];

          if (text !== undefined) subtitle.text = text.trim();
          if (start_time !== undefined) subtitle.startTime = start_time;
          if (end_time !== undefined) subtitle.endTime = end_time;

          store.setSubtitles(subtitles);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Updated subtitle ${index}`,
              data: { subtitle },
            },
          };
        }

        case 'delete_subtitle': {
          const { index } = call.args;
          const subtitles = store.subtitles.filter((_, i) => i !== index - 1);

          // Re-index remaining subtitles
          subtitles.forEach((sub, i) => {
            sub.index = i + 1;
          });

          store.setSubtitles(subtitles);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Deleted subtitle ${index}`,
            },
          };
        }

        case 'update_subtitle_style': {
          const { font_size, font_family, color, background_color, position } = call.args;
          const updates: Partial<typeof store.subtitleStyle> = {};

          if (font_size !== undefined) updates.fontSize = font_size;
          if (font_family !== undefined) updates.fontFamily = font_family;
          if (color !== undefined) updates.color = color;
          if (background_color !== undefined) updates.backgroundColor = background_color;
          if (position !== undefined) updates.position = position;

          store.updateSubtitleStyle(updates);

          return {
            name: call.name,
            result: {
              success: true,
              message: 'Updated subtitle styling',
              data: { updates },
            },
          };
        }

        case 'get_subtitles': {
          return {
            name: call.name,
            result: {
              success: true,
              message: `Retrieved ${store.subtitles.length} subtitles`,
              data: {
                subtitles: store.subtitles,
                style: store.subtitleStyle,
              },
            },
          };
        }

        case 'clear_all_subtitles': {
          const count = store.subtitles.length;
          store.clearSubtitles();

          return {
            name: call.name,
            result: {
              success: true,
              message: `Cleared ${count} subtitles`,
            },
          };
        }

        // ==================== TRANSCRIPTION EXECUTION ====================

        case 'transcribe_clip': {
          const { clip_id } = call.args;
          const targetId = clip_id === 'active' ? store.activeClipId : clip_id;
          const clip = store.clips.find((c) => c.id === targetId);

          if (!clip) throw new Error('Clip not found');

          // Trigger transcription asynchronously
          if (clip_id === 'active') {
            store.transcribeCurrentClip();
          } else {
            store.transcribeFile(clip.path);
          }

          return {
            name: call.name,
            result: {
              success: true,
              message: `Started transcribing "${clip.name}"...`,
              data: { clip_id: targetId, clip_name: clip.name },
            },
          };
        }

        case 'transcribe_timeline': {
          store.transcribeTimeline();

          return {
            name: call.name,
            result: {
              success: true,
              message: 'Started transcribing timeline...',
            },
          };
        }

        case 'get_transcription': {
          const transcription = store.transcription;

          if (!transcription) {
            return {
              name: call.name,
              result: {
                success: true,
                message: 'No transcription available',
                data: { transcription: null },
              },
            };
          }

          return {
            name: call.name,
            result: {
              success: true,
              message: 'Retrieved transcription',
              data: {
                text: transcription.text,
                segments: transcription.segments,
                wordCount: transcription.words?.length || 0,
              },
            },
          };
        }

        case 'apply_transcript_edits': {
          const { deletion_ranges } = call.args;

          // This is async but we'll fire and forget
          store.applyTranscriptEdits(deletion_ranges).catch((err) => {
            console.error('Error applying transcript edits:', err);
          });

          return {
            name: call.name,
            result: {
              success: true,
              message: `Applying ${deletion_ranges.length} transcript edits...`,
              data: { deletion_ranges },
            },
          };
        }

        // ==================== PROJECT MANAGEMENT EXECUTION ====================

        case 'save_project': {
          // Trigger save asynchronously
          store.saveProject().catch((err) => {
            console.error('Error saving project:', err);
          });

          return {
            name: call.name,
            result: {
              success: true,
              message: 'Saving project...',
              data: {
                projectPath: store.projectPath,
                hasUnsavedChanges: store.hasUnsavedChanges,
              },
            },
          };
        }

        case 'set_export_settings': {
          const { format, resolution } = call.args;
          const updates: string[] = [];
          const validFormats: ExportFormat[] = ['mp4', 'mov', 'avi', 'webm'];
          const validResolutions: ExportResolution[] = [
            '1920x1080',
            '1280x720',
            '854x480',
            'original',
          ];

          if (typeof format === 'string' && validFormats.includes(format as ExportFormat)) {
            store.setExportFormat(format as ExportFormat);
            updates.push(`format: ${format}`);
          }
          if (
            typeof resolution === 'string' &&
            validResolutions.includes(resolution as ExportResolution)
          ) {
            store.setExportResolution(resolution as ExportResolution);
            updates.push(`resolution: ${resolution}`);
          }

          return {
            name: call.name,
            result: {
              success: true,
              message: `Updated export settings (${updates.join(', ')})`,
              data: {
                format: store.exportFormat,
                resolution: store.exportResolution,
              },
            },
          };
        }

        case 'get_project_info': {
          return {
            name: call.name,
            result: {
              success: true,
              message: 'Retrieved project information',
              data: {
                projectPath: store.projectPath,
                projectId: store.projectId,
                hasUnsavedChanges: store.hasUnsavedChanges,
                lastSaved: store.lastSaved,
                exportFormat: store.exportFormat,
                exportResolution: store.exportResolution,
                totalClips: store.clips.length,
                totalDuration: store.getTotalDuration(),
                subtitleCount: store.subtitles.length,
                hasTranscription: !!store.transcription,
              },
            },
          };
        }

        // ==================== SEARCH & ANALYSIS EXECUTION ====================

        case 'search_clips_by_content': {
          const { query } = call.args;
          const memoryStore = useAiMemoryStore.getState();
          const completedEntries = memoryStore.getCompletedEntries();
          const matchingEntries = retrieveRelevantMemory({
            query: String(query || ''),
            entries: completedEntries,
            maxEntries: 10,
            maxScenesPerEntry: 2,
          }).map((hit) => hit.entry);

          // Map to clips
          const matchingClips = matchingEntries
            .map((entry) => store.clips.find((c) => c.id === entry.clipId))
            .filter((clip): clip is (typeof store.clips)[number] => Boolean(clip));

          return {
            name: call.name,
            result: {
              success: true,
              message: `Found ${matchingClips.length} clips matching "${query}"`,
              data: {
                query,
                matches: matchingClips.map((clip) => ({
                  id: clip.id,
                  name: clip.name,
                  startTime: clip.startTime,
                  duration: clip.duration,
                })),
              },
            },
          };
        }

        case 'get_clip_analysis': {
          const { clip_id } = call.args;
          const memoryStore = useAiMemoryStore.getState();
          const analysis = memoryStore.getEntryByClipId(clip_id);

          if (!analysis) {
            return {
              name: call.name,
              result: {
                success: true,
                message: 'No AI analysis available for this clip',
                data: { analysis: null },
              },
            };
          }

          return {
            name: call.name,
            result: {
              success: true,
              message: `Retrieved analysis for clip`,
              data: {
                summary: analysis.summary,
                tags: analysis.tags,
                visualInfo: analysis.visualInfo,
                audioInfo: analysis.audioInfo,
                scenes: analysis.scenes,
                status: analysis.status,
              },
            },
          };
        }

        case 'get_all_media_analysis': {
          const memoryStore = useAiMemoryStore.getState();
          const context = memoryStore.getMemoryContext();

          return {
            name: call.name,
            result: {
              success: true,
              message: context.projectSummary,
              data: {
                totalFiles: context.totalFiles,
                entries: context.entries.map((entry) => ({
                  clipId: entry.clipId,
                  fileName: entry.fileName,
                  mediaType: entry.mediaType,
                  summary: entry.summary,
                  tags: entry.tags,
                })),
              },
            },
          };
        }

        case 'set_clip_speed': {
          const { clip_id, speed } = call.args;
          const clip = store.clips.find((c) => c.id === clip_id);
          const oldSpeed = clip?.speed ?? 1;
          store.setClipSpeed(clip_id, speed);
          return {
            name: call.name,
            result: {
              success: true,
              message: `Set speed of "${clip?.name || clip_id}" to ${speed}x (was ${oldSpeed}x). Duration adjusted accordingly.`,
              data: { clipId: clip_id, oldSpeed, newSpeed: speed },
            },
          };
        }

        case 'apply_clip_effect': {
          const { clip_id, brightness, contrast, saturation, gamma } = call.args;
          const clip = store.clips.find((c) => c.id === clip_id);
          const newEffects: NonNullable<(typeof store.clips)[number]['effects']> = {};
          if (brightness !== undefined)
            newEffects.brightness = Math.max(-1, Math.min(1, brightness));
          if (contrast !== undefined) newEffects.contrast = Math.max(0, Math.min(3, contrast));
          if (saturation !== undefined)
            newEffects.saturation = Math.max(0, Math.min(3, saturation));
          if (gamma !== undefined) newEffects.gamma = Math.max(0.1, Math.min(10, gamma));
          store.setClipEffects(clip_id, newEffects);
          const parts = Object.entries(newEffects)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          return {
            name: call.name,
            result: {
              success: true,
              message: `Applied effects to "${clip?.name || clip_id}": ${parts}. Will be applied on export.`,
              data: { clipId: clip_id, effects: newEffects },
            },
          };
        }

        case 'find_highlights': {
          const { criteria = 'exciting moments', max_results = 5 } = call.args;
          const memoryStore = useAiMemoryStore.getState();
          const entries = memoryStore.entries ?? [];
          const clips = store.clips;

          // Score each entry against criteria keywords
          const keywords = criteria.toLowerCase().split(/\s+/);
          const scored = entries
            .filter((e) => e.status === 'completed')
            .map((entry) => {
              const haystack = [
                entry.summary ?? '',
                ...(entry.tags ?? []),
                entry.audioInfo?.mood ?? '',
                entry.audioInfo?.transcriptSummary ?? '',
                ...(entry.visualInfo?.subjects ?? []),
                entry.visualInfo?.style ?? '',
              ]
                .join(' ')
                .toLowerCase();
              const score = keywords.filter((kw: string) => haystack.includes(kw)).length;
              return { entry, score };
            })
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, max_results);

          if (scored.length === 0) {
            return {
              name: call.name,
              result: {
                success: true,
                message: `No highlights found matching "${criteria}". Try different criteria or ensure media has been analyzed.`,
                data: { highlights: [] },
              },
            };
          }

          const highlights = scored.map(({ entry }) => {
            const clip = clips.find((c) => c.id === entry.clipId);
            return {
              clipId: entry.clipId,
              clipName: entry.fileName,
              summary: entry.summary,
              tags: entry.tags?.slice(0, 5),
              timelineStart: clip?.startTime ?? 0,
              duration: clip?.duration ?? entry.duration ?? 0,
            };
          });

          return {
            name: call.name,
            result: {
              success: true,
              message: `Found ${highlights.length} highlight(s) matching "${criteria}".`,
              data: { highlights },
            },
          };
        }

        case 'generate_chapters': {
          const { add_as = 'subtitles', min_chapter_duration = 30 } = call.args;
          const transcription = store.transcription;
          const memoryStore = useAiMemoryStore.getState();
          const entries = memoryStore.entries ?? [];

          if (!transcription?.segments?.length && !entries.length) {
            return {
              name: call.name,
              result: {
                success: false,
                message:
                  'No transcription or media analysis available. Please transcribe the timeline first.',
                errorType: 'constraint_violation',
                recoveryHint: 'Run transcribe_timeline or import analyzed media, then retry.',
              },
            };
          }

          // Build chapter hints from transcript sentence breaks + scene changes
          const segments = transcription?.segments ?? [];
          const chapters: { time: number; title: string }[] = [];
          let lastChapterTime = 0;

          // Simple approach: create chapter every min_chapter_duration seconds using transcript context
          for (const seg of segments) {
            const segTime = seg.start ?? 0;
            if (segTime - lastChapterTime >= min_chapter_duration) {
              const rawTitle =
                seg.text?.split(/[.!?]/)[0]?.trim().slice(0, 50) ||
                `Chapter ${chapters.length + 1}`;
              chapters.push({ time: segTime, title: rawTitle });
              lastChapterTime = segTime;
            }
          }

          if (chapters.length === 0) {
            return {
              name: call.name,
              result: {
                success: false,
                message:
                  'Could not generate chapters — transcript too short or no content breaks found.',
                errorType: 'execution_error',
                recoveryHint:
                  'Try a smaller min_chapter_duration or transcribe richer content first.',
              },
            };
          }

          if (add_as === 'subtitles') {
            const existingSubs = store.subtitles;
            const newSubs = chapters.map((ch, i) => ({
              id: `chapter-${Date.now()}-${i}`,
              index: existingSubs.length + i + 1,
              startTime: ch.time,
              endTime: ch.time + 3,
              text: `Chapter: ${ch.title}`,
            }));
            store.setSubtitles([...existingSubs, ...newSubs]);
          } else {
            // Add text overlay clips at chapter positions
            chapters.forEach((ch) => {
              const beforeIds = new Set(store.clips.map((clip) => clip.id));
              store.addClip({
                path: '',
                name: `Chapter: ${ch.title}`,
                mediaType: 'text',
                duration: 3,
                sourceDuration: 3,
                textProperties: {
                  text: `Chapter: ${ch.title}`,
                  fontSize: 28,
                  fontFamily: 'Arial',
                  color: '#FFFFFF',
                  position: 'top',
                  align: 'center',
                  bold: true,
                },
              });
              const inserted = useProjectStore
                .getState()
                .clips.find(
                  (clip) =>
                    !beforeIds.has(clip.id) &&
                    clip.mediaType === 'text' &&
                    clip.name === `Chapter: ${ch.title}`,
                );
              if (inserted) {
                useProjectStore
                  .getState()
                  .moveClipToTime(inserted.id, ch.time, inserted.trackIndex);
              }
            });
          }

          return {
            name: call.name,
            result: {
              success: true,
              message: `Generated ${chapters.length} chapter markers added as ${add_as}.`,
              data: { chapters },
            },
          };
        }

        case 'generate_intro_script_from_timeline': {
          const generated = this.buildIntroScriptFromContext(call.args || {});
          return {
            name: call.name,
            result: {
              success: true,
              message: `Generated ${generated.blocks.length} intro script beats for ${generated.targetDuration}s timeline.`,
              data: {
                title: generated.title,
                target_duration: generated.targetDuration,
                script_blocks: generated.blocks,
                formatted_script: generated.formatted,
              },
            },
          };
        }

        case 'preview_caption_fit': {
          const totalDuration = Math.max(1, store.getTotalDuration());
          const inputBlocks = this.coerceScriptBlocks(call.args?.script_blocks);
          const normalized =
            inputBlocks.length > 0
              ? this.normalizeCaptionBlocks(inputBlocks, totalDuration).blocks
              : store.subtitles.map((subtitle) => ({
                  start: subtitle.startTime,
                  end: subtitle.endTime,
                  text: subtitle.text,
                }));
          const maxCharsPerSecond = Math.max(8, Number(call.args?.max_chars_per_second || 17));
          const minCaptionDuration = Math.max(0.5, Number(call.args?.min_caption_duration || 1));
          const fit = this.buildCaptionFitReport(
            normalized,
            totalDuration,
            maxCharsPerSecond,
            minCaptionDuration,
          );

          return {
            name: call.name,
            result: {
              success: true,
              message:
                fit.issues.length === 0
                  ? `Caption fit looks good (score ${fit.fitScore}).`
                  : `Caption fit has ${fit.issues.length} issue(s) (score ${fit.fitScore}).`,
              data: {
                checked_count: normalized.length,
                fit_score: fit.fitScore,
                issues: fit.issues,
                warnings: fit.warnings,
                max_chars_per_second: maxCharsPerSecond,
                min_caption_duration: minCaptionDuration,
              },
            },
          };
        }

        case 'apply_script_as_captions': {
          const totalDuration = Math.max(1, store.getTotalDuration());
          const rawBlocks = this.coerceScriptBlocks(
            call.args?.script_blocks ?? call.args?.script_text ?? call.args?.script,
          );
          const normalized = this.normalizeCaptionBlocks(rawBlocks, totalDuration);
          if (normalized.blocks.length === 0) {
            return {
              name: call.name,
              result: {
                success: false,
                message: 'No usable caption blocks found in script.',
                errorType: 'validation_error',
                error: 'script_blocks are empty after normalization',
                recoveryHint: 'Provide script blocks with text and valid start/end times.',
              },
            };
          }

          const stylePreset = String(call.args?.style_preset || 'clean_modern').toLowerCase();
          const replaceExisting = call.args?.replace_existing !== false;
          const presetStyle: Partial<typeof store.subtitleStyle> =
            stylePreset === 'bold_hype'
              ? {
                  fontSize: 32,
                  fontFamily: 'Arial Black',
                  color: '#ffffff',
                  backgroundColor: 'rgba(0, 0, 0, 0.65)',
                  position: 'bottom',
                  displayMode: 'progressive',
                }
              : stylePreset === 'minimal'
                ? {
                    fontSize: 22,
                    fontFamily: 'Arial',
                    color: '#ffffff',
                    backgroundColor: 'rgba(0, 0, 0, 0.35)',
                    position: 'bottom',
                    displayMode: 'progressive',
                  }
                : {
                    fontSize: 28,
                    fontFamily: 'Arial',
                    color: '#ffffff',
                    backgroundColor: 'rgba(0, 0, 0, 0.55)',
                    position: 'bottom',
                    displayMode: 'progressive',
                  };

          const base = replaceExisting ? [] : [...store.subtitles];
          const nextSubtitles = [
            ...base,
            ...normalized.blocks.map((block, index) => ({
              index: base.length + index + 1,
              startTime: block.start,
              endTime: block.end,
              text: block.text,
            })),
          ];

          store.setSubtitles(nextSubtitles);
          store.updateSubtitleStyle(presetStyle);

          const fit = this.buildCaptionFitReport(
            nextSubtitles.map((subtitle) => ({
              start: subtitle.startTime,
              end: subtitle.endTime,
              text: subtitle.text,
            })),
            totalDuration,
            17,
            1,
          );

          return {
            name: call.name,
            result: {
              success: true,
              message: `Applied ${normalized.blocks.length} caption block(s) with "${stylePreset}" style.`,
              data: {
                applied_count: normalized.blocks.length,
                dropped_blocks: normalized.dropped,
                replace_existing: replaceExisting,
                style_preset: stylePreset,
                fit_score: fit.fitScore,
                fit_issues: fit.issues,
                subtitles: nextSubtitles,
              },
            },
          };
        }

        default:
          throw new Error(`Unknown function: ${call.name}`);
      }
    } catch (error) {
      return {
        name: call.name,
        result: {
          success: false,
          message: 'Execution failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          errorType: 'execution_error',
          recoveryHint: 'Inspect tool arguments and current timeline state, then retry.',
        },
      };
    }
  }

  private static buildValidationFailureResult(
    call: FunctionCall,
    validation: ValidationResult,
  ): ToolResult {
    return {
      name: call.name,
      result: {
        success: false,
        message: 'Validation failed',
        error: validation.error,
        errorType: validation.errorType || 'validation_error',
        recoveryHint:
          validation.recoveryHint ||
          'Re-check IDs, required args, and numeric ranges before retrying.',
        adjustments: validation.adjustments,
      },
    };
  }

  private static normalizeToolResult(call: FunctionCall, result: ToolResult): ToolResult {
    const normalized: ToolResult = {
      ...result,
      name: result.name || call.name,
      result: {
        ...result.result,
        success: Boolean(result.result.success),
        message:
          result.result.message || (result.result.success ? 'Completed' : 'Execution failed'),
      },
    };

    if (!normalized.result.success) {
      normalized.result.errorType = normalized.result.errorType || 'execution_error';
      normalized.result.recoveryHint =
        normalized.result.recoveryHint ||
        'Inspect tool arguments and current timeline state, then retry.';
      normalized.result.error = normalized.result.error || 'Unknown error';
    }

    return normalized;
  }

  private static buildModeDeniedResult(call: FunctionCall, mode: RuntimeToolMode): ToolResult {
    return {
      name: call.name,
      result: {
        success: false,
        message: 'Mode policy blocked tool execution',
        errorType: 'constraint_violation',
        error: `Tool "${call.name}" is not allowed in "${mode}" mode.`,
        recoveryHint:
          mode === 'ask' || mode === 'plan'
            ? 'Switch to edit mode (or request execution) before mutating timeline state.'
            : 'Retry with a tool allowed by current mode policy.',
      },
    };
  }

  static async executeToolCallWithLifecycle(
    call: FunctionCall,
    index: number,
    total: number,
    context?: ExecutionLifecycleContext,
  ): Promise<ToolResult> {
    context?.onLifecycle?.({ call, index, total, state: 'pending' });
    context?.onHook?.({
      call,
      index,
      total,
      event: 'tool.execute.before',
    });

    const mode = context?.mode;
    if (mode && !isToolAllowedInMode(call.name, mode)) {
      const denied = this.normalizeToolResult(call, this.buildModeDeniedResult(call, mode));
      context?.onLifecycle?.({
        call,
        index,
        total,
        state: 'error',
        result: denied,
      });
      context?.onHook?.({
        call,
        index,
        total,
        event: 'tool.execute.after',
        result: denied,
      });
      return denied;
    }

    const validation = this.validateFunctionCall(call);
    if (!validation.valid) {
      const failed = this.normalizeToolResult(
        call,
        this.buildValidationFailureResult(call, validation),
      );
      context?.onLifecycle?.({
        call,
        index,
        total,
        state: 'error',
        result: failed,
      });
      context?.onHook?.({
        call,
        index,
        total,
        event: 'tool.execute.after',
        result: failed,
      });
      return failed;
    }

    context?.onLifecycle?.({ call, index, total, state: 'running' });

    const result = this.normalizeToolResult(call, this.executeSingle(call));
    context?.onLifecycle?.({
      call,
      index,
      total,
      state: result.result.success ? 'completed' : 'error',
      result,
    });
    context?.onHook?.({
      call,
      index,
      total,
      event: 'tool.execute.after',
      result,
    });
    return result;
  }

  static preflightPlan(calls: FunctionCall[]): {
    valid: boolean;
    normalizedCalls: FunctionCall[];
    corrections: string[];
    issues: PreflightIssue[];
  } {
    const normalizedCalls: FunctionCall[] = [];
    const corrections: string[] = [];
    const issues: PreflightIssue[] = [];

    for (const [index, original] of calls.entries()) {
      const call: FunctionCall = {
        name: original.name,
        args: { ...(original.args || {}) },
        id: original.id,
      };
      const validation = this.validateFunctionCall(call);

      if (!validation.valid) {
        issues.push({
          index,
          name: call.name,
          message: validation.error || 'Validation failed',
          errorType: validation.errorType || 'validation_error',
          recoveryHint: validation.recoveryHint,
        });
      }

      if (validation.adjustments && validation.adjustments.length > 0) {
        corrections.push(`${call.name}: ${validation.adjustments.join('; ')}`);
      }

      normalizedCalls.push(call);
    }

    return {
      valid: issues.length === 0,
      normalizedCalls,
      corrections,
      issues,
    };
  }

  private static cloneCall(call: FunctionCall): FunctionCall {
    return {
      name: call.name,
      args: { ...(call.args || {}) },
      id: call.id,
    };
  }

  private static repairCallWithConstraints(call: FunctionCall): FunctionCall | null {
    const repaired = this.cloneCall(call);
    const state = useProjectStore.getState();

    switch (repaired.name) {
      case 'set_playhead_position': {
        const totalDuration = state.getTotalDuration();
        const time = Number(repaired.args?.time);
        if (!Number.isFinite(time)) return null;
        repaired.args.time = Math.max(0, Math.min(totalDuration, time));
        return repaired;
      }
      case 'move_clip': {
        const startTime = Number(repaired.args?.start_time);
        if (!Number.isFinite(startTime)) return null;
        repaired.args.start_time = Math.max(0, startTime);
        return repaired;
      }
      case 'split_clip': {
        const clipId = String(repaired.args?.clip_id || '');
        const clip = state.clips.find((entry) => entry.id === clipId);
        if (!clip) return null;
        const time = Number(repaired.args?.time_in_clip);
        if (!Number.isFinite(time)) return null;
        const clamped = Math.max(0.05, Math.min(clip.duration - 0.05, time));
        repaired.args.time_in_clip = Number(clamped.toFixed(2));
        return repaired;
      }
      case 'update_clip_bounds': {
        const clipId = String(repaired.args?.clip_id || '');
        const clip = state.clips.find((entry) => entry.id === clipId);
        if (!clip) return null;
        const normalized = this.normalizeClipBounds(
          clip,
          repaired.args?.new_start as number | undefined,
          repaired.args?.new_end as number | undefined,
        );
        if (!normalized.valid) return null;
        repaired.args.new_start = normalized.start;
        repaired.args.new_end = normalized.end;
        return repaired;
      }
      default:
        return null;
    }
  }

  private static mergeRecoveryMetadata(
    result: ToolResult,
    recoveryReasonCodes: RecoveryReasonCode[],
    notes: string[],
  ): ToolResult {
    const attempts = Math.max(1, recoveryReasonCodes.length + 1);
    return {
      ...result,
      result: {
        ...result.result,
        recovery: {
          attempts,
          recovered: result.result.success && recoveryReasonCodes.length > 0,
          reasonCodes: recoveryReasonCodes,
          notes,
        },
      },
    };
  }

  static async executeWithRecovery(
    calls: FunctionCall[],
    policy: RecoveryPolicy = {},
    onProgress?: (index: number, total: number, result: ToolResult) => void,
    lifecycle?: ExecutionLifecycleContext,
  ): Promise<ExecuteWithRecoveryResult> {
    const stopOnFailure = policy.stopOnFailure ?? true;
    const maxAttemptsPerOperation = Math.max(1, Math.min(5, policy.maxAttemptsPerOperation || 4));
    const results: ToolResult[] = [];
    const recoveryEvents: RecoveryEvent[] = [];

    const emitRecoveryEvent = (
      index: number,
      name: string,
      code: RecoveryReasonCode,
      success: boolean,
      message: string,
    ) => {
      recoveryEvents.push({ index, name, code, success, message });
    };

    for (let i = 0; i < calls.length; i++) {
      const baseCall = this.cloneCall(calls[i]);
      const operationRecoveryCodes: RecoveryReasonCode[] = [];
      const operationNotes: string[] = [];

      let finalResult = await this.executeToolCallWithLifecycle(
        baseCall,
        i + 1,
        calls.length,
        lifecycle,
      );
      let attemptsUsed = 1;

      if (!finalResult.result.success && attemptsUsed < maxAttemptsPerOperation) {
        const preflight = this.preflightPlan([baseCall]);
        const normalizedCall = preflight.normalizedCalls[0];
        const normalizationApplied =
          preflight.corrections.length > 0 ||
          JSON.stringify(normalizedCall.args || {}) !== JSON.stringify(baseCall.args || {});
        if (normalizationApplied) {
          operationRecoveryCodes.push('arg_normalization_retry');
          operationNotes.push(...preflight.corrections);
          finalResult = await this.executeToolCallWithLifecycle(
            normalizedCall,
            i + 1,
            calls.length,
            lifecycle,
          );
          emitRecoveryEvent(
            i,
            baseCall.name,
            'arg_normalization_retry',
            finalResult.result.success,
            finalResult.result.message || finalResult.result.error || 'arg normalization retry',
          );
          attemptsUsed++;
        }
      }

      if (!finalResult.result.success && attemptsUsed < maxAttemptsPerOperation) {
        const inspectCalls: FunctionCall[] = [{ name: 'get_timeline_info', args: {} }];
        if (typeof baseCall.args?.clip_id === 'string' && baseCall.args.clip_id.trim()) {
          inspectCalls.push({ name: 'get_clip_details', args: { clip_id: baseCall.args.clip_id } });
        }

        const inspectResults: ToolResult[] = [];
        for (const inspectCall of inspectCalls) {
          const inspectResult = await this.executeToolCallWithLifecycle(
            inspectCall,
            i + 1,
            calls.length,
            lifecycle,
          );
          inspectResults.push(inspectResult);
        }
        const inspectSuccess = inspectResults.every((entry) => entry.result.success);
        operationRecoveryCodes.push('state_inspection');
        operationNotes.push(
          inspectSuccess
            ? 'State inspection completed before retry.'
            : 'State inspection partially failed.',
        );
        emitRecoveryEvent(
          i,
          baseCall.name,
          'state_inspection',
          inspectSuccess,
          inspectResults.map((entry) => entry.result.message).join(' | '),
        );
        attemptsUsed++;
      }

      if (!finalResult.result.success && attemptsUsed < maxAttemptsPerOperation) {
        const repairedCall = this.repairCallWithConstraints(baseCall);
        if (repairedCall) {
          operationRecoveryCodes.push('constraint_recompile_retry');
          operationNotes.push('Applied deterministic argument repair and retried.');
          finalResult = await this.executeToolCallWithLifecycle(
            repairedCall,
            i + 1,
            calls.length,
            lifecycle,
          );
          emitRecoveryEvent(
            i,
            baseCall.name,
            'constraint_recompile_retry',
            finalResult.result.success,
            finalResult.result.message || finalResult.result.error || 'constraint repair retry',
          );
          attemptsUsed++;
        }
      }

      if (!finalResult.result.success) {
        const fallbackInspect = await this.executeToolCallWithLifecycle(
          { name: 'get_timeline_info', args: {} },
          i + 1,
          calls.length,
          lifecycle,
        );
        operationRecoveryCodes.push('fallback_readonly_recovery');
        operationNotes.push('Fallback read-only timeline inspection executed.');
        emitRecoveryEvent(
          i,
          baseCall.name,
          'fallback_readonly_recovery',
          fallbackInspect.result.success,
          fallbackInspect.result.message || 'fallback recovery inspection',
        );
        operationRecoveryCodes.push('recovery_exhausted');
        emitRecoveryEvent(
          i,
          baseCall.name,
          'recovery_exhausted',
          false,
          'All configured recovery ladder steps were exhausted.',
        );
        finalResult = {
          ...finalResult,
          result: {
            ...finalResult.result,
            recoveryHint:
              finalResult.result.recoveryHint ||
              'Recovery steps were attempted. Please review clip IDs/timestamps and retry. Undo is available for successful prior steps.',
          },
        };
      }

      const annotated = this.mergeRecoveryMetadata(
        finalResult,
        operationRecoveryCodes,
        operationNotes,
      );
      results.push(annotated);
      onProgress?.(i + 1, calls.length, annotated);

      if (stopOnFailure && !annotated.result.success) {
        break;
      }
    }

    return { results, recoveryEvents };
  }

  static async executeWithPolicy(
    calls: FunctionCall[],
    policy: ExecutionPolicy = {},
    onProgress?: (index: number, total: number, result: ToolResult) => void,
    lifecycle?: ExecutionLifecycleContext,
  ): Promise<ToolResult[]> {
    const mode = policy.mode || 'strict_sequential';
    const maxReadOnlyBatchSize = Math.max(1, Math.min(3, policy.maxReadOnlyBatchSize || 3));
    const stopOnFailure = policy.stopOnFailure ?? true;

    if (mode !== 'hybrid') {
      return this.executeAll(calls, onProgress, lifecycle);
    }

    const results: ToolResult[] = [];
    let completed = 0;
    let i = 0;

    while (i < calls.length) {
      const current = calls[i];

      if (!isReadOnlyTool(current.name)) {
        const result = await this.executeToolCallWithLifecycle(
          current,
          i + 1,
          calls.length,
          lifecycle,
        );
        results.push(result);
        completed++;
        onProgress?.(completed, calls.length, result);
        if (stopOnFailure && !result.result.success) break;
        i++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }

      const batch: FunctionCall[] = [current];
      const batchIndices: number[] = [i + 1];
      let cursor = i + 1;
      while (
        cursor < calls.length &&
        isReadOnlyTool(calls[cursor].name) &&
        batch.length < maxReadOnlyBatchSize
      ) {
        batch.push(calls[cursor]);
        batchIndices.push(cursor + 1);
        cursor++;
      }

      const batchResults = await Promise.all(
        batch.map(async (call, batchIndex) =>
          this.executeToolCallWithLifecycle(
            call,
            batchIndices[batchIndex],
            calls.length,
            lifecycle,
          ),
        ),
      );

      for (const result of batchResults) {
        results.push(result);
        completed++;
        onProgress?.(completed, calls.length, result);
      }
      if (stopOnFailure && batchResults.some((result) => !result.result.success)) {
        break;
      }

      i = cursor;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    return results;
  }

  /**
   * Execute multiple function calls sequentially with progress tracking
   */
  static async executeAll(
    calls: FunctionCall[],
    onProgress?: (index: number, total: number, result: ToolResult) => void,
    lifecycle?: ExecutionLifecycleContext,
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      const result = await this.executeToolCallWithLifecycle(call, i + 1, calls.length, lifecycle);
      results.push(result);

      // Progress callback
      onProgress?.(i + 1, calls.length, result);

      // Enforce step-by-step safety: stop immediately on first failed execution.
      if (!result.result.success) {
        break;
      }

      // Small delay for UI updates
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return results;
  }
}
