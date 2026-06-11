// ============================================
// Maria CEA SDK - Contract Resolver Service
// Extracted from tools.ts — handles translation
// of old SIGE 9-digit contracts to new Hydra numbers
// ============================================

import { hydraQuery } from "./soap-client.js";

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
