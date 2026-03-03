# AI Copilot Hardening Plan (Weak-Model First)

## Goal

Make QuickCut AI behave like a copilot-grade executor even with a weak model by
moving intelligence into deterministic orchestration.

Core idea:

- Model does lightweight reasoning (intent + slot fill + tool selection)
- System does heavy lifting (routing, constraints, compilation, execution
  control, recovery)

## Current Architecture Snapshot (from code review)

- Chat orchestrator/UI state machine:
  - `src/components/Chat/ChatPanel.tsx`
  - Handles intent route, planning, auto-execution, clarification, tool
    follow-up, audit logging.
- Chat inference + tool-plan streaming:
  - `src/lib/aiService.ts`
  - Supports `includeTools` lane, context optimization, budget policy, token
    guard, tool-plan chunks.
- Multi-round planner + compiler + fallback:
  - `src/lib/aiPlanningService.ts`
  - `src/lib/planCompiler.ts`
  - `src/lib/fallbackPlanGenerator.ts`
- Tool runtime + validation:
  - `src/lib/toolExecutor.ts`
  - Large per-tool validation/execution switch with lifecycle hooks.
- Intent and mode shaping:
  - `src/lib/intentClassifier.ts`
  - `src/lib/intentNormalizer.ts`
- Cost, context, memory, routing:
  - `src/lib/costPolicy.ts`
  - `src/lib/contextBudgetPolicy.ts`
  - `src/lib/memoryRetrieval.ts`
  - `src/lib/modelRoutingPolicy.ts`

## Main Gaps (why weak model still misbehaves)

1. Lane separation still soft

- Script generation can still drift into edit lane via context/confirmation
  heuristics.

2. Confirmation semantics are fragile

- Generic "yes/ok" handling can trigger wrong action family.

3. Tool-level behavior is too low-level for weak model

- Weak models struggle to compose many atomic ops correctly (especially
  captions/scripts).

4. Post-tool response can be generic

- Follow-up summaries can dominate instead of delivering user-desired artifact
  (script/captions state).

5. Recovery policy is not uniform

- Some failures retry, others just error out; no unified deterministic repair
  ladder.

6. Evaluation harness is missing

- No scenario suite to prevent regressions in intent/plan/execute transitions.

---

## Delivery Phases

## Phase 0 - Safety Baseline and Observability Stabilization

Objective:

- Freeze current behavior and create measurable baselines.

Changes:

- Add AI flow metrics event schema for every turn transition:
  - `intent_detected`, `lane_selected`, `plan_generated`, `plan_compiled`,
    `plan_executed`, `repair_applied`, `fallback_used`.
- Persist compact event trace per turn.

Files:

- `src/components/Chat/ChatPanel.tsx`
- `src/lib/aiTelemetry.ts`
- `src/stores/useProjectStore.ts` (audit payload extension)

Acceptance:

- Every user turn can be replayed as a deterministic sequence of state
  transitions.

---

## Phase 1 - Hard Lane Architecture (Script Lane vs Edit Lane)

Objective:

- Enforce explicit lane boundaries; no accidental crossovers.

Design:

- Lane A: `script_guidance` (no mutating tools)
- Lane B: `timeline_edit` (tool execution allowed)
- Lane transitions only via structured intents, not generic confirmations.

Changes:

- Introduce explicit lane enum and resolver function:
  - `resolveConversationLane(message, lastAssistantArtifact, context)`
- Make `isExecutionConfirmation` lane-aware.
- For script lane, force `includeTools=false` except explicit "apply to
  timeline" transition.

Files:

- `src/lib/intentClassifier.ts`
- `src/lib/intentNormalizer.ts`
- `src/components/Chat/ChatPanel.tsx`

Acceptance:

- Prompt: "create 16s script" always returns script text.
- Prompt: "yes" after script does nothing unless the prior assistant artifact is
  executable and asks execution question.

---

## Phase 2 - Structured Artifacts and Confirmation Contracts

Objective:

- Replace free-form assistant output ambiguity with machine-readable artifacts.

Design:

- Assistant outputs hidden/embedded artifact metadata:
  - `artifact_type`: `script_draft` | `execution_plan` | `caption_plan`
  - `executable`: boolean
  - `next_actions`: list of explicit actions
- Confirmation parser binds "yes" to exact prior artifact action.

Changes:

- Add artifact metadata on assistant messages.
- Add contract check before executing anything:
  - no matching executable artifact => keep chatting, do not run tools.

Files:

- `src/types/chat.ts`
- `src/stores/useChatStore.ts`
- `src/components/Chat/ChatPanel.tsx`

Acceptance:

- "yes" after pure script draft triggers either:
  - explicit conversion prompt, or
  - mapped action `apply_script_as_captions` if available.

---

## Phase 3 - Macro Tools for Weak Model (High Impact)

Objective:

- Reduce multi-step reasoning burden on weak model.

Add macro tools:

1. `apply_script_as_captions`

- Input: script lines with time windows + style preset
- Internal deterministic splitter/allocator
- Uses `add_subtitle`/`update_subtitle_style` safely

2. `generate_intro_script_from_timeline`

- Input: target duration + tone + objective
- Uses timeline/memory descriptors and outputs structured script blocks

3. `preview_caption_fit`

- Checks timeline overflow, overlap, reading-speed violations

Files:

- `src/lib/videoEditingTools.ts`
- `src/lib/toolExecutor.ts`
- `src/lib/toolCapabilityMatrix.ts`

Acceptance:

- Script-to-caption use case executes with 1 macro call + deterministic sub-ops.

Status (2026-03-03):

- Implemented:
  - `generate_intro_script_from_timeline`
  - `apply_script_as_captions`
  - `preview_caption_fit`
- Added layman-prompt optimizer for script lane to enforce structured outputs.
- Added Phase 3 tests:
  - `test/lib/toolExecutor.phase3.macroTools.test.ts`
  - `test/lib/promptOptimizer.phase3.test.ts`

---

## Phase 4 - Deterministic Plan Compiler v2 (Guardrails as Brain)

Objective:

- Make planner output safe/executable even if model is weak.

Changes:

- Add operation class constraints in compiler:
  - `non_destructive_default=true`
  - `preserve_clip_order` unless explicitly requested
  - timeline duration invariants
- Add semantic rewrite rules:
  - if user intent = script/caption, disallow trim/move/delete by default
- Add "repair pass" before execution:
  - auto-fix or drop unsafe op with reason.

Files:

- `src/lib/planCompiler.ts`
- `src/lib/aiPlanningService.ts`
- `src/lib/fallbackPlanGenerator.ts`

Acceptance:

- For script/caption tasks, compiler rejects destructive ops unless explicit
  user intent includes destructive terms.

Status (2026-03-03):

- Implemented compiler guardrails + repair pass:
  - non-destructive default blocks destructive ops unless explicitly requested
  - preserve clip order default blocks `move_clip` unless explicit reorder
    intent
  - script/caption semantic guard blocks non-caption timeline mutations
  - deterministic bounds repairs (e.g., out-of-range `split_clip` clamped)
- Wired compiler context with `normalizedIntent` + user message in planning
  service.

---

## Phase 5 - Execution Controller and Auto-Recovery Ladder

Objective:

- Standardize failure handling and self-healing.

Recovery ladder:

1. Arg normalization retry
2. Read-only inspect (`get_timeline_info` / `get_clip_details`)
3. Recompile with corrected constraints
4. Fallback read-only recovery plan
5. User-facing concise error with undo-safe state

Changes:

- Central `executeWithRecovery` wrapper around current execution paths.
- Add operation-level retry budget and reason codes.

Files:

- `src/lib/toolExecutor.ts`
- `src/lib/aiPlanningService.ts`
- `src/components/Chat/ChatPanel.tsx`

Acceptance:

- Known transient/validation failures auto-recover without derailing the whole
  turn.

Status (2026-03-03):

- Implemented centralized `executeWithRecovery` in tool executor with reason
  codes and per-operation retry budget.
- Recovery ladder now runs in execution flow:
  1. arg normalization retry
  2. state inspection (`get_timeline_info` / `get_clip_details`)
  3. deterministic constraint repair retry
  4. fallback read-only recovery + recovery-exhausted marker
- `aiPlanningService.executePlan` now uses recovery execution and surfaces
  concise failure + undo-safe messaging.
- Added recovery tests in `test/lib/toolExecutorPolicy.test.ts`.

---

## Phase 6 - Context and Cost Intelligence v2

Objective:

- Improve answer quality under budget with deterministic context packing.

Changes:

- Build context packets by lane:
  - script lane: memory scenes + speech summaries + target duration
  - edit lane: timeline + operation history + selected clips
- Add hard token budget partition:
  - history budget
  - snapshot budget
  - memory budget
  - response budget
- Add cache key features for lane + artifact type.

Files:

- `src/lib/aiService.ts`
- `src/lib/contextManager.ts`
- `src/lib/memoryRetrieval.ts`
- `src/lib/costPolicy.ts`
- `src/lib/requestCache.ts`

Acceptance:

- Lower token use for repetitive script/caption turns while maintaining
  correctness.

---

## Phase 7 - Quality Harness (Copilot-style Regression Suite)

Objective:

- Prevent behavior regressions during fast iteration.

Create scenario suite:

- S1: script-only request => chat output, no tool mutation
- S2: script + explicit apply => caption macro tool invoked
- S3: ambiguous yes/no without executable artifact => no execution
- S4: low-confidence destructive plan => compile block + clarify
- S5: bounds overflow => auto-normalized and safe

Changes:

- Add integration tests for intent->lane->plan->execute chain.
- Add snapshot tests for final assistant response contracts.

Files:

- `test/` (new AI flow tests)
- `src/lib/*` harness helpers

Acceptance:

- All scenarios pass in CI with deterministic outputs/guards.

---

## Phase 8 - UX Parity Polish (Copilot-like Feel)

Objective:

- Make behavior transparent and trustworthy.

Changes:

- Show lane badge per turn: `Script`, `Plan`, `Execute`.
- Show explicit "What I will run" before mutation and "What changed" after.
- Add one-click undo chip after mutating turns.

Files:

- `src/components/Chat/ChatPanel.tsx`
- `src/components/Chat/ChatMessage.tsx`

Acceptance:

- Users can predict system behavior before pressing anything.

---

## Implementation Order (strict)

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8

Reason:

- Lane control + artifacts first, then macro capability, then compiler/recovery,
  then optimization and polish.

---

## Immediate Next Step (start now)

Execute Phase 1 first with a focused PR:

- Add lane resolver
- Harden confirmation gating
- Ensure script-only prompts never enter edit lane unless explicit execution
  action exists

PR exit criteria:

- Reproduce and fix your exact case:
  - Input: "you check the video and create a script for me of 16 seconds..."
  - Output: script draft (chat lane)
  - Input: "yes" afterwards
  - Output: either explicit apply flow or macro caption application request, not
    generic execution summary of unrelated timeline ops.
