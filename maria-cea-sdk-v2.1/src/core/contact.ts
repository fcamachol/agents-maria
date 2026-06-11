// ============================================
// Core: contact — write the caller's name back to the AGORA contact.
//
// Used by the voice post-call webhook: ElevenLabs `data_collection` extracts the
// name the caller gave ("¿Con quién tengo el gusto?"), and we persist it to the
// AGORA contact record via REST (never a direct DB write — client-facing writes
// go through AGORA).
//
// Overwrite policy (shouldWriteName): only fill when the existing AGORA name is
// empty or a non-personal placeholder. We never clobber a real name (e.g. the
// WhatsApp profile name).
// ============================================

const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL || "";
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || "";
const CHATWOOT_ACCOUNT_ID = Number(process.env.CHATWOOT_ACCOUNT_ID || "0");

// Case-insensitive placeholder names that are safe to overwrite.
const PLACEHOLDER_NAMES = new Set([
    "",
    "sin nombre",
    "cliente",
    "usuario",
    "whatsapp",
    "cliente llamada",
    "cliente whatsapp",
]);

/**
 * Title-case + whitespace-normalize a name for storage.
 * "  juan  carlos PÉREZ " -> "Juan Carlos Pérez"
 */
export function normalizeName(raw: string): string {
    return (raw || "")
        .trim()
        .replace(/\s+/g, " ")
        .split(" ")
        .map((w) => (w ? w[0].toLocaleUpperCase("es") + w.slice(1).toLocaleLowerCase("es") : w))
        .join(" ");
}

/**
 * Decide whether the collected name should overwrite the existing AGORA name.
 * Pure + unit-testable.
 *
 * Returns true ONLY when:
 *  - `incoming` (trimmed) has length >= 2 and contains at least one letter; AND
 *  - `existing` is empty/whitespace, OR has no letters (all digits/punctuation),
 *    OR equals the contact's phone (last 10 digits), OR is a known placeholder.
 * Otherwise false — a real name is already present, never clobber it.
 */
export function shouldWriteName(existing: string | null | undefined, incoming: string): boolean {
    const inc = (incoming || "").trim();
    if (inc.length < 2 || !/\p{L}/u.test(inc)) return false;

    const ex = (existing || "").trim();
    if (ex === "") return true;

    // No letters at all (phone number, digits, punctuation) -> overwrite.
    if (!/\p{L}/u.test(ex)) return true;

    // Known generic placeholder -> overwrite.
    if (PLACEHOLDER_NAMES.has(ex.toLocaleLowerCase("es"))) return true;

    // A real, personal name is present -> keep it.
    return false;
}

/**
 * PATCH the AGORA contact's name. Uses the Chatwoot bot token
 * (api_access_token), mirroring sendToChatwoot/updateConversationStatus.
 */
export async function updateAgoraContactName(
    contactId: number,
    name: string
): Promise<{ success: boolean; error?: string }> {
    if (!CHATWOOT_BASE_URL || !CHATWOOT_API_TOKEN || !CHATWOOT_ACCOUNT_ID) {
        console.error("[contact] Missing CHATWOOT_BASE_URL / CHATWOOT_API_TOKEN / CHATWOOT_ACCOUNT_ID");
        return { success: false, error: "AGORA not configured" };
    }

    const clean = normalizeName(name);
    const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/contacts/${contactId}`;

    try {
        console.log(`[contact] Updating contact ${contactId} name -> "${clean}"`);
        const response = await fetch(url, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "api_access_token": CHATWOOT_API_TOKEN,
            },
            body: JSON.stringify({ name: clean }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[contact] PATCH error ${response.status}: ${errorText}`);
            return { success: false, error: `API error: ${response.status}` };
        }

        console.log(`[contact] Contact ${contactId} name updated`);
        return { success: true };
    } catch (error) {
        console.error("[contact] update error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
