// ============================================
// Chatwoot Context - AsyncLocalStorage
// ============================================

import { AsyncLocalStorage } from "node:async_hooks";

export interface ChatwootContext {
    conversationId?: number;
    contactId?: number;
    inboxId?: number;
}

const contextStorage = new AsyncLocalStorage<ChatwootContext>();

export function runWithChatwootContext<T>(ctx: ChatwootContext, fn: () => T): T {
    return contextStorage.run(ctx, fn);
}

export function getCurrentChatwootContext(): ChatwootContext {
    return contextStorage.getStore() || {};
}
