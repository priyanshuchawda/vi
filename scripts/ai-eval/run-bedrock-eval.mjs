import fs from 'fs/promises';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

loadEnv({ path: path.resolve(process.cwd(), '.env') });

const CASES_PATH = path.resolve(process.cwd(), 'test/ai-eval/cases.json');
const OUTPUT_DIR = path.resolve(process.cwd(), 'test-output/ai-evals');
const VIDEO_TEST_DIR = path.resolve(process.cwd(), 'video_test');

function parseArgs(argv) {
  const args = { caseId: '', model: process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0' };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--case' && argv[i + 1]) args.caseId = argv[++i];
    else if (token === '--model' && argv[i + 1]) args.model = argv[++i];
  }
  return args;
}

function buildDescriptorBlock(files) {
  const rows = files.map((f, idx) => {
    const sizeMb = (f.size / (1024 * 1024)).toFixed(2);
    return `${idx + 1}. ${f.kind} | ${f.name} | ${sizeMb}MB`;
  });
  return `[Media Descriptors]\n${rows.join('\n')}`;
}

async function statMediaFiles() {
  const entries = await fs.readdir(VIDEO_TEST_DIR);
  const selected = [];
  for (const name of entries) {
    const full = path.join(VIDEO_TEST_DIR, name);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    const lower = name.toLowerCase();
    if (lower.endsWith('.jpeg') || lower.endsWith('.jpg')) {
      selected.push({ kind: 'IMAGE', name, path: full, size: stat.size });
    } else if (lower.endsWith('.mp4') || lower.endsWith('.mov')) {
      selected.push({ kind: 'VIDEO', name, path: full, size: stat.size });
    }
  }
  return selected;
}

async function readSmallImageBytes(files) {
  const image = files.filter((f) => f.kind === 'IMAGE').sort((a, b) => a.size - b.size)[0];
  if (!image) return null;
  const bytes = await fs.readFile(image.path);
  return {
    bytes: new Uint8Array(bytes),
    name: image.name,
    format: image.name.toLowerCase().endsWith('.png') ? 'png' : 'jpeg',
  };
}

async function readSmallVideoBytes(files) {
  const video = files.filter((f) => f.kind === 'VIDEO').sort((a, b) => a.size - b.size)[0];
  if (!video) return null;
  const bytes = await fs.readFile(video.path);
  return {
    bytes: new Uint8Array(bytes),
    name: video.name,
    format: 'mp4',
  };
}

function keywordScore(text, expectKeywords = []) {
  const lower = text.toLowerCase();
  const hits = expectKeywords.filter((k) => lower.includes(k.toLowerCase()));
  return {
    hits,
    score: expectKeywords.length === 0 ? 1 : hits.length / expectKeywords.length,
  };
}

function extractJsonObject(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function validateJsonContract(payload, contract, rawText = '') {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reasons: ['not_an_object'] };
  }
  const reasons = [];
  const normalizedRaw = String(rawText || '').trim();
  const hasFence = /```/.test(normalizedRaw);
  if (hasFence) reasons.push('markdown_fence_present');
  for (const key of contract.requiredKeys || []) {
    if (!(key in payload)) reasons.push(`missing:${key}`);
  }
  if (
    Array.isArray(contract.allowedModes) &&
    payload.mode &&
    !contract.allowedModes.includes(payload.mode)
  ) {
    reasons.push(`invalid_mode:${payload.mode}`);
  }
  if (Array.isArray(contract.allowedExecutionRecommendations) && payload.execution_recommendation) {
    if (!contract.allowedExecutionRecommendations.includes(payload.execution_recommendation)) {
      reasons.push(`invalid_execution_recommendation:${payload.execution_recommendation}`);
    }
  }
  if (typeof contract.minOperations === 'number') {
    const count = Array.isArray(payload.operations) ? payload.operations.length : 0;
    if (count < contract.minOperations) reasons.push(`operations_too_few:${count}`);
  }
  if (Array.isArray(contract.requiredOperationNames)) {
    const names = new Set(
      Array.isArray(payload.operations)
        ? payload.operations.map((op) => String(op?.name || '').toLowerCase())
        : [],
    );
    for (const required of contract.requiredOperationNames) {
      if (!names.has(String(required).toLowerCase())) {
        reasons.push(`missing_operation:${required}`);
      }
    }
  }
  if (Array.isArray(contract.allowedOperationNames)) {
    const invalidNames = Array.isArray(payload.operations)
      ? payload.operations
          .map((op) => String(op?.name || '').toLowerCase())
          .filter(
            (name) =>
              name &&
              !contract.allowedOperationNames.map((x) => String(x).toLowerCase()).includes(name),
          )
      : [];
    if (invalidNames.length > 0) {
      reasons.push(`invalid_operation_names:${invalidNames.join('|')}`);
    }
  }
  if (
    'confidence' in payload &&
    (typeof payload.confidence !== 'number' || payload.confidence < 0 || payload.confidence > 1)
  ) {
    reasons.push('invalid_confidence_type_or_range');
  } else if (typeof payload.confidence === 'number') {
    if (typeof contract.minConfidence === 'number' && payload.confidence < contract.minConfidence) {
      reasons.push(`confidence_below_min:${payload.confidence}`);
    }
    if (typeof contract.maxConfidence === 'number' && payload.confidence > contract.maxConfidence) {
      reasons.push(`confidence_above_max:${payload.confidence}`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

function buildJsonContractPrompt(userPrompt) {
  return `${userPrompt}

Return JSON only with this exact shape:
{
  "intent_type": "multi_video_edit",
  "mode": "create|modify|delete",
  "operations": [
    { "order": 1, "name": "trim|merge|transition|other", "detail": "..." }
  ],
  "assumptions": ["..."],
  "ambiguities": ["..."],
  "needs_clarification": true,
  "confidence": 0.0
}

Rules:
- QuickCut context only.
- No markdown, no prose, no code fences.
- Include at least these operations when relevant: trim, merge, transition.
- confidence must be 0..1 and realistically calibrated (not 0 unless impossible).`;
}

function buildCaseSpecificJsonPrompt(selectedCase, userPrompt) {
  if (selectedCase.id === 'descriptor_01_workspace') {
    return `${userPrompt}

Return JSON only with this shape:
{
  "story_goal": "...",
  "edit_order": ["asset_or_segment_1", "asset_or_segment_2", "asset_or_segment_3"],
  "cut_first": ["specific thing 1", "specific thing 2"],
  "timeline_notes": ["note 1", "note 2"],
  "assumptions": ["..."],
  "confidence": 0.0
}

Rules:
- Prefer narrative relevance, not file size.
- Keep concise and execution-oriented.`;
  }
  if (selectedCase.id === 'exec_01_modify_plan_readiness') {
    return `${userPrompt}

Return JSON only with this shape:
{
  "intent_type": "multi_video_edit",
  "mode": "modify",
  "operations": [
    { "order": 1, "name": "trim|transition|merge|other", "target": "clip_alias", "detail": "..." }
  ],
  "assumptions": ["..."],
  "ambiguities": ["..."],
  "needs_clarification": true,
  "confidence": 0.0,
  "execution_recommendation": "auto_execute|preview_required|clarify_required"
}

Rules:
- Use clip aliases (clip_1, clip_2, clip_3) when targets are known.
- Keep operations executable and ordered.
- If ambiguity remains, set needs_clarification true.`;
  }
  if (selectedCase.id === 'intent_02_script_plus_edit_parse') {
    return `${userPrompt}

Return JSON only with this shape:
{
  "intent_type": "multi_video_edit",
  "mode": "create|modify|delete",
  "goals": ["editing_goal", "script_goal"],
  "deliverables": ["edit_plan", "short_script_outline"],
  "assumptions": ["..."],
  "ambiguities": ["..."],
  "needs_clarification": true,
  "confidence": 0.0
}

Rules:
- Intent extraction only (no detailed timeline, no long script).
- Max 2 entries in goals, max 2 entries in deliverables.
- Keep each array item under 6 words.
- Ground only in provided descriptor notes.
- Do not invent unrelated topics or scenes.`;
  }
  return buildJsonContractPrompt(userPrompt);
}

function buildCaseSpecificPlainPrompt(selectedCase, userPrompt) {
  if (selectedCase.id === 'clarify_01_missing_style_reference') {
    return `${userPrompt}

Return exactly:
Clarification: <one sentence question>
1. <option>
2. <option>
3. <option>

Rules:
- exactly one clarification question
- exactly 3 options
- concise`;
  }
  if (selectedCase.id === 'clarify_02_missing_segment_reference') {
    return `${userPrompt}

Return exactly:
Clarification: <one sentence question>
1. <option>
2. <option>
3. <option>

Rules:
- identify segment target ambiguity
- exactly one clarification question
- exactly 3 options`;
  }
  return userPrompt;
}

function buildRepairPrompt(selectedCase, originalPrompt, previousOutput, failures) {
  const contract = selectedCase?.jsonContract
    ? `Contract:\n${JSON.stringify(selectedCase.jsonContract, null, 2)}`
    : '';
  const caseSpecific =
    selectedCase?.id === 'exec_01_modify_plan_readiness'
      ? `Extra requirements:
- execution_recommendation must be one of: auto_execute, preview_required, clarify_required
- include at least 2 ordered operations
- for this prompt, mode should stay "modify"
- if timestamps are not explicit, needs_clarification should usually be true`
      : '';
  return `Your previous output failed validation: ${failures.join(', ')}.
Original task: ${originalPrompt}
${contract}
${caseSpecific}
Previous output:
${previousOutput}

Repair it now and return valid JSON only following the required shape.
Hard format rules:
- Output MUST start with '{' and end with '}'.
- Do NOT use markdown.
- Do NOT use code fences like \`\`\`json.`;
}

async function run() {
  const args = parseArgs(process.argv);
  if (!args.caseId) {
    throw new Error('Usage: node scripts/ai-eval/run-bedrock-eval.mjs --case <case_id>');
  }

  const region = process.env.AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing AWS credentials in .env');
  }

  const allCases = JSON.parse(await fs.readFile(CASES_PATH, 'utf-8'));
  const selectedCase = allCases.find((c) => c.id === args.caseId);
  if (!selectedCase) {
    throw new Error(`Case not found: ${args.caseId}`);
  }

  const mediaFiles = await statMediaFiles();
  const descriptorText = buildDescriptorBlock(mediaFiles);
  const imageBytes = await readSmallImageBytes(mediaFiles);
  const videoBytes = await readSmallVideoBytes(mediaFiles);

  const systemText =
    'You are QuickCut AI assistant. Stay in-product, concise, and execution-oriented. Do not reference external software workflows. ' +
    'Execution policy: for mutating edits, use preview_required when confidence < 0.85; use auto_execute only when confidence >= 0.85 and ambiguity is low; use clarify_required when ambiguity remains.';
  const userBlocks = [];

  const descriptorExtraContext =
    Array.isArray(selectedCase.descriptorContext) && selectedCase.descriptorContext.length > 0
      ? `\n[Descriptor Notes]\n${selectedCase.descriptorContext.map((line, i) => `${i + 1}. ${line}`).join('\n')}\n`
      : '';

  const basePrompt = selectedCase.expectJson
    ? buildCaseSpecificJsonPrompt(selectedCase, selectedCase.prompt)
    : buildCaseSpecificPlainPrompt(selectedCase, selectedCase.prompt);

  if (selectedCase.mode === 'descriptor') {
    userBlocks.push({ text: `${descriptorText}${descriptorExtraContext}\n${basePrompt}` });
  } else if (selectedCase.mode === 'inline_image' && imageBytes) {
    userBlocks.push({
      image: {
        format: imageBytes.format,
        source: { bytes: imageBytes.bytes },
      },
    });
    userBlocks.push({ text: basePrompt });
  } else if (selectedCase.mode === 'inline_video' && videoBytes) {
    userBlocks.push({
      video: {
        format: videoBytes.format,
        source: { bytes: videoBytes.bytes },
      },
    });
    userBlocks.push({ text: basePrompt });
  } else {
    userBlocks.push({ text: basePrompt });
  }

  const client = new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  });

  const command = new ConverseCommand({
    modelId: args.model,
    system: [{ text: systemText }],
    messages: [{ role: 'user', content: userBlocks }],
    inferenceConfig: {
      maxTokens: selectedCase.maxTokens || 180,
      temperature: selectedCase.temperature ?? 0.1,
    },
  });

  const response = await client.send(command);
  let text = (response.output?.message?.content || [])
    .map((part) => part.text || '')
    .join('\n')
    .trim();
  let finalUsage = response.usage || null;
  let formatNormalized = false;
  let jsonPayload = selectedCase.expectJson ? extractJsonObject(text) : null;
  let contractValidation = selectedCase.expectJson
    ? validateJsonContract(jsonPayload, selectedCase.jsonContract || {}, text)
    : { valid: true, reasons: [] };

  if (selectedCase.expectJson && !contractValidation.valid) {
    const repair = await client.send(
      new ConverseCommand({
        modelId: args.model,
        system: [{ text: systemText }],
        messages: [
          {
            role: 'user',
            content: [
              {
                text: buildRepairPrompt(
                  selectedCase,
                  selectedCase.prompt,
                  text,
                  contractValidation.reasons,
                ),
              },
            ],
          },
        ],
        inferenceConfig: {
          maxTokens: 220,
          temperature: 0.1,
        },
      }),
    );
    const repairedText = (repair.output?.message?.content || [])
      .map((part) => part.text || '')
      .join('\n')
      .trim();
    if (repairedText) text = repairedText;
    const mergedUsage = {
      inputTokens: (response.usage?.inputTokens || 0) + (repair.usage?.inputTokens || 0),
      outputTokens: (response.usage?.outputTokens || 0) + (repair.usage?.outputTokens || 0),
      totalTokens: (response.usage?.totalTokens || 0) + (repair.usage?.totalTokens || 0),
    };
    finalUsage = mergedUsage;
    jsonPayload = extractJsonObject(text);
    contractValidation = validateJsonContract(jsonPayload, selectedCase.jsonContract || {}, text);
  }

  if (
    selectedCase.expectJson &&
    !contractValidation.valid &&
    contractValidation.reasons?.every((reason) => reason === 'markdown_fence_present') &&
    jsonPayload
  ) {
    text = JSON.stringify(jsonPayload, null, 2);
    formatNormalized = true;
    contractValidation = validateJsonContract(jsonPayload, selectedCase.jsonContract || {}, text);
  }

  const score = keywordScore(text, selectedCase.expectKeywords || []);
  const result = {
    timestamp: new Date().toISOString(),
    case: selectedCase,
    model: args.model,
    usage: finalUsage,
    output: text,
    jsonPayload,
    contractValidation,
    formatNormalized,
    keywordEvaluation: score,
  };

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, `${selectedCase.id}-${Date.now()}.json`);
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');

  console.log(`Case: ${selectedCase.id}`);
  console.log(`Mode: ${selectedCase.mode}`);
  console.log(`Usage: ${JSON.stringify(finalUsage || {})}`);
  console.log(
    `Keyword score: ${score.score.toFixed(2)} | hits: ${score.hits.join(', ') || 'none'}`,
  );
  if (selectedCase.expectJson) {
    console.log(
      `Contract valid: ${contractValidation.valid ? 'yes' : 'no'}${contractValidation.reasons?.length ? ` | ${contractValidation.reasons.join(', ')}` : ''}`,
    );
  }
  console.log('--- OUTPUT ---');
  console.log(text || '[empty]');
  console.log('--- SAVED ---');
  console.log(outputPath);
}

run().catch((err) => {
  console.error(`AI eval failed: ${err.message}`);
  process.exit(1);
});
