/**
 * Clip Alias Mapper - Maps human-readable aliases to UUIDs
 * 
 * Prevents LLM from hallucinating UUIDs by providing stable aliases.
 * The LLM only sees: clip_1, clip_2, etc.
 * We internally map these back to real UUIDs during execution.
 */

import type { Clip } from '../stores/useProjectStore';

export interface ClipAlias {
  alias: string;          // "clip_1", "clip_2", etc.
  uuid: string;           // Real clip UUID
  name: string;           // User-facing name
  duration: number;       // Clip duration
  mediaType: string;      // "video", "audio", "image"
  timelineStart: number;  // Position on timeline
  trackIndex: number;     // Track number
}

export interface AliasMap {
  byAlias: Map<string, string>;     // alias → uuid
  byUuid: Map<string, string>;      // uuid → alias
  metadata: Map<string, ClipAlias>; // alias → full metadata
}

/**
 * Build alias map from timeline clips
 * Clips are sorted by timeline position and numbered sequentially
 */
export function buildClipAliasMap(clips: Clip[]): AliasMap {
  const byAlias = new Map<string, string>();
  const byUuid = new Map<string, string>();
  const metadata = new Map<string, ClipAlias>();

  // Sort by timeline position for consistent numbering
  const sortedClips = [...clips].sort((a, b) => a.startTime - b.startTime);

  sortedClips.forEach((clip, index) => {
    const alias = `clip_${index + 1}`;
    
    byAlias.set(alias, clip.id);
    byUuid.set(clip.id, alias);
    
    metadata.set(alias, {
      alias,
      uuid: clip.id,
      name: clip.name,
      duration: clip.duration,
      mediaType: clip.mediaType || 'video',
      timelineStart: clip.startTime,
      trackIndex: clip.trackIndex ?? 0,
    });
  });

  return { byAlias, byUuid, metadata };
}

/**
 * Resolve alias to UUID
 * Returns undefined if alias doesn't exist
 */
export function resolveAlias(alias: string, aliasMap: AliasMap): string | undefined {
  return aliasMap.byAlias.get(alias);
}

/**
 * Resolve UUID to alias
 * Returns undefined if UUID doesn't exist
 */
export function resolveUuid(uuid: string, aliasMap: AliasMap): string | undefined {
  return aliasMap.byUuid.get(uuid);
}

/**
 * Get full metadata for an alias
 */
export function getAliasMetadata(alias: string, aliasMap: AliasMap): ClipAlias | undefined {
  return aliasMap.metadata.get(alias);
}

/**
 * Format alias map for LLM prompt (human-readable list)
 */
export function formatAliasMapForPrompt(aliasMap: AliasMap): string {
  const entries = Array.from(aliasMap.metadata.values());
  
  if (entries.length === 0) {
    return 'No clips on timeline.';
  }

  return entries
    .map((clip) => {
      return `${clip.alias}: "${clip.name}" (${clip.mediaType}, ${clip.duration.toFixed(1)}s, track ${clip.trackIndex}, starts at ${clip.timelineStart.toFixed(1)}s)`;
    })
    .join('\n');
}

/**
 * Convert tool call arguments from aliases to UUIDs
 * Returns modified args object (does not mutate original)
 */
export function aliasArgsToUuid(
  toolName: string,
  args: Record<string, any>,
  aliasMap: AliasMap,
): {
  success: boolean;
  args: Record<string, any>;
  errors: string[];
} {
  const newArgs = { ...args };
  const errors: string[] = [];

  // Tools that take clip_id
  if (toolName === 'split_clip' || toolName === 'move_clip' || toolName === 'get_clip_details' || 
      toolName === 'update_clip_bounds' || toolName === 'set_clip_speed' || toolName === 'apply_clip_effect' ||
      toolName === 'transcribe_clip') {
    if (args.clip_id) {
      const uuid = resolveAlias(args.clip_id, aliasMap);
      if (uuid) {
        newArgs.clip_id = uuid;
      } else {
        errors.push(`Invalid clip alias: ${args.clip_id}`);
      }
    }
  }

  // Tools that take clip_ids array
  if (toolName === 'delete_clips' || toolName === 'merge_clips' || toolName === 'copy_clips' || 
      toolName === 'select_clips' || toolName === 'set_clip_volume' || toolName === 'toggle_clip_mute') {
    if (Array.isArray(args.clip_ids)) {
      const resolvedIds: string[] = [];
      for (const alias of args.clip_ids) {
        if (alias === 'all' && (toolName === 'select_clips' || toolName === 'set_clip_volume')) {
          resolvedIds.push(alias);
          continue;
        }
        const uuid = resolveAlias(alias, aliasMap);
        if (uuid) {
          resolvedIds.push(uuid);
        } else {
          errors.push(`Invalid clip alias in array: ${alias}`);
        }
      }
      if (resolvedIds.length > 0) {
        newArgs.clip_ids = resolvedIds;
      }
    }
  }

  return {
    success: errors.length === 0,
    args: newArgs,
    errors,
  };
}

/**
 * Validate that tool args only reference valid aliases
 * Returns validation errors (empty array if valid)
 */
export function validateAliasReferences(
  _toolName: string,
  args: Record<string, any>,
  aliasMap: AliasMap,
): string[] {
  const errors: string[] = [];
  const validAliases = Array.from(aliasMap.byAlias.keys());

  // Single clip_id
  if (args.clip_id && typeof args.clip_id === 'string') {
    if (!aliasMap.byAlias.has(args.clip_id)) {
      errors.push(`clip_id "${args.clip_id}" is not valid. Use one of: ${validAliases.join(', ')}`);
    }
  }

  // Array of clip_ids
  if (Array.isArray(args.clip_ids)) {
    for (const id of args.clip_ids) {
      if (id === 'all') {
        continue;
      }
      if (typeof id === 'string' && !aliasMap.byAlias.has(id)) {
        errors.push(`clip_id "${id}" is not valid. Use one of: ${validAliases.join(', ')}`);
      }
    }
  }

  return errors;
}
