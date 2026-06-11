// ============================================
// Maria CEA SDK - Contract Resolver Service
// Extracted from tools.ts — handles translation
// of old SIGE 9-digit contracts to new Hydra numbers
// ============================================

import { hydraQuery } from "./soap-client.js";

/** Digit counts we accept as a well-formed contract: 6 = Hydra, 9 = legacy SIGE. */
export const VALID_CONTRACT_LENGTHS = [6, 9];

/**
 * True when `raw` (after stripping non-digits) has a valid contract length.
 * Used to reject malformed numbers (e.g. a mis-spoken 7-digit value) BEFORE
 * they reach the CEA API and come back as a confusing "contrato no encontrado".
 */
export function isValidContractFormat(raw: string): boolean {
    const digits = (raw ?? "").replace(/\D/g, "");
    return VALID_CONTRACT_LENGTHS.includes(digits.length);
}

/**
 * Translates an old 9-digit SIGE contract number to the new 6-digit Hydra number.
 * Returns the new number if found, or null if not in the mapping table.
 */
export async function translateContract(oldContract: string): Promise<string | null> {
    try {
        const rows = await hydraQuery<{ cnttnum: string }>(
            'SELECT cnttnum FROM sige_hydra WHERE cnttrefant = $1 LIMIT 1',
            [oldContract.trim()]
        );
        return rows.length > 0 ? rows[0].cnttnum : null;
    } catch (error) {
        console.error(`[translateContract] Error translating ${oldContract}:`, error);
        return null;
    }
}

/**
 * Auto-translates a contract number if it's a 9-digit SIGE number.
 * Returns the translated Hydra number or the original if not translatable.
 */
export async function resolveContract(contrato: string): Promise<string> {
    const trimmed = contrato.trim();
    if (trimmed.length === 9 && /^\d{9}$/.test(trimmed)) {
        const translated = await translateContract(trimmed);
        if (translated) {
            console.log(`[resolveContract] Translated SIGE ${trimmed} -> Hydra ${translated}`);
            return translated;
        }
        console.log(`[resolveContract] SIGE ${trimmed} not found in mapping, using as-is`);
    }
    return trimmed;
}
