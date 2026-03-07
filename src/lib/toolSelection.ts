import { allVideoEditingTools } from './videoEditingTools';

interface NormalizedIntentLike {
  goals?: string[];
  requestedOutputs?: string[];
  constraints?: Record<string, string | number | boolean>;
  operationHint?: string | null;
}

type ToolSelectionMode = 'agentic' | 'standard' | 'economy';

interface ToolSelectionOptions {
  message: string;
  mode?: ToolSelectionMode;
  normalizedIntent?: NormalizedIntentLike;
}

interface ToolSelectionResult {
  tools: ToolDeclaration[];
  toolNames: string[];
}

interface ToolRule {
  id: string;
  pattern: RegExp;
  tools: string[];
  weight: number;
}

interface ToolSpecSchema {
  required?: string[];
  properties?: Record<string, unknown>;
}

interface ToolSpec {
  name?: string;
  description?: string;
  inputSchema?: {
    json?: ToolSpecSchema;
  };
}

interface ToolDeclaration {
  toolSpec?: ToolSpec;
}

const TOOL_DECLARATIONS = allVideoEditingTools as ToolDeclaration[];

const ALL_TOOL_NAMES = TOOL_DECLARATIONS.map((tool) => tool?.toolSpec?.name).filter(
  (name: string | undefined): name is string => Boolean(name),
);

const BASE_EDIT_TOOLS = [
  'get_timeline_info',
  'get_clip_details',
  'ask_clarification',
  'select_clips',
  'update_clip_bounds',
  'move_clip',
  'split_clip',
  'delete_clips',
  'merge_clips',
  'undo_action',
  'redo_action',
] as const;

const DURATION_FILL_TOOLS = ['set_clip_speed', 'copy_clips', 'paste_clips'];
const SCRIPT_TOOLS = ['generate_intro_script_from_timeline', 'preview_caption_fit'];
const CAPTION_TOOLS = ['apply_script_as_captions'];
const CONTENT_ANALYSIS_TOOLS = [
  'get_all_media_analysis',
  'get_clip_analysis',
  'search_clips_by_content',
];
const AUDIO_TOOLS = ['set_clip_volume', 'toggle_clip_mute'];
const SUBTITLE_ATOMIC_TOOLS = [
  'add_subtitle',
  'update_subtitle',
  'delete_subtitle',
  'update_subtitle_style',
  'get_subtitles',
  'clear_all_subtitles',
];
const TRANSCRIPTION_TOOLS = [
  'transcribe_clip',
  'transcribe_timeline',
  'get_transcription',
  'apply_transcript_edits',
];
const FINISHING_TOOLS = ['apply_clip_effect', 'find_highlights', 'generate_chapters'];
const PROJECT_TOOLS = ['save_project', 'set_export_settings', 'get_project_info'];

const TOOL_RULES: ToolRule[] = [
  {
    id: 'duration',
    pattern:
      /\b(\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|min|mins|minute|minutes)|duration|30 second|30 sec)\b/i,
    tools: DURATION_FILL_TOOLS,
    weight: 8,
  },
  {
    id: 'short_form',
    pattern: /\b(yt short|youtube short|youtube shorts|shorts|reel|tiktok|viral|views)\b/i,
    tools: [...DURATION_FILL_TOOLS, ...CONTENT_ANALYSIS_TOOLS, 'get_timeline_info'],
    weight: 9,
  },
  {
    id: 'script_story',
    pattern: /\b(script|voiceover|hook|story|storyline|narration|cta|caption script)\b/i,
    tools: [...SCRIPT_TOOLS, ...CAPTION_TOOLS],
    weight: 8,
  },
  {
    id: 'caption',
    pattern:
      /\b(caption|captions|subtitle|subtitles|text overlay|overlay|on-screen text|onscreen text)\b/i,
    tools: [...CAPTION_TOOLS, ...SCRIPT_TOOLS, ...SUBTITLE_ATOMIC_TOOLS],
    weight: 7,
  },
  {
    id: 'analysis',
    pattern: /\b(analy[sz]e|analysis|scene|memory|best moment|highlight|proof|demo|hook)\b/i,
    tools: [...CONTENT_ANALYSIS_TOOLS, 'get_timeline_info'],
    weight: 7,
  },
  {
    id: 'duplicate',
    pattern: /\b(copy|duplicate|repeat|reuse|paste)\b/i,
    tools: ['copy_clips', 'paste_clips'],
    weight: 6,
  },
  {
    id: 'audio',
    pattern: /\b(volume|mute|audio|sound|quiet|loud|music)\b/i,
    tools: AUDIO_TOOLS,
    weight: 6,
  },
  {
    id: 'transcription',
    pattern: /\b(transcribe|transcription|transcript)\b/i,
    tools: TRANSCRIPTION_TOOLS,
    weight: 7,
  },
  {
    id: 'effects',
    pattern: /\b(effect|filter|speed|chapter|highlight|styl[e|ing]|polish)\b/i,
    tools: [...FINISHING_TOOLS, 'set_clip_speed'],
    weight: 5,
  },
  {
    id: 'project',
    pattern: /\b(save|export|upload|project|render)\b/i,
    tools: PROJECT_TOOLS,
    weight: 4,
  },
];

const GOAL_TOOLS: Record<string, string[]> = {
  platform_optimized_output: [
    ...DURATION_FILL_TOOLS,
    ...CONTENT_ANALYSIS_TOOLS,
    'get_timeline_info',
  ],
  script_generation: [...SCRIPT_TOOLS, ...CAPTION_TOOLS],
  smooth_transitions: ['move_clip', 'merge_clips', 'set_clip_speed'],
  style_enhancement: ['apply_clip_effect', 'generate_chapters', 'find_highlights'],
  combine_sources: ['copy_clips', 'paste_clips', 'merge_clips', 'move_clip'],
  remove_low_value_segments: [
    'get_all_media_analysis',
    'update_clip_bounds',
    'split_clip',
    'delete_clips',
  ],
};

const OPERATION_HINT_TOOLS: Record<string, string[]> = {
  trim: ['update_clip_bounds', 'get_clip_details'],
  split: ['split_clip', 'get_clip_details'],
  reorder: ['move_clip', 'select_clips'],
  merge: ['merge_clips', 'select_clips'],
  audio_adjust: AUDIO_TOOLS,
  subtitle: [...CAPTION_TOOLS, ...SCRIPT_TOOLS, ...SUBTITLE_ATOMIC_TOOLS],
  script_outline: [...SCRIPT_TOOLS, ...CAPTION_TOOLS, ...CONTENT_ANALYSIS_TOOLS],
  delete: ['delete_clips', 'select_clips'],
};

function addScore(scores: Map<string, number>, names: readonly string[], weight: number): void {
  for (const name of names) {
    if (!ALL_TOOL_NAMES.includes(name)) continue;
    scores.set(name, (scores.get(name) || 0) + weight);
  }
}

function tokenize(input: string): string[] {
  return Array.from(new Set(input.toLowerCase().match(/[a-z0-9_]+/g) || [])).filter(
    (token) => token.length >= 3,
  );
}

function buildSearchIndex(): Record<string, string> {
  return Object.fromEntries(
    TOOL_DECLARATIONS.map((tool) => {
      const spec = tool?.toolSpec;
      const schema = spec?.inputSchema?.json || {};
      const properties = schema.properties || {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      const optional = Object.keys(properties).filter((name) => !required.includes(name));
      return [
        spec?.name,
        [spec?.name?.replaceAll('_', ' '), spec?.description || '', ...required, ...optional]
          .join(' ')
          .toLowerCase(),
      ];
    }),
  );
}

const TOOL_SEARCH_INDEX = buildSearchIndex();

function getToolLimit(mode: ToolSelectionMode): number {
  switch (mode) {
    case 'economy':
      return 8;
    case 'agentic':
      return 12;
    case 'standard':
    default:
      return 14;
  }
}

function getSeedTools(mode: ToolSelectionMode, message: string): string[] {
  const lower = message.toLowerCase();
  const seeds = new Set<string>(BASE_EDIT_TOOLS);
  const overlayRequest = /\b(text overlay|overlay|on-screen text|onscreen text)\b/.test(lower);

  if (mode !== 'economy') {
    seeds.add('get_all_media_analysis');
  }

  if (
    /\b(script|caption|subtitle|text overlay|overlay|story|hook|voiceover|narration|on-screen text|onscreen text)\b/.test(
      lower,
    )
  ) {
    SCRIPT_TOOLS.forEach((tool) => seeds.add(tool));
    CAPTION_TOOLS.forEach((tool) => seeds.add(tool));
  }

  if (overlayRequest) {
    ['add_subtitle', 'update_subtitle', 'update_subtitle_style', 'get_subtitles'].forEach((tool) =>
      seeds.add(tool),
    );
  }

  if (/\b(duration|30 second|shorts|reel|tiktok)\b/.test(lower)) {
    DURATION_FILL_TOOLS.forEach((tool) => seeds.add(tool));
    seeds.add('get_timeline_info');
  }

  return Array.from(seeds);
}

export function selectToolsForRequest(options: ToolSelectionOptions): ToolSelectionResult {
  const mode = options.mode || 'standard';
  const message = options.message.trim();
  const lower = message.toLowerCase();
  const scores = new Map<string, number>();
  const seeds = getSeedTools(mode, lower);

  addScore(scores, seeds, 100);

  for (const rule of TOOL_RULES) {
    if (rule.pattern.test(lower)) {
      addScore(scores, rule.tools, rule.weight);
    }
  }

  const intent = options.normalizedIntent;
  if (intent?.constraints?.target_duration) {
    addScore(scores, DURATION_FILL_TOOLS, 9);
    addScore(scores, ['get_timeline_info'], 10);
  }

  if (
    intent?.constraints?.platform === 'youtube_shorts' ||
    intent?.constraints?.platform === 'instagram_reels'
  ) {
    addScore(scores, [...CONTENT_ANALYSIS_TOOLS, 'get_timeline_info'], 8);
  }

  for (const goal of intent?.goals || []) {
    addScore(scores, GOAL_TOOLS[goal] || [], 7);
  }

  for (const output of intent?.requestedOutputs || []) {
    if (output === 'short_script_outline') {
      addScore(scores, [...SCRIPT_TOOLS, ...CAPTION_TOOLS], 8);
    }
    if (output === 'subtitle_plan') {
      addScore(scores, [...CAPTION_TOOLS, ...SCRIPT_TOOLS, ...SUBTITLE_ATOMIC_TOOLS], 7);
    }
    if (output === 'edit_plan') {
      addScore(scores, BASE_EDIT_TOOLS, 4);
    }
  }

  if (intent?.operationHint) {
    addScore(scores, OPERATION_HINT_TOOLS[intent.operationHint] || [], 9);
  }

  const queryTokens = tokenize(lower);
  for (const name of ALL_TOOL_NAMES) {
    const indexed = TOOL_SEARCH_INDEX[name] || name.replaceAll('_', ' ');
    for (const token of queryTokens) {
      if (indexed.includes(token)) {
        scores.set(name, (scores.get(name) || 0) + 1.5);
      }
    }
  }

  const overlayRequest = /\b(text overlay|overlay|on-screen text|onscreen text)\b/i.test(lower);
  if (overlayRequest) {
    addScore(
      scores,
      ['add_subtitle', 'update_subtitle', 'update_subtitle_style', 'get_subtitles'],
      24,
    );
  }
  const prefersCaptionMacro =
    /\b(shorts|reel|tiktok|script|voiceover|hook|story|caption script|apply these captions)\b/i.test(
      lower,
    ) && !/\b(update subtitle|subtitle \d+|caption \d+|delete subtitle)\b/i.test(lower);
  if (prefersCaptionMacro && !overlayRequest) {
    for (const name of SUBTITLE_ATOMIC_TOOLS) {
      scores.delete(name);
    }
  }

  if (mode === 'economy') {
    for (const name of [
      ...SUBTITLE_ATOMIC_TOOLS,
      ...TRANSCRIPTION_TOOLS,
      ...PROJECT_TOOLS,
      ...FINISHING_TOOLS,
    ]) {
      if (!scores.has(name) || scores.get(name)! < 7) {
        scores.delete(name);
      }
    }
  }

  const limit = getToolLimit(mode);
  const selectedNames = Array.from(scores.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([name]) => name);

  const selected = new Set(selectedNames);
  const tools = TOOL_DECLARATIONS.filter((tool) => selected.has(tool?.toolSpec?.name || ''));

  return {
    tools,
    toolNames: tools
      .map((tool) => tool?.toolSpec?.name)
      .filter((name: string | undefined): name is string => Boolean(name)),
  };
}
