/**
 * Intent Classifier — Local, zero-cost message routing
 *
 * Determines whether a user message requires AI planning + tool use (editing)
 * or is just a conversational chat question.
 *
 * This saves ~50% of API calls by skipping the planning step for non-editing messages.
 */

export type MessageIntent = 'edit' | 'chat';
export interface IntentContext {
  hasPendingPlan?: boolean;
  hasRecentEditingContext?: boolean;
}

// Editing action keywords — if ANY of these appear, route to planning
const EDIT_KEYWORDS = [
  // Clip manipulation
  'split',
  'trim',
  'cut',
  'crop',
  'delete',
  'remove',
  'move',
  'merge',
  'combine',
  'join',
  'duplicate',
  'copy',
  'paste',
  'reorder',
  // Audio
  'volume',
  'mute',
  'unmute',
  'silence',
  'audio',
  'loud',
  'quiet',
  // Speed / Effects
  'speed',
  'slow',
  'fast',
  'reverse',
  'effect',
  'filter',
  'fade',
  // Timeline
  'playhead',
  'timeline',
  'undo',
  'redo',
  // Export / Save
  'export',
  'render',
  'save project',
  // Transcription / Captions
  'transcribe',
  'caption',
  'subtitle',
  'overlay',
  'on-screen text',
  'onscreen text',
  // Direct tool references
  'clip',
  'track',
];

// Patterns that strongly indicate editing intent
const EDIT_PATTERNS = [
  /\bat\s+\d+(\.\d+)?\s*s(ec|econds?)?\b/i, // "at 5s", "at 5.2 seconds"
  /\bfrom\s+\d+.*to\s+\d+/i, // "from 2 to 5"
  /\b\d+(\.\d+)?\s*s(ec|econds?)?\b/i, // "5 seconds", "3.5s"
  /\bclip\s*\d+\b/i, // "clip 1", "clip 2"
  /\btrack\s*\d+\b/i, // "track 0", "track 1"
  /\b\d+%\s*(volume|loud|quiet)\b/i, // "50% volume"
  /\b(make|create|build|turn)\b[\s\S]{0,40}\b(video|short|shorts|reel|vlog|montage|highlight reel)\b/i,
  /\bstep\s*by\s*step\b/i, // "step by step"
  /\bmove\s+next\b/i, // "move next"
  /\bnext\s+step\b/i, // "next step"
];

// Chat-only indicators — even if edit keywords appear, these override
const CHAT_OVERRIDE_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|ok|okay|sure|got it|nice|cool|great)\b/i,
  /\b(what is|what are|how does|how do|explain|tell me about|can you describe)\b/i,
  /\b(recommend|suggest|tip|advice|best practice|tutorial)\b/i,
  /\b(why|when should|difference between)\b/i,
];

// Short execution confirmations that should trigger editing flow
const EXECUTION_CONFIRM_PATTERNS = [
  /\b(do it|go ahead|execute|apply (it|that)|proceed|make it)\b/i,
  /\bstart editing\b/i,
  /^(yes|yep|yeah|ok|okay|sure)\b/i,
];

const SCRIPT_REQUEST_PATTERN = /\b(script|voiceover|narration|hook|intro)\b/i;
const HARD_EDIT_OPERATION_PATTERN =
  /\b(trim|split|cut|crop|delete|remove|move|merge|combine|join|duplicate|copy|paste|reorder|timeline|clip|track|transition|effect|filter|fade|speed|mute|unmute|volume|subtitle|caption|overlay|on-screen text|onscreen text|transcribe|playhead|export|render)\b/i;
const VIDEO_BUILD_PATTERN =
  /\b(make|create|build|turn)\b[\s\S]{0,40}\b(video|short|shorts|reel|vlog|montage|highlight reel)\b/i;
const EXPLICIT_EDIT_WORD_PATTERN = /\bedit(?:ing)?\b/i;

/**
 * Classify a user message as editing intent or chat intent.
 *
 * This runs entirely locally (zero API cost).
 * Biased toward 'chat' — a false negative (classifying edit as chat)
 * just means the AI responds with text instead of tools, which the user
 * can clarify. A false positive (classifying chat as edit) wastes an API call.
 */
export function classifyIntent(message: string): MessageIntent {
  return classifyIntentWithContext(message, {});
}

export function classifyIntentWithContext(message: string, context: IntentContext): MessageIntent {
  const lower = message.toLowerCase().trim();
  const hasExecutionContext = Boolean(context.hasPendingPlan || context.hasRecentEditingContext);
  const isScriptRequest = SCRIPT_REQUEST_PATTERN.test(lower);
  const hasHardEditOperation =
    HARD_EDIT_OPERATION_PATTERN.test(lower) ||
    VIDEO_BUILD_PATTERN.test(lower) ||
    EXPLICIT_EDIT_WORD_PATTERN.test(lower);

  // Script-writing requests should stay in chat mode unless explicit edit operations are included.
  if (isScriptRequest && !hasHardEditOperation) {
    return 'chat';
  }

  // If user explicitly asks to execute/apply, route to edit.
  // Short confirmations only route to edit when there is pending editing context.
  for (const pattern of EXECUTION_CONFIRM_PATTERNS) {
    if (pattern.test(lower)) {
      if (hasExecutionContext) return 'edit';
      if (
        /\b(do it|go ahead|execute|apply (it|that)|proceed|make it|start editing)\b/i.test(lower)
      ) {
        return 'edit';
      }
      return 'chat';
    }
  }

  // Short greetings are always chat
  if (lower.length < 15) {
    const isGreeting = CHAT_OVERRIDE_PATTERNS[0].test(lower);
    if (isGreeting) return 'chat';
  }

  // Check for chat-override patterns first
  for (const pattern of CHAT_OVERRIDE_PATTERNS) {
    if (pattern.test(lower)) {
      return 'chat';
    }
  }

  // Check for strong edit patterns (regex)
  for (const pattern of EDIT_PATTERNS) {
    if (pattern.test(lower)) {
      return 'edit';
    }
  }

  // Check for edit keywords (word boundary matching)
  for (const keyword of EDIT_KEYWORDS) {
    // Use word boundary for single words, includes for multi-word
    if (keyword.includes(' ')) {
      if (lower.includes(keyword)) return 'edit';
    } else {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(lower)) return 'edit';
    }
  }

  // Default: chat (cheaper — false negatives are cheap)
  return 'chat';
}

/**
 * Determine what context to inject based on message content.
 * Returns flags for each context type.
 */
export interface ContextFlags {
  includeTimeline: boolean;
  includeMemory: boolean;
  includeChannel: boolean;
}

// ─── Publish Intent ────────────────────────────────────────────────────────────
// Phrases that unambiguously signal the user wants to publish/upload to YouTube.
const PUBLISH_INTENT_PATTERNS = [
  /\bpublish\b/i,
  /\bupload\s+(to\s+)?youtube\b/i,
  /\bpost\s+(to\s+|on\s+)?youtube\b/i,
  /\bput\s+it\s+on\s+youtube\b/i,
  /\bshare\s+(it\s+)?on\s+youtube\b/i,
  /\bgo\s+live\b/i,
  /\brelease\s+(the\s+)?video\b/i,
  /\bready\s+to\s+(publish|upload|post)\b/i,
  /\blet'?s?\s+(publish|upload|post)\b/i,
  /\b(publish|upload|post)\s+(the\s+)?video\b/i,
  /\bsend\s+(it\s+)?to\s+youtube\b/i,
];

/**
 * Returns true when the user message clearly signals intent to publish/upload to YouTube.
 * This is checked before edit/chat routing to open the publish panel instead of planning.
 */
export function detectPublishIntent(message: string): boolean {
  return PUBLISH_INTENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function detectContextNeeds(message: string, intent: MessageIntent): ContextFlags {
  const lower = message.toLowerCase();
  const scriptRequest = /\b(script|voiceover|narration|hook|intro)\b/i.test(lower);

  // For editing intent, always include timeline + memory
  if (intent === 'edit') {
    return {
      includeTimeline: true,
      includeMemory: true,
      includeChannel: false,
    };
  }

  // For chat intent, selectively include
  return {
    includeTimeline:
      scriptRequest || /\b(timeline|clip|track|duration|playhead|project)\b/i.test(lower),
    includeMemory: /\b(video|image|photo|media|file|content|scene|analyze|memory)\b/i.test(lower),
    includeChannel: /\b(channel|youtube|subscriber|upload|growth)\b/i.test(lower),
  };
}
