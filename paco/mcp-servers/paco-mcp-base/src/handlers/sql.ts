/**
 * SQL Handler
 *
 * Executes parameterized SQL queries against PostgreSQL databases.
 * Pools are cached per unique connection string for efficient reuse.
 */

import pg from "pg";
import { renderTemplate } from "../template-engine.js";

const { Pool } = pg;

export interface SqlConfig {
  connection_env: string; // env var name containing connection string (e.g., "DATABASE_URL")
  query: string; // SQL with $1, $2 positional params
  params?: string[]; // template strings for param values
  query_type: "select" | "insert" | "update" | "delete";
}

// Lazy pool cache keyed by connection string
const poolCache = new Map<string, pg.Pool>();

function getPool(connectionString: string): pg.Pool {
  let pool = poolCache.get(connectionString);
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on("error", (err) => {
      console.error(`[SQL] Pool error for connection: ${err.message}`);
    });
    poolCache.set(connectionString, pool);
  }
  return pool;
}

export async function sqlHandler(
  config: SqlConfig,
  args: Record<string, any>,
  env: Record<string, string>,
  _toolName: string,
  _dispatcher: null,
  _timeoutMs: number = 30000,
): Promise<string> {
  // Resolve connection string from env
  const connectionString = env[config.connection_env];
  if (!connectionString) {
    throw new Error(
      `SQL connection env var "${config.connection_env}" is not set or empty`,
    );
  }

  const pool = getPool(connectionString);

  // Render param templates
  const params: any[] = [];
  if (config.params) {
    for (const paramTemplate of config.params) {
      const rendered = renderTemplate(paramTemplate, args, env);
      params.push(rendered);
    }
  }

  // Execute parameterized query
  const result = await pool.query(config.query, params);

  if (config.query_type === "select") {
    return JSON.stringify(result.rows);
  }

  return JSON.stringify({
    rowCount: result.rowCount,
    rows: result.rows,
  });
}

/**
 * Gracefully close all cached pools (for shutdown).
 */
export async function closePools(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const [key, pool] of poolCache) {
    promises.push(pool.end());
    poolCache.delete(key);
  }
  await Promise.all(promises);
}
