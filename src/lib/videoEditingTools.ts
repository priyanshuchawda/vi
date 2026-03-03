/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Video Editing Tool Declarations for AWS Bedrock (Amazon Nova Lite)
 *
 * These tool specifications inform the AI about available video editing operations.
 * Format: Bedrock Converse API `toolSpec` with `inputSchema.json` (JSON Schema).
 *
 * The AI will analyze user requests and call appropriate tools with parameters.
 */

export const getTimelineInfoDeclaration = {
  toolSpec: {
    name: 'get_timeline_info',
    description:
      "Retrieves current state of the timeline including all clips, their positions, durations, selections, and playback state. Use this to understand what's currently on the timeline before performing operations.",
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

export const askClarificationDeclaration = {
  toolSpec: {
    name: 'ask_clarification',
    description:
      'Use when required information is missing or ambiguous before editing (for example: which clip, which range, which track). Ask one focused question with explicit answer options.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Short clarification question for the user.',
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '2-6 mutually exclusive answer options.',
          },
          context: {
            type: 'string',
            description: 'Optional short context describing why clarification is needed.',
          },
        },
        required: ['question', 'options'],
      },
    },
  },
};

export const splitClipDeclaration = {
  toolSpec: {
    name: 'split_clip',
    description:
      "Splits a video/audio clip at a specific time position into two separate clips. Use when user wants to cut or divide a clip into parts. Time is relative to the clip's start, not the timeline position.",
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_id: {
            type: 'string',
            description:
              'The unique ID of the clip to split. Get this from get_timeline_info first.',
          },
          time_in_clip: {
            type: 'number',
            description:
              'Position in seconds within the clip where to split (relative to clip start, not timeline). Must be between 0 and clip duration.',
          },
        },
        required: ['clip_id', 'time_in_clip'],
      },
    },
  },
};

export const deleteClipsDeclaration = {
  toolSpec: {
    name: 'delete_clips',
    description:
      'Removes one or more clips from the timeline permanently. Use when user wants to delete, remove, or clear clips. This action can be undone.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of clip IDs to delete. Must provide at least one clip ID.',
          },
        },
        required: ['clip_ids'],
      },
    },
  },
};

export const moveClipDeclaration = {
  toolSpec: {
    name: 'move_clip',
    description:
      'Moves a clip to a different position in the timeline or to a different track. Use for repositioning clips, closing gaps, or organizing the timeline.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_id: {
            type: 'string',
            description: 'The unique ID of the clip to move.',
          },
          start_time: {
            type: 'number',
            description: 'New starting position in the timeline (in seconds). Must be >= 0.',
          },
          track_index: {
            type: 'number',
            description:
              'Optional: Target track index (0-9 for video tracks, 10+ for audio tracks). If omitted, keeps current track.',
          },
        },
        required: ['clip_id', 'start_time'],
      },
    },
  },
};

export const mergeClipsDeclaration = {
  toolSpec: {
    name: 'merge_clips',
    description:
      'Combines multiple adjacent clips into a single merged clip. Clips must be on the same track and in sequential order. Use when user wants to join or combine clips.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Array of clip IDs to merge. Must provide at least 2 clip IDs. Clips should be adjacent on the timeline.',
          },
        },
        required: ['clip_ids'],
      },
    },
  },
};

export const copyClipsDeclaration = {
  toolSpec: {
    name: 'copy_clips',
    description:
      'Copies selected clips to clipboard for later pasting. Use when user wants to duplicate or copy clips.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of clip IDs to copy.',
          },
        },
        required: ['clip_ids'],
      },
    },
  },
};

export const pasteClipsDeclaration = {
  toolSpec: {
    name: 'paste_clips',
    description:
      'Pastes previously copied clips to the timeline at the current playhead position. Use after copy_clips to duplicate clips.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

export const setClipVolumeDeclaration = {
  toolSpec: {
    name: 'set_clip_volume',
    description:
      'Sets the volume level for one or more clips. Volume ranges from 0.0 (silent) to 1.0 (full volume, 100%). Use when user wants to adjust audio levels, make clips louder/quieter.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Array of clip IDs to adjust volume for. Use ["all"] to affect all clips on timeline.',
          },
          volume: {
            type: 'number',
            description:
              'Volume level from 0.0 to 1.0. Examples: 0.0 = muted, 0.5 = 50%, 0.7 = 70%, 1.0 = 100% (full volume).',
          },
        },
        required: ['clip_ids', 'volume'],
      },
    },
  },
};

export const toggleClipMuteDeclaration = {
  toolSpec: {
    name: 'toggle_clip_mute',
    description:
      'Mutes or unmutes audio for one or more clips. If clip is currently muted, it will be unmuted and vice versa. Use when user wants to silence or enable audio.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of clip IDs to toggle mute status.',
          },
        },
        required: ['clip_ids'],
      },
    },
  },
};

export const selectClipsDeclaration = {
  toolSpec: {
    name: 'select_clips',
    description:
      'Selects one or more clips on the timeline. Use before operations that require clip selection (like merge, copy). Use ["all"] to select all clips.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Array of clip IDs to select. Use ["all"] to select all clips on timeline.',
          },
        },
        required: ['clip_ids'],
      },
    },
  },
};

export const undoActionDeclaration = {
  toolSpec: {
    name: 'undo_action',
    description:
      'Undoes the last editing action. Use when user wants to revert the most recent change. Can be called multiple times to undo several actions.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

export const redoActionDeclaration = {
  toolSpec: {
    name: 'redo_action',
    description:
      'Redoes the last undone action. Use when user wants to restore a change they just undid. Only works if undo was called previously.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

export const setPlayheadPositionDeclaration = {
  toolSpec: {
    name: 'set_playhead_position',
    description:
      'Moves the playhead (current time position) to a specific point in the timeline. Use when user wants to jump to a time, scrub, or navigate the timeline.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          time: {
            type: 'number',
            description:
              'Timeline position in seconds. Must be >= 0 and <= total timeline duration.',
          },
        },
        required: ['time'],
      },
    },
  },
};

export const updateClipBoundsDeclaration = {
  toolSpec: {
    name: 'update_clip_bounds',
    description:
      'Trims the start and/or end of a clip by adjusting its source boundaries. Use when user wants to trim, cut off edges, or adjust clip duration without splitting.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_id: {
            type: 'string',
            description: 'The unique ID of the clip to trim.',
          },
          new_start: {
            type: 'number',
            description:
              'Optional: New start position within the source media (in seconds). If omitted, keeps current start.',
          },
          new_end: {
            type: 'number',
            description:
              'Optional: New end position within the source media (in seconds). If omitted, keeps current end.',
          },
        },
        required: ['clip_id'],
      },
    },
  },
};

export const getClipDetailsDeclaration = {
  toolSpec: {
    name: 'get_clip_details',
    description:
      'Gets detailed information about a specific clip including all properties, position, duration, volume, and source details. Use when user asks about a specific clip.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_id: {
            type: 'string',
            description: 'The unique ID of the clip to get details for.',
          },
        },
        required: ['clip_id'],
      },
    },
  },
};

// ==================== SUBTITLE TOOLS ====================

export const addSubtitleDeclaration = {
  toolSpec: {
    name: 'add_subtitle',
    description:
      'Adds a new subtitle entry at specified time with text. Use when user wants to add captions, text overlays, or subtitles to the video.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The subtitle text to display.',
          },
          start_time: {
            type: 'number',
            description: 'Start time in seconds when subtitle should appear.',
          },
          end_time: {
            type: 'number',
            description: 'End time in seconds when subtitle should disappear.',
          },
        },
        required: ['text', 'start_time', 'end_time'],
      },
    },
  },
};

export const updateSubtitleDeclaration = {
  toolSpec: {
    name: 'update_subtitle',
    description:
      'Updates an existing subtitle entry. Can modify text, start time, or end time. Use subtitle index starting from 1.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description: 'Index of the subtitle to update (1-based, as shown to user).',
          },
          text: {
            type: 'string',
            description: 'Optional: New text for the subtitle.',
          },
          start_time: {
            type: 'number',
            description: 'Optional: New start time in seconds.',
          },
          end_time: {
            type: 'number',
            description: 'Optional: New end time in seconds.',
          },
        },
        required: ['index'],
      },
    },
  },
};

export const deleteSubtitleDeclaration = {
  toolSpec: {
    name: 'delete_subtitle',
    description: 'Removes a subtitle entry by its index. Use 1-based indexing.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description: 'Index of the subtitle to delete (1-based).',
          },
        },
        required: ['index'],
      },
    },
  },
};

export const updateSubtitleStyleDeclaration = {
  toolSpec: {
    name: 'update_subtitle_style',
    description:
      'Changes the visual appearance of all subtitles including font, size, color, background, and position.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          font_size: {
            type: 'number',
            description: 'Optional: Font size in pixels (e.g., 24, 32, 48).',
          },
          font_family: {
            type: 'string',
            description:
              'Optional: Font family name (e.g., "Arial", "Helvetica", "Times New Roman").',
          },
          color: {
            type: 'string',
            description:
              'Optional: Text color in hex format (e.g., "#ffffff" for white, "#000000" for black).',
          },
          background_color: {
            type: 'string',
            description:
              'Optional: Background color in hex format with transparency (e.g., "#000000AA" for semi-transparent black).',
          },
          position: {
            type: 'string',
            description: 'Optional: Vertical position: "top" or "bottom".',
          },
        },
        required: [],
      },
    },
  },
};

export const getSubtitlesDeclaration = {
  toolSpec: {
    name: 'get_subtitles',
    description:
      'Retrieves all current subtitles with their text, timings, and styling. Use to see what subtitles are currently added.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

export const clearAllSubtitlesDeclaration = {
  toolSpec: {
    name: 'clear_all_subtitles',
    description:
      'Removes all subtitle entries from the timeline. Use when user wants to start fresh with subtitles.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

// ==================== TRANSCRIPTION TOOLS ====================

export const transcribeClipDeclaration = {
  toolSpec: {
    name: 'transcribe_clip',
    description:
      'Transcribes audio from a specific clip to text using AI. Works with video or audio clips that have audio tracks.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_id: {
            type: 'string',
            description:
              'The ID of the clip to transcribe. Use "active" to transcribe the currently selected clip.',
          },
        },
        required: ['clip_id'],
      },
    },
  },
};

export const transcribeTimelineDeclaration = {
  toolSpec: {
    name: 'transcribe_timeline',
    description:
      'Transcribes audio from all clips in the timeline to generate a complete transcript. Useful for creating subtitles or editing by text.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

export const getTranscriptionDeclaration = {
  toolSpec: {
    name: 'get_transcription',
    description:
      'Retrieves the current transcription text and word-level timing data if available.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

export const applyTranscriptEditsDeclaration = {
  toolSpec: {
    name: 'apply_transcript_edits',
    description:
      'Automatically cuts video based on transcript deletions. Removes sections of timeline corresponding to deleted text ranges.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          deletion_ranges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                start: { type: 'number' },
                end: { type: 'number' },
              },
            },
            description:
              'Array of time ranges (in seconds) to delete. Each range has start and end properties.',
          },
        },
        required: ['deletion_ranges'],
      },
    },
  },
};

// ==================== PROJECT MANAGEMENT TOOLS ====================

export const saveProjectDeclaration = {
  toolSpec: {
    name: 'save_project',
    description:
      'Saves the current project to disk. If project was previously saved, updates the existing file. If new, prompts for save location.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

export const setExportSettingsDeclaration = {
  toolSpec: {
    name: 'set_export_settings',
    description: 'Configures video export settings including format and resolution.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            description: 'Optional: Export format - "mp4", "mov", "avi", or "webm".',
          },
          resolution: {
            type: 'string',
            description:
              'Optional: Export resolution - "1920x1080" (1080p), "1280x720" (720p), "854x480" (480p), or "original".',
          },
        },
        required: [],
      },
    },
  },
};

export const getProjectInfoDeclaration = {
  toolSpec: {
    name: 'get_project_info',
    description:
      'Gets information about the current project including save status, export settings, and project statistics.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

// ==================== SEARCH & ANALYSIS TOOLS ====================

export const searchClipsByContentDeclaration = {
  toolSpec: {
    name: 'search_clips_by_content',
    description:
      'Searches through analyzed clips to find those matching a description. Uses AI analysis data to find relevant clips.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search query describing what to look for (e.g., "people talking", "outdoor scenes", "music").',
          },
        },
        required: ['query'],
      },
    },
  },
};

export const getClipAnalysisDeclaration = {
  toolSpec: {
    name: 'get_clip_analysis',
    description:
      'Retrieves AI-generated analysis for a specific clip including scenes, subjects, mood, audio info, and tags.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_id: {
            type: 'string',
            description: 'The ID of the clip to get analysis for.',
          },
        },
        required: ['clip_id'],
      },
    },
  },
};

export const getAllMediaAnalysisDeclaration = {
  toolSpec: {
    name: 'get_all_media_analysis',
    description:
      'Gets a summary of all analyzed media files in the project with their AI-generated insights.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
};

export const setClipSpeedDeclaration = {
  toolSpec: {
    name: 'set_clip_speed',
    description:
      'Changes the playback speed of a clip. Values less than 1 slow it down (slow-motion), values greater than 1 speed it up (time-lapse). The clip duration in the timeline adjusts automatically. Examples: 0.5 = half speed (slow-mo), 2.0 = double speed, 0.25 = quarter speed.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_id: {
            type: 'string',
            description:
              'ID of the clip to change speed for. Use get_timeline_info to find clip IDs.',
          },
          speed: {
            type: 'number',
            description:
              'Speed multiplier. Range: 0.25 (quarter speed) to 8.0 (8x speed). Default is 1.0 (normal).',
          },
        },
        required: ['clip_id', 'speed'],
      },
    },
  },
};

export const applyClipEffectDeclaration = {
  toolSpec: {
    name: 'apply_clip_effect',
    description:
      'Applies color and visual effects to a clip. All parameters are optional — only specify what you want to change. Effects are applied during export via FFmpeg eq filter.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          clip_id: {
            type: 'string',
            description: 'ID of the clip to apply effects to.',
          },
          brightness: {
            type: 'number',
            description:
              'Brightness adjustment. Range: -1.0 (very dark) to 1.0 (very bright). 0 = no change.',
          },
          contrast: {
            type: 'number',
            description:
              'Contrast adjustment. Range: 0 (flat) to 3.0 (high contrast). 1.0 = no change.',
          },
          saturation: {
            type: 'number',
            description:
              'Saturation/color intensity. Range: 0 (grayscale) to 3.0 (very vivid). 1.0 = no change.',
          },
          gamma: {
            type: 'number',
            description:
              'Gamma correction for midtone brightness. Range: 0.1 to 10.0. 1.0 = no change.',
          },
        },
        required: ['clip_id'],
      },
    },
  },
};

export const findHighlightsDeclaration = {
  toolSpec: {
    name: 'find_highlights',
    description:
      'Analyzes the AI memory of all imported media to find the most interesting, energetic, or emotionally significant moments based on existing analysis data. Returns a list of clip IDs and time ranges that match the criteria. Use this to quickly identify best moments for a highlight reel.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          criteria: {
            type: 'string',
            description:
              'What to look for. Examples: "exciting action moments", "emotional moments", "funny parts", "best quality shots", "landscape shots", "people talking".',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of highlight moments to return (default: 5).',
          },
        },
        required: ['criteria'],
      },
    },
  },
};

export const generateChaptersDeclaration = {
  toolSpec: {
    name: 'generate_chapters',
    description:
      'Analyzes the timeline transcript and media analysis to automatically generate chapter markers with titles. Adds text overlay clips or subtitle entries at each chapter break. Useful for long-form content like tutorials, vlogs, or documentaries.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          add_as: {
            type: 'string',
            description:
              'How to add chapters to the timeline. "subtitles" = adds subtitle entries, "text_clips" = adds text overlay clips at chapter start times.',
          },
          min_chapter_duration: {
            type: 'number',
            description: 'Minimum duration in seconds between chapters (default: 30).',
          },
        },
        required: [],
      },
    },
  },
};

// ==================== PHASE 3 MACRO TOOLS ====================

export const generateIntroScriptFromTimelineDeclaration = {
  toolSpec: {
    name: 'generate_intro_script_from_timeline',
    description:
      'Generates a timestamped intro script grounded in the current timeline and analyzed media memory. Use for requests like "make a 16s hackathon intro script".',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          target_duration: {
            type: 'number',
            description: 'Target script duration in seconds (recommended 8-30).',
          },
          objective: {
            type: 'string',
            description:
              'Core message objective, for example "how I won the hackathon" or "product launch teaser".',
          },
          tone: {
            type: 'string',
            description: 'Optional tone style (e.g., energetic, cinematic, confident).',
          },
          format: {
            type: 'string',
            description:
              'Optional script format: "voiceover_with_captions" or "on_screen_text_only".',
          },
          beat_count: {
            type: 'number',
            description: 'Optional number of beats/segments to split the script into.',
          },
        },
        required: ['target_duration', 'objective'],
      },
    },
  },
};

export const applyScriptAsCaptionsDeclaration = {
  toolSpec: {
    name: 'apply_script_as_captions',
    description:
      'Applies a structured script directly as timeline captions/subtitles in one deterministic operation.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          script_blocks: {
            type: 'array',
            description: 'Timestamped script lines to convert into subtitles.',
            items: {
              type: 'object',
              properties: {
                start_time: { type: 'number' },
                end_time: { type: 'number' },
                text: { type: 'string' },
                voiceover: { type: 'string' },
                on_screen_text: { type: 'string' },
              },
            },
          },
          style_preset: {
            type: 'string',
            description: 'Optional style preset: clean_modern, bold_hype, minimal.',
          },
          replace_existing: {
            type: 'boolean',
            description: 'Whether to replace existing subtitles before applying new ones.',
          },
        },
        required: ['script_blocks'],
      },
    },
  },
};

export const previewCaptionFitDeclaration = {
  toolSpec: {
    name: 'preview_caption_fit',
    description:
      'Checks caption/script fit before applying: overlap, overflow, and reading-speed violations.',
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          script_blocks: {
            type: 'array',
            description:
              'Optional script blocks to validate. If omitted, validates current timeline subtitles.',
            items: {
              type: 'object',
              properties: {
                start_time: { type: 'number' },
                end_time: { type: 'number' },
                text: { type: 'string' },
                voiceover: { type: 'string' },
                on_screen_text: { type: 'string' },
              },
            },
          },
          max_chars_per_second: {
            type: 'number',
            description: 'Optional reading speed ceiling (default 17 chars/sec).',
          },
          min_caption_duration: {
            type: 'number',
            description: 'Optional minimum caption duration in seconds (default 1.0s).',
          },
        },
        required: [],
      },
    },
  },
};

/**
 * Export all video editing tool declarations
 * Passed as `toolConfig: { tools: allVideoEditingTools }` in ConverseCommand
 */
export const allVideoEditingTools = [
  // Timeline & Clip Management
  getTimelineInfoDeclaration,
  askClarificationDeclaration,
  splitClipDeclaration,
  deleteClipsDeclaration,
  moveClipDeclaration,
  mergeClipsDeclaration,
  copyClipsDeclaration,
  pasteClipsDeclaration,
  setClipVolumeDeclaration,
  toggleClipMuteDeclaration,
  selectClipsDeclaration,
  undoActionDeclaration,
  redoActionDeclaration,
  setPlayheadPositionDeclaration,
  updateClipBoundsDeclaration,
  getClipDetailsDeclaration,
  // Subtitle Tools
  addSubtitleDeclaration,
  updateSubtitleDeclaration,
  deleteSubtitleDeclaration,
  updateSubtitleStyleDeclaration,
  getSubtitlesDeclaration,
  clearAllSubtitlesDeclaration,
  // Transcription Tools
  transcribeClipDeclaration,
  transcribeTimelineDeclaration,
  getTranscriptionDeclaration,
  applyTranscriptEditsDeclaration,
  // Project Management
  saveProjectDeclaration,
  setExportSettingsDeclaration,
  getProjectInfoDeclaration,
  // Search & Analysis
  searchClipsByContentDeclaration,
  getClipAnalysisDeclaration,
  getAllMediaAnalysisDeclaration,
  // Speed, Effects & AI Features
  setClipSpeedDeclaration,
  applyClipEffectDeclaration,
  findHighlightsDeclaration,
  generateChaptersDeclaration,
  // Phase 3 Macros
  generateIntroScriptFromTimelineDeclaration,
  applyScriptAsCaptionsDeclaration,
  previewCaptionFitDeclaration,
];

/**
 * Type definitions for function call arguments
 */
export interface FunctionCall {
  name: string;
  args: Record<string, any>;
  id?: string; // toolUseId from Bedrock
}

export interface ToolResult {
  name: string;
  toolUseId?: string; // Assigned by aiService when sending results back to Bedrock
  result: {
    success: boolean;
    message: string;
    data?: any;
    error?: string;
    errorType?:
      | 'plan_error'
      | 'validation_error'
      | 'execution_error'
      | 'media_limit'
      | 'tool_missing'
      | 'constraint_violation';
    recoveryHint?: string;
    adjustments?: string[];
  };
}
