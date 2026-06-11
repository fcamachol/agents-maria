# Maria CEA SDK — Endpoints & Data Mapping

## CEA SOAP API

**Base URL:** `https://aquacis-cf.ceaqueretaro.gob.mx/Comercial/services`
**Credentials:** `WSGESTIONDEUDA` / `WSGESTIONDEUDA` (WS-Security header)
**Proxy:** Optional via `CEA_PROXY_URL` env var

---

### 1. `get_deuda` — Debt / Balance

| | |
|---|---|
| **Service** | `/InterfazGenericaGestionDeudaWS` |
| **SOAP Actions** | `getDeudaContrato`, `getDeudaTotalConFacturas` |

**Raw response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `deuda` / `deudaTotal` | numeric string | Total debt amount |
| `nombreCliente` | string | Account holder name |
| `direccion` | string | Address |
| `codigoError` | int | Error code (-501 = not found) |
| `cantidadFacturas` | int | Number of pending invoices |
| `<factura>` blocks: `numFactura`, `ciclo`, `fechaVencimiento`, `importeTotal`, `estado`/`codigoEstado`, `referenciaPago` | | Per-invoice details |

**Mapping:**

| Raw | Transformation | Output |
|-----|---------------|--------|
| `deudaTotal` | `parseFloat()` | `data.totalDeuda` |
| `estado` / `codigoEstado` | `"4"` or `"vencido"` → `"vencido"`, else → `"pendiente"` | `factura.estadoTexto` |
| `importeTotal` | `parseFloat()`, sum by status | `data.vencido`, `data.porVencer` |

---

### 2. `get_consumo` — Water Consumption History

| | |
|---|---|
| **Service** | `/InterfazOficinaVirtualClientesWS` |
| **SOAP Action** | `getConsumos` |

**Raw response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `año` | int string | Year (e.g., "2024") |
| `metrosCubicos` / `consumo` / `m3` | decimal string | Consumption in m³ |
| `periodo` | string | Period with month tag (e.g., `<JUN> - <JUN>`) |
| `fechaLectura` | string | Reading date |
| `estimado` | bool string | `"true"` if estimated reading |

**Mapping:**

| Raw | Transformation | Output |
|-----|---------------|--------|
| `periodo` | Regex `/<([A-Z]{3})>/` extracts month → combine with `año` | `consumo.periodo` (e.g., "JUN 2024") |
| `metrosCubicos` | `parseFloat()` | `consumo.consumoM3` |
| `estimado` | `"true"` → `"estimada"`, else → `"real"` | `consumo.tipoLectura` |
| all consumos | avg of all m³ values | `promedioMensual` |
| all consumos | compare recent 3 vs oldest 3 months (±10% threshold) | `tendencia` (`"aumentando"` / `"disminuyendo"` / `"estable"`) |

---

### 3. `get_contract_details` — Contract Info

| | |
|---|---|
| **Service** | `/InterfazGenericaContratacionWS` |
| **SOAP Action** | `consultaDetalleContrato` |
| **Enrichment** | `/InterfazGenericaContadoresWS` → `getPuntoServicioPorContador` |

**Raw response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `numeroContrato` / `contrato` | string | Contract number |
| `nombreTitular` / `titular` | string | Account holder |
| `calle` + `numero` | strings | Street components |
| `municipio` / `colonia` | string | Neighborhood |
| `codigoPostal` / `cp` | string | Postal code |
| `descUso` / `tarifa` | string | Rate type |
| `estadoContador` / `estado` | string | Status (numeric or text) |
| `fechaAlta` | string | Activation date |
| `ultimaLectura` | string | Last meter reading |
| `numeroContador` | string | Meter serial (used for enrichment) |

**Mapping:**

| Raw | Transformation | Output |
|-----|---------------|--------|
| `calle` + `numero` | Join with space | `data.direccion` |
| `estadoContador` | `"1"` → `"activo"`, `"2"` → `"cortado"`, text matched case-insensitive | `data.estado` |
| `numeroContador` | If exists → fetch `getPuntoServicioPorContador` → override status with real service point status | `data.estado` (enriched) |

---

### 4. `get_recibo_link` — Receipt PDF Download

| | |
|---|---|
| **Services** | `/InterfazOficinaVirtualClientesWS` → `getFacturas` |
| | `/InterfazGenericaContratacionWS` → `getPdfFactura` |

**Raw response fields (getFacturas):**

| Field | Type | Description |
|-------|------|-------------|
| `numero` | string | Invoice number |
| `periodo` | int string | Month (1-12) |
| `año` | string | Year |
| `importeTotal` | decimal string | Amount |
| `estado` | string | Status code |

**Raw response fields (getPdfFactura):**

| Field | Type | Description |
|-------|------|-------------|
| `<pdf>` / `<return>` | base64 string | PDF binary content |

**Mapping:**

| Raw | Transformation | Output |
|-----|---------------|--------|
| `periodo` (1-12) | Map via `MESES` array → month name | `data.periodo` (e.g., "Enero 2025") |
| `estado` | `4` → `"vencido"`, `2` → `"pendiente"`, else → `"pagado"` | Status text |
| contrato + token | JWT signed (48h expiry) → build URL | `data.download_url` (`{SERVER_BASE_URL}/recibo/{contrato}?token=...&factura=...`) |

---

### 5. `validate_contract_holder` — Identity Verification

| | |
|---|---|
| **Services** | `/InterfazGenericaContratacionWS` → `consultaDetalleContrato` |
| | `/InterfazGenericaContadoresWS` → `getPuntoServicioPorContador` |

**Raw response fields:** Same as `get_contract_details` — uses `nombreTitular`

**Mapping:**

| Raw | Transformation | Output |
|-----|---------------|--------|
| `nombreTitular` | `matchName(input, titular)` → fuzzy/exact/initials comparison | `validated` (bool), `confidence` (0-1), `method` (string) |
| Match result | If true → add to `ctx.verifiedContracts` Set | Session state update |

---

## Google Maps APIs

### 6. `search_location` — Place Text Search

| | |
|---|---|
| **Endpoint** | `POST https://places.googleapis.com/v1/places:searchText` |
| **Auth** | `GOOGLE_MAPS_API_KEY` header |
| **Bounds** | QRO: SW (20.01, -100.60) → NE (21.65, -99.03) |

**Raw response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `places[].displayName.text` | string | Location name |
| `places[].formattedAddress` | string | Full address |
| `places[].location.latitude` | float | Latitude |
| `places[].location.longitude` | float | Longitude |

**Mapping:** Extract top 3 results → build Google Maps link `https://maps.google.com/?q={lat},{lng}`

---

### 7. `reverse_geocode` — Coordinates to Address

| | |
|---|---|
| **Endpoint** | `GET https://maps.googleapis.com/maps/api/geocode/json` |
| **Auth** | `GOOGLE_MAPS_API_KEY` query param |

**Raw response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `results[0].formatted_address` | string | Readable address |
| `results[0].address_components[]` | array | Components by type: `route`, `street_number`, `sublocality`, `locality`, `postal_code`, etc. |

**Mapping:**

| Component Type | Output Field |
|---------------|-------------|
| `route` | `street` |
| `street_number` | `street_number` |
| `sublocality_level_1` / `neighborhood` | `colonia` |
| `locality` | `city` |
| `administrative_area_level_1` | `state` |
| `postal_code` | `postal_code` |

---

## PostgreSQL — AGORA Database

**Connection:** `PGHOST`, `PGPORT` (default 5432), `PGDATABASE` (default `agora_production`), `PGUSER`, `PGPASSWORD`

### 8. `search_customer_by_contract`

| | |
|---|---|
| **Table** | `contacts` |
| **Query** | `WHERE identifier = {contract} OR custom_attributes->>'contract_number' = {contract}` |

**Raw fields:** `id`, `name`, `email`, `phone_number`, `identifier`, `custom_attributes` (JSONB with `contract_number`, `whatsapp`, `recibo_digital`)

**Output:** Flattened `customer` object with `id`, `nombre`, `contrato`, `email`, `whatsapp`, `recibo_digital`

---

### 9. `create_ticket`

| | |
|---|---|
| **Table** | `tickets` (INSERT) |
| **Lookups** | `ticket_categories`, `ticket_subcategories` (by code → numeric ID) |

**Key transformations:**
- `category_code` → DB lookup → `ticket_category_id`
- `subcategory_code` → DB lookup → `ticket_subcategory_id`
- Folio generated by DB trigger
- `metadata` stored as JSONB (email, phone, ubicacion, coordenadas)
- Timestamps in `America/Mexico_City` timezone

**Output:** `folio`, `ticketId`, `status`

---

### 10. `get_client_tickets`

| | |
|---|---|
| **Table** | `tickets` |
| **Query modes** | By `conversation_id` (no contract) or by `contract_number` (with contract) |
| **Limit** | 10, ordered by `created_at DESC` |

**Output per ticket:** `folio`, `status`, `titulo`, `service_type`, `created_at`, `descripcion` (truncated to 100 chars)

---

### 11. `lookup_ticket_by_folio`

| | |
|---|---|
| **Table** | `tickets` |
| **Query** | Exact match on `folio`, fallback: `LIKE 'CEA-' || {input}` for numeric-only input |

**Output:** `folio`, `status`, `titulo`, `descripcion` (truncated to 200 chars), `created_at`, `priority`

---

### 12. `update_ticket`

| | |
|---|---|
| **Table** | `tickets` (UPDATE) |
| **Allowed statuses** | `open`, `in_progress`, `waiting_client`, `waiting_internal`, `escalated` |
| **Blocked statuses** | `resolved`, `closed`, `cancelled` → triggers handoff to human |

**Output:** `folio`, `message`

---

## Location Tools (PostgreSQL)

### 13. `find_nearest_locations`

| | |
|---|---|
| **Table** | `cea_locations` |
| **Distance** | Haversine formula in meters |

**Raw fields:** `name`, `tipo` (oficina/cajero/autopago), `address_street`, `colonia`, `municipio`, `latitude`, `longitude`, `horario` (JSONB: `lun_vie`, `sab`, `dom`), `telefono`, `servicios`, `notas`

**Mapping:**

| Raw | Transformation | Output |
|-----|---------------|--------|
| `tipo` | `"oficina"` → `"Oficina"`, `"cajero"` → `"CEAmático"` | `tipo_label` |
| lat/lng + user lat/lng | Haversine → meters | `distance` (`"X m"` or `"X.X km"`) |
| `horario` + current time (Mexico City TZ) | Check current day key + parse time range | `is_open` (bool), `current_schedule` |

---

### 14. `get_main_office`

| | |
|---|---|
| **Table** | `cea_locations` |
| **Filter** | `slug = 'pabellon-campestre'` |

Same fields as `find_nearest_locations`, formatted as single office info.

---

## Vision / AI APIs

### 15. `extract_cea_receipt` — Receipt OCR

| | |
|---|---|
| **API** | Google Gemini (`gemini-2.5-flash`) |
| **Auth** | `GEMINI_API_KEY` |

**Output schema (structured JSON):**
- `identification`: `contrato`, `titular`, `direccion`, `no_factura`, `referencia`, `rfc_emisor`, `uuid_fiscal`
- `technical_grid`: `no_medidor`, `lectura_actual`, `lectura_anterior`, `consumo_m3`, `periodo_facturacion`
- `concepts_table[]`: `descripcion`, `valor_unitario`, `importe`, `iva`
- `financial_summary`: `total_periodo`, `facturas_pendientes`, `total_a_pagar`, `fecha_vencimiento`

**Post-extraction validation:**
- `lectura_actual - lectura_anterior ≈ consumo_m3` (±0.5 m³)
- `total_periodo + facturas_pendientes ≈ total_a_pagar` (±$0.01)
- Sum of concept `importe` ≈ `total_periodo` (±$1.00)
- Failures set `validation_warning = true`

---

### 16. Media Processing (images & video)

| Media Type | API | Model |
|------------|-----|-------|
| Images | Claude Vision | `claude-sonnet-4-5` |
| Video (pass 1 — classify) | Google Gemini | `gemini-2.5-flash-lite` |
| Video (pass 2 — analyze) | Google Gemini | `gemini-2.5-flash` |

---

## Chatwoot Integration

**Base URL:** `CHATWOOT_BASE_URL` env var

| Function | Endpoint | Method |
|----------|----------|--------|
| `sendToChatwoot` | `/api/v1/accounts/{accountId}/conversations/{conversationId}/messages` | POST |
| `updateConversationStatus` | `/api/v1/accounts/{accountId}/conversations/{conversationId}/toggle_status` | POST |

**Auth:** `api_access_token` header (`CHATWOOT_API_TOKEN` or `CHATWOOT_USER_API_TOKEN`)

---

## Internal Server

**Base URL:** `SERVER_BASE_URL` env var (default: `https://info-cea.cea-info.workers.dev`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/recibo/{contrato}` | GET | PDF download (HMAC token, 48h expiry) |
| `/health` | GET | Health check |
| `/status` | GET | Agent status |
| `/api/chat` | POST | Chat webhook from Chatwoot |
| `/api/webhook/chatwoot` | POST | Chatwoot webhook receiver |
