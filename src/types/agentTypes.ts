/**
 * Agentic Execution Types — Plan → Act → Verify → Iterate
 *
 * Type definitions for the autonomous agent loop that allows the AI
 * to continue executing tool calls without user intervention until
 * the goal is achieved.
 */

export type AgentStepStatus =
  | 'thinking'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'skipped';

export type AgentLoopStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'cost_limit'
  | 'step_limit';

export interface AgentToolCall {
  name: string;
  args: Record<string, unknown>;
  toolUseId?: string;
}

export interface AgentToolResult {
  success: boolean;
  output: string;
  error?: string;
  adjustments?: string[];
}

export interface AgentClarificationRequest {
  question: string;
  options: string[];
  context?: string;
}

export interface AgentStep {
  stepNumber: number;
  status: AgentStepStatus;
  thought: string;
  toolCall: AgentToolCall | null;
  result: AgentToolResult | null;
  verification: AgentVerification | null;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  startedAt: number;
  completedAt?: number;
}

export interface AgentVerification {
  verified: boolean;
  method: 'timeline_check' | 'clip_check' | 'none';
  details?: string;
  discrepancy?: string;
  snapshot?: {
    totalDuration: number;
    clipCount: number;
    gapCount: number;
    totalGapDuration: number;
    targetDuration?: number;
    durationDelta?: number;
    firstClipName?: string;
    strongestSignalEarly?: boolean;
  };
}

export interface AgentLoopConfig {
  maxSteps: number;
  maxCostUsd: number;
  maxDurationMs: number;
  autoApproveReadOnly: boolean;
  autoApproveMutations: boolean;
  verifyAfterMutation: boolean;
  compressContextAfterSteps: number;
  enableDoomLoopDetection: boolean;
  doomLoopThreshold: number;
}

export const DEFAULT_AGENT_LOOP_CONFIG: AgentLoopConfig = {
  maxSteps: 1000,
  maxCostUsd: 1000.0,
  maxDurationMs: 86_400_000,
  autoApproveReadOnly: true,
  autoApproveMutations: true,
  verifyAfterMutation: true,
  compressContextAfterSteps: 5,
  enableDoomLoopDetection: false,
  doomLoopThreshold: 20,
};

export interface AgentLoopState {
  id: string;
  status: AgentLoopStatus;
  steps: AgentStep[];
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  startedAt: number;
  completedAt?: number;
  finalSummary?: string;
  error?: string;
  clarificationRequest?: AgentClarificationRequest;
  config: AgentLoopConfig;
  goalDescription: string;
}

export interface AgentLoopCallbacks {
  onStepStart: (step: AgentStep, loopState: AgentLoopState) => void;
  onStepComplete: (step: AgentStep, loopState: AgentLoopState) => void;
  onLoopComplete: (loopState: AgentLoopState) => void;
  onLoopError: (error: string, loopState: AgentLoopState) => void;
  onCostUpdate: (costUsd: number, loopState: AgentLoopState) => void;
}

export interface AgentLoopInput {
  userMessage: string;
  history: Array<{ role: string; content: unknown[] }>;
  config?: Partial<AgentLoopConfig>;
  callbacks: AgentLoopCallbacks;
  abortSignal?: AbortSignal;
  aliasMap?: Record<string, string>;
  snapshotContext?: string;
  memoryContext?: string;
  channelContext?: string;
  normalizedIntent?: {
    mode: string;
    goals: string[];
    constraints: Record<string, string | number>;
    operationHint: string | null;
    confidence: number;
  };
}

export interface AgentLoopResult {
  state: AgentLoopState;
  steps: AgentStep[];
  finalSummary: string;
  totalCostUsd: number;
  totalSteps: number;
  success: boolean;
  clarificationRequest?: AgentClarificationRequest;
}

/**
 * Context compression helpers
 */
export interface CompressedStepSummary {
  stepNumber: number;
  tool: string;
  success: boolean;
  keyResult: string;
}

/**
 * Routing decision for agentic vs single-pass
 */
export type ExecutionMode = 'single_pass' | 'agentic';

export interface ExecutionModeDecision {
  mode: ExecutionMode;
  reason: string;
  estimatedSteps: number;
  estimatedCostUsd: number;
}

/**
 * Cost tracking per-step
 */
export interface StepCostReport {
  stepNumber: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  cumulativeCostUsd: number;
  budgetRemainingUsd: number;
  budgetUsedPercent: number;
}
