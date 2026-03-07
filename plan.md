# QuickCut Agentic Workflow Plan

## Goal

Make QuickCut's AI editor feel like a real autonomous editing agent:

- It should inspect state, act, verify, and continue without falling back into
  manual approval flows for normal editing requests.
- It should stay cost-efficient even when a request needs many tool calls.
- It should handle Shorts / highlight / hackathon storytelling requests with
  better planning and better editing choices.
- It should be robust under repeated follow-ups, validation edge cases, and
  context growth.

This plan is grounded in:

- Our current runtime:
  - `src/lib/agentRouter.ts`
  - `src/lib/agentLoop.ts`
  - `src/lib/aiPlanningService.ts`
  - `src/lib/aiService.ts`
  - `src/lib/toolExecutor.ts`
  - `src/components/Chat/ChatPanel.tsx`
- Kilo reference runtime:
  - `kilocode/packages/opencode/src/session/prompt.ts`
  - `kilocode/packages/opencode/src/session/processor.ts`
  - `kilocode/packages/opencode/src/session/compaction.ts`
  - `kilocode/packages/opencode/src/tool/batch.ts`
  - `kilocode/packages/opencode/src/tool/task.ts`

## Executive Summary

We already implemented the high-level agentic pattern:

- route request
- choose tool path
- execute
- inspect result
- continue

But our system is still split across too many control planes:

- router
- chat lane
- planner lane
- plan compiler
- execution plan UI
- separate agent loop

Kilo is stronger because the loop is the runtime. Tool execution, retries, step
transitions, finish conditions, and compaction all happen in one place.

Our best path is not to add more prompt logic. It is to reduce architectural
fragmentation and move more intelligence into deterministic runtime control.

## Current State

### What We Already Have

- Request routing between single-pass and agentic:
  - `src/lib/agentRouter.ts`
- A real Bedrock-based step loop with one-tool-per-step semantics:
  - `src/lib/agentLoop.ts`
- Cost guards for agentic runs:
  - `src/lib/agentCostGuard.ts`
- Context optimization, token guards, history summarization, tool exposure
  trimming:
  - `src/lib/aiService.ts`
- Multi-round planner with compile / repair / fallback:
  - `src/lib/aiPlanningService.ts`
  - `src/lib/planCompiler.ts`
  - `src/lib/fallbackPlanGenerator.ts`
- Tool runtime validation and recovery:
  - `src/lib/toolExecutor.ts`
- Timeline-aware macro tools for script/captions:
  - `generate_intro_script_from_timeline`
  - `preview_caption_fit`
  - `apply_script_as_captions`

### What Is Still Weak

1. Runtime fragmentation

- Complex requests can bounce between:
  - plan generation
  - plan validation
  - execution plan UI
  - auto-execute
  - agent loop
- This creates visible failure states that should have been absorbed by the
  runtime.

2. Weak autonomy under validation defects

- Planner/preflight issues can still block execution instead of triggering
  repair/rebuild transparently.

3. Agent loop context still spends too much

- The agent loop builds snapshot/capability context using all tools first, then
  narrows the actual tool set later.
- That wastes tokens on tool descriptions the turn cannot use.

4. Verification is coarse

- Our post-mutation verification mostly means calling `get_timeline_info` again.
- That is useful, but expensive and less precise than local diff-based checks.

5. We do not yet have a safe parallel-read story for the video editor

- Kilo can parallelize independent work with `batch` and `task`.
- Bedrock one-tool-per-step is correct for our loop, but we need local macro
  tools to avoid too many round trips.

6. Shorts / story requests still lean too much on prompt quality

- We improved the prompt path, but the stronger fix is better runtime scoring
  for:
  - clip selection
  - timeline fill strategy
  - story-arc sequencing

## Kilo Comparison

### What Kilo Does Better

1. Unified loop runtime

- `kilocode/packages/opencode/src/session/prompt.ts`
- `kilocode/packages/opencode/src/session/processor.ts`

Kilo keeps:

- step loop
- tool-call handling
- retries
- tool result lifecycle
- finish detection
- abort handling
- per-step telemetry

inside one runtime path.

2. Integrated step lifecycle

Kilo emits and persists:

- reasoning start/end
- tool pending/running/completed/error
- step start/finish
- patch/snapshot state

That makes the loop easier to recover and easier to inspect.

3. Smarter context management

- `kilocode/packages/opencode/src/session/compaction.ts`

Kilo compacts against actual model window and prunes old tool outputs after they
stop being useful.

4. Safe performance tools

- `kilocode/packages/opencode/src/tool/batch.ts`
- `kilocode/packages/opencode/src/tool/task.ts`

Kilo gives the model structured ways to:

- parallelize independent work
- delegate bounded tasks
- avoid bloating the main context

### What We Already Do Better

1. Domain grounding for video editing

- timeline snapshot
- media analysis
- source-bounds repair
- duration target recovery
- caption macro tools

2. Edit-domain cost optimization

- dynamic tool exposure
- history summarization
- descriptor-only media mode
- budget degradation

3. More explicit deterministic repair for some editor-specific failures

- clip bound normalization
- duration expansion fallback
- subtitle preflight normalization

## Design Principles

1. One runtime should own complex autonomous editing.

2. Prompting should guide, not carry correctness.

3. Cost optimization should come from:
   - smaller tool set
   - smaller context
   - fewer LLM round trips
   - more deterministic local work

4. Empty timeline gaps must never count as successful duration fulfillment.

5. The user should almost never see internal repair/planner states for a normal
   autonomous editing task.

6. Macro tools should absorb fragile multi-step edit patterns.

## Target Architecture

### Mode Model

We should keep three effective execution modes:

1. Chat

- no tools
- answer/explain/recommend

2. Direct deterministic edit

- one-shot or short chain
- e.g. mute, split, trim, delete, simple caption apply

3. Unified autonomous edit loop

- state inspect
- act
- verify
- continue
- summarize

Important:

- The planner should become an internal compiler/repair service for the unified
  autonomous edit runtime, not a user-facing main lane for complex tasks.

### Runtime Ownership

Complex edits should go through:

1. intent/router
2. unified autonomous edit runtime
3. internal repair/fallback helpers when needed
4. final summary to user

Not:

1. router
2. planner
3. compile
4. preflight
5. plan UI
6. execute
7. follow-up

## Delivery Phases

## Phase 0 - Baseline, Logging, and Guarded Refactor Setup

Objective:

- Capture current behavior clearly before we change the runtime shape.

Work:

- Add a stable "agent turn transcript" object that records:
  - user goal
  - chosen execution mode
  - tool set exposed
  - model selected
  - per-step token/cost
  - verification result
  - fallback/repair decisions
- Normalize agentic telemetry so planner and loop runs can be compared.
- Add eval fixtures for:
  - 30s Shorts expansion
  - highlight reel
  - script + captions apply
  - follow-up edit after previous agentic turn
  - ambiguous request
  - long-session context growth

Files:

- `src/lib/aiTelemetry.ts`
- `src/stores/useChatStore.ts`
- `src/components/Chat/ChatPanel.tsx`
- `test/integration/agentLoop.integration.test.ts`
- new eval tests under `test/ai-eval/`

Acceptance:

- Every complex turn can be replayed from structured logs.
- We can compare pre/post refactor token usage and failures.

## Phase 1 - Unify Complex Edit Runtime

Objective:

- Make complex edit requests run through one runtime path.

Work:

- Introduce a single `runAutonomousEditTurn()` orchestration entrypoint.
- Route these request classes directly there:
  - target duration
  - highlight reel
  - Shorts / Reels / TikTok
  - "make it better" / optimize / full edit
  - multi-goal edit requests
- Keep the planner as an internal helper for:
  - initial operation draft
  - repair draft
  - deterministic fallback
- Remove user-visible plan blocking for auto-execute-safe autonomous turns.

Files:

- `src/lib/agentRouter.ts`
- `src/components/Chat/ChatPanel.tsx`
- `src/lib/agentLoop.ts`
- `src/lib/aiPlanningService.ts`

Acceptance:

- A normal complex editing request no longer surfaces "Plan needs fixes before
  execution" unless the task is genuinely blocked and needs user clarification.

## Phase 2 - Runtime Repair Ladder

Objective:

- Absorb common failures automatically inside the autonomous loop.

Repair ladder:

1. retry with corrected args
2. refresh timeline state
3. re-resolve aliases
4. downgrade to macro tool
5. call deterministic fallback
6. ask user only if the task is genuinely underspecified

Work:

- Add structured runtime failure taxonomy:
  - invalid_args
  - stale_state
  - missing_asset
  - constraint_violation
  - validation_block
  - model_misplan
- Add runtime decision rules for each category.
- Reuse compiler and preflight logic internally rather than exposing plan
  errors.

Files:

- `src/lib/toolExecutor.ts`
- `src/lib/aiPlanningService.ts`
- `src/lib/agentLoop.ts`
- `src/lib/toolCapabilityMatrix.ts`

Acceptance:

- Common failures become self-healing retries, not user-visible plan stops.

## Phase 3 - Cost Efficiency Pass

Objective:

- Make many-tool-call requests cheaper without weakening autonomy.

Work:

### 3.1 Selected-tools-only context

- Build snapshot capability context from selected tool names, not all tools.
- Maintain separate compact capability views:
  - base read/edit tools
  - caption tools
  - story tools
  - analysis tools

### 3.2 Context pruning for agent loop

- Add loop-local compaction similar in spirit to Kilo:
  - compress old steps
  - prune stale tool outputs
  - preserve only recent tool results in full detail

### 3.3 Macro-tool-first execution

- Prefer local macro tools for common patterns:
  - script to captions
  - duration fill
  - clip scoring for Shorts
  - clip expansion by best available strategy

### 3.4 Token-aware downgrade

- If cost budget is tight:
  - reduce tool set
  - reduce memory context
  - reduce capability matrix size
  - switch to deterministic expansion/scoring helpers

Files:

- `src/lib/agentLoop.ts`
- `src/lib/aiService.ts`
- `src/lib/contextManager.ts`
- `src/lib/contextBudgetPolicy.ts`
- `src/lib/agentCostGuard.ts`
- `src/lib/videoEditingTools.ts`

Acceptance:

- Complex autonomous turns use fewer tokens than today for the same outcome.
- Agent loop context no longer includes unused tool descriptions.

## Phase 4 - Efficient Multi-Tool Strategy Without Breaking Bedrock

Objective:

- Allow efficient work even with Bedrock's one-tool-per-step constraint.

Work:

- Add deterministic local macro tools instead of asking the model to emit many
  raw calls.

Candidate tools:

1. `analyze_timeline_for_shorts`

- returns:
  - strongest hook candidate
  - best proof/demo shot
  - weakest clip sections
  - candidate story arc ordering

2. `fill_timeline_to_duration`

- deterministic strategy:
  - restore source bounds
  - extend stills
  - slow clips moderately
  - duplicate approved clip windows
  - reject blank-gap solutions

3. `apply_shorts_story_package`

- takes structured story blocks and applies:
  - clip trims/order adjustments
  - speed changes
  - caption package

4. `verify_timeline_goal`

- returns explicit success/failure against:
  - target duration
  - no-gap rule
  - subtitle fit
  - clip count / story beat constraints

This is the closest equivalent to getting Kilo-style efficiency while still
honoring Bedrock's single-tool-use message constraint.

Files:

- `src/lib/videoEditingTools.ts`
- `src/lib/toolExecutor.ts`
- `src/lib/agentLoop.ts`

Acceptance:

- A 30s Shorts request can be handled in a few high-value steps, not many
  brittle low-level calls.

## Phase 5 - Verification and Diff-Based Checking

Objective:

- Make the loop smarter about whether a step actually improved the timeline.

Work:

- Add local timeline diff snapshots before and after mutating operations.
- Replace most "call get_timeline_info again" verification with structured diff
  checks.
- Add verification fields:
  - duration delta
  - gap delta
  - subtitle count delta
  - caption readability score delta
  - ordering delta
  - source-bound restoration success

Files:

- `src/stores/useProjectStore.ts`
- `src/lib/agentLoop.ts`
- `src/lib/toolExecutor.ts`
- `src/lib/aiProjectSnapshot.ts`

Acceptance:

- The runtime can tell whether a step helped, hurt, or changed nothing without
  re-reading the whole timeline every time.

## Phase 6 - Shorts / Story Quality Engine

Objective:

- Make the model better at social-video decisions without depending only on
  prompt wording.

Work:

- Add deterministic scoring model for story beats:
  - hook strength
  - human presence
  - proof/demo value
  - payoff value
  - CTA suitability
- Add timeline strategy templates:
  - hackathon win story
  - product demo Short
  - before/after edit
  - highlight montage
- Generate structured story plans before clip edits:
  - beat
  - preferred asset/window
  - target duration
  - preferred caption style

Files:

- `src/lib/toolExecutor.ts`
- `src/lib/strategyPlanner.ts`
- `src/lib/aiPlanningService.ts`
- `src/lib/memoryRetrieval.ts`

Acceptance:

- "make a 30 second yt short about how we won the hackathon" yields story beats
  that feel like:
  - hook
  - build
  - proof/demo
  - payoff
  - CTA not generic ceremony filler.

## Phase 7 - Permissionless Auto-Execution for Safe Autonomous Turns

Objective:

- Keep true autonomy for normal editor requests.

Work:

- Define strict classes of autonomous-safe operations:
  - trim bounds
  - speed adjustments in safe range
  - duplicate/paste into open slot
  - caption macro apply
  - subtitle style update
- Make manual intervention only for:
  - destructive bulk delete
  - export/publish side effects
  - ambiguous target asset
  - missing media

Files:

- `src/lib/executionConfidencePolicy.ts`
- `src/components/Chat/ChatPanel.tsx`
- `src/lib/aiPlanningService.ts`

Acceptance:

- The default editing UX feels like an agent, not a plan reviewer.

## Phase 8 - Parallel Research and Background Work

Objective:

- Add Kilo-like efficiency where it is actually useful.

Work:

- For read-only prep and research:
  - allow background analysis helpers
  - batch independent inspections
- For heavy media understanding:
  - cache media analysis summaries
  - reuse per-clip story scores across follow-ups
- For future architecture:
  - consider sub-agent style analysis workers for:
    - content scoring
    - caption fit
    - publish metadata generation

Important:

- Do not add uncontrolled multi-agent editing first.
- First stabilize single-runtime autonomy.

Files:

- `src/lib/aiService.ts`
- `src/lib/memoryRetrieval.ts`
- `src/lib/toolExecutor.ts`
- future worker helpers if needed

Acceptance:

- Repeated follow-up requests become cheaper because analysis is reused.

## Phase 9 - Evaluation Harness and Exit Criteria

Objective:

- Ensure the refactor improves behavior rather than moving failure around.

### Eval Scenarios

1. "Make this a 30 second YouTube Short"
2. "Make a hackathon win story from these clips"
3. "Apply these captions"
4. "Use the same story but make it 20 seconds"
5. "Now make it more energetic"
6. "Follow-up after previous successful agentic run"
7. "Target duration with still image extension"
8. "Target duration with no stills available"
9. "Long session with many previous tool calls"

### Metrics

- success rate
- user-visible blocking rate
- average tools per successful turn
- average total cost per successful turn
- average retries/repairs
- no-gap success rate for target-duration tasks
- Shorts quality rubric pass rate

Acceptance:

- We should see:
  - fewer user-visible plan/validation blocks
  - lower average cost for successful complex turns
  - higher success rate on Shorts and duration tasks

## Implementation Priority

If we want the highest impact first:

1. Phase 1 - unify complex edit runtime
2. Phase 3.1 - selected-tools-only context
3. Phase 4 - add macro tools for efficient complex edits
4. Phase 5 - diff-based verification
5. Phase 2 - runtime repair ladder
6. Phase 6 - Shorts quality engine

## Immediate Next Sprint

### Sprint A

- Create unified `runAutonomousEditTurn()`
- Route complex edit intents there
- Keep planner internal
- Remove user-visible plan blocking for autonomous-safe turns

### Sprint B

- Build selected-tools-only snapshot/capability context
- Add loop-local context pruning
- Add `verify_timeline_goal`

### Sprint C

- Add `fill_timeline_to_duration`
- Add `analyze_timeline_for_shorts`
- Add deterministic story scoring for hackathon/Shorts use cases

## Concrete Code Targets

Primary targets:

- `src/lib/agentRouter.ts`
- `src/lib/agentLoop.ts`
- `src/lib/aiPlanningService.ts`
- `src/lib/aiService.ts`
- `src/lib/toolExecutor.ts`
- `src/lib/videoEditingTools.ts`
- `src/components/Chat/ChatPanel.tsx`
- `src/stores/useProjectStore.ts`

Reference targets:

- `kilocode/packages/opencode/src/session/prompt.ts`
- `kilocode/packages/opencode/src/session/processor.ts`
- `kilocode/packages/opencode/src/session/compaction.ts`
- `kilocode/packages/opencode/src/tool/batch.ts`
- `kilocode/packages/opencode/src/tool/task.ts`

## Final Outcome We Want

When the user says:

- "make this a 30 second yt short"
- "show how we won the hackathon"
- "arrange it properly and make it best"

the AI should:

1. inspect timeline/media state
2. choose the right editing strategy
3. make real visible-content edits
4. verify the result against the goal
5. continue iterating if needed
6. finish with a clean summary

without:

- exposing plan-review states
- padding duration with blank gaps
- producing generic filler scripts
- needing the user to micromanage every step
- wasting tokens on tools or context it does not need
