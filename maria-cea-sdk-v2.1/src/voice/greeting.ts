// ============================================
// Voice greeting builder for the conversation-initiation webhook.
//
// If AGORA already knows the caller's name we greet them by first name and skip
// "¿Con quién tengo el gusto?"; otherwise we use the original generic greeting.
// Pure + unit-testable.
// ============================================

/** Generic greeting when the caller's name is unknown (the original first message). */
export const GENERIC_GREETING =
    "¡Hola! Soy María de CEA Querétaro. ¿Con quién tengo el gusto?";

/** Extract a clean, title-cased FIRST name from a full name. "" if none usable. */
export function firstName(fullName: string | null | undefined): string {
    const token = (fullName || "").trim().replace(/\s+/g, " ").split(" ")[0] || "";
    if (token.length < 2 || !/\p{L}/u.test(token)) return "";
    return token[0].toLocaleUpperCase("es") + token.slice(1).toLocaleLowerCase("es");
}

/** Build the greeting. Returns the personalized line if a usable name is given. */
export function buildGreeting(fullName: string | null | undefined): string {
    const name = firstName(fullName);
    if (!name) return GENERIC_GREETING;
    return `¡Hola ${name}! Soy María de CEA Querétaro. ¿En qué te puedo ayudar?`;
}
