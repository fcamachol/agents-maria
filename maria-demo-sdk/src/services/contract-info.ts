// ============================================
// Contract Info Service
//
// Single source of truth for a contract's zona de explotación.
// Calls the zone-agnostic consultaDetalleContrato endpoint once,
// caches the result, and lets every zone-sharded SOAP call
// (getFacturas, getConsumos, getDeudaContrato, etc.) target the
// correct zone instead of guessing through a hardcoded list.
// ============================================

import {
    fetchWithRetry,
    buildContratoSOAP,
    parseContratoResponse,
    CEA_API_BASE,
} from "./soap-client.js";
import { resolveContract } from "./contract-resolver.js";
import type { ContratoData } from "../types.js";

const CACHE_TTL_MS = 15 * 60 * 1000;

interface CacheEntry {
    info: ContratoData;
    cachedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ContratoData | null>>();

function isFresh(entry: CacheEntry): boolean {
    return Date.now() - entry.cachedAt < CACHE_TTL_MS;
}

async function fetchFromApi(resolvedContrato: string): Promise<ContratoData | null> {
    const response = await fetchWithRetry(
        `${CEA_API_BASE}/InterfazGenericaContratacionWS`,
        {
            method: "POST",
            headers: { "Content-Type": "text/xml;charset=UTF-8" },
            body: buildContratoSOAP(resolvedContrato),
        }
    );
    const xml = await response.text();
    const parsed = parseContratoResponse(xml);

    if (!parsed.success || !parsed.data) {
        if (parsed.codigoError === -501) {
            console.log(`[getContractInfo] contrato=${resolvedContrato} not_found`);
            return null;
        }
        console.warn(`[getContractInfo] contrato=${resolvedContrato} api_error=${parsed.error}`);
        return null;
    }

    if (!parsed.data.explotacion) {
        console.warn(`[getContractInfo] contrato=${resolvedContrato} missing_explotacion_in_response`);
    }

    return parsed.data;
}

export async function getContractInfo(contrato: string): Promise<ContratoData | null> {
    const resolved = await resolveContract(contrato);
    const cached = cache.get(resolved);
    if (cached && isFresh(cached)) {
        console.log(`[getContractInfo] resolved contrato=${resolved} explotacion=${cached.info.explotacion} source=cache`);
        return cached.info;
    }

    const pending = inFlight.get(resolved);
    if (pending) return pending;

    const promise = (async () => {
        try {
            const info = await fetchFromApi(resolved);
            if (info) {
                cache.set(resolved, { info, cachedAt: Date.now() });
                console.log(`[getContractInfo] resolved contrato=${resolved} explotacion=${info.explotacion} source=api`);
            }
            return info;
        } finally {
            inFlight.delete(resolved);
        }
    })();

    inFlight.set(resolved, promise);
    return promise;
}

export async function primeContractInfo(contrato: string, info: ContratoData): Promise<void> {
    const resolved = await resolveContract(contrato);
    if (!info.explotacion) return;
    cache.set(resolved, { info, cachedAt: Date.now() });
    console.log(`[getContractInfo] resolved contrato=${resolved} explotacion=${info.explotacion} source=prime`);
}

export async function invalidateContractInfo(contrato: string): Promise<void> {
    const resolved = await resolveContract(contrato);
    cache.delete(resolved);
    console.log(`[getContractInfo] invalidated contrato=${resolved}`);
}

export function __resetContractInfoCacheForTests(): void {
    cache.clear();
    inFlight.clear();
}
