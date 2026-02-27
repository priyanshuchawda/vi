import { useProjectStore } from "../stores/useProjectStore";
import { useAiMemoryStore } from "../stores/useAiMemoryStore";
import type { FunctionCall, ToolResult } from "./videoEditingTools";
import { isReadOnlyTool } from "./toolCapabilityMatrix";

type ToolErrorCategory =
  | "plan_error"
  | "validation_error"
  | "execution_error"
  | "media_limit"
  | "tool_missing"
  | "constraint_violation";

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
  mode?: "strict_sequential" | "hybrid";
  maxReadOnlyBatchSize?: number;
  stopOnFailure?: boolean;
}

/**
 * Tool Executor - Maps AI function calls to actual video editing operations
 *
 * This class handles validation, execution, and result collection for all
 * video editing tools exposed to AI AI.
 */
export class ToolExecutor {
  /**
   * Normalize clip bounds to valid source ranges.
   * This prevents hard failures when AI asks to extend beyond source media.
   */
  private static normalizeClipBounds(
    clip: any,
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
        error: "new_start/new_end must be finite numbers",
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
          error: "Resulting clip bounds are invalid after normalization (start must be less than end)",
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
      case "split_clip": {
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

      case "set_clip_volume": {
        const { volume, clip_ids } = call.args;
        if (volume < 0 || volume > 1) {
          return {
            valid: false,
            error: "Volume must be between 0.0 (silent) and 1.0 (full volume)",
          };
        }
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return { valid: false, error: "Must provide at least one clip ID" };
        }
        // Check clips exist (unless "all")
        if (!clip_ids.includes("all")) {
          const missing = clip_ids.filter(
            (id: string) => !state.clips.find((c) => c.id === id),
          );
          if (missing.length > 0) {
            return {
              valid: false,
              error: `Clips not found: ${missing.join(", ")}`,
            };
          }
        }
        return { valid: true };
      }

      case "delete_clips": {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return {
            valid: false,
            error: "Must provide at least one clip ID to delete",
          };
        }
        const missing = clip_ids.filter(
          (id: string) => !state.clips.find((c) => c.id === id),
        );
        if (missing.length > 0) {
          return {
            valid: false,
            error: `Clips not found: ${missing.join(", ")}`,
          };
        }
        return { valid: true };
      }

      case "move_clip": {
        const { clip_id, start_time } = call.args;
        const clip = state.clips.find((c) => c.id === clip_id);
        if (!clip)
          return {
            valid: false,
            error: `Clip with ID "${clip_id}" not found`,
            errorType: "validation_error",
            recoveryHint: "Call get_timeline_info first to get current clip IDs, then retry with a valid clip_id.",
          };
        if (start_time < 0) {
          return {
            valid: false,
            error: "Start time cannot be negative",
            errorType: "constraint_violation",
            recoveryHint: "Use start_time >= 0.",
          };
        }
        return { valid: true };
      }

      case "merge_clips": {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length < 2) {
          return {
            valid: false,
            error: "Must provide at least 2 clip IDs to merge",
          };
        }
        const missing = clip_ids.filter(
          (id: string) => !state.clips.find((c) => c.id === id),
        );
        if (missing.length > 0) {
          return {
            valid: false,
            error: `Clips not found: ${missing.join(", ")}`,
          };
        }
        return { valid: true };
      }

      case "toggle_clip_mute": {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return { valid: false, error: "Must provide at least one clip ID" };
        }
        const missing = clip_ids.filter(
          (id: string) => !state.clips.find((c) => c.id === id),
        );
        if (missing.length > 0) {
          return {
            valid: false,
            error: `Clips not found: ${missing.join(", ")}`,
          };
        }
        return { valid: true };
      }

      case "select_clips": {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return { valid: false, error: "Must provide at least one clip ID" };
        }
        // "all" is allowed
        if (!clip_ids.includes("all")) {
          const missing = clip_ids.filter(
            (id: string) => !state.clips.find((c) => c.id === id),
          );
          if (missing.length > 0) {
            return {
              valid: false,
              error: `Clips not found: ${missing.join(", ")}`,
            };
          }
        }
        return { valid: true };
      }

      case "copy_clips": {
        const { clip_ids } = call.args;
        if (!Array.isArray(clip_ids) || clip_ids.length === 0) {
          return {
            valid: false,
            error: "Must provide at least one clip ID to copy",
          };
        }
        const missing = clip_ids.filter(
          (id: string) => !state.clips.find((c) => c.id === id),
        );
        if (missing.length > 0) {
          return {
            valid: false,
            error: `Clips not found: ${missing.join(", ")}`,
          };
        }
        return { valid: true };
      }

      case "undo_action": {
        if (!state.canUndo()) {
          return { valid: false, error: "Nothing to undo" };
        }
        return { valid: true };
      }

      case "redo_action": {
        if (!state.canRedo()) {
          return { valid: false, error: "Nothing to redo" };
        }
        return { valid: true };
      }

      case "set_playhead_position": {
        const { time } = call.args;
        if (time < 0) {
          return {
            valid: false,
            error: "Time cannot be negative",
            errorType: "constraint_violation",
            recoveryHint: "Use time >= 0.",
          };
        }
        const totalDuration = state.getTotalDuration();
        if (time > totalDuration) {
          return {
            valid: false,
            error: `Time ${time.toFixed(1)}s exceeds timeline duration ${totalDuration.toFixed(1)}s`,
            errorType: "constraint_violation",
            recoveryHint: `Use a time between 0 and ${totalDuration.toFixed(1)}s.`,
          };
        }
        return { valid: true };
      }

      case "update_clip_bounds": {
        const { clip_id, new_start, new_end } = call.args;
        const clip = state.clips.find((c) => c.id === clip_id);
        if (!clip)
          return {
            valid: false,
            error: `Clip with ID "${clip_id}" not found`,
            errorType: "validation_error",
            recoveryHint: "Call get_timeline_info first and use a valid clip_id.",
          };

        const normalized = this.normalizeClipBounds(clip, new_start, new_end);
        if (!normalized.valid) {
          return {
            valid: false,
            error: normalized.error,
            errorType: "constraint_violation",
            recoveryHint: "Adjust new_start/new_end to a valid source range.",
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

      case "get_clip_details": {
        const { clip_id } = call.args;
        const clip = state.clips.find((c) => c.id === clip_id);
        if (!clip)
          return { valid: false, error: `Clip with ID "${clip_id}" not found` };
        return { valid: true };
      }

      // ==================== SUBTITLE VALIDATION ====================

      case "add_subtitle": {
        const { text, start_time, end_time } = call.args;
        if (!text || text.trim().length === 0) {
          return { valid: false, error: "Subtitle text cannot be empty" };
        }
        if (start_time < 0) {
          return { valid: false, error: "Start time cannot be negative" };
        }
        if (end_time <= start_time) {
          return { valid: false, error: "End time must be after start time" };
        }
        return { valid: true };
      }

      case "update_subtitle": {
        const { index, start_time, end_time } = call.args;
        if (index < 1 || index > state.subtitles.length) {
          return {
            valid: false,
            error: `Subtitle ${index} not found. Valid range: 1-${state.subtitles.length}`,
          };
        }
        if (start_time !== undefined && start_time < 0) {
          return { valid: false, error: "Start time cannot be negative" };
        }
        if (
          start_time !== undefined &&
          end_time !== undefined &&
          end_time <= start_time
        ) {
          return { valid: false, error: "End time must be after start time" };
        }
        return { valid: true };
      }

      case "delete_subtitle": {
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

      case "transcribe_clip": {
        const { clip_id } = call.args;
        if (clip_id === "active") {
          if (!state.activeClipId) {
            return { valid: false, error: "No clip is currently selected" };
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

      case "apply_transcript_edits": {
        const { deletion_ranges } = call.args;
        if (!Array.isArray(deletion_ranges) || deletion_ranges.length === 0) {
          return {
            valid: false,
            error: "Must provide at least one deletion range",
          };
        }
        for (const range of deletion_ranges) {
          if (range.start < 0 || range.end <= range.start) {
            return {
              valid: false,
              error: "Invalid deletion range: end must be after start",
            };
          }
        }
        return { valid: true };
      }

      // ==================== PROJECT MANAGEMENT VALIDATION ====================

      case "set_export_settings": {
        const { format, resolution } = call.args;
        const validFormats = ["mp4", "mov", "avi", "webm"];
        const validResolutions = [
          "1920x1080",
          "1280x720",
          "854x480",
          "original",
        ];

        if (format && !validFormats.includes(format)) {
          return {
            valid: false,
            error: `Invalid format. Valid options: ${validFormats.join(", ")}`,
          };
        }
        if (resolution && !validResolutions.includes(resolution)) {
          return {
            valid: false,
            error: `Invalid resolution. Valid options: ${validResolutions.join(", ")}`,
          };
        }
        return { valid: true };
      }

      // ==================== SEARCH & ANALYSIS VALIDATION ====================

      case "search_clips_by_content": {
        const { query } = call.args;
        if (!query || query.trim().length === 0) {
          return { valid: false, error: "Search query cannot be empty" };
        }
        return { valid: true };
      }

      case "get_clip_analysis": {
        const { clip_id } = call.args;
        const clip = state.clips.find((c) => c.id === clip_id);
        if (!clip) {
          return { valid: false, error: `Clip with ID "${clip_id}" not found` };
        }
        return { valid: true };
      }

      case "get_timeline_info":
      case "paste_clips":
      case "update_subtitle_style":
      case "get_subtitles":
      case "clear_all_subtitles":
      case "transcribe_timeline":
      case "get_transcription":
      case "save_project":
      case "get_project_info":
      case "get_all_media_analysis":
      case "find_highlights":
      case "generate_chapters":
        // No validation needed for these
        return { valid: true };

      case "set_clip_speed": {
        const { clip_id, speed } = call.args;
        if (!clip_id) return { valid: false, error: "clip_id is required" };
        if (typeof speed !== "number" || speed < 0.25 || speed > 8.0) {
          return {
            valid: false,
            error: "speed must be a number between 0.25 and 8.0",
          };
        }
        const clip = useProjectStore
          .getState()
          .clips.find((c) => c.id === clip_id);
        if (!clip) return { valid: false, error: `Clip ${clip_id} not found` };
        return { valid: true };
      }

      case "apply_clip_effect": {
        const { clip_id } = call.args;
        if (!clip_id) return { valid: false, error: "clip_id is required" };
        const clip = useProjectStore
          .getState()
          .clips.find((c) => c.id === clip_id);
        if (!clip) return { valid: false, error: `Clip ${clip_id} not found` };
        return { valid: true };
      }

      default:
        return {
          valid: false,
          error: `Unknown function: ${call.name}`,
          errorType: "tool_missing",
          recoveryHint: "Use only supported tools from toolConfig.",
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
        case "get_timeline_info": {
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

        case "split_clip": {
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

        case "delete_clips": {
          const { clip_ids } = call.args;
          const clipNames = clip_ids.map(
            (id: string) => store.clips.find((c) => c.id === id)?.name || id,
          );

          clip_ids.forEach((id: string) => store.removeClip(id));

          return {
            name: call.name,
            result: {
              success: true,
              message: `Deleted ${clip_ids.length} clip(s): ${clipNames.join(", ")}`,
            },
          };
        }

        case "move_clip": {
          const { clip_id, start_time, track_index } = call.args;
          const clip = store.clips.find((c) => c.id === clip_id);
          if (!clip) throw new Error(`Clip ${clip_id} not found`);

          store.moveClipToTime(clip_id, start_time, track_index);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Moved "${clip.name}" to ${start_time.toFixed(1)}s${track_index !== undefined ? ` on track ${track_index}` : ""}`,
            },
          };
        }

        case "merge_clips": {
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
              message: `Merged ${clip_ids.length} clips: ${clipNames.join(", ")}`,
            },
          };
        }

        case "copy_clips": {
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

        case "paste_clips": {
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

        case "set_clip_volume": {
          const { clip_ids, volume } = call.args;

          // Handle "all" keyword
          const targetIds = clip_ids.includes("all")
            ? store.clips.map((c) => c.id)
            : clip_ids;

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

        case "toggle_clip_mute": {
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

        case "select_clips": {
          const { clip_ids } = call.args;
          const targetIds = clip_ids.includes("all")
            ? store.clips.map((c) => c.id)
            : clip_ids;

          store.selectClips(targetIds);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Selected ${targetIds.length} clip(s)`,
            },
          };
        }

        case "undo_action": {
          if (!store.canUndo()) throw new Error("Nothing to undo");
          store.undo();

          return {
            name: call.name,
            result: {
              success: true,
              message: "Undid last action",
            },
          };
        }

        case "redo_action": {
          if (!store.canRedo()) throw new Error("Nothing to redo");
          store.redo();

          return {
            name: call.name,
            result: {
              success: true,
              message: "Redid last action",
            },
          };
        }

        case "set_playhead_position": {
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

        case "update_clip_bounds": {
          const { clip_id, new_start, new_end } = call.args;
          const clip = store.clips.find((c) => c.id === clip_id);
          if (!clip) throw new Error(`Clip ${clip_id} not found`);

          const normalized = this.normalizeClipBounds(clip, new_start, new_end);
          if (!normalized.valid) {
            throw new Error(
              normalized.error ||
                `Failed to normalize clip bounds for "${clip.name}"`,
            );
          }

          const updates: Partial<typeof clip> = {
            start: normalized.start,
            end: normalized.end,
            duration: normalized.end - normalized.start,
          };

          store.updateClip(clip_id, updates);

          const adjustmentSuffix = normalized.adjusted
            ? ` (auto-adjusted: ${normalized.adjustmentNotes.join("; ")})`
            : "";

          return {
            name: call.name,
            result: {
              success: true,
              message: `Updated bounds for "${clip.name}" (duration: ${updates.duration?.toFixed(1)}s)${adjustmentSuffix}`,
            },
          };
        }

        case "get_clip_details": {
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

        case "add_subtitle": {
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

        case "update_subtitle": {
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

        case "delete_subtitle": {
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

        case "update_subtitle_style": {
          const { font_size, font_family, color, background_color, position } =
            call.args;
          const updates: any = {};

          if (font_size !== undefined) updates.fontSize = font_size;
          if (font_family !== undefined) updates.fontFamily = font_family;
          if (color !== undefined) updates.color = color;
          if (background_color !== undefined)
            updates.backgroundColor = background_color;
          if (position !== undefined) updates.position = position;

          store.updateSubtitleStyle(updates);

          return {
            name: call.name,
            result: {
              success: true,
              message: "Updated subtitle styling",
              data: { updates },
            },
          };
        }

        case "get_subtitles": {
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

        case "clear_all_subtitles": {
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

        case "transcribe_clip": {
          const { clip_id } = call.args;
          const targetId = clip_id === "active" ? store.activeClipId : clip_id;
          const clip = store.clips.find((c) => c.id === targetId);

          if (!clip) throw new Error("Clip not found");

          // Trigger transcription asynchronously
          if (clip_id === "active") {
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

        case "transcribe_timeline": {
          store.transcribeTimeline();

          return {
            name: call.name,
            result: {
              success: true,
              message: "Started transcribing timeline...",
            },
          };
        }

        case "get_transcription": {
          const transcription = store.transcription;

          if (!transcription) {
            return {
              name: call.name,
              result: {
                success: true,
                message: "No transcription available",
                data: { transcription: null },
              },
            };
          }

          return {
            name: call.name,
            result: {
              success: true,
              message: "Retrieved transcription",
              data: {
                text: transcription.text,
                segments: transcription.segments,
                wordCount: transcription.words?.length || 0,
              },
            },
          };
        }

        case "apply_transcript_edits": {
          const { deletion_ranges } = call.args;

          // This is async but we'll fire and forget
          store.applyTranscriptEdits(deletion_ranges).catch((err) => {
            console.error("Error applying transcript edits:", err);
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

        case "save_project": {
          // Trigger save asynchronously
          store.saveProject().catch((err) => {
            console.error("Error saving project:", err);
          });

          return {
            name: call.name,
            result: {
              success: true,
              message: "Saving project...",
              data: {
                projectPath: store.projectPath,
                hasUnsavedChanges: false,
              },
            },
          };
        }

        case "set_export_settings": {
          const { format, resolution } = call.args;
          const updates: string[] = [];

          if (format) {
            store.setExportFormat(format as any);
            updates.push(`format: ${format}`);
          }
          if (resolution) {
            store.setExportResolution(resolution as any);
            updates.push(`resolution: ${resolution}`);
          }

          return {
            name: call.name,
            result: {
              success: true,
              message: `Updated export settings (${updates.join(", ")})`,
              data: {
                format: store.exportFormat,
                resolution: store.exportResolution,
              },
            },
          };
        }

        case "get_project_info": {
          return {
            name: call.name,
            result: {
              success: true,
              message: "Retrieved project information",
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

        case "search_clips_by_content": {
          const { query } = call.args;
          const memoryStore = useAiMemoryStore.getState();
          const completedEntries = memoryStore.getCompletedEntries();

          // Simple content search through analysis data
          const lowerQuery = query.toLowerCase();
          const matchingEntries = completedEntries.filter((entry: any) => {
            const searchText = [
              entry.summary,
              entry.analysis,
              ...(entry.tags || []),
              entry.visualInfo?.style,
              ...(entry.visualInfo?.subjects || []),
              entry.audioInfo?.mood,
            ]
              .join(" ")
              .toLowerCase();

            return searchText.includes(lowerQuery);
          });

          // Map to clips
          const matchingClips = matchingEntries
            .map((entry: any) => store.clips.find((c) => c.id === entry.clipId))
            .filter(Boolean);

          return {
            name: call.name,
            result: {
              success: true,
              message: `Found ${matchingClips.length} clips matching "${query}"`,
              data: {
                query,
                matches: matchingClips.map((clip: any) => ({
                  id: clip.id,
                  name: clip.name,
                  startTime: clip.startTime,
                  duration: clip.duration,
                })),
              },
            },
          };
        }

        case "get_clip_analysis": {
          const { clip_id } = call.args;
          const memoryStore = useAiMemoryStore.getState();
          const analysis = memoryStore.getEntryByClipId(clip_id);

          if (!analysis) {
            return {
              name: call.name,
              result: {
                success: true,
                message: "No AI analysis available for this clip",
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

        case "get_all_media_analysis": {
          const memoryStore = useAiMemoryStore.getState();
          const context = memoryStore.getMemoryContext();

          return {
            name: call.name,
            result: {
              success: true,
              message: context.projectSummary,
              data: {
                totalFiles: context.totalFiles,
                entries: context.entries.map((entry: any) => ({
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

        case "set_clip_speed": {
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

        case "apply_clip_effect": {
          const { clip_id, brightness, contrast, saturation, gamma } =
            call.args;
          const clip = store.clips.find((c) => c.id === clip_id);
          const newEffects: any = {};
          if (brightness !== undefined)
            newEffects.brightness = Math.max(-1, Math.min(1, brightness));
          if (contrast !== undefined)
            newEffects.contrast = Math.max(0, Math.min(3, contrast));
          if (saturation !== undefined)
            newEffects.saturation = Math.max(0, Math.min(3, saturation));
          if (gamma !== undefined)
            newEffects.gamma = Math.max(0.1, Math.min(10, gamma));
          store.setClipEffects(clip_id, newEffects);
          const parts = Object.entries(newEffects)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
          return {
            name: call.name,
            result: {
              success: true,
              message: `Applied effects to "${clip?.name || clip_id}": ${parts}. Will be applied on export.`,
              data: { clipId: clip_id, effects: newEffects },
            },
          };
        }

        case "find_highlights": {
          const { criteria = "exciting moments", max_results = 5 } = call.args;
          const memoryStore = useAiMemoryStore.getState();
          const entries = memoryStore.entries ?? [];
          const clips = store.clips;

          // Score each entry against criteria keywords
          const keywords = criteria.toLowerCase().split(/\s+/);
          const scored = entries
            .filter((e: any) => e.status === "completed")
            .map((entry: any) => {
              const haystack = [
                entry.summary ?? "",
                ...(entry.tags ?? []),
                entry.analysis?.audioInfo?.mood ?? "",
                entry.analysis?.audioInfo?.speechContent ?? "",
                ...(entry.analysis?.visualInfo?.subjects ?? []),
                entry.analysis?.visualInfo?.style ?? "",
              ]
                .join(" ")
                .toLowerCase();
              const score = keywords.filter((kw: string) =>
                haystack.includes(kw),
              ).length;
              return { entry, score };
            })
            .filter(({ score }: any) => score > 0)
            .sort((a: any, b: any) => b.score - a.score)
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

          const highlights = scored.map(({ entry }: any) => {
            const clip = clips.find((c: any) => c.id === entry.clipId);
            return {
              clipId: entry.clipId,
              clipName: entry.fileName,
              summary: entry.summary,
              tags: entry.tags?.slice(0, 5),
              timelineStart: clip?.startTime ?? 0,
              duration:
                clip?.duration ?? entry.analysis?.metadata?.duration ?? 0,
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

        case "generate_chapters": {
          const { add_as = "subtitles", min_chapter_duration = 30 } = call.args;
          const transcription = store.transcription;
          const memoryStore = useAiMemoryStore.getState();
          const entries = memoryStore.entries ?? [];

          if (!transcription?.segments?.length && !entries.length) {
            return {
              name: call.name,
              result: {
                success: false,
                message:
                  "No transcription or media analysis available. Please transcribe the timeline first.",
                errorType: "constraint_violation",
                recoveryHint: "Run transcribe_timeline or import analyzed media, then retry.",
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
                  "Could not generate chapters — transcript too short or no content breaks found.",
                errorType: "execution_error",
                recoveryHint: "Try a smaller min_chapter_duration or transcribe richer content first.",
              },
            };
          }

          if (add_as === "subtitles") {
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
              store.addClip({
                path: "",
                name: `Chapter: ${ch.title}`,
                mediaType: "text",
                startTime: ch.time,
                duration: 3,
                sourceDuration: 3,
                textProperties: {
                  text: `Chapter: ${ch.title}`,
                  fontSize: 28,
                  color: "#FFFFFF",
                  position: "top",
                  align: "center",
                  bold: true,
                } as any,
              } as any);
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

        default:
          throw new Error(`Unknown function: ${call.name}`);
      }
    } catch (error) {
      return {
        name: call.name,
        result: {
          success: false,
          message: "Execution failed",
          error: error instanceof Error ? error.message : "Unknown error",
          errorType: "execution_error",
          recoveryHint: "Inspect tool arguments and current timeline state, then retry.",
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
        message: "Validation failed",
        error: validation.error,
        errorType: validation.errorType || "validation_error",
        recoveryHint:
          validation.recoveryHint ||
          "Re-check IDs, required args, and numeric ranges before retrying.",
        adjustments: validation.adjustments,
      },
    };
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
          message: validation.error || "Validation failed",
          errorType: validation.errorType || "validation_error",
          recoveryHint: validation.recoveryHint,
        });
      }

      if (validation.adjustments && validation.adjustments.length > 0) {
        corrections.push(
          `${call.name}: ${validation.adjustments.join("; ")}`,
        );
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

  static async executeWithPolicy(
    calls: FunctionCall[],
    policy: ExecutionPolicy = {},
    onProgress?: (index: number, total: number, result: ToolResult) => void,
  ): Promise<ToolResult[]> {
    const mode = policy.mode || "strict_sequential";
    const maxReadOnlyBatchSize = Math.max(
      1,
      Math.min(3, policy.maxReadOnlyBatchSize || 3),
    );
    const stopOnFailure = policy.stopOnFailure ?? true;

    if (mode !== "hybrid") {
      return this.executeAll(calls, onProgress);
    }

    const results: ToolResult[] = [];
    let completed = 0;
    let i = 0;

    while (i < calls.length) {
      const current = calls[i];

      if (!isReadOnlyTool(current.name)) {
        const validation = this.validateFunctionCall(current);
        if (!validation.valid) {
          const failed = this.buildValidationFailureResult(current, validation);
          results.push(failed);
          completed++;
          onProgress?.(completed, calls.length, failed);
          if (stopOnFailure) break;
          i++;
          continue;
        }

        const result = this.executeSingle(current);
        results.push(result);
        completed++;
        onProgress?.(completed, calls.length, result);
        if (stopOnFailure && !result.result.success) break;
        i++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }

      const batch: FunctionCall[] = [current];
      let cursor = i + 1;
      while (
        cursor < calls.length &&
        isReadOnlyTool(calls[cursor].name) &&
        batch.length < maxReadOnlyBatchSize
      ) {
        batch.push(calls[cursor]);
        cursor++;
      }

      const validationFailures: ToolResult[] = [];
      for (const call of batch) {
        const validation = this.validateFunctionCall(call);
        if (!validation.valid) {
          validationFailures.push(
            this.buildValidationFailureResult(call, validation),
          );
        }
      }
      if (validationFailures.length > 0) {
        for (const failed of validationFailures) {
          results.push(failed);
          completed++;
          onProgress?.(completed, calls.length, failed);
        }
        if (stopOnFailure) break;
        i = cursor;
        continue;
      }

      const batchResults = await Promise.all(
        batch.map(async (call) => this.executeSingle(call)),
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
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];

      // Validate first
      const validation = this.validateFunctionCall(call);
      if (!validation.valid) {
        const result = this.buildValidationFailureResult(call, validation);
        results.push(result);
        onProgress?.(i + 1, calls.length, result);
        break;
      }

      // Execute
      const result = this.executeSingle(call);
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
