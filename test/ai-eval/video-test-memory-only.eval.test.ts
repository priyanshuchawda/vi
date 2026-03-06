import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConversationLane } from '../../src/lib/conversationLane';
import { retrieveRelevantMemory } from '../../src/lib/memoryRetrieval';
import type { MediaAnalysisEntry } from '../../src/types/aiMemory';

interface Scenario {
  prompt: string;
  lastAssistantMessage?: string;
}

const projectPath = path.resolve(process.cwd(), 'video_test', 'project.quickcut');

function loadVideoTestMemory(): MediaAnalysisEntry[] {
  const raw = fs.readFileSync(projectPath, 'utf-8');
  const parsed = JSON.parse(raw) as { memory?: MediaAnalysisEntry[] };
  const memory = Array.isArray(parsed.memory) ? parsed.memory : [];
  return memory.filter((entry) => entry.filePath.includes('/video_test/'));
}

describe('video_test memory-only AI evaluation', () => {
  it.skipIf(!fs.existsSync(projectPath))(
    'runs prompt evaluation using only saved memory (no model call)',
    () => {
      const memoryEntries = loadVideoTestMemory();
      expect(memoryEntries.length).toBeGreaterThan(0);

      const scenarios: Scenario[] = [
      {
        prompt:
          'you check the video and create a script for me of 16 seconds of how i won hackaton intro, should look really attractive',
      },
      {
        prompt: 'trim the photo from 2 sec to 6 second increase it',
      },
      {
        prompt: 'yes',
        lastAssistantMessage:
          '[0:00 - 0:02] [Text Overlay: Hackathon Victory] [0:03 - 0:05] [Text Overlay: Innovative Ideas] Would you like to proceed with these changes?',
      },
      {
        prompt: 'yes',
        lastAssistantMessage: 'Here is your draft. Tell me what to improve.',
      },
    ];

    const report = scenarios.map((scenario, index) => {
      const lane = resolveConversationLane({
        message: scenario.prompt,
        lastAssistantMessage: scenario.lastAssistantMessage || '',
        hasTimeline: true,
        hasPendingPlan: false,
        hasRecentEditingContext: true,
      });
      const hits = retrieveRelevantMemory({
        query: scenario.prompt,
        entries: memoryEntries,
        intent: lane.lane === 'timeline_edit' ? 'plan' : 'chat',
      });

      return {
        case: index + 1,
        prompt: scenario.prompt,
        lane: lane.lane,
        laneReason: lane.reason,
        topMemoryFile: hits[0]?.entry.fileName || 'none',
        topMemoryScore: Number((hits[0]?.score || 0).toFixed(2)),
      };
    });

    console.table(report);

      expect(report[0].lane).toBe('script_guidance');
      expect(report[1].lane).toBe('timeline_edit');
      expect(report[2].lane).toBe('timeline_edit');
      expect(report[3].lane).toBe('script_guidance');
    },
  );
});
