# QuickCut AI Runtime Upgrade Plan (Kilo-style Tool-Calling + Turn Orchestration)

## 1. Goal
Build an agent-grade AI runtime for QuickCut chat that behaves like a reliable coding agent (Kilo/OpenCode style), while staying tailored to video editing workflows.

This plan focuses on:
- deterministic planning/execution behavior
- turn-based tool-call lifecycle tracking
- robust follow-up gating (`plan complete -> explicit continue/rebuild`) 
- safer permissions/mode boundaries
- better trust UX (what changed, confidence, rollback)
- observability and regression-proof tests

---

## 2. What We Learned from Kilo (patterns worth copying)

### 2.1 Runtime patterns in Kilo
From `kilocode/packages/opencode/src` and tests:

1. Session Turn lifecycle:
- explicit events: `TurnOpen`, `TurnClose`
- status model: idle/busy/retry
- turn-level handling instead of raw chat stream only

2. Structured message parts:
- `text`, `tool`, `step-start`, `step-finish`, `retry`, `reasoning`
- tool states are typed and explicit: `pending`, `running`, `completed`, `error`

3. Unified tool wrapper and registry:
- central `ToolRegistry`
- all tools executed through a standard wrapper
- hooks around execution (`tool.execute.before` / `tool.execute.after`)
- consistent permission ask path

4. Plan completion signal (`plan_exit`) + follow-up gate:
- planning is considered done only after `plan_exit` completes
- then a clear follow-up action path is presented

5. Strong mode/permission boundaries:
- plan mode and ask mode have constrained permissions
- non-compliant tools are denied by design

6. Test-first reliability:
- dedicated tests for follow-up detection, tool states, retry handling, and turn behavior

### 2.2 Relevant Kilo references
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/tool/registry.ts`
- `packages/opencode/src/tool/plan.ts`
- `packages/opencode/src/tool/question.ts`
- `packages/opencode/src/kilocode/plan-followup.ts`
- `packages/opencode/src/session/index.ts`
- `packages/opencode/test/kilocode/plan-followup.test.ts`
- `packages/opencode/test/kilocode/plan-exit-detection.test.ts`

---

## 3. QuickCut Current State (baseline)

### 3.1 What we already improved
- alias/UUID correctness fixes in planning pipeline
- non-destructive fallback
- truthfulness for `delete_clips`
- context-aware confirmation handling
- telemetry rates and plan confidence UX

### 3.2 Remaining gaps vs Kilo-style reliability
1. No first-class turn model yet (still message-centric in chat store/UI).
2. Tool-call lifecycle in UI is not fully stateful (`pending/running/completed/error` per call).
3. No canonical single execution pipeline across all AI execution paths.
4. No explicit `plan_exit`-style completion marker in QuickCut planner semantics.
5. No mode-level tool restrictions (`ask`, `plan`, `edit`) enforced consistently.
6. No robust retry-state UX for transient provider/runtime failures.
7. Test coverage does not yet model full turn lifecycle and rebuild/retry turn actions.

---

## 4. Target Architecture for QuickCut

## 4.1 Turn-centric runtime model
Introduce explicit Turn objects in chat runtime:
- `turnId`
- `sessionMessageId` (user input message)
- `status`: `idle | planning | awaiting_approval | executing | retry | completed | error | interrupted`
- `parts`: ordered parts (`text`, `tool_call`, `tool_result`, `step_start`, `step_finish`, `error`)
- `startedAt`, `endedAt`

Store in chat state, not only transient component state.

## 4.2 Unified Tool Execution Engine
Create one canonical execution pipeline used by:
- plan auto-execution
- plan manual execution
- ad-hoc tool calls from chat stream

Pipeline stages:
1. preflight normalization
2. permission/mode check
3. execute tool
4. result normalization
5. lifecycle update + telemetry hooks

## 4.3 Plan completion protocol
Introduce explicit planning completion state in QuickCut:
- logical equivalent of `plan_exit`
- planner marks plan as ready only when quality + self-check pass
- UI follow-up options:
  - execute here
  - rebuild from current timeline
  - refine plan

## 4.4 Mode policy layer
Add runtime modes with strict tool capability sets:
- `ask`: read-only tools only
- `plan`: read-only + plan construction metadata updates only
- `edit`: mutating + read-only tools

Mode is stored per turn and validated before every tool call.

---

## 5. Detailed Implementation Plan

## Phase P0-A: Turn Model + Store Refactor (Critical)

### Scope
Add a turn-based state model while keeping existing message model backward-compatible.

### Files
- `src/stores/useChatStore.ts`
- `src/types/chat.ts`
- `src/components/Chat/ChatPanel.tsx`

### Changes
1. Add types:
- `ChatTurn`
- `TurnPart` union (`text`, `tool_call`, `tool_result`, `step_start`, `step_finish`, `error`, `status`)
- `TurnStatus`

2. Store actions:
- `startTurn(userMessageId, mode)`
- `appendTurnPart(turnId, part)`
- `setTurnStatus(turnId, status, retryInfo?)`
- `closeTurn(turnId, reason)`

3. UI updates:
- render grouped turn cards
- show current status badge and elapsed time
- keep old message rendering for compatibility during migration

### Acceptance criteria
- Every edit/planning flow creates exactly one turn.
- Turn status transitions are deterministic and persisted.
- Existing chat messages still render correctly.

---

## Phase P0-B: Unified Tool Runtime Wrapper (Critical)

### Scope
Consolidate execution path and make tool lifecycle observable.

### Files
- `src/lib/toolExecutor.ts`
- `src/lib/aiPlanningService.ts`
- `src/lib/aiService.ts`
- `src/components/Chat/ChatPanel.tsx`

### Changes
1. Add wrapper method:
- `executeToolCallWithLifecycle(call, context)`

2. Wrapper responsibilities:
- emit `tool_call` part (`pending`)
- run validation + normalization
- transition to `running`
- execute
- transition to `completed`/`error`
- normalize outputs (`success`, `errorType`, `recoveryHint`, structured `data`)

3. Replace ad-hoc tool execution in:
- plan execution path
- direct stream tool plan path

4. Add before/after execution hooks (internal events):
- `tool.execute.before`
- `tool.execute.after`

### Acceptance criteria
- No direct tool execution bypasses wrapper.
- All tool calls in UI show lifecycle states.
- Errors include actionable recovery hint.

---

## Phase P0-C: Plan Completion Protocol (`plan_exit` equivalent)

### Scope
Stop ambiguous plan completion and over-looping.

### Files
- `src/lib/aiPlanningService.ts`
- `src/components/Chat/ChatPanel.tsx`
- `src/lib/intentClassifier.ts`

### Changes
1. Add explicit planner completion marker in plan object:
- `planReady: boolean`
- `planReadyReason: string`

2. Mark ready only if:
- compile succeeds
- self-check passes
- confidence above threshold
- preflight valid

3. Follow-up gate UX:
- on ready plans: show `Execute`, `Refine`, `Rebuild`
- short confirmations only map to execute when `planReady=true` and pending turn exists

4. Remove any generic repeated “next steps” fallback text paths.

### Acceptance criteria
- “yes do it” only executes a valid pending ready plan.
- Planner never appears complete without explicit readiness state.
- No repeated generic response loop for execution confirmations.

---

## Phase P0-D: Mode/Permission Policy Layer

### Scope
Kilo-style strict mode gating in QuickCut.

### Files
- `src/lib/toolCapabilityMatrix.ts`
- `src/lib/aiService.ts`
- `src/lib/aiPlanningService.ts`
- `src/lib/toolExecutor.ts`
- `src/stores/useChatStore.ts`

### Changes
1. Add mode enum:
- `ask | plan | edit`

2. Define per-mode allowlist of tool names.

3. Enforce before execution:
- if tool disallowed by mode -> return structured validation error

4. Set mode per turn:
- chat-only informational -> `ask`
- planning generation -> `plan`
- execution turns -> `edit`

### Acceptance criteria
- `ask` mode cannot mutate timeline.
- `plan` mode does not execute timeline mutations.
- disallowed operations are blocked with clear reason.

---

## Phase P1-A: Retry + Transient Error Handling

### Scope
Add robust retry state and UI akin to Kilo’s status model.

### Files
- `src/lib/rateLimiter.ts`
- `src/lib/aiService.ts`
- `src/lib/aiPlanningService.ts`
- `src/components/Chat/ChatPanel.tsx`

### Changes
1. Add retry classifier for transient errors:
- 429, 5xx, network resets/timeouts

2. Add turn status `retry` with countdown metadata:
- attempt number
- next retry timestamp
- reason

3. Show retry indicator in UI while keeping turn open.

4. Cap retry budget and fail gracefully with rebuild action.

### Acceptance criteria
- transient failures produce retry UX, not silent failure.
- max retry budget exits to clear error state.

---

## Phase P1-B: Clarification Question Tool for Video Workflow

### Scope
Mirror Kilo’s `question` tool behavior for ambiguous editing tasks.

### Files
- `src/lib/videoEditingTools.ts`
- `src/lib/toolExecutor.ts`
- `src/components/Chat/ChatPanel.tsx`
- `src/stores/useChatStore.ts`

### Changes
1. Add internal `ask_clarification` tool schema for AI.
2. Render interactive answer chips in chat.
3. Feed selected answers back into the same turn context.
4. Use this for unresolved references (“which clip?”, “which range?”).

### Acceptance criteria
- AI asks structured clarification when required data is missing.
- answers are attached to turn history and reused in next step.

---

## Phase P1-C: Turn-level Timeline Diff + Audit Trail

### Scope
Upgrade trust and debuggability.

### Files
- `src/lib/aiPlanningService.ts`
- `src/stores/useProjectStore.ts`
- `src/components/Chat/ChatPanel.tsx`

### Changes
1. For each completed edit turn, persist:
- pre snapshot hash
- post snapshot hash
- high-level diff summary

2. Add “View full turn audit” UI:
- tool inputs
- tool results
- failures/retries
- final diff summary

### Acceptance criteria
- Every mutating turn has a verifiable audit summary.
- Users can see exactly what changed and why.

---

## Phase P2-A: Planner Prompt + Output Contract Hardening

### Scope
Move toward strict structured planning contracts.

### Files
- `src/lib/aiPlanningService.ts`
- `src/lib/planCompiler.ts`

### Changes
1. Require planner output shape with explicit fields:
- `understanding`
- `operations`
- `riskNotes`
- `planReady`

2. Add compile-time rejection for malformed outputs.
3. Add model correction pass that references exact compile errors.

### Acceptance criteria
- malformed plans never reach UI as executable.
- correction pass resolves common malformed-tool-call cases automatically.

---

## Phase P2-B: Expanded Test Matrix

### Scope
Achieve Kilo-like confidence via scenario-heavy tests.

### Files
- `test/lib/*`
- `test/integration/*`

### Add tests for
1. Turn lifecycle transitions.
2. Tool lifecycle state transitions.
3. Mode gating (`ask`/`plan`/`edit`).
4. Plan readiness gating.
5. Confirmation behavior (`yes do it`) with/without pending ready plan.
6. Retry-state behavior and retry budget exhaustion.
7. Full replay of your real failure scenario transcript.

### Acceptance criteria
- all new tests green in CI
- scenario regression test prevents old failure from returning

---

## 6. Concrete File-by-File Worklist

### High priority
- `src/stores/useChatStore.ts`
  - add turns state + lifecycle actions
- `src/components/Chat/ChatPanel.tsx`
  - turn UI, status badges, retry state, clarification cards, audit view
- `src/lib/aiPlanningService.ts`
  - plan readiness protocol, explicit completion contract, turn hooks, diff persistence
- `src/lib/aiService.ts`
  - unified turn + tool runtime integration, retry status propagation
- `src/lib/toolExecutor.ts`
  - lifecycle wrapper integration and normalized results
- `src/lib/intentClassifier.ts`
  - confirmation handling tied to turn readiness

### Supporting
- `src/lib/toolCapabilityMatrix.ts`
  - per-mode allowlists
- `src/lib/videoEditingTools.ts`
  - clarification tool declaration
- `src/lib/aiTelemetry.ts`
  - turn-level metrics extensions
- `src/types/chat.ts`
  - turn and part type definitions

---

## 7. Observability and Metrics

Existing metrics to retain:
- `plan_compile_fail_rate`
- `fallback_rate`
- `execution_validation_fail_rate`
- `repeat_response_rate`

Add metrics:
- `turn_retry_rate`
- `avg_tools_per_turn`
- `tool_error_rate`
- `mutating_turn_success_rate`
- `clarification_tool_usage_rate`

Target thresholds after rollout:
- `fallback_rate < 5%`
- `execution_validation_fail_rate < 2%`
- `repeat_response_rate < 3%`
- `mutating_turn_success_rate > 95%`

---

## 8. Rollout Strategy

1. Feature flags
- `QC_TURN_RUNTIME_V2`
- `QC_MODE_GATING`
- `QC_CLARIFICATION_TOOL`

2. Incremental activation
- internal/dev only -> beta users -> all users

3. Kill-switch
- one config switch to route back to current stable flow if needed

---

## 9. Risks and Mitigations

1. Increased complexity in ChatPanel
- Mitigation: move turn rendering logic into dedicated components (`TurnCard`, `ToolLifecycleRow`, `RetryBanner`).

2. Backward compatibility of existing messages
- Mitigation: dual rendering support until migration complete.

3. Over-strict mode gating blocks legitimate actions
- Mitigation: log denied tool requests, tune allowlists with telemetry.

4. Provider/model variability in structured planning output
- Mitigation: compiler correction pass + deterministic fallback + tests.

---

## 10. Definition of Done

1. Turn model is first-class and persisted.
2. All tool calls go through lifecycle wrapper.
3. Plan execution only occurs for explicit ready plans.
4. Confirmation flow cannot misfire without pending ready plan.
5. Mode gating enforces safety boundaries.
6. Retry UX and budgets are implemented.
7. Full regression scenario test passes for your reported conversation flow.
8. Build + tests + lint checks pass.

---

## 11. Suggested Execution Sequence

1. P0-A Turn model.
2. P0-B Unified tool runtime.
3. P0-C Plan readiness + follow-up gate.
4. P0-D Mode gating.
5. P1-A Retry UX/status.
6. P1-B Clarification tool.
7. P1-C Audit trail + diff view.
8. P2 prompt contract hardening + expanded tests.

This order gives maximum user-visible reliability early while preserving implementation momentum.
