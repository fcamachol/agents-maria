// ============================================
// Maria Monitor - Log Parser
// Parses maria-cea-sdk stdout log lines into MonitorStepEvents
// ============================================

import type { MonitorStepEvent, StepType } from './types.js';

// ============================================
// Known tool names (from maria-cea-sdk/src/tools/)
// ============================================

const KNOWN_TOOLS = new Set([
  'get_deuda',
  'get_consumo',
  'get_contrato',
  'get_recibo_pdf',
  'validate_contract_holder',
  'search_customer',
  'create_ticket',
  'create_ticket_direct',
  'get_client_tickets',
  'lookup_ticket_by_folio',
  'update_ticket',
  'handoff_to_human',
  'find_nearest_locations',
  'search_location',
  'reverse_geocode',
  'get_main_office',
  'extract_cea_receipt',
  'getHQOfficeInfo',
]);

// ============================================
// Parsing rules
// ============================================

interface ParseRule {
  regex: RegExp;
  handler: (match: RegExpMatchArray, parser: LogParser) => MonitorStepEvent | null;
}

const RULES: ParseRule[] = [
  // --- Session lifecycle ---
  {
    regex: /^={10} WORKFLOW START ={10}$/,
    handler: (_match, parser) => {
      parser.startNewSession();
      return null; // workflow_start emitted after we get conversationId
    },
  },
  {
    regex: /^ConversationId: (.+)$/,
    handler: (match, parser) => {
      parser.currentConversationId = match[1].trim();
      return parser.makeEvent('workflow_start', {
        conversationId: parser.currentConversationId,
      });
    },
  },
  {
    regex: /^Input: "(.+)"$/,
    handler: (match, parser) => {
      parser.currentUserMessage = match[1].substring(0, 200);
      return parser.makeEvent('workflow_start', {
        userMessage: parser.currentUserMessage,
      });
    },
  },
  {
    regex: /^\[Workflow\] Starting Claude query \(session: ([^,]+), isNew: (.+)\)\.\.\.$/,
    handler: (match, parser) => {
      return parser.makeEvent('agent_start', {
        sessionId: match[1],
        isNewSession: match[2] === 'true',
        model: 'claude-sonnet-4-5-20250929',
      });
    },
  },
  {
    regex: /^\[Workflow\] Translated SIGE (.+) → Hydra (.+)$/,
    handler: (match, parser) => {
      return parser.makeEvent('tool_result', {
        detail: `Translated SIGE ${match[1]} → Hydra ${match[2]}`,
      }, 'contract_resolver');
    },
  },
  {
    regex: /^\[Workflow\] Tools called: \[(.*)?\]$/,
    handler: (match, parser) => {
      const tools = match[1] ? match[1].split(', ').filter(Boolean) : [];
      parser.currentToolsSummary = tools;
      return null; // informational, result event captures this
    },
  },
  {
    regex: /^\[Workflow\] Completed\. Cost: \$(.+)$/,
    handler: (match, parser) => {
      parser.currentCost = parseFloat(match[1]);
      return null; // captured in result event
    },
  },
  {
    regex: /^\[Workflow\] Complete in (\d+)ms$/,
    handler: (match, parser) => {
      const durationMs = parseInt(match[1]);
      return parser.makeEvent('result', {
        durationMs,
        totalCostUsd: parser.currentCost,
        toolsUsed: parser.currentToolsSummary,
      }, undefined, durationMs);
    },
  },
  {
    regex: /^={10} WORKFLOW END ={10}$/,
    handler: (_match, parser) => {
      const event = parser.makeEvent('workflow_end', {});
      parser.endSession();
      return event;
    },
  },

  // --- Errors ---
  {
    regex: /^\[Workflow\] Error:(.*)$/,
    handler: (match, parser) => {
      return parser.makeEvent('error', {
        error: match[1].trim(),
      });
    },
  },
  {
    regex: /^\[Workflow\] BLOCKED: (.+)$/,
    handler: (match, parser) => {
      return parser.makeEvent('error', {
        error: `BLOCKED: ${match[1]}`,
      });
    },
  },

  // --- Chatwoot events ---
  {
    regex: /^\[Chatwoot\] Received message for conv (\d+): "(.+)"$/,
    handler: (match, parser) => {
      const chatwootConvId = parseInt(match[1]);
      parser.currentChatwootConvId = chatwootConvId;
      return parser.makeEvent('chatwoot_received', {
        chatwootConversationId: chatwootConvId,
        messagePreview: match[2].substring(0, 100),
      });
    },
  },
  {
    regex: /^={10} CHATWOOT FLUSH \((\d+) message\(s\)\) ={10}$/,
    handler: (match, parser) => {
      return parser.makeEvent('chatwoot_flush', {
        messageCount: parseInt(match[1]),
      });
    },
  },
  {
    regex: /^\[Chatwoot\] Processing with Maria\.\.\.$/,
    handler: (_match, parser) => {
      return parser.makeEvent('agent_start', {
        source: 'chatwoot',
      });
    },
  },
  {
    regex: /^\[Chatwoot\] Sending (\d+) message\(s\) back\.\.\.$/,
    handler: (match, parser) => {
      return parser.makeEvent('chatwoot_sending', {
        messageCount: parseInt(match[1]),
      });
    },
  },
  {
    regex: /^\[Chatwoot\] Message (\d+)\/(\d+) sent$/,
    handler: (match, parser) => {
      return parser.makeEvent('response', {
        messageSent: `${match[1]}/${match[2]}`,
      });
    },
  },
  {
    regex: /^\[Chatwoot\] Combined text: "(.+)"$/,
    handler: (match, parser) => {
      parser.currentUserMessage = match[1].substring(0, 200);
      return null;
    },
  },
];

// ============================================
// Generic tool call pattern (catches [tool_name] lines)
// ============================================

const TOOL_LOG_REGEX = /^\[(\w+)\] (.+)$/;

// ============================================
// PM2 timestamp prefix pattern
// ============================================

const PM2_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}: ?/;

// ============================================
// LogParser Class
// ============================================

export type EventCallback = (event: MonitorStepEvent) => void;

export class LogParser {
  currentConversationId = '';
  currentUserMessage = '';
  currentCost: number | undefined;
  currentToolsSummary: string[] = [];
  currentChatwootConvId: number | undefined;
  private inWorkflow = false;
  private onEvent: EventCallback;

  constructor(onEvent: EventCallback) {
    this.onEvent = onEvent;
  }

  startNewSession(): void {
    this.currentConversationId = '';
    this.currentUserMessage = '';
    this.currentCost = undefined;
    this.currentToolsSummary = [];
    this.inWorkflow = true;
  }

  endSession(): void {
    this.inWorkflow = false;
  }

  makeEvent(
    step: StepType,
    data: Record<string, unknown>,
    toolName?: string,
    durationMs?: number,
  ): MonitorStepEvent {
    return {
      step,
      conversation_id: this.currentConversationId || 'unknown',
      agent_id: 'maria',
      tool_name: toolName,
      data,
      timestamp: new Date().toISOString(),
      duration_ms: durationMs,
    };
  }

  parseLine(rawLine: string): void {
    // Strip PM2 timestamp prefix if present
    const line = rawLine.replace(PM2_TIMESTAMP_REGEX, '').trim();
    if (!line) return;

    // Try specific rules first
    for (const rule of RULES) {
      const match = line.match(rule.regex);
      if (match) {
        const event = rule.handler(match, this);
        if (event) {
          this.onEvent(event);
        }
        return;
      }
    }

    // Try generic tool call pattern
    const toolMatch = line.match(TOOL_LOG_REGEX);
    if (toolMatch) {
      const toolName = toolMatch[1];
      const detail = toolMatch[2];

      if (KNOWN_TOOLS.has(toolName)) {
        // First log line from a tool = tool_call start
        const isError = detail.toLowerCase().startsWith('error');
        const event = this.makeEvent(
          isError ? 'tool_result' : 'tool_call',
          {
            detail: detail.substring(0, 300),
            ...(isError ? { success: false } : {}),
          },
          toolName,
        );
        this.onEvent(event);
      }
    }
  }
}
