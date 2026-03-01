import type { MediaAnalysisEntry } from "../types/aiMemory";

export interface MemoryRetrievalHit {
  entry: MediaAnalysisEntry;
  score: number;
  reasons: string[];
  matchedScenes: Array<{
    startTime: number;
    endTime: number;
    description: string;
  }>;
}

export interface MemoryRetrievalOptions {
  query: string;
  entries: MediaAnalysisEntry[];
  maxEntries?: number;
  maxScenesPerEntry?: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s:]/g, " ")
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
    entry.visualInfo?.style || "",
    ...(entry.visualInfo?.subjects || []),
    entry.audioInfo?.mood || "",
    entry.audioInfo?.transcriptSummary || "",
  ];
  const haystack = haystackParts.join(" ").toLowerCase();

  const matchedTokenCount = queryTokens.filter((token) => haystack.includes(token)).length;
  if (matchedTokenCount > 0) {
    score += matchedTokenCount * 1.8;
    reasons.push(`matched_tokens:${matchedTokenCount}`);
  }

  if (query.includes("short") || query.includes("reel")) {
    if ((entry.duration || 0) > 0 && (entry.duration || 0) <= 45) {
      score += 1.2;
      reasons.push("short_form_duration_match");
    }
  }

  if (query.includes("script") && entry.audioInfo?.hasSpeech) {
    score += 1.4;
    reasons.push("speech_for_script");
  }

  const wantsHighEnergy =
    query.includes("best") ||
    query.includes("highlight") ||
    query.includes("engagement") ||
    query.includes("viral");
  if (wantsHighEnergy) {
    const energeticTags = ["award", "winner", "celebration", "stage", "crowd", "highlight"];
    const tagText = (entry.tags || []).join(" ").toLowerCase();
    const energeticHits = energeticTags.filter((tag) => tagText.includes(tag)).length;
    if (energeticHits > 0) {
      score += energeticHits * 1.1;
      reasons.push(`energetic_tag_hits:${energeticHits}`);
    }
  }

  const sceneHits = (entry.scenes || [])
    .map((scene) => ({
      scene,
      hitCount: queryTokens.filter((token) =>
        String(scene.description || "").toLowerCase().includes(token),
      ).length,
    }))
    .filter((x) => x.hitCount > 0)
    .sort((a, b) => b.hitCount - a.hitCount)
    .slice(0, Math.max(1, maxScenesPerEntry));

  if (sceneHits.length > 0) {
    score += sceneHits.reduce((acc, x) => acc + x.hitCount, 0) * 0.9;
    reasons.push(`scene_hits:${sceneHits.length}`);
  }

  if (query.includes("video") && entry.mediaType === "video") score += 0.8;
  if (query.includes("image") && entry.mediaType === "image") score += 0.8;
  if (query.includes("audio") && entry.mediaType === "audio") score += 0.8;

  return {
    entry,
    score,
    reasons,
    matchedScenes: sceneHits.map((x) => ({
      startTime: x.scene.startTime,
      endTime: x.scene.endTime,
      description: x.scene.description,
    })),
  };
}

export function retrieveRelevantMemory(options: MemoryRetrievalOptions): MemoryRetrievalHit[] {
  const query = String(options.query || "").trim().toLowerCase();
  if (!query) return [];
  const maxEntries = Math.max(1, Math.min(10, options.maxEntries ?? 5));
  const maxScenesPerEntry = Math.max(1, Math.min(4, options.maxScenesPerEntry ?? 2));
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const hits = options.entries
    .filter((entry) => entry.status === "completed")
    .map((entry) => scoreEntry(entry, queryTokens, query, maxScenesPerEntry))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxEntries);

  return hits;
}

export function formatRetrievedMemoryContext(
  hits: MemoryRetrievalHit[],
  query: string,
  maxChars: number = 1400,
): string {
  if (!hits.length) return "";

  const lines: string[] = [];
  lines.push(`<retrieved-memory query="${query.replace(/"/g, "'")}">`);
  lines.push(`Top relevant analyzed assets: ${hits.length}`);

  hits.forEach((hit, index) => {
    const e = hit.entry;
    const durationPart = typeof e.duration === "number" ? ` | duration=${e.duration.toFixed(1)}s` : "";
    lines.push(
      `${index + 1}. ${e.fileName} | type=${e.mediaType}${durationPart} | score=${hit.score.toFixed(2)}`,
    );
    if (e.summary) lines.push(`   summary: ${e.summary}`);
    if (e.tags?.length) lines.push(`   tags: ${e.tags.slice(0, 6).join(", ")}`);
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

  const text = lines.join("\n");
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}\n[Retrieved memory truncated for token efficiency]`;
}
