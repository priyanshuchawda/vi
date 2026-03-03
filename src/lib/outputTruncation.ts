export type ToolOutputCategory = 'state_dump' | 'analysis' | 'search' | 'mutation';

export const TOOL_OUTPUT_MAX_CHARS_BY_CATEGORY: Record<ToolOutputCategory, number> = {
  state_dump: 12_000,
  analysis: 8_000,
  search: 6_000,
  mutation: 3_000,
};

const STATE_DUMP_TOOLS = new Set([
  'get_timeline_info',
  'get_clip_details',
  'get_subtitles',
  'get_clip_analysis',
  'get_all_media_analysis',
]);

const ANALYSIS_TOOLS = new Set([
  'analyze_media',
  'transcribe_audio',
  'detect_scenes',
  'generate_chapters',
]);

const SEARCH_TOOLS = new Set([
  'search_clips_by_content',
  'find_highlights',
  'retrieve_relevant_memory',
]);

interface TruncationEnvelope {
  _truncated: true;
  _note: string;
  _truncation: {
    tool: string;
    category: ToolOutputCategory;
    strategy: 'head_tail_json';
    originalChars: number;
    maxChars: number;
    omittedChars: number;
  };
  _head: string;
  _tail: string;
}

export function resolveToolOutputCategory(toolName: string): ToolOutputCategory {
  if (STATE_DUMP_TOOLS.has(toolName) || toolName.startsWith('get_')) {
    return 'state_dump';
  }
  if (ANALYSIS_TOOLS.has(toolName) || toolName.includes('analysis')) {
    return 'analysis';
  }
  if (
    SEARCH_TOOLS.has(toolName) ||
    toolName.startsWith('search_') ||
    toolName.startsWith('find_')
  ) {
    return 'search';
  }
  return 'mutation';
}

export function getToolOutputMaxChars(toolName: string): number {
  const category = resolveToolOutputCategory(toolName);
  return TOOL_OUTPUT_MAX_CHARS_BY_CATEGORY[category];
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, inputValue) => {
    if (inputValue && typeof inputValue === 'object') {
      if (seen.has(inputValue as object)) {
        return '[Circular]';
      }
      seen.add(inputValue as object);
    }
    return inputValue;
  });
}

function buildTruncationEnvelope(
  toolName: string,
  category: ToolOutputCategory,
  serialized: string,
  maxChars: number,
): TruncationEnvelope {
  let snippetBudget = Math.max(64, maxChars - 340);

  while (snippetBudget >= 64) {
    const headLength = Math.ceil(snippetBudget * 0.7);
    const tailLength = Math.max(0, snippetBudget - headLength);
    const head = serialized.slice(0, headLength);
    const tail = tailLength > 0 ? serialized.slice(-tailLength) : '';

    const envelope: TruncationEnvelope = {
      _truncated: true,
      _note:
        'Tool output was truncated to stay within budget. Use narrower tool arguments if more detail is needed.',
      _truncation: {
        tool: toolName,
        category,
        strategy: 'head_tail_json',
        originalChars: serialized.length,
        maxChars,
        omittedChars: Math.max(0, serialized.length - (head.length + tail.length)),
      },
      _head: head,
      _tail: tail,
    };

    if (safeJsonStringify(envelope).length <= maxChars) {
      return envelope;
    }

    snippetBudget = Math.floor(snippetBudget * 0.85);
  }

  return {
    _truncated: true,
    _note: 'Tool output was truncated to stay within budget.',
    _truncation: {
      tool: toolName,
      category,
      strategy: 'head_tail_json',
      originalChars: serialized.length,
      maxChars,
      omittedChars: serialized.length,
    },
    _head: serialized.slice(0, 32),
    _tail: serialized.slice(-16),
  };
}

export function truncateToolResultForModel(
  toolName: string,
  result: unknown,
  options?: { reserveChars?: number; maxCharsOverride?: number },
): {
  payload: unknown;
  truncated: boolean;
  category: ToolOutputCategory;
  maxChars: number;
  originalChars: number;
} {
  const category = resolveToolOutputCategory(toolName);
  const reserveChars = Math.max(0, options?.reserveChars ?? 0);
  const maxChars = Math.max(
    256,
    Math.floor(options?.maxCharsOverride ?? TOOL_OUTPUT_MAX_CHARS_BY_CATEGORY[category]),
  );
  const effectiveMaxChars = Math.max(256, maxChars - reserveChars);
  const serialized = safeJsonStringify(result);

  if (serialized.length <= effectiveMaxChars) {
    return {
      payload: result,
      truncated: false,
      category,
      maxChars,
      originalChars: serialized.length,
    };
  }

  const payload = buildTruncationEnvelope(toolName, category, serialized, effectiveMaxChars);
  return {
    payload,
    truncated: true,
    category,
    maxChars,
    originalChars: serialized.length,
  };
}
