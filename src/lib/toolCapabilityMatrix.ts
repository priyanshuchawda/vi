import { allVideoEditingTools } from './videoEditingTools';

export type ToolErrorCategory =
  | 'plan_error'
  | 'validation_error'
  | 'validation_warning'
  | 'execution_error'
  | 'media_limit'
  | 'tool_missing'
  | 'constraint_violation';

export type ToolSafety = 'read_only' | 'state_mutation';
export type RuntimeToolMode = 'ask' | 'plan' | 'edit';

export interface ToolCapability {
  name: string;
  purpose: string;
  safety: ToolSafety;
  requiredArgs: string[];
  optionalArgs: string[];
  constraints: Record<string, string>;
  sideEffects: string[];
  failureReasons: ToolErrorCategory[];
  recoveryHints: string[];
}

const READ_ONLY_TOOLS = new Set<string>([
  'get_timeline_info',
  'ask_clarification',
  'get_clip_details',
  'get_subtitles',
  'get_transcription',
  'get_project_info',
  'get_clip_analysis',
  'get_all_media_analysis',
  'search_clips_by_content',
]);

const TOOL_CONSTRAINTS: Record<string, Record<string, string>> = {
  split_clip: {
    time_in_clip: 'Must be > 0 and < clip duration',
  },
  set_clip_volume: {
    volume: 'Range: 0.0 to 1.0',
  },
  set_playhead_position: {
    time: 'Must be >= 0 and <= timeline duration',
  },
  update_clip_bounds: {
    new_start: 'Must be >= 0 and <= sourceDuration',
    new_end: 'Must be >= 0 and <= sourceDuration and greater than new_start',
  },
  set_export_settings: {
    format: 'Allowed: mp4, mov, avi, webm',
    resolution: 'Allowed: 1920x1080, 1280x720, 854x480, original',
  },
  set_clip_speed: {
    speed: 'Range: 0.25 to 8.0',
  },
  apply_clip_effect: {
    brightness: 'Range: -1 to 1',
    contrast: 'Range: 0 to 3',
    saturation: 'Range: 0 to 3',
    gamma: 'Range: 0.1 to 10',
  },
  generate_chapters: {
    add_as: 'Allowed: subtitles, text_clips',
    min_chapter_duration: 'Recommended >= 10 seconds',
  },
};

const TOOL_SIDE_EFFECTS: Record<string, string[]> = {
  get_timeline_info: ['No state changes; returns timeline snapshot'],
  get_clip_details: ['No state changes; returns clip metadata'],
  get_subtitles: ['No state changes; returns subtitle list + style'],
  get_transcription: ['No state changes; returns transcript if available'],
  get_project_info: ['No state changes; returns project/export metadata'],
  get_clip_analysis: ['No state changes; returns AI memory analysis for one clip'],
  get_all_media_analysis: ['No state changes; returns AI memory summary'],
  search_clips_by_content: ['No state changes; searches analyzed memory entries'],
  save_project: ['Triggers async project save'],
  transcribe_clip: ['Starts async transcription workflow'],
  transcribe_timeline: ['Starts async timeline transcription workflow'],
  apply_transcript_edits: ['Starts async transcript-based timeline edits'],
};

const DEFAULT_FAILURES: ToolErrorCategory[] = ['validation_error', 'execution_error'];

const UNSUPPORTED_OPERATIONS = [
  'Creating tools not declared in toolConfig',
  'Calling pseudo-functions (e.g. insert_clip, apply_transition_magic)',
  'Mutating external files directly without supported tool',
  'Assuming clip IDs, transcript, or analysis exists without lookup',
  'Bypassing approval for state-changing operations',
];

function inferSideEffects(name: string, safety: ToolSafety): string[] {
  if (TOOL_SIDE_EFFECTS[name]) {
    return TOOL_SIDE_EFFECTS[name];
  }

  if (safety === 'read_only') {
    return ['No state changes'];
  }

  return ['Mutates timeline/project state'];
}

function inferRecoveryHints(name: string, safety: ToolSafety): string[] {
  const hints = [
    'Re-fetch timeline/media state before retrying',
    'Validate IDs and numeric bounds before execution',
  ];

  if (safety === 'state_mutation') {
    hints.push('If uncertain, run operation sequentially and verify result before next step');
  }

  if (name === 'split_clip' || name === 'update_clip_bounds') {
    hints.push('Use get_clip_details to confirm clip duration/source bounds first');
  }

  if (name === 'set_export_settings') {
    hints.push('Retry with supported format/resolution values only');
  }

  return hints;
}

function inferFailureCategories(name: string): ToolErrorCategory[] {
  if (name === 'transcribe_clip' || name === 'transcribe_timeline') {
    return [...DEFAULT_FAILURES, 'media_limit'];
  }

  if (name === 'save_project') {
    return [...DEFAULT_FAILURES, 'constraint_violation'];
  }

  return DEFAULT_FAILURES;
}

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name);
}

export function getAllowedToolsForMode(mode: RuntimeToolMode): Set<string> {
  const allTools = new Set(getSupportedToolNames());
  if (mode === 'edit') {
    return allTools;
  }

  const allowlist = new Set<string>();
  for (const toolName of allTools) {
    if (isReadOnlyTool(toolName)) {
      allowlist.add(toolName);
    }
  }
  return allowlist;
}

export function isToolAllowedInMode(name: string, mode: RuntimeToolMode): boolean {
  return getAllowedToolsForMode(mode).has(name);
}

export function getSupportedToolNames(): string[] {
  return allVideoEditingTools
    .map((tool: any) => tool?.toolSpec?.name)
    .filter((name: string | undefined): name is string => Boolean(name));
}

export function buildToolCapabilityMatrix(
  toolNames?: string[],
): {
  tools: ToolCapability[];
  unsupportedOperations: string[];
} {
  const requested = new Set(toolNames || getSupportedToolNames());

  const tools = allVideoEditingTools
    .map((declaration: any) => declaration?.toolSpec)
    .filter((toolSpec: any) => toolSpec?.name && requested.has(toolSpec.name))
    .map((toolSpec: any): ToolCapability => {
      const schema = toolSpec.inputSchema?.json || {};
      const properties = schema.properties || {};
      const requiredArgs: string[] = Array.isArray(schema.required)
        ? schema.required
        : [];
      const optionalArgs = Object.keys(properties).filter(
        (name) => !requiredArgs.includes(name),
      );
      const safety: ToolSafety = READ_ONLY_TOOLS.has(toolSpec.name)
        ? 'read_only'
        : 'state_mutation';

      return {
        name: toolSpec.name,
        purpose: toolSpec.description || 'No description',
        safety,
        requiredArgs,
        optionalArgs,
        constraints: TOOL_CONSTRAINTS[toolSpec.name] || {},
        sideEffects: inferSideEffects(toolSpec.name, safety),
        failureReasons: inferFailureCategories(toolSpec.name),
        recoveryHints: inferRecoveryHints(toolSpec.name, safety),
      };
    });

  return {
    tools,
    unsupportedOperations: UNSUPPORTED_OPERATIONS,
  };
}

export function formatCapabilityMatrixForPrompt(
  toolNames?: string[],
  maxChars: number = 3500,
): string {
  const matrix = buildToolCapabilityMatrix(toolNames);
  const serialized = JSON.stringify(matrix, null, 2);
  if (serialized.length <= maxChars) {
    return serialized;
  }

  return `${serialized.slice(0, maxChars)}\n[Capability matrix truncated for token efficiency]`;
}
