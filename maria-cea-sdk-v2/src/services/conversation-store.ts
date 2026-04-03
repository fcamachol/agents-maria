// ============================================
// Conversation Store - Abstracted for Redis migration
// ============================================

import type { AgentInputItem } from "@openai/agents";
import type { Classification } from "../config/types.js";
import { cfg } from "../config/index.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("conversation-store");

export interface ConversationEntry {
    history: AgentInputItem[];
    lastAccess: Date;
    contractNumber?: string;
    classification?: Classification;
    chatwootConversationId?: number;
    chatwootContactId?: number;
    chatwootInboxId?: number;
}

// Store interface — swap implementation for Redis without changing callers
export interface ConversationStore {
    get(id: string): ConversationEntry;
    size(): number;
    cleanup(): void;
    shutdown(): void;
}

class InMemoryConversationStore implements ConversationStore {
    private store = new Map<string, ConversationEntry>();
    private cleanupTimer: ReturnType<typeof setInterval>;

    constructor() {
        this.cleanupTimer = setInterval(() => this.cleanup(), cfg.CONVERSATION_CLEANUP_MS);
    }

    get(id: string): ConversationEntry {
        const existing = this.store.get(id);
        if (existing) {
            existing.lastAccess = new Date();
            return existing;
        }

        const entry: ConversationEntry = {
            history: [],
            lastAccess: new Date(),
        };
        this.store.set(id, entry);
        return entry;
    }

    size(): number {
        return this.store.size;
    }

    cleanup(): void {
        const now = Date.now();
        let cleaned = 0;
        for (const [id, entry] of this.store.entries()) {
            if (now - entry.lastAccess.getTime() > cfg.CONVERSATION_TTL_MS) {
                this.store.delete(id);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            log.debug({ cleaned, remaining: this.store.size }, "Cleaned expired conversations");
        }
    }

    shutdown(): void {
        clearInterval(this.cleanupTimer);
        this.store.clear();
    }
}

// Export singleton — replace with Redis implementation when ready
export const conversationStore: ConversationStore = new InMemoryConversationStore();
