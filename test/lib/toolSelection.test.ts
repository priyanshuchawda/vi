import { describe, expect, it } from 'vitest';
import { selectToolsForRequest } from '../../src/lib/toolSelection';

describe('toolSelection', () => {
  it('keeps short-form execution requests on a compact, relevant tool set', () => {
    const result = selectToolsForRequest({
      message:
        'make a 30 second youtube short with proper script and editing so it gets more views',
      mode: 'agentic',
      normalizedIntent: {
        goals: ['platform_optimized_output', 'script_generation'],
        requestedOutputs: ['edit_plan', 'short_script_outline'],
        constraints: { target_duration: 30, platform: 'youtube_shorts' },
        operationHint: 'script_outline',
      },
    });

    expect(result.toolNames.length).toBeLessThanOrEqual(12);
    expect(result.toolNames).toEqual(
      expect.arrayContaining([
        'get_timeline_info',
        'get_all_media_analysis',
        'generate_intro_script_from_timeline',
        'preview_caption_fit',
        'apply_script_as_captions',
        'set_clip_speed',
        'copy_clips',
        'paste_clips',
      ]),
    );
    expect(result.toolNames).not.toContain('add_subtitle');
    expect(result.toolNames).not.toContain('update_subtitle');
    expect(result.toolNames).not.toContain('delete_clips');
  });

  it('keeps economy mode narrow and avoids unrelated heavy tools', () => {
    const result = selectToolsForRequest({
      message: 'trim this to 30 seconds for shorts',
      mode: 'economy',
      normalizedIntent: {
        goals: ['platform_optimized_output'],
        requestedOutputs: ['edit_plan'],
        constraints: { target_duration: 30, platform: 'youtube_shorts' },
        operationHint: 'trim',
      },
    });

    expect(result.toolNames.length).toBeLessThanOrEqual(8);
    expect(result.toolNames).toEqual(
      expect.arrayContaining([
        'get_timeline_info',
        'update_clip_bounds',
        'set_clip_speed',
      ]),
    );
    expect(result.toolNames).not.toContain('transcribe_timeline');
    expect(result.toolNames).not.toContain('save_project');
  });

  it('keeps atomic subtitle tools available for text overlay retention asks', () => {
    const result = selectToolsForRequest({
      message: 'add a text overlay so users watch till the end of this vlog',
      mode: 'agentic',
      normalizedIntent: {
        goals: [],
        requestedOutputs: ['subtitle_plan'],
        constraints: {},
        operationHint: 'subtitle',
      },
    });

    expect(result.toolNames).toEqual(
      expect.arrayContaining([
        'add_subtitle',
        'update_subtitle_style',
        'get_subtitles',
      ]),
    );
  });

  it('avoids update_subtitle for fresh shorts overlay requests', () => {
    const result = selectToolsForRequest({
      message: 'make this a 30 second youtube short vlog with attractive text overlays',
      mode: 'agentic',
      normalizedIntent: {
        goals: ['platform_optimized_output', 'script_generation'],
        requestedOutputs: ['subtitle_plan', 'short_script_outline'],
        constraints: { target_duration: 30, platform: 'youtube_shorts' },
        operationHint: 'subtitle',
      },
    });

    expect(result.toolNames).not.toContain('update_subtitle');
  });

  it('keeps delete_clips available only for explicit delete requests', () => {
    const result = selectToolsForRequest({
      message: 'delete the first clip from timeline',
      mode: 'agentic',
      normalizedIntent: {
        goals: [],
        requestedOutputs: ['edit_plan'],
        constraints: {},
        operationHint: 'delete',
      },
    });

    expect(result.toolNames).toContain('delete_clips');
  });
});
