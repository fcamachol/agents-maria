// ============================================
// Core: notify — outbound delivery to the customer's WhatsApp via AGORA
//
// Per product decision, links/receipts are pushed to the customer's WhatsApp
// THROUGH AGORA (never SMS, never ElevenLabs' own WhatsApp). Flow:
//   1. resolve the AGORA contact from the contract (searchCustomerByContractCore)
//   2. find an existing WhatsApp conversation for that contact (best-effort create)
//   3. post the message (text/URL in `content`) via sendToChatwoot
//
// NOTE: find/create-conversation is net-new and channel-config dependent (inbox,
// source_id). We find-existing robustly and attempt create as best-effort; on
// failure we return success:false so the caller can tell the user out loud.
// ============================================

import { sendToChatwoot } from "../chatwoot.js";
import { searchCustomerByContractCore } from "./identity.js";
import type { ToolResultObject } from "./types.js";

const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL || "";
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || "";
const CHATWOOT_ACCOUNT_ID = Number(process.env.CHATWOOT_ACCOUNT_ID || "0");
const CHATWOOT_INBOX_ID = Number(process.env.CHATWOOT_INBOX_ID || "0");

interface ChatwootConversationLite {
    id: number;
    status?: string;
    last_activity_at?: number;
}

/** GET the contact's conversations; return the most recently active id, or null. */
async function findContactConversation(accountId: number, contactId: number): Promise<number | null> {
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}/contacts/${contactId}/conversations`;
    try {
        const res = await fetch(url, { headers: { "api_access_token": CHATWOOT_API_TOKEN } });
        if (!res.ok) {
            console.error(`[notify] list conversations error ${res.status}: ${await res.text()}`);
            return null;
        }
        // Chatwoot returns either an array or { payload: [...] } depending on version.
        const body = await res.json() as { payload?: ChatwootConversationLite[] } | ChatwootConversationLite[];
        const list: ChatwootConversationLite[] = Array.isArray(body) ? body : (body.payload || []);
        if (list.length === 0) return null;
        // Prefer the most recently active.
        list.sort((a, b) => (b.last_activity_at || 0) - (a.last_activity_at || 0));
        return list[0].id;
    } catch (error) {
        console.error("[notify] findContactConversation error:", error);
        return null;
    }
}

/** Best-effort create of a conversation for the contact on the configured inbox. */
async function createContactConversation(accountId: number, contactId: number): Promise<number | null> {
    if (!CHATWOOT_INBOX_ID) {
        console.error("[notify] CHATWOOT_INBOX_ID not set — cannot create conversation");
        return null;
    }
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${accountId}/conversations`;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "api_access_token": CHATWOOT_API_TOKEN },
            body: JSON.stringify({ inbox_id: CHATWOOT_INBOX_ID, contact_id: contactId })
        });
        if (!res.ok) {
            console.error(`[notify] create conversation error ${res.status}: ${await res.text()}`);
            return null;
        }
        const data = await res.json() as { id?: number };
        return data.id ?? null;
    } catch (error) {
        console.error("[notify] createContactConversation error:", error);
        return null;
    }
}

/**
 * Send a text/URL message to the WhatsApp of the customer who owns `contrato`,
 * via their AGORA contact + conversation.
 */
export async function sendArtifactToWhatsApp(contrato: string, message: string): Promise<ToolResultObject> {
    if (!CHATWOOT_BASE_URL || !CHATWOOT_API_TOKEN || !CHATWOOT_ACCOUNT_ID) {
        console.error("[notify] AGORA/Chatwoot not configured (BASE_URL/API_TOKEN/ACCOUNT_ID)");
        return { success: false, error: "agora_not_configured" };
    }

    // 1. Resolve the AGORA contact from the contract.
    const lookup = await searchCustomerByContractCore(contrato);
    const customer = (lookup as { customer?: { id?: number; whatsapp?: string | null } }).customer;
    if (!lookup.success || !customer?.id) {
        return { success: false, error: "contact_not_found", contrato };
    }
    const contactId = customer.id;

    // 2. Find (or best-effort create) the WhatsApp conversation.
    let conversationId = await findContactConversation(CHATWOOT_ACCOUNT_ID, contactId);
    if (!conversationId) {
        conversationId = await createContactConversation(CHATWOOT_ACCOUNT_ID, contactId);
    }
    if (!conversationId) {
        return { success: false, error: "no_conversation", contrato, contactId };
    }

    // 3. Post the message.
    const sent = await sendToChatwoot(CHATWOOT_ACCOUNT_ID, conversationId, message);
    if (!sent.success) {
        return { success: false, error: sent.error || "send_failed", contrato, contactId, conversationId };
    }

    return {
        success: true,
        contrato,
        data: { contactId, conversationId, whatsapp: customer.whatsapp ?? null }
    };
}
