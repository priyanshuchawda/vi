/**
 * AI Memory Service — AWS Bedrock (Amazon Nova Lite v1)
 *
 * Background analysis of imported media files.
 * When a user imports files into the video editor, this service:
 * 1. Receives the file info (path, type, thumbnail, etc.)
 * 2. Sends it to Bedrock for analysis using inline bytes
 * 3. Parses the structured response with Zod validation
 * 4. Stores the analysis in the AiMemoryStore
 *
 * The analysis runs in parallel with the normal import flow.
 */

import { converseBedrock, MODEL_ID, isBedrockConfigured } from './bedrockGateway';
import { useAiMemoryStore } from '../stores/useAiMemoryStore';
import type { AudioInfo, EditorialInsights, SceneInfo, VisualInfo } from '../types/aiMemory';
import { MediaAnalysisSchema } from './schemas/mediaAnalysis';
import { waitForSlot } from './rateLimiter';
import { recordUsage } from './tokenTracker';

// Queue management for background analysis
const analysisQueue: AnalysisTask[] = [];
let isProcessingQueue = false;
const MAX_CONCURRENT = 1;
let activeAnalyses = 0;

/**
 * Options for analyzing specific segments of a video
 */
interface VideoClipOptions {
  startTime?: number;
  endTime?: number;
  fps?: number;
}

interface AnalysisTask {
  entryId: string;
  filePath: string;
  fileName: string;
  mediaType: 'video' | 'audio' | 'image' | 'document';
  mimeType: string;
  fileSize: number;
  duration?: number;
  thumbnailDataUrl?: string;
  clipOptions?: VideoClipOptions;
}

export type AnalysisBudgetTier = 'low' | 'standard' | 'high';

interface AnalysisTierConfig {
  maxTokens: number;
  maxRetries: number;
  temperature: number;
  maxTags: number;
}

const ANALYSIS_TIER_CONFIG: Record<AnalysisBudgetTier, AnalysisTierConfig> = {
  low: {
    maxTokens: 768,
    maxRetries: 1,
    temperature: 0.1,
    maxTags: 5,
  },
  standard: {
    maxTokens: 1400,
    maxRetries: 2,
    temperature: 0.2,
    maxTags: 8,
  },
  high: {
    maxTokens: 2048,
    maxRetries: 3,
    temperature: 0.2,
    maxTags: 10,
  },
};

/**
 * Get the appropriate analysis prompt based on media type
 * Nova Lite doesn't have responseSchema — we add JSON instructions to the prompt
 */
function getAnalysisPrompt(mediaType: string, fileName: string, tier: AnalysisBudgetTier): string {
  const tierGuidance: Record<AnalysisBudgetTier, string> = {
    low: `<budget_mode>
Tier: low
- Prioritize concise, high-signal analysis
- Keep analysis to one compact paragraph
- Return up to ${ANALYSIS_TIER_CONFIG.low.maxTags} tags
- Include scenes only for major moments
</budget_mode>`,
    standard: `<budget_mode>
Tier: standard
- Balance depth and cost
- Keep analysis to 1-2 short paragraphs
- Return up to ${ANALYSIS_TIER_CONFIG.standard.maxTags} tags
- Include key scenes relevant for editing
</budget_mode>`,
    high: `<budget_mode>
Tier: high
- Provide richer editing insights while staying factual
- Keep analysis to 2 concise paragraphs max
- Return up to ${ANALYSIS_TIER_CONFIG.high.maxTags} tags
- Include detailed key scenes and quality observations
</budget_mode>`,
  };

  const baseInstruction = `<role>
You are a specialized media analysis AI for QuickCut, a professional video editing application.
You analyze media files to extract detailed, structured information for video editors.
</role>

<task>
Analyze the provided ${mediaType} file named "${fileName}" and provide a comprehensive analysis.
</task>

<constraints>
1. Base your analysis strictly on the actual content of the file
2. Be accurate and factual - do not speculate or assume
3. Provide specific, actionable insights relevant to video editing
4. Keep the summary concise (1-2 sentences)
5. Provide 5-10 relevant tags for quick reference
</constraints>

<output_format>
You MUST respond with ONLY valid JSON (no markdown, no code blocks, no extra text).
Keep fields simple:
- "analysis" must be a plain string, never an object
- arrays should contain short strings
- omit any field you are not confident about instead of inventing values
- if you use storyRole, use one of: hook, setup, behind_the_scenes, proof, payoff, cta_support
- if you use strength/energy/hook levels, use only: low, medium, high
- if you use pacing, use only: slow, steady, fast, mixed
Use this structure:
{
  "summary": "1-2 sentence summary",
  "tags": ["tag1", "tag2", ...],
  "analysis": "Detailed paragraph about content, quality, pacing, etc.",
  "scenes": [{"startTime": 0, "endTime": 5, "description": "Scene description", "storyRole": "hook", "editValue": "why useful", "searchHints": ["short phrase"]}],
  "audioInfo": {"hasSpeech": true, "hasMusic": false, "languages": ["English"], "transcriptSummary": "..."},
  "visualInfo": {"subjects": ["person"], "visibleTextHighlights": ["important text"], "style": "cinematic", "quality": "high"},
  "editorialInsights": {"storyRole": "proof", "evidenceStrength": "high", "memoryAnchors": ["short factual memory point"], "bestFor": ["proof-first intro"], "avoidFor": ["slow process montage"], "hookMoments": ["Short factual hook idea"], "overlayIdeas": ["2-6 word text overlay idea"]}
}
All fields except summary/tags/analysis are optional.
</output_format>`;

  if (mediaType === 'video') {
    return (
      baseInstruction +
      `
${tierGuidance[tier]}

<analysis_focus>
- Identify key scenes with approximate timestamps
- Analyze both visual and audio aspects
- Note dominant colors, composition style, and quality
- Detect speech, music, and overall mood
- Provide actionable insights for video editing
- For each important scene, estimate energy and best editorial use
- For each important scene, say why it matters in an edit and add 2-5 short search hints
- Call out hook-worthy moments for the first 1-3 seconds of a short if present
- Suggest short on-screen text overlays grounded in the actual footage
- Distinguish between proof/payoff footage and behind-the-scenes work footage
- Generic office work, laptop use, wiring, typing, meetings, walking, or setup footage is NOT proof unless a concrete result is visibly shown
- Only mark hasSpeech or a language when speech is clearly audible; never infer audio from visuals alone
- If footage only shows generic working, typing, walking, setup, or preparation without the visible result, prefer storyRole=behind_the_scenes and evidenceStrength=low
- Use storyRole=proof only when the asset visibly shows the winning result, certificate, announcement, demo outcome, or another concrete claim on screen
- Add 3-8 memoryAnchors: short factual points the editing agent should remember later
- Add bestFor / avoidFor to clarify when this asset helps or should stay secondary
</analysis_focus>`
    );
  }

  if (mediaType === 'audio') {
    return (
      baseInstruction +
      `
${tierGuidance[tier]}

<analysis_focus>
- Describe what you hear (speech, music, sound effects)
- Identify languages and speakers if applicable
- Assess audio quality and mood
- Note any background sounds or music
- Provide insights relevant to audio editing
</analysis_focus>`
    );
  }

  if (mediaType === 'image') {
    return (
      baseInstruction +
      `
${tierGuidance[tier]}

<analysis_focus>
- Describe composition, colors, and style
- Identify main subjects and elements
- Assess image quality and resolution
- Note lighting and artistic choices
- Provide insights for photo/video editing
- Suggest whether the image works best as hook frame, establishing shot, payoff, or filler
- Suggest short overlay text ideas only if clearly supported by the image
- Extract important visible text such as winner names, certificates, event titles, rankings, and claims shown on screen
- If the image is a screenshot/poster/social post, say so explicitly and classify whether it is proof or context
- Add memoryAnchors that make the image easy to reuse later in script and edit planning
</analysis_focus>`
    );
  }

  // Document
  return (
    baseInstruction +
    `
${tierGuidance[tier]}

<analysis_focus>
- Summarize the document's content and purpose
- Extract key information and themes
- Identify document type and structure
- Note any production-relevant details
- Extract concise visible text highlights that matter for editing or story proof
</analysis_focus>`
  );
}

/** Bedrock-compatible media format from MIME type */
function getMediaFormat(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
  };
  return map[mimeType] || mimeType.split('/')[1] || 'jpeg';
}

// Max size for inline bytes in Bedrock: 25MB
const MAX_INLINE_SIZE = 25 * 1024 * 1024;

export function selectAnalysisTier(input: {
  mediaType: AnalysisTask['mediaType'];
  fileSize: number;
  duration?: number;
  queueDepth: number;
  activeAnalyses: number;
}): AnalysisBudgetTier {
  const pressure = input.queueDepth + input.activeAnalyses;
  const largeFile = input.fileSize > MAX_INLINE_SIZE;

  if (largeFile || pressure >= 4) {
    return 'low';
  }

  if (input.mediaType === 'image' && input.fileSize <= 5 * 1024 * 1024) {
    return 'high';
  }

  if (
    input.mediaType === 'video' &&
    input.fileSize <= 12 * 1024 * 1024 &&
    (input.duration ?? 0) > 0 &&
    (input.duration ?? 0) <= 60 &&
    pressure <= 1
  ) {
    return 'high';
  }

  return 'standard';
}

/**
 * Read a file as base64 from disk via Electron IPC
 */
async function readFileAsBase64(filePath: string): Promise<string | null> {
  try {
    if (window.electronAPI && window.electronAPI.readFileAsBase64) {
      const base64 = await window.electronAPI.readFileAsBase64(filePath);
      return base64;
    }
    return null;
  } catch (error) {
    console.error('Error reading file for analysis:', error);
    return null;
  }
}

/** Convert base64 to Uint8Array for Bedrock */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

type ParsedAnalysisResult = {
  summary: string;
  tags: string[];
  analysis: string;
  scenes?: SceneInfo[];
  audioInfo?: AudioInfo;
  visualInfo?: VisualInfo;
  editorialInsights?: EditorialInsights;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function cleanText(value: string, maxLength: number = 400): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function keyToLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function toText(value: unknown, maxLength: number = 400): string | undefined {
  if (typeof value === 'string') {
    const cleaned = cleanText(value, maxLength);
    return cleaned || undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => toText(item, Math.max(40, Math.floor(maxLength / Math.max(1, value.length)))))
      .filter(Boolean) as string[];
    if (!parts.length) return undefined;
    return cleanText(parts.join('; '), maxLength);
  }

  if (isRecord(value)) {
    const preferredKeys = [
      'summary',
      'description',
      'content',
      'analysis',
      'value',
      'reason',
      'note',
    ];
    const preferredParts = preferredKeys
      .map((key) => toText(value[key], maxLength))
      .filter(Boolean) as string[];
    if (preferredParts.length) {
      return cleanText(preferredParts.join('. '), maxLength);
    }

    const parts = Object.entries(value)
      .slice(0, 6)
      .map(([key, nested]) => {
        const text = toText(nested, 120);
        return text ? `${keyToLabel(key)}: ${text}` : undefined;
      })
      .filter(Boolean) as string[];

    if (!parts.length) return undefined;
    return cleanText(parts.join('. '), maxLength);
  }

  return undefined;
}

function toStringArray(
  value: unknown,
  options?: {
    maxItems?: number;
    maxItemLength?: number;
    splitDelimited?: boolean;
  },
): string[] {
  const maxItems = options?.maxItems ?? 8;
  const maxItemLength = options?.maxItemLength ?? 120;
  const splitDelimited = options?.splitDelimited ?? true;
  const rawValues = Array.isArray(value) ? value : value == null ? [] : [value];
  const items: string[] = [];

  for (const rawValue of rawValues) {
    const text = toText(rawValue, maxItemLength * 2);
    if (!text) continue;

    const segments = splitDelimited && /[,\n|]/.test(text) ? text.split(/[,\n|]+/) : [text];

    for (const segment of segments) {
      const cleaned = cleanText(segment, maxItemLength);
      if (!cleaned) continue;
      if (!items.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
        items.push(cleaned);
      }
      if (items.length >= maxItems) {
        return items;
      }
    }
  }

  return items;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', 'y', 'present', 'detected'].includes(normalized)) return true;
  if (['false', 'no', 'n', 'none', 'absent', 'not detected'].includes(normalized)) return false;
  return undefined;
}

function normalizeLevel(
  value: unknown,
  kind: 'strength' | 'pacing',
): 'low' | 'medium' | 'high' | 'slow' | 'steady' | 'fast' | 'mixed' | undefined {
  const text = toText(value, 80)?.toLowerCase();
  if (!text) return undefined;

  if (kind === 'pacing') {
    if (/(mixed|varied|changes|combination)/.test(text)) return 'mixed';
    if (/(fast|quick|rapid|energetic|dynamic|snappy)/.test(text)) return 'fast';
    if (/(slow|calm|gentle|lingering)/.test(text)) return 'slow';
    if (/(steady|balanced|consistent|moderate|medium)/.test(text)) return 'steady';
    return undefined;
  }

  if (/(high|strong|clear|very high|excellent|major)/.test(text)) return 'high';
  if (/(medium|moderate|some|partial|mid)/.test(text)) return 'medium';
  if (/(low|weak|limited|minor|small)/.test(text)) return 'low';
  return undefined;
}

function normalizeStoryRole(value: unknown): SceneInfo['storyRole'] | undefined {
  const text = toText(value, 120)?.toLowerCase();
  if (!text) return undefined;

  if (/(cta|call to action)/.test(text)) return 'cta_support';
  if (/(payoff|ending|result reveal|final reveal|resolution|celebration)/.test(text))
    return 'payoff';
  if (
    /(proof|announcement|winner|winning|award|certificate|result|outcome|achievement|evidence)/.test(
      text,
    )
  ) {
    return 'proof';
  }
  if (/(behind|bts|process|making|build|work|working|setup footage|preparation)/.test(text)) {
    return 'behind_the_scenes';
  }
  if (/(setup|intro|context|establishing|opening context)/.test(text)) return 'setup';
  if (/(hook|attention|opening hit|thumbstop)/.test(text)) return 'hook';
  return undefined;
}

function normalizeScene(scene: unknown): SceneInfo | undefined {
  if (!isRecord(scene)) return undefined;

  const description = toText(scene.description || scene.summary || scene.scene, 240);
  const startTime = toNumber(scene.startTime ?? scene.start ?? scene.from);
  const endTime = toNumber(scene.endTime ?? scene.end ?? scene.to);
  if (!description || startTime == null || endTime == null) {
    return undefined;
  }

  const safeStart = Math.max(0, Math.min(startTime, endTime));
  const safeEnd = Math.max(safeStart, Math.max(startTime, endTime));
  const normalized: SceneInfo = {
    startTime: safeStart,
    endTime: safeEnd === safeStart ? safeStart + 0.1 : safeEnd,
    description,
  };

  const keyElements = toStringArray(scene.keyElements, { maxItems: 6 });
  if (keyElements.length) normalized.keyElements = keyElements;

  const energyLevel = normalizeLevel(scene.energyLevel ?? scene.energy, 'strength');
  if (energyLevel === 'low' || energyLevel === 'medium' || energyLevel === 'high') {
    normalized.energyLevel = energyLevel;
  }

  const recommendedUse = toText(scene.recommendedUse ?? scene.use ?? scene.editorialUse, 120);
  if (recommendedUse) normalized.recommendedUse = recommendedUse;

  const storyRole = normalizeStoryRole(scene.storyRole ?? scene.role ?? scene.momentType);
  if (storyRole) normalized.storyRole = storyRole;

  const hookPotential = normalizeLevel(scene.hookPotential ?? scene.hookStrength, 'strength');
  if (hookPotential === 'low' || hookPotential === 'medium' || hookPotential === 'high') {
    normalized.hookPotential = hookPotential;
  }

  const editValue = toText(scene.editValue ?? scene.whyItMatters ?? scene.reason, 180);
  if (editValue) normalized.editValue = editValue;

  const searchHints = toStringArray(scene.searchHints ?? scene.searchTerms ?? scene.findWith, {
    maxItems: 5,
    maxItemLength: 80,
  });
  if (searchHints.length) normalized.searchHints = searchHints;

  return normalized;
}

function normalizeAudioInfo(audioInfo: unknown): AudioInfo | undefined {
  if (!isRecord(audioInfo)) return undefined;

  const transcriptSummary = toText(audioInfo.transcriptSummary ?? audioInfo.transcript, 240);
  const languages = toStringArray(audioInfo.languages ?? audioInfo.language, {
    maxItems: 4,
    maxItemLength: 40,
  });
  const mood = toText(audioInfo.mood ?? audioInfo.tone, 80);
  const confidenceNotes = toText(audioInfo.confidenceNotes ?? audioInfo.notes, 180);

  const hasSpeech =
    toBoolean(audioInfo.hasSpeech ?? audioInfo.speechPresent) ??
    Boolean(transcriptSummary || languages.length);
  const hasMusic = toBoolean(audioInfo.hasMusic ?? audioInfo.musicPresent) ?? false;

  if (
    !hasSpeech &&
    !hasMusic &&
    !transcriptSummary &&
    !languages.length &&
    !mood &&
    !confidenceNotes
  ) {
    return undefined;
  }

  return {
    hasSpeech,
    hasMusic,
    languages: languages.length ? languages : undefined,
    mood: mood || undefined,
    transcriptSummary: transcriptSummary || undefined,
    confidenceNotes: confidenceNotes || undefined,
  };
}

function normalizeVisualInfo(visualInfo: unknown): VisualInfo | undefined {
  if (!isRecord(visualInfo)) return undefined;

  const dominantColors = toStringArray(visualInfo.dominantColors ?? visualInfo.colors, {
    maxItems: 6,
    maxItemLength: 30,
  });
  const style = toText(visualInfo.style, 80);
  const subjects = toStringArray(visualInfo.subjects ?? visualInfo.objects, {
    maxItems: 8,
    maxItemLength: 60,
  });
  const composition = toText(visualInfo.composition ?? visualInfo.camera, 160);
  const quality = toText(visualInfo.quality ?? visualInfo.resolution, 80);
  const visibleTextHighlights = toStringArray(
    visualInfo.visibleTextHighlights ?? visualInfo.visibleText ?? visualInfo.onScreenText,
    {
      maxItems: 8,
      maxItemLength: 120,
    },
  );

  if (
    !dominantColors.length &&
    !style &&
    !subjects.length &&
    !composition &&
    !quality &&
    !visibleTextHighlights.length
  ) {
    return undefined;
  }

  return {
    dominantColors: dominantColors.length ? dominantColors : undefined,
    style: style || undefined,
    subjects: subjects.length ? subjects : undefined,
    composition: composition || undefined,
    quality: quality || undefined,
    visibleTextHighlights: visibleTextHighlights.length ? visibleTextHighlights : undefined,
  };
}

function normalizeEditorialInsights(editorialInsights: unknown): EditorialInsights | undefined {
  if (!isRecord(editorialInsights)) return undefined;

  const shortFormPotential = normalizeLevel(
    editorialInsights.shortFormPotential ?? editorialInsights.shortFormScore,
    'strength',
  );
  const pacing = normalizeLevel(editorialInsights.pacing, 'pacing');
  const storyRole = normalizeStoryRole(
    editorialInsights.storyRole ?? editorialInsights.role ?? editorialInsights.primaryRole,
  );
  const evidenceStrength = normalizeLevel(
    editorialInsights.evidenceStrength ?? editorialInsights.proofStrength,
    'strength',
  );
  const memoryAnchors = toStringArray(
    editorialInsights.memoryAnchors ?? editorialInsights.remember,
    {
      maxItems: 8,
      maxItemLength: 120,
    },
  );
  const hookMoments = toStringArray(editorialInsights.hookMoments ?? editorialInsights.hooks, {
    maxItems: 5,
    maxItemLength: 120,
  });
  const bestFor = toStringArray(editorialInsights.bestFor ?? editorialInsights.goodFor, {
    maxItems: 5,
    maxItemLength: 100,
  });
  const avoidFor = toStringArray(editorialInsights.avoidFor ?? editorialInsights.weakFor, {
    maxItems: 5,
    maxItemLength: 100,
  });
  const recommendedUses = toStringArray(
    editorialInsights.recommendedUses ?? editorialInsights.uses ?? editorialInsights.recommendedUse,
    {
      maxItems: 5,
      maxItemLength: 100,
    },
  );
  const overlayIdeas = toStringArray(editorialInsights.overlayIdeas ?? editorialInsights.overlays, {
    maxItems: 5,
    maxItemLength: 80,
  });
  const cautions = toStringArray(editorialInsights.cautions ?? editorialInsights.notes, {
    maxItems: 4,
    maxItemLength: 120,
  });

  if (
    !shortFormPotential &&
    !pacing &&
    !storyRole &&
    !evidenceStrength &&
    !memoryAnchors.length &&
    !hookMoments.length &&
    !bestFor.length &&
    !avoidFor.length &&
    !recommendedUses.length &&
    !overlayIdeas.length &&
    !cautions.length
  ) {
    return undefined;
  }

  return {
    shortFormPotential:
      shortFormPotential === 'low' ||
      shortFormPotential === 'medium' ||
      shortFormPotential === 'high'
        ? shortFormPotential
        : undefined,
    pacing:
      pacing === 'slow' || pacing === 'steady' || pacing === 'fast' || pacing === 'mixed'
        ? pacing
        : undefined,
    storyRole,
    evidenceStrength:
      evidenceStrength === 'low' || evidenceStrength === 'medium' || evidenceStrength === 'high'
        ? evidenceStrength
        : undefined,
    memoryAnchors: memoryAnchors.length ? memoryAnchors : undefined,
    hookMoments: hookMoments.length ? hookMoments : undefined,
    bestFor: bestFor.length ? bestFor : undefined,
    avoidFor: avoidFor.length ? avoidFor : undefined,
    recommendedUses: recommendedUses.length ? recommendedUses : undefined,
    overlayIdeas: overlayIdeas.length ? overlayIdeas : undefined,
    cautions: cautions.length ? cautions : undefined,
  };
}

const PROOF_SIGNAL_TERMS = [
  'winner',
  'winning',
  'won',
  'award',
  'certificate',
  'announcement',
  'result',
  'results',
  'rank',
  'ranking',
  'trophy',
  'prize',
  'selected',
  'finalist',
];

const PROCESS_SIGNAL_TERMS = [
  'office',
  'desk',
  'laptop',
  'typing',
  'wire',
  'wires',
  'cable',
  'setup',
  'preparation',
  'building',
  'build',
  'prototype',
  'coding',
  'work',
  'working',
  'assembling',
  'testing',
];

function countSignalHits(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term)).length;
}

function deriveFactualSignalText(result: ParsedAnalysisResult): string {
  return [
    result.summary,
    result.analysis,
    ...(result.tags || []),
    ...(result.visualInfo?.visibleTextHighlights || []),
    ...(result.visualInfo?.subjects || []),
    ...(result.scenes || []).flatMap((scene) => [
      scene.description,
      ...(scene.keyElements || []),
      ...(scene.searchHints || []),
      scene.editValue || '',
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function rebalanceEditorialSignals(result: ParsedAnalysisResult): ParsedAnalysisResult {
  const factualText = deriveFactualSignalText(result);
  const proofHits = countSignalHits(factualText, PROOF_SIGNAL_TERMS);
  const processHits = countSignalHits(factualText, PROCESS_SIGNAL_TERMS);
  const hasVisibleProofText = countSignalHits(
    (result.visualInfo?.visibleTextHighlights || []).join(' ').toLowerCase(),
    PROOF_SIGNAL_TERMS,
  );
  const looksLikeProcessOnly = hasVisibleProofText === 0 && proofHits === 0 && processHits >= 2;

  const scenes = result.scenes?.map((scene) => {
    const sceneText = [
      scene.description,
      ...(scene.keyElements || []),
      ...(scene.searchHints || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const sceneProofHits = countSignalHits(sceneText, PROOF_SIGNAL_TERMS);
    const sceneProcessHits = countSignalHits(sceneText, PROCESS_SIGNAL_TERMS);

    if (scene.storyRole === 'proof' && sceneProofHits === 0 && sceneProcessHits >= 1) {
      return { ...scene, storyRole: 'behind_the_scenes' as const };
    }
    return scene;
  });

  if (!looksLikeProcessOnly) {
    return scenes ? { ...result, scenes } : result;
  }

  const editorialInsights: EditorialInsights = {
    ...(result.editorialInsights || {}),
    storyRole: 'behind_the_scenes',
    evidenceStrength: 'low',
  };

  const bestFor = new Set(editorialInsights.bestFor || []);
  bestFor.add('process montage');
  bestFor.add('setup');
  editorialInsights.bestFor = Array.from(bestFor).slice(0, 5);

  const avoidFor = new Set(editorialInsights.avoidFor || []);
  avoidFor.add('proof-first intro');
  editorialInsights.avoidFor = Array.from(avoidFor).slice(0, 5);

  return {
    ...result,
    scenes,
    editorialInsights,
  };
}

function extractJsonPayload(responseText: string): unknown {
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  const directCandidates = [cleaned, cleaned.replace(/,\s*([}\]])/g, '$1')];
  for (const candidate of directCandidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try balanced extraction below.
    }
  }

  const start = cleaned.indexOf('{');
  if (start < 0) {
    throw new Error('No JSON object found in model response');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index++) {
    const char = cleaned[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(start, index + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1'));
        }
      }
    }
  }

  throw new Error('Could not extract a complete JSON object from model response');
}

function normalizeParsedAnalysis(payload: unknown): ParsedAnalysisResult {
  const record = isRecord(payload) ? payload : {};
  const summary =
    toText(record.summary ?? record.overview ?? record.title, 240) || 'No summary available';
  const analysis =
    toText(record.analysis, 1000) ||
    toText(record.details ?? record.observations ?? record.description, 1000) ||
    summary;
  const tags = toStringArray(record.tags ?? record.labels ?? record.keywords, {
    maxItems: 10,
    maxItemLength: 40,
  });
  const scenes = Array.isArray(record.scenes)
    ? record.scenes.map((scene) => normalizeScene(scene)).filter(isDefined)
    : [];
  const audioInfo = normalizeAudioInfo(record.audioInfo);
  const visualInfo = normalizeVisualInfo(record.visualInfo);
  const editorialInsights = normalizeEditorialInsights(record.editorialInsights);

  return rebalanceEditorialSignals({
    summary,
    tags,
    analysis,
    scenes: scenes.length ? scenes : undefined,
    audioInfo,
    visualInfo,
    editorialInsights,
  });
}

/**
 * Parse the JSON analysis response with Zod validation
 */
export function parseAnalysisResponse(responseText: string): ParsedAnalysisResult {
  try {
    const parsed = extractJsonPayload(responseText);
    const normalized = normalizeParsedAnalysis(parsed);
    const result = MediaAnalysisSchema.safeParse(normalized);

    if (!result.success) {
      console.warn('Schema validation failed after normalization:', result.error.format());
      return normalized;
    }

    return result.data;
  } catch (error) {
    console.error('Failed to parse analysis response:', error);
    return {
      summary: 'Analysis parsing failed',
      tags: [],
      analysis: responseText.slice(0, 500),
    };
  }
}

/** Sleep utility */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Analyze a single media file using Bedrock Nova Lite
 *
 * Strategy:
 * - Images: Send as inline bytes via { image: { format, source: { bytes } } }
 * - Videos < 25MB: Send as inline bytes via { video: { format, source: { bytes } } }
 * - Videos > 25MB: Log warning, attempt anyway (may fail — user should clip first)
 * - Audio: Nova Lite doesn't support audio inline — use thumbnail or metadata-only
 * - Retry transient errors with exponential backoff
 */
async function analyzeFile(task: AnalysisTask): Promise<void> {
  if (!isBedrockConfigured()) {
    console.error(' [AI Memory] Bedrock client not configured!');
    useAiMemoryStore
      .getState()
      .updateStatus(
        task.entryId,
        'failed',
        'Bedrock gateway not available. Ensure Electron preload API is active.',
      );
    return;
  }

  const store = useAiMemoryStore.getState();
  store.updateStatus(task.entryId, 'analyzing');

  console.log(
    ` [AI Memory] Starting analysis for "${task.fileName}" (${(task.fileSize / 1024 / 1024).toFixed(2)} MB)`,
  );

  const tier = selectAnalysisTier({
    mediaType: task.mediaType,
    fileSize: task.fileSize,
    duration: task.duration,
    queueDepth: analysisQueue.length,
    activeAnalyses,
  });
  const tierConfig = ANALYSIS_TIER_CONFIG[tier];
  const MAX_RETRIES = tierConfig.maxRetries;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const prompt = getAnalysisPrompt(task.mediaType, task.fileName, tier);

      // Build Bedrock content blocks
      const content: Array<Record<string, unknown>> = [];

      if (task.mediaType === 'image') {
        // Images: always inline bytes
        let base64Data: string | null = null;

        if (task.thumbnailDataUrl) {
          const base64Match = task.thumbnailDataUrl.match(/^data:[^;]+;base64,(.+)$/);
          if (base64Match) {
            base64Data = base64Match[1];
          }
        }

        if (!base64Data) {
          base64Data = await readFileAsBase64(task.filePath);
        }

        if (base64Data) {
          const bytes = base64ToUint8Array(base64Data);
          const format = getMediaFormat(task.mimeType);
          content.push({
            image: { format, source: { bytes } },
          });
        }
      } else if (task.mediaType === 'video') {
        // Videos: inline bytes (< 25MB recommended)
        if (task.fileSize > MAX_INLINE_SIZE) {
          console.warn(
            ` Video "${task.fileName}" is ${(task.fileSize / 1024 / 1024).toFixed(1)}MB — exceeds 25MB inline limit. Using metadata-only analysis.`,
          );
          content.push({
            text: `Large video metadata:
- Name: ${task.fileName}
- Size: ${(task.fileSize / 1024 / 1024).toFixed(1)}MB
- Duration: ${task.duration?.toFixed(2) ?? 'unknown'}s
Provide conservative analysis and explicitly mention limited confidence due to missing inline video bytes.`,
          });
        } else {
          const base64Data = await readFileAsBase64(task.filePath);
          if (base64Data) {
            const bytes = base64ToUint8Array(base64Data);
            const format = getMediaFormat(task.mimeType);
            content.push({
              video: { format, source: { bytes } },
            });
          }
        }
      } else if (task.mediaType === 'audio') {
        // Audio: Nova Lite doesn't support audio inline
        // If we have a thumbnail, send it as an image for visual context
        if (task.thumbnailDataUrl) {
          const base64Match = task.thumbnailDataUrl.match(/^data:[^;]+;base64,(.+)$/);
          if (base64Match) {
            const bytes = base64ToUint8Array(base64Match[1]);
            content.push({
              image: { format: 'jpeg', source: { bytes } },
            });
          }
        }
        // Otherwise, metadata-only analysis
      }

      // If no media parts were added, do metadata-only analysis
      if (content.length === 0) {
        console.log(
          ` No file data available for "${task.fileName}", performing metadata-only analysis`,
        );
      }

      // Add the text prompt
      content.push({ text: prompt });

      console.log(
        ` Analyzing ${task.mediaType}: "${task.fileName}" [tier=${tier}] (attempt ${attempt}/${MAX_RETRIES})...`,
      );

      // Use shared rate limiter
      await waitForSlot();

      const systemPrompt = `<role>
You are a specialized media analysis AI for QuickCut, a professional video editing application.
</role>

<instructions>
1. Analyze the provided media file accurately and thoroughly
2. Extract structured information useful for video editors
3. Be specific and detail-oriented in your analysis
4. You MUST respond with ONLY valid JSON — no markdown, no extra text
5. If text is visible on screen, capture the most important phrases exactly or near-exactly
6. Do not infer audio, speech, or language from visuals alone
7. Optimize the output for later retrieval during AI video editing, not for human prose beauty
</instructions>

<constraints>
- Base analysis strictly on the actual content provided
- Do not speculate or assume information not present
- Verbosity: Medium (detailed but concise)
- Tone: Technical and precise
- Budget tier: ${tier}
</constraints>`;

      const response = await converseBedrock({
        modelId: MODEL_ID,
        messages: [
          {
            role: 'user',
            content,
          },
        ],
        system: [{ text: systemPrompt }],
        inferenceConfig: {
          maxTokens: tierConfig.maxTokens,
          temperature: tierConfig.temperature,
        },
      });

      // Record token usage
      if (response.usage) {
        recordUsage({
          promptTokenCount: response.usage.inputTokens,
          candidatesTokenCount: response.usage.outputTokens,
          totalTokenCount: response.usage.totalTokens,
        });
      }

      const responseText = response.output?.message?.content?.[0]?.text || '';

      if (!responseText) {
        throw new Error('Empty response from Bedrock');
      }

      const parsed = parseAnalysisResponse(responseText);

      // Store the analysis
      store.updateAnalysis(task.entryId, parsed.analysis, parsed.tags, parsed.summary, {
        scenes: parsed.scenes,
        audioInfo: parsed.audioInfo,
        visualInfo: parsed.visualInfo,
        editorialInsights: parsed.editorialInsights,
      });

      console.log(` Analysis complete for "${task.fileName}": ${parsed.summary}`);
      return; // Success — exit retry loop
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMsg = lastError.message;

      // Check if this is a retryable error
      const isRetryable =
        errorMsg.includes('500') ||
        errorMsg.includes('InternalServerException') ||
        errorMsg.includes('503') ||
        errorMsg.includes('ServiceUnavailableException') ||
        errorMsg.includes('ThrottlingException') ||
        errorMsg.includes('overloaded');

      if (isRetryable && attempt < MAX_RETRIES) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000) + Math.random() * 1000;
        console.warn(
          ` Retryable error for "${task.fileName}" (attempt ${attempt}/${MAX_RETRIES}), retrying in ${(backoffMs / 1000).toFixed(1)}s...`,
          errorMsg,
        );
        await sleep(backoffMs);
        continue;
      }

      console.error(` Analysis failed for "${task.fileName}" after ${attempt} attempt(s):`, error);
      store.updateStatus(task.entryId, 'failed', errorMsg);
      return;
    }
  }

  if (lastError) {
    store.updateStatus(task.entryId, 'failed', lastError.message);
  }
}

/**
 * Memory is now saved with project files, not separately to disk
 */
export function saveMemoryToDisk(): void {
  console.log('[Memory Service] Memory is saved with project file');
}

/**
 * Process the analysis queue — sequential with gap between tasks
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  const store = useAiMemoryStore.getState();

  while (analysisQueue.length > 0 && activeAnalyses < MAX_CONCURRENT) {
    const task = analysisQueue.shift();
    if (!task) break;

    activeAnalyses++;
    store.setAnalyzingCount(activeAnalyses);
    store.setAnalyzing(true);

    await analyzeFile(task).finally(() => {
      activeAnalyses--;
      const currentStore = useAiMemoryStore.getState();
      currentStore.setAnalyzingCount(activeAnalyses);

      if (activeAnalyses === 0 && analysisQueue.length === 0) {
        currentStore.setAnalyzing(false);
      }
    });

    // Wait between analyses to avoid rate limits
    if (analysisQueue.length > 0) {
      console.log(
        ` [Rate limit] Waiting 5s before next analysis (${analysisQueue.length} remaining)...`,
      );
      await sleep(5000);
    }
  }

  isProcessingQueue = false;
}

/**
 * Queue a media file for background AI analysis
 * This is the main entry point called when files are imported
 */
export function queueMediaAnalysis(params: {
  filePath: string;
  fileName: string;
  mediaType: 'video' | 'audio' | 'image';
  mimeType: string;
  fileSize: number;
  duration?: number;
  thumbnailDataUrl?: string;
  clipId?: string;
}): string {
  const store = useAiMemoryStore.getState();

  // Check if this file has already been analyzed
  const existing = store.getEntryByFilePath(params.filePath);
  if (existing && existing.status === 'completed') {
    console.log(` "${params.fileName}" already analyzed, skipping`);
    if (params.clipId && !existing.clipId) {
      store.linkClipId(existing.id, params.clipId);
    }
    return existing.id;
  }

  // Determine mime type from extension if not provided
  let mimeType = params.mimeType;
  if (!mimeType) {
    const ext = params.fileName.split('.').pop()?.toLowerCase() || '';
    const mimeMap: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      aac: 'audio/aac',
      flac: 'audio/flac',
      ogg: 'audio/ogg',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
    };
    mimeType = mimeMap[ext] || 'application/octet-stream';
  }

  // Add entry to store
  const entryId = store.addEntry({
    filePath: params.filePath,
    fileName: params.fileName,
    mediaType: params.mediaType,
    mimeType,
    fileSize: params.fileSize,
    duration: params.duration,
    thumbnail: params.thumbnailDataUrl,
    clipId: params.clipId,
  });

  // Queue for analysis
  analysisQueue.push({
    entryId,
    filePath: params.filePath,
    fileName: params.fileName,
    mediaType: params.mediaType,
    mimeType,
    fileSize: params.fileSize,
    duration: params.duration,
    thumbnailDataUrl: params.thumbnailDataUrl,
  });

  console.log(` Queued "${params.fileName}" for AI analysis (${analysisQueue.length} in queue)`);

  processQueue();

  return entryId;
}

/**
 * Retry analysis for a failed entry
 */
export function retryAnalysis(entryId: string): void {
  const store = useAiMemoryStore.getState();
  const entry = store.entries.find((e) => e.id === entryId);
  if (!entry) return;

  store.updateStatus(entryId, 'pending');

  analysisQueue.push({
    entryId,
    filePath: entry.filePath,
    fileName: entry.fileName,
    mediaType: entry.mediaType,
    mimeType: entry.mimeType,
    fileSize: entry.fileSize,
    duration: entry.duration,
    thumbnailDataUrl: entry.thumbnail,
  });

  processQueue();
}

/**
 * Get the memory context string for injecting into AI chat prompts
 */
export function getMemoryForChat(): string {
  return useAiMemoryStore.getState().getMemoryContextString();
}

/**
 * Check if AI Memory service is available
 */
export function isMemoryServiceAvailable(): boolean {
  return isBedrockConfigured();
}
