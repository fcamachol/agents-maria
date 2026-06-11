// ============================================
// Maria Monitor - Type Definitions
// ============================================

export type StepType =
  | 'workflow_start'
  | 'agent_start'
  | 'tool_call'
  | 'tool_progress'
  | 'tool_result'
  | 'chatwoot_received'
  | 'chatwoot_sending'
  | 'chatwoot_flush'
  | 'response'
  | 'result'
  | 'error'
  | 'workflow_end';

export interface MonitorStepEvent {
  step: StepType;
  conversation_id: string;
  agent_id: string;
  tool_name?: string;
  data: Record<string, unknown>;
  timestamp: string;
  duration_ms?: number;
}

export type SessionStatus = 'active' | 'completed' | 'error';

export interface MonitorSession {
  conversationId: string;
  chatwootConversationId?: number;
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;
  steps: MonitorStepEvent[];
  toolsUsed: string[];
  totalCostUsd?: number;
  durationMs?: number;
  userMessage: string;
}
