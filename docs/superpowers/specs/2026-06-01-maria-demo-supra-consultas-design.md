# maria-demo-sdk: consultas + identity + payment → SUPRA REST

**Date:** 2026-06-01
**Target:** `maria-demo-sdk` (pm2 id 12 on gcp-cea, port 3016) — the exact copy of `maria-cea-sdk-v2`.
**Pattern source:** `maria-atlantis-sdk` (already migrated SOAP/Aquacis → SUPRA REST).

## Goal

Make the demo's data-query tools read from **SUPRA REST** instead of the Aquacis SOAP API,
mirroring `maria-atlantis-sdk`. In scope:

- **consultas (4):** `get_deuda`, `get_consumo`, `get_contract_details`, `get_recibo_link`
- **payment:** `get_payment_link` (new tool, atlantis-only today)
- **identity (2):** `validate_contract_holder`, `search_customer_by_contract`

Out of scope (stay on current path): `location.*`, `tickets.*`, the `/recibo/:contrato` PDF
route in `server.ts`, vision/OCR.

## Backend

`SUPRA_API_BASE = https://supra-back.humansoftware.mx` — verified live, speaks the SUPRA
envelope (`GET /api/contrato/SUP-001` → `{"success":false,"error":"Contrato no
encontrado","codigoError":-501}`), no auth header required. Atlantis's hardcoded
`supra-back.whoopflow.com` is **down** and must not be used.

Data-source consequence (accepted by owner): consultas now answer from the **SUPRA demo
dataset**, not real CEA Querétaro data.

## Branding

**Copy atlantis verbatim** — keep the "Hydropolis" wording in tool descriptions and
user-facing messages exactly as atlantis ships them.

## File changes (in a local `maria-demo-sdk/` working copy, then deployed)

| File | Action |
|------|--------|
| `src/services/supra-client.ts` | **NEW** — copy from atlantis; change only the `SUPRA_API_BASE` default to `https://supra-back.humansoftware.mx` (still env-overridable) |
| `src/tools/supra-api.ts` | **NEW** — copy from atlantis verbatim (`get_deuda/get_consumo/get_contract_details/get_recibo_link/get_payment_link`) |
| `src/tools/identity.ts` | **REPLACE** with atlantis's SUPRA version (`getContrato`/`getCliente`, local `flexibleNameMatch`) |
| `src/tools/index.ts` | Rewire imports to `./supra-api.js`, register `getPaymentLinkTool`. Keep MCP server name as-is. |
| `src/tools/cea-api.ts` | **DELETE** (replaced by `supra-api.ts`) |
| `.env` (server) | Add `SUPRA_API_BASE=https://supra-back.humansoftware.mx` |

**Kept (still required by out-of-scope code):**
`soap-client.ts` (`pgQuery`/`getMexicoDate`/`fetchReciboPdf` → location, tickets, server),
`contract-resolver.ts` (`translateContract` → agent.ts), `contract-info.ts` &
`recibo-token.ts` (→ server `/recibo` route). `name-matching.ts` becomes orphaned — left in
place, harmless.

## Behavioral notes / risks

- SUPRA passes `contrato` straight through — **no zone/`explotacion` resolution** on these
  tools. The zone machinery remains only for the kept SOAP paths.
- `agent.ts` `translateContract` only fires for exactly-9-digit IDs present in the CEA Hydra
  mapping and falls back to the original otherwise → **safe no-op** for SUPRA contract IDs.
  Hydra DB stays configured in `.env`, so no errors.
- `RequestContext` already carries `verifiedContracts` + `conversationId`, which the atlantis
  identity tool needs — compatible, no type changes.

## Deploy

Local edits → `rsync src/` to `gcp-cea:~/maria-demo-sdk` → `npm run build` on server →
**confirm before `pm2 restart maria-demo-sdk`**. Never sync `.env`/`dist`; add the
`SUPRA_API_BASE` line directly on the server `.env`.

## Verification

1. `npm run build` clean on server.
2. `curl localhost:3016/health` → ok after restart.
3. Tool probe via `/api/chat` against a known SUPRA demo contract: `get_deuda`,
   `get_contract_details`, `validate_contract_holder` return SUPRA-sourced data (logs show
   `supra-back.humansoftware.mx`, not the SOAP endpoints).
4. A location/ticket query still works (proves the kept SOAP path is intact).
