# QuickCut Bedrock AI Cost + Intelligence Master Plan

## Objective
Build the most cost-efficient, reliable, and intelligent Bedrock-only AI runtime for QuickCut by adopting proven Gemini CLI token-discipline patterns and adapting them to QuickCut's video-editing workflow.

## Scope
- Keep provider strictly Amazon Bedrock.
- Optimize chat, planning, tool execution follow-up, media analysis, and captioning paths.
- Improve intelligence quality while reducing token and dollar cost.

## Baseline Findings (Current QuickCut)
Strong existing controls:
- Token/cost preflight and soft/hard budget behavior (`src/lib/costPolicy.ts`).
- Context dedup + truncation + summarize trigger (`src/lib/contextManager.ts`).
- Intent-aware tool disabling for chat-only turns (`src/lib/aiService.ts`).
- In-memory request cache for chat/planning (`src/lib/requestCache.ts`, `src/lib/aiPlanningService.ts`).
- Usage accounting from Bedrock usage metadata (`src/lib/tokenTracker.ts`).

Key gaps vs Gemini CLI-style discipline:
1. No turn-level overflow guard with explicit estimated-request-vs-remaining budget gate per call.
2. No robust tool-output masking/offloading for old bulky tool results.
3. Compression is single-pass only (no summary verification/self-correction pass).
4. No cost-aware model routing/escalation strategy across turn complexity.
5. No persistent AI response cache (process restart loses cache).
6. No unified per-workflow token ceilings and adaptive degradation policy.

## Architecture Targets
1. Deterministic Token Governance
- Introduce a Bedrock token estimator utility used before every Bedrock call.
- Enforce context overflow warning/block behavior with deterministic degradation.

2. Loss-Aware Context Compaction
- Add two-pass compression: summarize then verify/improve.
- Reject inflated compression outcomes and fallback safely.

3. Tool Output Efficiency
- Mask/prune old low-signal bulky tool outputs.
- Preserve latest/high-signal tool outputs and keep reversible references.

4. Adaptive Intelligence Routing
- Route low-complexity turns to lowest-cost suitable Bedrock model.
- Escalate only on explicit complexity/error/retry signals.

5. Durable Cache + Cost Telemetry
- Add project/session aware persisted cache with TTL.
- Track cache hit rates and realized cost savings.

## Phase Plan

### Phase 1: Token Estimator + Overflow Guard (P0)
Goal: prevent oversized/expensive requests before they hit Bedrock.
Status: `completed` (PR #25 merged)

Deliverables:
- New `src/lib/bedrockTokenEstimator.ts`:
  - fast text/token heuristic
  - media token estimates (image/video/audio/document conservative presets)
  - request-level estimator for history + system + dynamic context + user message + tool schema.
- Integrate estimator into:
  - `sendMessageWithHistory`
  - `sendMessageWithHistoryStream`
  - `sendToolResultsToAI`
  - planning rounds in `aiPlanningService`.
- Add overflow policy:
  - if estimated request exceeds safe threshold, degrade context/history/toolset first
  - if still over hard cap, block with actionable error message.
- Add test suite:
  - estimator correctness envelopes
  - guard/degrade behavior
  - hard-block behavior.

Acceptance criteria:
- No Bedrock call proceeds when estimated request exceeds hard cap.
- Degrade path triggers deterministically under pressure.
- Existing behavior preserved for normal-sized requests.

### Phase 2: Tool Output Masking + History Pruning (P0)
Goal: reduce context bloat from older tool outputs.
Status: `completed` (PR #26 merged)

Deliverables:
- New `src/lib/toolOutputMaskingService.ts` adapted for QuickCut Bedrock message shape.
- Backward scan protection window:
  - protect latest turn and recent high-signal tool tokens
  - prune only older bulky outputs beyond threshold.
- Masked placeholder format with concise preview metadata.
- Integrate into pre-send pipeline in `aiService` and planning loops.
- Tests for:
  - threshold triggers
  - preservation of recent outputs
  - no-regression when nothing is prunable.

Acceptance criteria:
- Large historical tool outputs no longer dominate prompt tokens.
- Tool execution correctness unchanged.

### Phase 3: Two-Pass Compression (P0)
Goal: improve compression reliability and reduce summary information loss.
Status: `completed` (PR #27 merged)

Deliverables:
- Extend `summarizeHistory` pipeline to:
  1) generate summary
  2) verification pass asking model to patch omissions.
- Keep compression only if token estimate improves; otherwise keep original.
- Add failure-mode fallback flags to avoid repeated expensive failed compression attempts.
- Tests for:
  - successful two-pass compaction
  - fallback on empty summary
  - fallback when compressed form inflates tokens.

Acceptance criteria:
- Compression quality improves while avoiding inflated context.

### Phase 4: Adaptive Bedrock Model Routing + Escalation (P1)
Goal: pay for stronger models only when needed.
Status: `in_progress`

Deliverables:
- New `src/lib/modelRoutingPolicy.ts`:
  - map intents/complexity/retry state to model tiers.
- Config-driven model ids (e.g. cheap router model, default model, strong planner model).
- Integrate with chat/planning/retry flows.
- Add telemetry fields for selected model + reason.
- Tests for routing decisions and fallback.

Acceptance criteria:
- Low-complexity turns use cheaper model tier.
- Hard tasks/retries escalate deterministically.

### Phase 5: Persistent Request Cache + Semantic Keys (P2)
Goal: maximize reuse across repeated asks and sessions.

Deliverables:
- Extend `requestCache` with persisted store (Electron/localStorage-backed).
- Semantic key enrichment:
  - normalized prompt
  - snapshot hash
  - intent + mode
  - model id + toolset signature.
- Cache policy:
  - bypass mutating execution responses
  - short TTL for volatile contexts
  - longer TTL for stable chat/planning summaries.
- Tests for cache hit/miss, TTL expiry, persistence restore.

Acceptance criteria:
- Repeated equivalent requests hit cache across reloads.
- No stale-response regression on mutating flows.

### Phase 6: Unified Cost Governance + UI/Telemetry (P3)
Goal: make budget behavior explicit, measurable, and safe.

Deliverables:
- Per-workflow budgets (chat/planning/caption/memory) in `costPolicy`.
- Unified cost counters (remove duplicated or stale-derived fields).
- UI updates in token panel/budget controls to surface:
  - estimated turn cost pre-send
  - degrade/block reason
  - cache savings and hit rate.
- Tests for policy boundaries and stats consistency.

Acceptance criteria:
- Cost behavior is predictable and user-visible.
- No mismatch between UI and backend usage accounting.

## Execution Workflow (Per Phase)
For each phase:
1. Create feature branch.
2. Implement code + tests.
3. Run targeted tests and relevant project checks.
4. Open PR with concise summary + risk notes.
5. Merge PR into `main`.
6. Tag phase complete in this plan.

## Test Strategy
- Unit tests for estimator, policy decisions, masking, compression, routing, and cache.
- Integration tests for chat/planning flow envelopes (token/cost budgets).
- Regression tests for tool-execution correctness after optimization.

## Rollout + Guardrails
- Ship phase flags where risk is non-trivial.
- Start with conservative thresholds.
- Monitor telemetry and tune thresholds/model routing after observing real usage.

## Expected Outcome
- 25-40% lower average input tokens.
- 20-35% lower average Bedrock cost per successful task.
- Better long-session stability (fewer context overflows and planner retries).
