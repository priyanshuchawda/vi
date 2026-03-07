import { describe, expect, it } from 'vitest';
import { parseAnalysisResponse } from '../../src/lib/aiMemoryService';

describe('aiMemoryService parseAnalysisResponse', () => {
  it('normalizes free-form editorial labels into canonical memory fields', () => {
    const parsed = parseAnalysisResponse(`{
      "summary": "A screenshot announces the winning hackathon team.",
      "tags": "hackathon, winner, cybersecurity",
      "analysis": {
        "content": "The image shows a winner announcement post with AllKnighters named on screen.",
        "editNote": "Useful as proof early in the edit."
      },
      "visualInfo": {
        "visibleText": ["AllKnighters", "Winner announcement"]
      },
      "editorialInsights": {
        "storyRole": "announcement",
        "evidenceStrength": "strong",
        "memoryAnchors": "Winner announcement screenshot | Team name visible on screen",
        "bestFor": "proof-first intro"
      }
    }`);

    expect(parsed.tags).toEqual(['hackathon', 'winner', 'cybersecurity']);
    expect(parsed.analysis).toContain('winner announcement post');
    expect(parsed.visualInfo?.visibleTextHighlights).toEqual([
      'AllKnighters',
      'Winner announcement',
    ]);
    expect(parsed.editorialInsights?.storyRole).toBe('proof');
    expect(parsed.editorialInsights?.evidenceStrength).toBe('high');
    expect(parsed.editorialInsights?.memoryAnchors).toEqual([
      'Winner announcement screenshot',
      'Team name visible on screen',
    ]);
    expect(parsed.editorialInsights?.bestFor).toEqual(['proof-first intro']);
  });

  it('extracts wrapped JSON and repairs scene-level drift', () => {
    const parsed = parseAnalysisResponse(`Here is the analysis:
\`\`\`json
{
  "summary": "A team builds a prototype at a desk before the reveal.",
  "tags": ["prototype", "build", "team",],
  "analysis": "Hands connect wires and test components. Good process footage.",
  "scenes": [
    {
      "startTime": "4.2",
      "endTime": "1.1",
      "description": "Hands connect wires on a small board.",
      "storyRole": "process",
      "hookPotential": "strong",
      "editValue": {"reason": "Useful before the final result reveal."},
      "searchHints": "prototype wiring, hands on desk"
    }
  ],
  "audioInfo": {
    "languages": "English",
    "transcriptSummary": "Short explanation while building."
  }
}
\`\`\`
Extra text that should be ignored.`);

    expect(parsed.tags).toEqual(['prototype', 'build', 'team']);
    expect(parsed.scenes).toHaveLength(1);
    expect(parsed.scenes?.[0]).toMatchObject({
      startTime: 1.1,
      endTime: 4.2,
      storyRole: 'behind_the_scenes',
      hookPotential: 'high',
    });
    expect(parsed.scenes?.[0].editValue).toContain('final result reveal');
    expect(parsed.scenes?.[0].searchHints).toEqual(['prototype wiring', 'hands on desk']);
    expect(parsed.audioInfo).toMatchObject({
      hasSpeech: true,
      hasMusic: false,
      languages: ['English'],
    });
  });

  it('downgrades generic process footage from proof to behind-the-scenes', () => {
    const parsed = parseAnalysisResponse(`{
      "summary": "Two people are working at a desk with a laptop while one adjusts wires.",
      "tags": ["office", "technology", "collaboration"],
      "analysis": "The clip shows teammates working in an office setup and preparing equipment on a desk.",
      "editorialInsights": {
        "storyRole": "proof",
        "evidenceStrength": "high",
        "bestFor": ["demonstrating teamwork"]
      },
      "scenes": [
        {
          "startTime": 0.8,
          "endTime": 2.6,
          "description": "One teammate adjusts wires connected to the laptop on the desk.",
          "storyRole": "proof"
        }
      ]
    }`);

    expect(parsed.editorialInsights?.storyRole).toBe('behind_the_scenes');
    expect(parsed.editorialInsights?.evidenceStrength).toBe('low');
    expect(parsed.editorialInsights?.bestFor).toContain('process montage');
    expect(parsed.editorialInsights?.avoidFor).toContain('proof-first intro');
    expect(parsed.scenes?.[0].storyRole).toBe('behind_the_scenes');
  });
});
