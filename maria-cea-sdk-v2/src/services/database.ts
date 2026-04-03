// ============================================
// Database Service - PostgreSQL with health checks
// ============================================

import pg from "pg";
import { cfg } from "../config/index.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("database");

const pool = new pg.Pool({
    host: cfg.PGHOST,
    port: cfg.PGPORT,
    user: cfg.PGUSER,
    password: cfg.PGPASSWORD,
    database: cfg.PGDATABASE,
    max: cfg.PGPOOL_MAX,
});

pool.on("error", (err) => {
    log.error({ err }, "Unexpected PostgreSQL pool error");
});

export async function pgQuery<T = Record<string, unknown>>(
    query: string,
    params?: unknown[]
): Promise<T[]> {
    const client = await pool.connect();
    try {
        const result = await client.query(query, params);
        return result.rows as T[];
    } finally {
        client.release();
    }
}

export async function checkDatabaseHealth(): Promise<boolean> {
    try {
        await pgQuery("SELECT 1");
        return true;
    } catch {
        return false;
    }
}

export async function shutdownDatabase(): Promise<void> {
    log.info("Closing database pool");
    await pool.end();
}
