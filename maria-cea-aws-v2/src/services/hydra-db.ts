// ============================================
// Hydra Database Service
// Contract translation (old SIGE → new Hydra)
// ============================================

import pg from "pg";

// ============================================
// Configuration — credentials from env only
// ============================================

const HYDRA_PG_CONFIG = {
    host: process.env.HYDRA_PGHOST,
    port: parseInt(process.env.HYDRA_PGPORT || '5432'),
    user: process.env.HYDRA_PGUSER,
    password: process.env.HYDRA_PGPASSWORD || '',
    database: process.env.HYDRA_PGDATABASE || 'hydradb',
    max: parseInt(process.env.HYDRA_PGPOOL_MAX || '5'),
    ssl: { rejectUnauthorized: false },
};

const hydraPool = new pg.Pool(HYDRA_PG_CONFIG);

async function hydraQuery<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
    const client = await hydraPool.connect();
    try {
        const result = await client.query(query, params);
        return result.rows as T[];
    } finally {
        client.release();
    }
}

// ============================================
// Public API
// ============================================

/**
 * Translates an old 9-digit SIGE contract number to the new 6-digit Hydra number.
 * Returns the new number if found, or null if not in the mapping table.
 */
export async function translateContract(oldContract: string): Promise<string | null> {
    try {
        const trimmed = oldContract.trim();
        if (!/^\d{9}$/.test(trimmed)) return null;

        const rows = await hydraQuery<{ cnttnum: string }>(
            'SELECT cnttnum FROM sige_hydra WHERE cnttrefant = $1 LIMIT 1',
            [trimmed]
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
            console.log(`[resolveContract] Translated SIGE ${trimmed} → Hydra ${translated}`);
            return translated;
        }
        console.log(`[resolveContract] SIGE ${trimmed} not found in mapping, using as-is`);
    }
    return trimmed;
}
