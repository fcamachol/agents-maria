// ============================================
// Maria Monitor - Session Store
// Tracks active and completed sessions from parsed log events
// ============================================

import { EventEmitter } from 'node:events';
import type { MonitorStepEvent, MonitorSession } from './types.js';

const MAX_SESSIONS = 500;
const MAX_STEPS_PER_SESSION = 200;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, MonitorSession>();

  constructor() {
    super();
    this.setMaxListeners(100);

    // Periodic cleanup
    setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  addEvent(event: MonitorStepEvent): void {
    const convId = event.conversation_id;
    if (!convId || convId === 'unknown') {
      // For events without a conversation ID, still emit them for the global stream
      this.emit('step', event);
      return;
    }

    let session = this.sessions.get(convId);

    // Create session on workflow_start
    if (!session && (event.step === 'workflow_start' || event.step === 'chatwoot_received')) {
      session = {
        conversationId: convId,
        startedAt: event.timestamp,
        status: 'active',
        steps: [],
        toolsUsed: [],
        userMessage: '',
      };
      this.sessions.set(convId, session);
      this.enforceMaxSessions();
    }

    if (!session) {
      // Event for unknown session -- still emit for global stream
      this.emit('step', event);
      return;
    }

    // Update session based on event type
    switch (event.step) {
      case 'workflow_start':
        session.status = 'active';
        if (event.data.userMessage) {
          session.userMessage = String(event.data.userMessage);
        }
        if (event.data.conversationId) {
          session.conversationId = String(event.data.conversationId);
        }
        break;

      case 'chatwoot_received':
        if (event.data.chatwootConversationId) {
          session.chatwootConversationId = Number(event.data.chatwootConversationId);
        }
        if (event.data.messagePreview && !session.userMessage) {
          session.userMessage = String(event.data.messagePreview);
        }
        break;

      case 'tool_call':
        if (event.tool_name && !session.toolsUsed.includes(event.tool_name)) {
          session.toolsUsed.push(event.tool_name);
        }
        break;

      case 'result':
        session.status = 'completed';
        session.endedAt = event.timestamp;
        if (event.data.totalCostUsd != null) {
          session.totalCostUsd = Number(event.data.totalCostUsd);
        }
        if (event.data.durationMs != null) {
          session.durationMs = Number(event.data.durationMs);
        }
        if (Array.isArray(event.data.toolsUsed)) {
          session.toolsUsed = event.data.toolsUsed as string[];
        }
        break;

      case 'error':
        session.status = 'error';
        session.endedAt = event.timestamp;
        break;

      case 'workflow_end':
        if (session.status === 'active') {
          session.status = 'completed';
        }
        session.endedAt = event.timestamp;
        break;
    }

    // Append step (with limit)
    if (session.steps.length < MAX_STEPS_PER_SESSION) {
      session.steps.push(event);
    }

    // Emit for SSE subscribers
    this.emit('step', event);
  }

  getSessions(): MonitorSession[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }

  getActiveSessions(): MonitorSession[] {
    return this.getSessions().filter(s => s.status === 'active');
  }

  getSession(conversationId: string): MonitorSession | undefined {
    return this.sessions.get(conversationId);
  }

  private enforceMaxSessions(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;

    // Remove oldest completed sessions first
    const sorted = this.getSessions();
    const toRemove = sorted
      .filter(s => s.status !== 'active')
      .slice(MAX_SESSIONS - 50); // keep buffer

    for (const session of toRemove) {
      this.sessions.delete(session.conversationId);
    }
  }

  private cleanup(): void {
    const cutoff = Date.now() - SESSION_MAX_AGE_MS;
    for (const [id, session] of this.sessions.entries()) {
      if (new Date(session.startedAt).getTime() < cutoff) {
        this.sessions.delete(id);
      }
    }
  }
}
