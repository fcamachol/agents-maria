// ============================================
// Session hub - KV store backend (Redis, with in-memory fallback)
//
// Both channel front-ends import the hub; in production they may be separate
// processes, so state MUST live in a shared store. Redis is used when REDIS_URL
// is set; otherwise an in-process Map fallback keeps dev/build/tests runnable
// (NOT shared across processes — fine for local single-process work).
// ============================================

import { Redis } from "ioredis";

export interface KVStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
    rpush(key: string, value: string): Promise<void>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    expire(key: string, ttlSeconds: number): Promise<void>;
}

// ============================================
// Redis-backed store
// ============================================

class RedisStore implements KVStore {
    constructor(private client: Redis) {}

    async get(key: string) { return this.client.get(key); }
    async set(key: string, value: string, ttlSeconds?: number) {
        if (ttlSeconds && ttlSeconds > 0) await this.client.set(key, value, "EX", ttlSeconds);
        else await this.client.set(key, value);
    }
    async del(key: string) { await this.client.del(key); }
    async rpush(key: string, value: string) { await this.client.rpush(key, value); }
    async lrange(key: string, start: number, stop: number) { return this.client.lrange(key, start, stop); }
    async expire(key: string, ttlSeconds: number) { await this.client.expire(key, ttlSeconds); }
}

// ============================================
// In-memory fallback (single process only)
// ============================================

class MemoryStore implements KVStore {
    private kv = new Map<string, { value: string; expiresAt?: number }>();
    private lists = new Map<string, { value: string[]; expiresAt?: number }>();

    private isExpired(e?: { expiresAt?: number }): boolean {
        return !!e?.expiresAt && Date.now() > e.expiresAt;
    }

    async get(key: string) {
        const e = this.kv.get(key);
        if (!e || this.isExpired(e)) { this.kv.delete(key); return null; }
        return e.value;
    }
    async set(key: string, value: string, ttlSeconds?: number) {
        this.kv.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined });
    }
    async del(key: string) { this.kv.delete(key); }
    async rpush(key: string, value: string) {
        const e = this.lists.get(key);
        if (!e || this.isExpired(e)) { this.lists.set(key, { value: [value] }); return; }
        e.value.push(value);
    }
    async lrange(key: string, start: number, stop: number) {
        const e = this.lists.get(key);
        if (!e || this.isExpired(e)) { this.lists.delete(key); return []; }
        // Emulate Redis negative-index semantics (stop = -1 → end).
        const end = stop < 0 ? e.value.length + stop + 1 : stop + 1;
        return e.value.slice(start, end);
    }
    async expire(key: string, ttlSeconds: number) {
        const expiresAt = Date.now() + ttlSeconds * 1000;
        const k = this.kv.get(key); if (k) k.expiresAt = expiresAt;
        const l = this.lists.get(key); if (l) l.expiresAt = expiresAt;
    }
}

// ============================================
// Factory (singleton)
// ============================================

let store: KVStore | null = null;

export function getStore(): KVStore {
    if (store) return store;

    const url = process.env.REDIS_URL;
    if (url) {
        const client = new Redis(url, {
            maxRetriesPerRequest: 3,
            lazyConnect: false,
        });
        client.on("error", (err: Error) => console.error("[session/store] Redis error:", err.message));
        console.log("[session/store] Using Redis backend");
        store = new RedisStore(client);
    } else {
        console.warn("[session/store] REDIS_URL not set — using in-memory store (NOT shared across processes)");
        store = new MemoryStore();
    }
    return store;
}
