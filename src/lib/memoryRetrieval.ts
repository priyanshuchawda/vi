import type { MediaAnalysisEntry } from '../types/aiMemory';
import { getContextBudgetProfile, type ContextBudgetIntent } from './contextBudgetPolicy';

export interface MemoryRetrievalHit {
  entry: MediaAnalysisEntry;
  score: number;
  reasons: string[];
  matchedScenes: Array<{
    startTime: number;
    endTime: number;
    description: string;
  }>;
  matchedSceneTotal: number;
}

export interface MemoryRetrievalOptions {
  query: string;
  entries: MediaAnalysisEntry[];
  maxEntries?: number;
  maxScenesPerEntry?: number;
  intent?: ContextBudgetIntent;
  onLimitsApplied?: (metrics: { droppedEntries: number; droppedScenes: number }) => void;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s:]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function scoreEntry(
  entry: MediaAnalysisEntry,
  queryTokens: string[],
  query: string,
  maxScenesPerEntry: number,
): MemoryRetrievalHit {
  const reasons: string[] = [];
  let score = 0;

  const haystackParts = [
    entry.fileName,
    entry.summary,
    entry.analysis,
    ...(entry.tags || []),
    entry.visualInfo?.style || '',
    ...(entry.visualInfo?.subjects || []),
    ...(entry.visualInfo?.visibleTextHighlights || []),
    entry.audioInfo?.mood || '',
    entry.audioInfo?.transcriptSummary || '',
    entry.audioInfo?.confidenceNotes || '',
    entry.editorialInsights?.shortFormPotential || '',
    entry.editorialInsights?.pacing || '',
    entry.editorialInsights?.storyRole || '',
    entry.editorialInsights?.evidenceStrength || '',
    ...(entry.editorialInsights?.memoryAnchors || []),
    ...(entry.editorialInsights?.bestFor || []),
    ...(entry.editorialInsights?.avoidFor || []),
    ...(entry.editorialInsights?.hookMoments || []),
    ...(entry.editorialInsights?.recommendedUses || []),
    ...(entry.editorialInsights?.overlayIdeas || []),
    ...(entry.editorialInsights?.cautions || []),
    ...(entry.scenes || []).flatMap((scene) => [
      scene.storyRole || '',
      scene.editValue || '',
      ...(scene.searchHints || []),
    ]),
  ];
  const haystack = haystackParts.join(' ').toLowerCase();

  const matchedTokenCount = queryTokens.filter((token) => haystack.includes(token)).length;
  if (matchedTokenCount > 0) {
    score += matchedTokenCount * 1.8;
    reasons.push(`matched_tokens:${matchedTokenCount}`);
  }

  if (query.includes('short') || query.includes('reel')) {
    if ((entry.duration || 0) > 0 && (entry.duration || 0) <= 45) {
      score += 1.2;
      reasons.push('short_form_duration_match');
    }
    if (entry.editorialInsights?.shortFormPotential === 'high') {
      score += 1.8;
      reasons.push('short_form_potential_high');
    } else if (entry.editorialInsights?.shortFormPotential === 'medium') {
      score += 0.9;
      reasons.push('short_form_potential_medium');
    }
  }

  if (query.includes('script') && entry.audioInfo?.hasSpeech) {
    score += 1.4;
    reasons.push('speech_for_script');
  }

  if (/\b(win|won|winner|winners|hackathon|award|certificate|proof|achievement)\b/.test(query)) {
    const visibleProof =
      (entry.visualInfo?.visibleTextHighlights || []).join(' ').toLowerCase() +
      ' ' +
      (entry.editorialInsights?.storyRole || '') +
      ' ' +
      (entry.editorialInsights?.evidenceStrength || '');
    const proofHits = [
      'winner',
      'winning',
      'award',
      'certificate',
      'hackathon',
      'allknighters',
    ].filter((token) => visibleProof.includes(token)).length;
    if (proofHits > 0) {
      score += proofHits * 1.2;
      reasons.push(`proof_text_hits:${proofHits}`);
    }
    if (
      entry.editorialInsights?.storyRole === 'proof' ||
      entry.editorialInsights?.storyRole === 'payoff'
    ) {
      score += 1.4;
      reasons.push(`story_role:${entry.editorialInsights.storyRole}`);
    }
    if (entry.editorialInsights?.evidenceStrength === 'high') {
      score += 1.4;
      reasons.push('evidence_strength_high');
    } else if (entry.editorialInsights?.evidenceStrength === 'medium') {
      score += 0.7;
      reasons.push('evidence_strength_medium');
    }
  }

  const wantsHighEnergy =
    query.includes('best') ||
    query.includes('highlight') ||
    query.includes('engagement') ||
    query.includes('viral');
  if (wantsHighEnergy) {
    const energeticTags = ['award', 'winner', 'celebration', 'stage', 'crowd', 'highlight'];
    const tagText = (entry.tags || []).join(' ').toLowerCase();
    const energeticHits = energeticTags.filter((tag) => tagText.includes(tag)).length;
    if (energeticHits > 0) {
      score += energeticHits * 1.1;
      reasons.push(`energetic_tag_hits:${energeticHits}`);
    }
  }

  const allSceneHits = (entry.scenes || [])
    .map((scene) => ({
      scene,
      hitCount: queryTokens.filter((token) =>
        String(scene.description || '')
          .toLowerCase()
          .includes(token),
      ).length,
    }))
    .filter((x) => x.hitCount > 0);
  const sceneHits = allSceneHits
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, Math.max(1, maxScenesPerEntry));

  if (sceneHits.length > 0) {
    score += sceneHits.reduce((acc, x) => acc + x.hitCount, 0) * 0.9;
    reasons.push(`scene_hits:${sceneHits.length}`);
  }

  if (/\b(hook|viral|scroll|retention|overlay|caption)\b/.test(query)) {
    const hookSignals =
      (entry.editorialInsights?.hookMoments?.length || 0) +
      (entry.editorialInsights?.overlayIdeas?.length || 0);
    if (hookSignals > 0) {
      score += Math.min(2, hookSignals * 0.5);
      reasons.push(`hook_overlay_signals:${hookSignals}`);
    }
  }

  if (query.includes('video') && entry.mediaType === 'video') score += 0.8;
  if (query.includes('image') && entry.mediaType === 'image') score += 0.8;
  if (query.includes('audio') && entry.mediaType === 'audio') score += 0.8;

  return {
    entry,
    score,
    reasons,
    matchedScenes: sceneHits.map((x) => ({
      startTime: x.scene.startTime,
      endTime: x.scene.endTime,
      description: x.scene.description,
    })),
    matchedSceneTotal: allSceneHits.length,
  };
}

export function retrieveRelevantMemory(options: MemoryRetrievalOptions): MemoryRetrievalHit[] {
  const query = String(options.query || '')
    .trim()
    .toLowerCase();
  if (!query) return [];
  const profile = getContextBudgetProfile(options.intent ?? 'chat');
  const maxEntries = Math.max(1, Math.min(10, options.maxEntries ?? profile.maxRetrievedEntries));
  const maxScenesPerEntry = Math.max(
    1,
    Math.min(4, options.maxScenesPerEntry ?? profile.maxScenesPerEntry),
  );
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  let droppedScenes = 0;

  const scored = options.entries
    .filter((entry) => entry.status === 'completed')
    .map((entry) => scoreEntry(entry, queryTokens, query, maxScenesPerEntry))
    .map((hit) => {
      if (hit.matchedSceneTotal > hit.matchedScenes.length) {
        droppedScenes += hit.matchedSceneTotal - hit.matchedScenes.length;
      }
      return hit;
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.entry.fileName.localeCompare(b.entry.fileName);
    });
  const hits = scored.slice(0, maxEntries);
  options.onLimitsApplied?.({
    droppedEntries: Math.max(0, scored.length - hits.length),
    droppedScenes,
  });

  return hits;
}

export function formatRetrievedMemoryContext(
  hits: MemoryRetrievalHit[],
  query: string,
  maxChars: number = 1400,
): string {
  if (!hits.length) return '';

  const lines: string[] = [];
  lines.push(`<retrieved-memory query="${query.replace(/"/g, "'")}">`);
  lines.push(`Top relevant analyzed assets: ${hits.length}`);

  hits.forEach((hit, index) => {
    const e = hit.entry;
    const durationPart =
      typeof e.duration === 'number' ? ` | duration=${e.duration.toFixed(1)}s` : '';
    lines.push(
      `${index + 1}. ${e.fileName} | type=${e.mediaType}${durationPart} | score=${hit.score.toFixed(2)}`,
    );
    if (e.summary) lines.push(`   summary: ${e.summary}`);
    if (e.tags?.length) lines.push(`   tags: ${e.tags.slice(0, 6).join(', ')}`);
    if (e.editorialInsights?.shortFormPotential) {
      lines.push(`   shorts: ${e.editorialInsights.shortFormPotential}`);
    }
    if (e.editorialInsights?.recommendedUses?.length) {
      lines.push(`   uses: ${e.editorialInsights.recommendedUses.slice(0, 3).join(', ')}`);
    }
    if (e.editorialInsights?.memoryAnchors?.length) {
      lines.push(`   memory: ${e.editorialInsights.memoryAnchors.slice(0, 3).join(' | ')}`);
    }
    if (e.editorialInsights?.storyRole) {
      lines.push(`   role: ${e.editorialInsights.storyRole}`);
    }
    if (e.editorialInsights?.evidenceStrength) {
      lines.push(`   evidence: ${e.editorialInsights.evidenceStrength}`);
    }
    if (e.editorialInsights?.bestFor?.length) {
      lines.push(`   best_for: ${e.editorialInsights.bestFor.slice(0, 2).join(', ')}`);
    }
    if (e.editorialInsights?.overlayIdeas?.length) {
      lines.push(`   overlays: ${e.editorialInsights.overlayIdeas.slice(0, 2).join(' | ')}`);
    }
    if (e.visualInfo?.visibleTextHighlights?.length) {
      lines.push(`   text: ${e.visualInfo.visibleTextHighlights.slice(0, 3).join(' | ')}`);
    }
    if (hit.matchedScenes.length) {
      hit.matchedScenes.forEach((scene) => {
        lines.push(
          `   scene: [${scene.startTime.toFixed(1)}-${scene.endTime.toFixed(1)}] ${scene.description}`,
        );
      });
    }
  });
  lines.push(`Use this retrieved memory for selection, timing, and script grounding.`);
  lines.push(`</retrieved-memory>`);

  const text = lines.join('\n');
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}\n[Retrieved memory truncated for token efficiency]`;
}
