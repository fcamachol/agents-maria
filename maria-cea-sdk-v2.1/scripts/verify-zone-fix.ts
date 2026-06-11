// ============================================
// Zone-fix verification — run from the deployed environment
// (gcp-cea or any host with CEA-whitelisted egress).
//
//     npx tsx scripts/verify-zone-fix.ts [contract]
//
// Default contract: 30129295 (reported failing case, zone 5).
// Exits with non-zero status on any assertion failure.
// ============================================

import {
    getContractInfo,
    invalidateContractInfo,
    __resetContractInfoCacheForTests,
} from "../src/services/contract-info.js";
import {
    fetchWithRetry,
    buildGetFacturasSOAP,
    parseGetFacturasResponse,
    CEA_API_BASE,
} from "../src/services/soap-client.js";

const CONTRACT = process.argv[2] ?? "30129295";

function assert(cond: unknown, msg: string): void {
    if (!cond) {
        console.error(`FAIL: ${msg}`);
        process.exit(1);
    }
    console.log(`PASS: ${msg}`);
}

async function main() {
    __resetContractInfoCacheForTests();

    console.log(`\n--- 1. cold lookup ---`);
    const t0 = Date.now();
    const cold = await getContractInfo(CONTRACT);
    const coldMs = Date.now() - t0;
    assert(cold !== null, `getContractInfo(${CONTRACT}) returns non-null`);
    assert(!!cold!.explotacion, `cold response has explotacion field`);
    console.log(`    contrato=${cold!.numeroContrato} explotacion=${cold!.explotacion} titular="${cold!.titular}" (${coldMs}ms)`);

    console.log(`\n--- 2. warm lookup (must be cache hit) ---`);
    const t1 = Date.now();
    const warm = await getContractInfo(CONTRACT);
    const warmMs = Date.now() - t1;
    assert(warm !== null, `warm getContractInfo returns non-null`);
    assert(warm!.explotacion === cold!.explotacion, `warm explotacion matches cold`);
    assert(warmMs < 50, `warm lookup is fast (${warmMs}ms < 50ms — proves cache hit)`);

    console.log(`\n--- 3. invalidate + refetch ---`);
    await invalidateContractInfo(CONTRACT);
    const t2 = Date.now();
    const refreshed = await getContractInfo(CONTRACT);
    const refreshedMs = Date.now() - t2;
    assert(refreshed !== null, `refreshed getContractInfo returns non-null`);
    assert(refreshed!.explotacion === cold!.explotacion, `refreshed explotacion matches cold`);
    assert(refreshedMs > 50, `refreshed lookup hits API (${refreshedMs}ms > 50ms — proves cache was busted)`);

    console.log(`\n--- 4. getFacturas with resolved zone ---`);
    const facturasResp = await fetchWithRetry(
        `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
        {
            method: "POST",
            headers: { "Content-Type": "text/xml;charset=UTF-8" },
            body: buildGetFacturasSOAP(CONTRACT, cold!.explotacion),
        }
    );
    const parsed = parseGetFacturasResponse(await facturasResp.text());
    assert(parsed.success, `getFacturas succeeds with explotacion=${cold!.explotacion}`);
    assert(parsed.facturas.length > 0, `getFacturas returns ≥1 factura (got ${parsed.facturas.length})`);
    if (parsed.facturas.length > 0) {
        console.log(`    latest factura: ${parsed.facturas[0].numero} (${parsed.facturas[0].periodoTexto})`);
    }

    console.log(`\n--- 5. negative control (clearly invalid contract) ---`);
    const bogus = await getContractInfo("99999999");
    assert(bogus === null, `getContractInfo("99999999") returns null for non-existent contract`);

    console.log(`\nALL CHECKS PASSED for contract ${CONTRACT} (explotacion=${cold!.explotacion})`);
}

main().catch((err) => {
    console.error(`\nFATAL: ${err instanceof Error ? err.stack : err}`);
    process.exit(2);
}).finally(() => {
    // The pg pools in soap-client.ts hold the process open.
    setTimeout(() => process.exit(0), 100).unref();
});
