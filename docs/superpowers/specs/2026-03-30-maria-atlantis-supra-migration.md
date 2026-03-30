# Maria Atlantis SDK — SUPRA REST Migration

**Date:** 2026-03-30
**Scope:** Replace all SOAP/XML + direct PostgreSQL integrations with SUPRA REST API calls in `maria-atlantis-sdk`
**SUPRA Base URL:** `https://supra-back.whoopflow.com`
**Auth:** None (open API)

---

## Goal

Migrate maria-atlantis-sdk from the CEA Aquacis SOAP API + direct PostgreSQL queries to the SUPRA REST API. This eliminates XML building/parsing, direct database access, local fuzzy name matching, local HMAC token generation, and SIGE-to-Hydra contract translation. The agent-facing tool interface remains identical.

---

## Architecture

### Before

```
Agent → Tools → soap-client.ts (XML build/parse) → CEA Aquacis SOAP
                                                   → PostgreSQL (tickets, locations, clients)
              → name-matching.ts (fuzzy match)
              → contract-resolver.ts (SIGE→Hydra)
              → recibo-token.ts (HMAC tokens) → Cloudflare Worker
```

### After

```
Agent → Tools → supra-client.ts (fetch + JSON) → SUPRA REST API
```

One client, one transport (HTTP/JSON), no database connection.

---

## SUPRA REST Endpoints Used

| Method | Endpoint | Replaces |
|--------|----------|----------|
| `GET` | `/api/contrato/:id` | SOAP `getContrato` |
| `GET` | `/api/contrato/:id/deuda` | SOAP `getDeudaContrato` + `getDeudaTotalConFacturas` |
| `GET` | `/api/contrato/:id/consumos` | SOAP `getConsumos` |
| `GET` | `/api/contrato/:id/recibos` | SOAP `getFacturas` + local HMAC + Cloudflare Worker |
| `POST` | `/api/contrato/validar` | SOAP `getContrato` + local fuzzy name matching |
| `GET` | `/api/cliente?contrato=` | Direct PG query on `contacts` table |
| `POST` | `/api/tickets` | Direct PG INSERT into `tickets` table |
| `GET` | `/api/tickets?contrato=` | Direct PG SELECT from `tickets` |
| `GET` | `/api/tickets?conversation_id=` | Direct PG SELECT from `tickets` |
| `GET` | `/api/tickets/folio/:folio` | Direct PG SELECT from `tickets` |
| `PUT` | `/api/tickets/:id` | Direct PG UPDATE on `tickets` |
| `GET` | `/api/ubicaciones/cercanas?lat=&lng=&tipo=&limite=` | Direct PG query on `cea_locations` + Haversine |
| `POST` | `/api/ubicaciones/buscar` | Google Places API text search |
| `GET` | `/api/geocode/reverso?lat=&lng=` | Google Geocoding API |

---

## File Changes

### DELETE (4 files, 775 lines)

| File | Lines | Reason |
|------|-------|--------|
| `services/soap-client.ts` | 627 | XML builders, parsers, WS-Security, PG pool — all replaced by supra-client.ts |
| `services/name-matching.ts` | 84 | SUPRA handles validation server-side via `POST /api/contrato/validar` |
| `services/contract-resolver.ts` | 41 | SUPRA uses its own contract format, no SIGE-to-Hydra translation |
| `services/recibo-token.ts` | 23 | SUPRA returns download URLs directly from `/api/contrato/:id/recibos` |

### CREATE (1 file, ~120 lines)

#### `services/supra-client.ts`

Thin REST client. Config via `SUPRA_API_BASE` env var (defaults to `https://supra-back.whoopflow.com`).

```typescript
// Shape (not final code):
const SUPRA_BASE = process.env.SUPRA_API_BASE || "https://supra-back.whoopflow.com";

async function supraFetch<T>(path: string, options?: RequestInit): Promise<T>
// Shared fetch wrapper: builds URL, sets Content-Type, checks response.ok, returns .json()

export async function getContrato(id: string): Promise<ContratoResponse>
export async function getDeuda(id: string): Promise<DeudaResponse>
export async function getConsumos(id: string): Promise<ConsumoResponse>
export async function getRecibos(id: string): Promise<RecibosResponse>
export async function validarContrato(id: string, nombre: string): Promise<ValidacionResponse>
export async function getCliente(contrato: string): Promise<ClienteResponse>
export async function createTicket(body: CreateTicketBody): Promise<CreateTicketResponse>
export async function getTickets(query: TicketQuery): Promise<TicketListResponse>
export async function getTicketByFolio(folio: string): Promise<TicketResponse>
export async function updateTicket(id: string, body: UpdateTicketBody): Promise<TicketResponse>
export async function getUbicaciones(params: UbicacionQuery): Promise<UbicacionesResponse>
export async function buscarUbicacion(textQuery: string): Promise<UbicacionesResponse>
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResponse>
```

Each method is typed with interfaces that match SUPRA's response shapes. Error handling returns `{success: false, error: string}` consistently.

### REWRITE (5 files)

#### `tools/cea-api.ts` renamed to `tools/supra-api.ts`

All four tools (`get_deuda`, `get_consumo`, `get_contract_details`, `get_recibo_link`) rewritten to call supra-client methods. Tool names, descriptions, and zod schemas stay identical. Internal logic shrinks from ~548 lines to ~120 lines because:
- No XML building/parsing
- No primary/fallback SOAP call dance for deuda
- No explotacion loop for consumo
- No punto-servicio enrichment for contracts (SUPRA returns final state)
- No local HMAC token generation for recibos (SUPRA returns downloadUrl)

#### `tools/identity.ts`

- `validate_contract_holder`: Calls `supra.validarContrato(contrato, nombre)`. Returns `{validated, confidence}` from server response. Removes local SOAP call + fuzzy name matching + punto-servicio enrichment. ~20 lines instead of ~130.
- `search_customer_by_contract`: Calls `supra.getCliente(contrato)`. ~15 lines instead of ~60.

#### `tools/tickets.ts`

All four tools rewritten:
- `create_ticket`: Calls `supra.createTicket(body)`. No local folio generation, no dedup map, no PG INSERT. SUPRA handles all of that. ~20 lines instead of ~180.
- `get_client_tickets`: Calls `supra.getTickets({contrato})` or `supra.getTickets({conversation_id})`. ~15 lines instead of ~60.
- `lookup_ticket_by_folio`: Calls `supra.getTicketByFolio(folio)`. ~10 lines instead of ~80.
- `update_ticket`: Calls `supra.updateTicket(id, body)`. Status restriction (users can't close tickets) stays in the tool layer. ~15 lines instead of ~60.

#### `tools/location.ts`

All four tools rewritten:
- `get_main_office`: Calls `supra.getUbicaciones({tipo: "oficina", limite: 1})`. ~10 lines instead of ~40.
- `find_nearest_locations`: Calls `supra.getUbicaciones({lat, lng, tipo, limite})`. For colonia input, uses `supra.buscarUbicacion(colonia)` to resolve coordinates first. ~30 lines instead of ~150.
- `search_location`: Calls `supra.buscarUbicacion(query)`. Replaces Google Places API. ~15 lines instead of ~80.
- `reverse_geocode`: Calls `supra.reverseGeocode(lat, lng)`. Replaces Google Geocoding API. ~15 lines instead of ~80.

#### `server.ts`

- Remove `/recibo/:contrato` route entirely (SUPRA provides download URLs directly)
- Remove imports of `verifyReciboToken` and `fetchReciboPdf`
- Keep `isPendingLectura` import (lives in agent.ts, used for media processing context — unrelated to backend API)
- Update banner to remove recibo route from endpoint list

### MINOR EDITS (3 files)

#### `tools/index.ts`
- Update imports: `./cea-api.js` becomes `./supra-api.js`
- Remove `CEA_API_BASE` references if any remain

#### `.env.example`
- Add: `SUPRA_API_BASE=https://supra-back.whoopflow.com`
- Remove: `CEA_PROXY_URL`, `SERVER_BASE_URL`, `RECIBO_TOKEN_SECRET`
- Remove: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPOOL_MAX`
- Remove: `HYDRA_PGHOST`, `HYDRA_PGPORT`, `HYDRA_PGUSER`, `HYDRA_PGPASSWORD`, `HYDRA_PGDATABASE`
- Remove: `GOOGLE_MAPS_API_KEY` (SUPRA handles geocoding and location search)

#### `package.json`
- Remove dependency: `pg`
- Remove devDependency: `@types/pg`

### UNCHANGED (7 files)

| File | Reason |
|------|--------|
| `agent.ts` | Orchestration layer, talks to tools via MCP — no transport awareness |
| `chatwoot.ts` | Chatwoot webhook integration — independent of backend API |
| `media.ts` | Gemini/Claude vision + Whisper audio — independent |
| `tools/vision.ts` | Gemini receipt extraction — independent |
| `config/response-templates.ts` | Formatting templates — independent |
| `types.ts` | Type definitions stay (may add SUPRA response types) |
| `index.ts` | Entry point, just imports and starts server |

---

## Environment Variables

### After migration

```env
# Required
ANTHROPIC_API_KEY=

# SUPRA API
SUPRA_API_BASE=https://supra-back.whoopflow.com

# Chatwoot
CHATWOOT_BASE_URL=
CHATWOOT_API_TOKEN=
CHATWOOT_USER_API_TOKEN=
CHATWOOT_ACCOUNT_ID=
CHATWOOT_INBOX_ID=

# AI Services (media processing)
GEMINI_API_KEY=
GEMINI_CLASSIFY_MODEL=
GEMINI_ANALYZE_MODEL=
GEMINI_RECEIPT_MODEL=
OPENAI_API_KEY=

# Server
PORT=3003
```

### Removed

`CEA_PROXY_URL`, `SERVER_BASE_URL`, `RECIBO_TOKEN_SECRET`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGPOOL_MAX`, `HYDRA_PGHOST`, `HYDRA_PGPORT`, `HYDRA_PGUSER`, `HYDRA_PGPASSWORD`, `HYDRA_PGDATABASE`, `GOOGLE_MAPS_API_KEY`

---

## Test Contracts (SUPRA seed data)

| Contract | Scenario | Useful for testing |
|----------|----------|-------------------|
| SUP-001 | No debt | get_deuda (zero balance) |
| SUP-002 | 1 month debt | get_deuda (simple) |
| SUP-003 | 3 months debt | get_deuda (multiple invoices) |
| SUP-004 | 6 months debt | get_deuda (overdue) |
| SUP-005 | 12 months debt | get_deuda (heavy overdue) |
| SUP-006 | Service cut | get_contract_details (estado: cortado) |
| SUP-007 | About to expire | get_deuda (upcoming due date) |
| SUP-008 | Estimated readings | get_consumo (tipoLectura: estimada) |
| SUP-009 | Rising consumption | get_consumo (tendencia: aumentando) |
| SUP-010 | Commercial use | get_contract_details (tarifa comercial) |

---

## Metrics

| Metric | Before | After |
|--------|--------|-------|
| Source lines (tools + services) | ~2,780 | ~930 |
| Dependencies | 8 (`pg` included) | 7 (`pg` removed) |
| Env vars | 22 | 12 |
| External services | 4 (CEA SOAP, PostgreSQL, Google Maps, Cloudflare Worker) | 1 (SUPRA) |
| Files in services/ | 4 | 1 |
