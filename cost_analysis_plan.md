# Cost Analysis Plan: QuickCut vs KiloCode

## 1) Goal
Build the lowest-cost, high-quality AI chat/edit pipeline for QuickCut (Bedrock-first), using proven cost controls seen in KiloCode.

---

## 2) Executive Summary

QuickCut already has strong cost controls:
- intent routing (`chat` vs `edit`)
- selective tool exposure
- context dedup + truncation + optional summarize
- capped generation tokens
- retry limits and throttling guard

Main gaps versus Kilo-style cost discipline:
- no pre-request token budget estimator/gate
- no request-level cache for repeated prompts/results
- cost tracking split across multiple systems (store + tokenTracker) and partially stale cache fields
- no explicit per-turn cost budget policy (soft/hard limits with fallback behavior)

Result: QuickCut is good, but not yet "lowest efficient cost" under high usage.

---

## 3) Current QuickCut Cost Mechanics (What Exists)

## Request shaping
- Chat-only path disables tool declarations to reduce prompt size: [src/lib/aiService.ts](/home/priyanshuchawda/Desktop/vid/src/lib/aiService.ts)
- Tool list is narrowed by message content (not all tools every time): [src/lib/aiService.ts](/home/priyanshuchawda/Desktop/vid/src/lib/aiService.ts)
- Planning path has dedicated token cap and bounded rounds: [src/lib/aiPlanningService.ts](/home/priyanshuchawda/Desktop/vid/src/lib/aiPlanningService.ts)

## Context control
- Duplicate context stripping + truncation + summarize trigger: [src/lib/contextManager.ts](/home/priyanshuchawda/Desktop/vid/src/lib/contextManager.ts)
- Dynamic context hard cap (`MAX_DYNAMIC_CONTEXT_CHARS=5000`) in chat/planning: [src/lib/aiService.ts](/home/priyanshuchawda/Desktop/vid/src/lib/aiService.ts), [src/lib/aiPlanningService.ts](/home/priyanshuchawda/Desktop/vid/src/lib/aiPlanningService.ts)

## Token and cost accounting
- Usage recorded from Bedrock `response.usage`: [src/lib/tokenTracker.ts](/home/priyanshuchawda/Desktop/vid/src/lib/tokenTracker.ts)
- UI cost estimate in chat store (Nova Lite pricing constants): [src/stores/useChatStore.ts](/home/priyanshuchawda/Desktop/vid/src/stores/useChatStore.ts)

## Safety limits
- RPM/RPD soft guard and throttling retry: [src/lib/rateLimiter.ts](/home/priyanshuchawda/Desktop/vid/src/lib/rateLimiter.ts)
- Planner retries bounded; fallback plan when compile/quality fails: [src/lib/aiPlanningService.ts](/home/priyanshuchawda/Desktop/vid/src/lib/aiPlanningService.ts), [src/lib/fallbackPlanGenerator.ts](/home/priyanshuchawda/Desktop/vid/src/lib/fallbackPlanGenerator.ts)

---

## 4) KiloCode Cost Mechanics (What They Do Well)

## Aggressive request suppression
- Debounced request pipeline with pending-request reuse (avoids duplicate calls while user types): [AutocompleteInlineCompletionProvider.ts](/home/priyanshuchawda/Desktop/vid/kilocode/packages/kilo-vscode/src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider.ts)

## Cache-first completions
- In-memory LRU cache with exact + fuzzy prefix reuse: [AutocompleteLruCacheInMem.ts](/home/priyanshuchawda/Desktop/vid/kilocode/packages/kilo-vscode/src/services/autocomplete/continuedev/core/autocomplete/util/AutocompleteLruCacheInMem.ts)
- `useCache=true` in defaults: [parameters.ts](/home/priyanshuchawda/Desktop/vid/kilocode/packages/kilo-vscode/src/services/autocomplete/continuedev/core/util/parameters.ts)

## Strict token budgeting before send
- Prompt token budgeting with prefix/suffix split and pruning: [HelperVars.ts](/home/priyanshuchawda/Desktop/vid/kilocode/packages/kilo-vscode/src/services/autocomplete/continuedev/core/autocomplete/util/HelperVars.ts)
- Context-aware prompt trimming to model context length: [templating/index.ts](/home/priyanshuchawda/Desktop/vid/kilocode/packages/kilo-vscode/src/services/autocomplete/continuedev/core/autocomplete/templating/index.ts)
- Snippet token bucket with priorities and early stop: [templating/filtering.ts](/home/priyanshuchawda/Desktop/vid/kilocode/packages/kilo-vscode/src/services/autocomplete/continuedev/core/autocomplete/templating/filtering.ts)

## Usage/cost observability pipeline
- Cost/tokens streamed from backend and accumulated in session UI: [http-client.ts](/home/priyanshuchawda/Desktop/vid/kilocode/packages/kilo-vscode/src/services/cli-backend/http-client.ts), [AutocompleteServiceManager.ts](/home/priyanshuchawda/Desktop/vid/kilocode/packages/kilo-vscode/src/services/autocomplete/AutocompleteServiceManager.ts)
- Session compaction endpoint exposed in product flow: [KiloProvider.ts](/home/priyanshuchawda/Desktop/vid/kilocode/packages/kilo-vscode/src/KiloProvider.ts)

---

## 5) QuickCut vs KiloCode: Cost Comparison Table

| Area | QuickCut Today | KiloCode Today | Gap |
|---|---|---|---|
| Request suppression | Retry + rate limiter | Debounce + pending request reuse + skip heuristics | QuickCut lacks debounce/reuse layer for conversational bursts |
| Prompt cache | No request-level response cache | LRU cache (`useCache`) with fuzzy prefix reuse | High-value gap for repeated asks and iterative edits |
| Token budget before send | Char caps + history optimizer | Token-accurate preflight budget + pruning | QuickCut is less deterministic on worst-case token spend |
| Context compaction control | Auto summarize on thresholds | Explicit compact operation + backend support | QuickCut lacks user-visible/manual compact action |
| Tool schema payload cost | Intent-based selective tools | Not tool-heavy in autocomplete path | QuickCut still pays tool schema cost on tool-enabled turns |
| Cost telemetry | Session stats + estimates | Request usage + session accumulation from backend | QuickCut has split accounting and partial stale fields |
| Hard cost governance | Soft RPD warning | Strong request discipline in pipeline | QuickCut lacks hard per-turn/per-session budget policies |

---

## 6) Inefficiencies/Risks in QuickCut

1. No preflight token estimator gate before Bedrock call.
2. No semantic/prompt cache for repeated plan generation or repeated Q&A on same timeline state.
3. Dual accounting paths (`useChatStore` vs `tokenTracker`) can drift.
4. Cached-token UI fields are exposed though Bedrock cache usage is not implemented in the current request path.
5. Planning can consume multiple rounds; no adaptive round budget based on task complexity/cost pressure.
6. Memory analysis path uses high `maxTokens` and retries; no dynamic quality tier when budget pressure is high.

---

## 7) Cost Model (Nova Lite)

Current pricing used in app logic:
- input: `$0.06 / 1M`
- output: `$0.24 / 1M`

Formula per request:
- `cost = (input_tokens / 1_000_000 * 0.06) + (output_tokens / 1_000_000 * 0.24)`

Practical implication:
- Output tokens are 4x costlier than input tokens.
- Biggest savings come from:
  1. lowering response caps where quality allows
  2. avoiding extra turns/retries
  3. caching repeated work

---

## 8) Optimization Plan (Phased)

## Phase C1 (High impact, low/medium effort)
1. Add token preflight estimator
   - Estimate tokens for `history + dynamic context + message + tool schema`.
   - If over budget, apply deterministic reductions before sending:
     - shrink snapshot scope
     - prune older turns more aggressively
     - disable non-essential tool declarations
2. Add request fingerprint cache for chat/planning
   - Key: `intent + model + normalized user msg + snapshot hash + selected tools`.
   - TTL:
     - chat answers: 2-10 min
     - plan drafts: 30-120 sec
   - Auto-bypass cache for mutating execution results.
3. Unify accounting
   - Single source of truth for session usage/cost.
   - Remove/disable unsupported cached-token UI fields unless real cache metrics exist.

## Phase C2 (High impact, medium effort)
1. Adaptive model/tokens policy
   - chat-only turns: optional lower-cost model tier (config-gated).
   - plan turns: keep stronger model/tokens, but dynamic max output cap by complexity.
2. Adaptive planning rounds
   - default 2 rounds, escalate to 3 only when unresolved dependencies remain.
   - correction retry only if compile error category is recoverable.
3. Budget-aware memory analysis tiers
   - low/standard/high analysis modes with token caps and media sampling policy.

## Phase C3 (Medium impact, medium effort)
1. Manual "Compact Context" UX action for chat session.
2. Budget policy controls in settings
   - per-turn max estimated cost
   - per-session soft/hard cap
   - behavior on cap: ask, degrade, or block.
3. Cost regression tests
   - assert max token/cost envelopes for key flows (chat, plan, execute, rebuild).

---

## 9) Engineering Tasks (Concrete)

1. Create `costPolicy.ts`
   - `estimateTurnCost()`
   - `shouldDegradeContext()`
   - `shouldBlockTurn()`
2. Add `requestCache.ts`
   - in-memory LRU + optional persisted cache
   - fingerprint utilities using snapshot hash
3. Refactor `aiService.ts` and `aiPlanningService.ts`
   - preflight estimator hook
   - cache lookup/write
   - adaptive caps and round budgeting
4. Refactor chat stats
   - unify token usage accumulation path
   - remove fake cached savings display unless backed by real metrics
5. Add tests
   - cache hit behavior
   - estimator degradation behavior
   - budget cap enforcement
   - no-regression execution correctness

---

## 10) Success Metrics

Primary:
- 25-40% reduction in average input tokens per turn
- 20-35% reduction in average cost per successful task
- no decrease in execution success rate

Secondary:
- fewer >2 round planning turns
- lower retry frequency
- faster median turn completion

---

## 11) Recommended Next PR Sequence

1. [x] PR-C1A: token preflight estimator + degradation policy
2. [x] PR-C1B: request fingerprint cache (chat + planning)
3. [x] PR-C1C: unified usage/cost accounting and UI cleanup
4. [x] PR-C2A: adaptive planning rounds + correction retry gate
5. [ ] PR-C2B: budget-aware memory analysis tiers
6. [ ] PR-C3A: manual compact action + budget settings
