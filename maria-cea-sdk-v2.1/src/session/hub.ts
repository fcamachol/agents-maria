// ============================================
// Session hub - channel-agnostic customer state, keyed by identity (phone)
//
// This is THE shared state both channels read/write. Voice (Twilio `From`) and
// WhatsApp (AGORA `phone_number`) resolve to the same key, so a contract verified
// or a photo received on one channel is visible to the other.
// ============================================

import { getStore } from "./store.js";
import {
    type Channel,
    type CustomerState,
    type SessionEvent,
    type PendingIntent,
    emptyCustomerState,
} from "./types.js";

const STATE_TTL_SECONDS = 60 * 60;       // 1h, mirrors the text agent's session TTL
const EVENTS_TTL_SECONDS = 60 * 60;
const EVENTS_MAX = 50;

// ============================================
// Identity normalization
// ============================================

/**
 * Canonical identity key. Mexican numbers arrive in many shapes
 * (+52..., 521..., 10-digit local, with spaces/dashes). We key on the LAST 10
 * digits so voice (Twilio) and WhatsApp (AGORA) collapse to the same customer.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10) return null;
    return digits.slice(-10);
}

function stateKey(phone: string): string { return `maria:session:${phone}`; }
function eventsKey(phone: string): string { return `maria:events:${phone}`; }

function now(): number { return Date.now(); }

// ============================================
// State read / write
// ============================================

export async function getState(phone: string): Promise<CustomerState> {
    const store = getStore();
    const raw = await store.get(stateKey(phone));
    if (!raw) return emptyCustomerState(phone, now());
    try {
        const parsed = JSON.parse(raw) as CustomerState;
        // Defensive defaults for forward/backward compatibility.
        parsed.verified = parsed.verified || { whatsapp: [], voice: [] };
        parsed.verified.whatsapp = parsed.verified.whatsapp || [];
        parsed.verified.voice = parsed.verified.voice || [];
        return parsed;
    } catch {
        return emptyCustomerState(phone, now());
    }
}

async function saveState(state: CustomerState): Promise<void> {
    const store = getStore();
    state.updatedAt = now();
    await store.set(stateKey(state.phone), JSON.stringify(state), STATE_TTL_SECONDS);
}

/** Read-modify-write helper. */
async function mutate(phone: string, fn: (s: CustomerState) => void): Promise<CustomerState> {
    const state = await getState(phone);
    fn(state);
    await saveState(state);
    return state;
}

// ============================================
// Identity verification (per channel)
// ============================================

export async function markVerified(phone: string, channel: Channel, contrato: string): Promise<void> {
    await mutate(phone, (s) => {
        const set = new Set(s.verified[channel]);
        set.add(contrato);
        s.verified[channel] = [...set];
    });
    await recordEvent(phone, { channel, type: "verified", payload: { contrato }, ts: now() });
}

export async function isVerified(phone: string, channel: Channel, contrato: string): Promise<boolean> {
    const state = await getState(phone);
    return state.verified[channel].includes(contrato);
}

// ============================================
// Active call registry (so WhatsApp knows a call is live)
// ============================================

export async function setActiveCall(phone: string, conversationId: string): Promise<void> {
    await mutate(phone, (s) => { s.activeCall = { conversationId, startedAt: now() }; });
}

export async function clearActiveCall(phone: string): Promise<void> {
    await mutate(phone, (s) => { delete s.activeCall; });
}

export async function getActiveCall(phone: string): Promise<CustomerState["activeCall"]> {
    return (await getState(phone)).activeCall;
}

// ============================================
// Pending intent (cross-channel "Maria is waiting on X")
// ============================================

export async function setPendingIntent(phone: string, intent: Omit<PendingIntent, "ts">): Promise<void> {
    await mutate(phone, (s) => { s.pendingIntent = { ...intent, ts: now() }; });
}

export async function clearPendingIntent(phone: string): Promise<void> {
    await mutate(phone, (s) => { delete s.pendingIntent; });
}

export async function setContactId(phone: string, contactId: number): Promise<void> {
    await mutate(phone, (s) => { s.contactId = contactId; });
}

// ============================================
// Cross-channel event inbox (scaffold for push-later; usable now for pull)
// ============================================

export async function recordEvent(phone: string, event: SessionEvent): Promise<void> {
    const store = getStore();
    const key = eventsKey(phone);
    await store.rpush(key, JSON.stringify(event));
    await store.expire(key, EVENTS_TTL_SECONDS);
}

export async function readEvents(phone: string, sinceTs = 0): Promise<SessionEvent[]> {
    const store = getStore();
    const raw = await store.lrange(eventsKey(phone), -EVENTS_MAX, -1);
    const events: SessionEvent[] = [];
    for (const r of raw) {
        try {
            const e = JSON.parse(r) as SessionEvent;
            if (e.ts >= sinceTs) events.push(e);
        } catch { /* skip malformed */ }
    }
    return events;
}
