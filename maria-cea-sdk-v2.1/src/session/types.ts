// ============================================
// Session hub - shared cross-channel state types
//
// Maria is channel-agnostic: WhatsApp (AGORA) and voice (ElevenLabs) are thin
// front-ends over shared `core/` logic AND this shared live state, keyed by the
// customer's IDENTITY (phone) rather than by any single channel's conversation.
// ============================================

export type Channel = "whatsapp" | "voice";

export interface ActiveCall {
    /** ElevenLabs conversation_id for the in-progress voice call. */
    conversationId: string;
    startedAt: number;
}

export interface PendingIntent {
    /** e.g. "awaiting_leak_photo", "awaiting_receipt_photo". */
    type: string;
    data?: Record<string, unknown>;
    ts: number;
}

export interface CustomerState {
    /** Canonical identity key (see normalizePhone — last 10 digits). */
    phone: string;
    /**
     * Verified contract numbers, tracked PER CHANNEL. Verification is visible
     * across channels for awareness, but (per product decision) sensitive data
     * on a new channel still requires a fresh titular check — so the gate reads
     * the channel-specific set, not the union.
     */
    verified: { whatsapp: string[]; voice: string[] };
    /** Set while a voice call is live, so the WhatsApp side knows. */
    activeCall?: ActiveCall;
    /** What Maria is currently waiting on (e.g. a photo), cross-channel. */
    pendingIntent?: PendingIntent;
    /** AGORA contact id once resolved (secondary key). */
    contactId?: number;
    updatedAt: number;
}

export interface SessionEvent {
    channel: Channel;
    /** "message" | "media" | "verified" | ... */
    type: string;
    payload: Record<string, unknown>;
    ts: number;
}

export function emptyCustomerState(phone: string, now: number): CustomerState {
    return {
        phone,
        verified: { whatsapp: [], voice: [] },
        updatedAt: now,
    };
}
