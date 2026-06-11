// ============================================
// Maria CEA - Caching Layer
// ============================================

import NodeCache from "node-cache";
import { logger } from "./logger.js";

// Cache configuration
const DEFAULT_TTL = parseInt(process.env.CACHE_TTL_SECONDS || "300"); // 5 minutes
const CHECK_PERIOD = parseInt(process.env.CACHE_CHECK_PERIOD || "60");

class CacheManager {
    private cache: NodeCache;
    private hits: number = 0;
    private misses: number = 0;

    constructor() {
        this.cache = new NodeCache({
            stdTTL: DEFAULT_TTL,
            checkperiod: CHECK_PERIOD,
            useClones: true,
            deleteOnExpire: true
        });

        this.cache.on("expired", (key) => {
            logger.debug({ key }, "Cache entry expired");
        });

        logger.info({ ttl: DEFAULT_TTL, checkPeriod: CHECK_PERIOD }, "Cache manager initialized");
    }

    /**
     * Get value from cache
     */
    get<T>(key: string): T | undefined {
        const value = this.cache.get<T>(key);
        if (value !== undefined) {
            this.hits++;
            logger.debug({ key, hits: this.hits }, "Cache hit");
        } else {
            this.misses++;
        }
        return value;
    }

    /**
     * Set value in cache
     */
    set<T>(key: string, value: T, ttl?: number): boolean {
        return this.cache.set(key, value, ttl || DEFAULT_TTL);
    }

    /**
     * Get or set value (cache-aside pattern)
     */
    async getOrSet<T>(
        key: string,
        factory: () => Promise<T>,
        ttl?: number
    ): Promise<T> {
        const cached = this.get<T>(key);
        if (cached !== undefined) {
            return cached;
        }

        const value = await factory();
        this.set(key, value, ttl);
        return value;
    }

    /**
     * Delete value from cache
     */
    del(key: string): number {
        return this.cache.del(key);
    }

    /**
     * Check if key exists
     */
    has(key: string): boolean {
        return this.cache.has(key);
    }

    /**
     * Flush all cache
     */
    flush(): void {
        this.cache.flushAll();
        this.hits = 0;
        this.misses = 0;
        logger.info("Cache flushed");
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        hits: number;
        misses: number;
        hitRate: number;
        keys: number;
        ttl: number;
    } {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? Math.round((this.hits / total) * 100) : 0,
            keys: this.cache.keys().length,
            ttl: DEFAULT_TTL
        };
    }

    /**
     * Generate cache key for CEA API calls
     */
    static generateKey(prefix: string, params: Record<string, unknown>): string {
        const sortedParams = Object.entries(params)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v}`)
            .join("|");
        return `${prefix}:${sortedParams}`;
    }
}

// Singleton instance
let cacheManager: CacheManager | null = null;

export function getCache(): CacheManager {
    if (!cacheManager) {
        cacheManager = new CacheManager();
    }
    return cacheManager;
}

// Specific cache key generators
export const CacheKeys = {
    deuda: (contract: string) => `deuda:${contract}`,
    consumo: (contract: string, year?: number) => `consumo:${contract}:${year || "all"}`,
    contrato: (contract: string) => `contrato:${contract}`,
    classification: (input: string) => `classification:${Buffer.from(input).toString("base64").slice(0, 32)}`,
    customer: (contract: string) => `customer:${contract}`,
    tickets: (contract: string) => `tickets:${contract}`,
    facturas: (contract: string) => `facturas:${contract}`
};
