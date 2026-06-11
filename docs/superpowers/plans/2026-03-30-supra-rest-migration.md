# SUPRA REST Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all SOAP/XML + direct PostgreSQL integrations in maria-atlantis-sdk with SUPRA REST API calls.

**Architecture:** One new file (`supra-client.ts`) with typed REST methods replaces 4 service files (775 lines). Each tool file gets rewritten to call the REST client instead of building XML or querying PG directly. Agent-facing tool names and interfaces stay identical.

**Tech Stack:** TypeScript, fetch API, Express, Claude Agent SDK, Zod

**Working directory:** `/Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk`

**Spec:** `docs/superpowers/specs/2026-03-30-maria-atlantis-supra-migration.md`

---

## SUPRA API Response Reference

All SUPRA endpoints return `{ "success": boolean, "data": ... }` or `{ "success": false, "error": "..." }`.

<details>
<summary>Response shapes (from live probing)</summary>

**GET /api/contrato/:id**
```json
{ "success": true, "data": { "contrato": "SUP-002", "nombreTitular": "José Luis Ramírez García", "direccion": "Av. Juárez 89", "calle": "Av. Juárez", "numero": "89", "colonia": "Centenario", "municipio": "Querétaro", "cp": "76010", "tarifa": "Doméstico", "estado": "activo", "fechaAlta": "2020-07-01T00:00:00.000Z", "numeroMedidor": "MED-002-B", "ultimaLectura": "112.00" } }
```

**GET /api/contrato/:id/deuda**
```json
{ "success": true, "data": { "contrato": "SUP-002", "nombreCliente": "José Luis Ramírez García", "direccion": "Av. Juárez 89", "totalDeuda": 330.55, "vencido": 330.55, "porVencer": 0, "cantidadFacturas": 1, "facturas": [{ "numFactura": "F-2-001", "ciclo": "FEB 2026", "fechaVencimiento": "2026-03-27T00:00:00.000Z", "importeTotal": 330.55, "estadoTexto": "vencido" }] } }
```

**GET /api/contrato/:id/consumos**
```json
{ "success": true, "data": { "contrato": "SUP-002", "promedioMensual": 14.17, "tendencia": "estable", "consumos": [{ "periodo": "MAR 2026", "consumoM3": 14.22, "tipoLectura": "real", "fechaLectura": "2026-03-27T00:00:00.000Z", "lecturaActual": 470.64, "lecturaAnterior": 456.42 }, ...] } }
```

**GET /api/contrato/:id/recibos**
```json
{ "success": true, "data": { "contrato": "SUP-002", "recibos": [{ "numFactura": "F-2-001", "periodo": "Febrero 2026", "importeTotal": 330.55, "estadoTexto": "vencido", "fechaVencimiento": "2026-03-27T00:00:00.000Z", "downloadUrl": "https://supra.whoopflow.com/recibo/SUP-002?token=JWT..." }] } }
```

**POST /api/contrato/validar** `{ "contrato": "SUP-002", "nombre": "García" }`
```json
{ "success": true, "data": { "contrato": "SUP-002", "validated": false, "confidence": 0.25, "method": "no_match", "titularEncontrado": "José Luis Ramírez García" } }
```

**GET /api/cliente?contrato=SUP-002**
```json
{ "success": true, "data": { "id": 2, "nombre": "José Luis Ramírez García", "contrato": "SUP-002", "email": "jose.ramirez@email.com", "telefono": "442-987-6543", "whatsapp": "5214429876543", "reciboDigital": false, "identifier": null } }
```

**POST /api/tickets** `{ "contratoNumero": "SUP-002", "titulo": "...", "descripcion": "...", "prioridad": "media", "tipoServicio": "fuga", "conversationId": "..." }`
```json
{ "success": true, "data": { "folio": "CEA-363022", "ticketId": 4, "status": "abierto" } }
```

**GET /api/tickets?contrato=SUP-002**
```json
{ "success": true, "data": [{ "folio": "CEA-363022", "status": "abierto", "titulo": "...", "tipoServicio": "fuga", "createdAt": "2026-03-30T...", "descripcion": "...", "categoria": null, "subcategoria": null }] }
```

**GET /api/tickets/folio/:folio**
```json
{ "success": true, "data": { "folio": "CEA-363022", "status": "abierto", "titulo": "...", "descripcion": "...", "createdAt": "2026-03-30T...", "prioridad": "media" } }
```

**PUT /api/tickets/:id** `{ "estado": "en_proceso", "prioridad": "alta" }`
```json
{ "success": true, "data": { "folio": "CEA-363022", "message": "Ticket actualizado exitosamente" } }
```

**GET /api/ubicaciones/cercanas?lat=20.58&lng=-100.38&tipo=oficina&limite=2**
```json
{ "success": true, "data": [{ "id": 1, "nombre": "Oficina Central SUPRA", "tipo": "oficina", "tipoLabel": "Oficina", "direccion": "Av. 5 de Febrero 4002, Jardines de la Corregidora, Querétaro", "direccionCalle": "Av. 5 de Febrero 4002", "colonia": "Jardines de la Corregidora", "municipio": "Querétaro", "latitud": 20.5888, "longitud": -100.3899, "distancia": "1.4 km", "distanciaMetros": 1421, "horario": { "dom": "Cerrado", "sab": "8:00 - 13:00", "lun_vie": "8:00 - 17:00" }, "telefono": "442-441-0000", "servicios": "Pagos, trámites, aclaraciones", "notas": "Estacionamiento disponible", "mapsUrl": "https://maps.google.com/?q=20.5888,-100.3899" }] }
```

**POST /api/ubicaciones/buscar** and **GET /api/geocode/reverso** — Currently return 503 (Google Maps not configured on server). Tools should handle this gracefully with a fallback message.

</details>

---

## Task 1: Create `supra-client.ts` REST client

**Files:**
- Create: `src/services/supra-client.ts`

- [ ] **Step 1: Create the supra-client with all typed methods**

```typescript
// src/services/supra-client.ts
// ============================================
// SUPRA REST Client
// Thin wrapper over fetch for all SUPRA API calls
// ============================================

const SUPRA_BASE = process.env.SUPRA_API_BASE || "https://supra-back.whoopflow.com";

// ============================================
// Types
// ============================================

export interface SupraResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

export interface SupraContrato {
    contrato: string;
    nombreTitular: string;
    direccion: string;
    calle: string;
    numero: string;
    colonia: string;
    municipio: string;
    cp: string;
    tarifa: string;
    estado: string;
    fechaAlta: string;
    numeroMedidor: string;
    ultimaLectura: string;
}

export interface SupraDeuda {
    contrato: string;
    nombreCliente: string;
    direccion: string;
    totalDeuda: number;
    vencido: number;
    porVencer: number;
    cantidadFacturas: number;
    facturas: SupraFactura[];
}

export interface SupraFactura {
    numFactura: string;
    ciclo: string;
    fechaVencimiento: string;
    importeTotal: number;
    estadoTexto: string;
}

export interface SupraConsumos {
    contrato: string;
    promedioMensual: number;
    tendencia: string;
    consumos: SupraConsumo[];
}

export interface SupraConsumo {
    periodo: string;
    consumoM3: number;
    tipoLectura: string;
    fechaLectura: string;
    lecturaActual: number;
    lecturaAnterior: number;
}

export interface SupraRecibos {
    contrato: string;
    recibos: SupraRecibo[];
}

export interface SupraRecibo {
    numFactura: string;
    periodo: string;
    importeTotal: number;
    estadoTexto: string;
    fechaVencimiento: string;
    downloadUrl: string;
}

export interface SupraValidacion {
    contrato: string;
    validated: boolean;
    confidence: number;
    method: string;
    titularEncontrado: string;
}

export interface SupraCliente {
    id: number;
    nombre: string;
    contrato: string;
    email: string | null;
    telefono: string | null;
    whatsapp: string | null;
    reciboDigital: boolean;
    identifier: string | null;
}

export interface SupraTicketCreated {
    folio: string;
    ticketId: number;
    status: string;
}

export interface SupraTicket {
    folio: string;
    status: string;
    titulo: string;
    descripcion: string;
    createdAt: string;
    prioridad: string;
    tipoServicio?: string;
    categoria?: string | null;
    subcategoria?: string | null;
}

export interface SupraTicketUpdated {
    folio: string;
    message: string;
}

export interface SupraUbicacion {
    id: number;
    nombre: string;
    tipo: string;
    tipoLabel: string;
    direccion: string;
    direccionCalle: string;
    colonia: string;
    municipio: string;
    latitud: number;
    longitud: number;
    distancia: string;
    distanciaMetros: number;
    horario: Record<string, string>;
    telefono: string | null;
    servicios: string;
    notas: string | null;
    mapsUrl: string;
}

export interface SupraGeocode {
    formatted_address: string;
    street: string | null;
    street_number: string | null;
    colonia: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    latitude: number;
    longitude: number;
    maps_link: string;
}

// ============================================
// Fetch wrapper
// ============================================

async function supraFetch<T>(path: string, options?: RequestInit): Promise<SupraResponse<T>> {
    const url = `${SUPRA_BASE}${path}`;
    console.log(`[SUPRA] ${options?.method || "GET"} ${path}`);

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...options?.headers,
            },
            signal: AbortSignal.timeout(15000),
        });

        const json = await response.json() as SupraResponse<T>;

        if (!response.ok || !json.success) {
            console.error(`[SUPRA] Error: ${json.error || `HTTP ${response.status}`}`);
            return { success: false, error: json.error || `HTTP ${response.status}` };
        }

        return json;
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`[SUPRA] Fetch error: ${message}`);
        return { success: false, error: message };
    }
}

// ============================================
// Contratos
// ============================================

export async function getContrato(id: string): Promise<SupraResponse<SupraContrato>> {
    return supraFetch(`/api/contrato/${encodeURIComponent(id)}`);
}

export async function getDeuda(id: string): Promise<SupraResponse<SupraDeuda>> {
    return supraFetch(`/api/contrato/${encodeURIComponent(id)}/deuda`);
}

export async function getConsumos(id: string): Promise<SupraResponse<SupraConsumos>> {
    return supraFetch(`/api/contrato/${encodeURIComponent(id)}/consumos`);
}

export async function getRecibos(id: string): Promise<SupraResponse<SupraRecibos>> {
    return supraFetch(`/api/contrato/${encodeURIComponent(id)}/recibos`);
}

export async function validarContrato(id: string, nombre: string): Promise<SupraResponse<SupraValidacion>> {
    return supraFetch("/api/contrato/validar", {
        method: "POST",
        body: JSON.stringify({ contrato: id, nombre }),
    });
}

// ============================================
// Clientes
// ============================================

export async function getCliente(contrato: string): Promise<SupraResponse<SupraCliente>> {
    return supraFetch(`/api/cliente?contrato=${encodeURIComponent(contrato)}`);
}

// ============================================
// Tickets
// ============================================

export interface CreateTicketBody {
    contratoNumero?: string;
    titulo: string;
    descripcion: string;
    prioridad: string;
    tipoServicio?: string;
    conversationId?: string | number;
    categoria?: string;
    subcategoria?: string;
    clientName?: string;
    phone?: string;
    email?: string;
    ubicacion?: string;
    latitude?: number;
    longitude?: number;
}

export async function createTicket(body: CreateTicketBody): Promise<SupraResponse<SupraTicketCreated>> {
    return supraFetch("/api/tickets", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

export async function getTicketsByContrato(contrato: string): Promise<SupraResponse<SupraTicket[]>> {
    return supraFetch(`/api/tickets?contrato=${encodeURIComponent(contrato)}`);
}

export async function getTicketsByConversation(conversationId: string | number): Promise<SupraResponse<SupraTicket[]>> {
    return supraFetch(`/api/tickets?conversation_id=${encodeURIComponent(String(conversationId))}`);
}

export async function getTicketByFolio(folio: string): Promise<SupraResponse<SupraTicket>> {
    return supraFetch(`/api/tickets/folio/${encodeURIComponent(folio)}`);
}

export interface UpdateTicketBody {
    estado?: string;
    prioridad?: string;
    notas?: string;
}

export async function updateTicket(id: string | number, body: UpdateTicketBody): Promise<SupraResponse<SupraTicketUpdated>> {
    return supraFetch(`/api/tickets/${encodeURIComponent(String(id))}`, {
        method: "PUT",
        body: JSON.stringify(body),
    });
}

// ============================================
// Ubicaciones
// ============================================

export interface UbicacionQuery {
    lat?: number;
    lng?: number;
    tipo?: string;
    limite?: number;
}

export async function getUbicaciones(params: UbicacionQuery): Promise<SupraResponse<SupraUbicacion[]>> {
    const searchParams = new URLSearchParams();
    if (params.lat !== undefined) searchParams.set("lat", String(params.lat));
    if (params.lng !== undefined) searchParams.set("lng", String(params.lng));
    if (params.tipo && params.tipo !== "all") searchParams.set("tipo", params.tipo);
    if (params.limite) searchParams.set("limite", String(params.limite));
    return supraFetch(`/api/ubicaciones/cercanas?${searchParams}`);
}

export async function buscarUbicacion(textQuery: string): Promise<SupraResponse<SupraUbicacion[]>> {
    return supraFetch("/api/ubicaciones/buscar", {
        method: "POST",
        body: JSON.stringify({ textQuery }),
    });
}

export async function reverseGeocode(lat: number, lng: number): Promise<SupraResponse<SupraGeocode>> {
    return supraFetch(`/api/geocode/reverso?lat=${lat}&lng=${lng}`);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsc --noEmit src/services/supra-client.ts`
Expected: No errors (file is self-contained, no imports from other project files).

- [ ] **Step 3: Smoke-test one endpoint**

Run: `cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsx -e "import { getDeuda } from './src/services/supra-client.js'; getDeuda('SUP-002').then(r => console.log(JSON.stringify(r, null, 2)))"`
Expected: JSON with `success: true` and `data.totalDeuda` as a number.

- [ ] **Step 4: Commit**

```bash
git add src/services/supra-client.ts
git commit -m "feat(atlantis): add SUPRA REST client

Typed fetch wrapper for all SUPRA API endpoints: contratos, deuda,
consumos, recibos, validation, tickets, ubicaciones, geocoding."
```

---

## Task 2: Rewrite `tools/cea-api.ts` → `tools/supra-api.ts`

**Files:**
- Delete: `src/tools/cea-api.ts`
- Create: `src/tools/supra-api.ts`

- [ ] **Step 1: Create supra-api.ts with all four tools**

```typescript
// src/tools/supra-api.ts
// ============================================
// Hydropolis API Tools - Debt, Consumption, Contract, Recibo
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getDeuda, getConsumos, getContrato, getRecibos } from "../services/supra-client.js";
import { renderTemplate } from "../config/response-templates.js";

// ============================================
// GET DEUDA
// ============================================

export const getDeudaTool = tool(
    "get_deuda",
    `Obtiene el saldo y adeudo de un contrato Hydropolis.

RETORNA:
- totalDeuda: Total a pagar
- vencido: Monto vencido
- porVencer: Monto por vencer
- facturas: Desglose de facturas pendientes

Usa este tool cuando el usuario pregunte por su saldo, deuda, cuánto debe, o quiera pagar.`,
    {
        contrato: z.string().describe("Número de contrato Hydropolis (ej: SUP-001)")
    },
    async ({ contrato }) => {
        console.log(`[get_deuda] Fetching debt for contract: ${contrato}`);

        const result = await getDeuda(contrato);

        if (!result.success || !result.data) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: result.error,
                formatted_response: `No encontré información de adeudo para el contrato ${contrato}. ¿Puedes verificar el número?`
            }) }] };
        }

        const data = result.data;

        if (data.totalDeuda === 0) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                formatted_response: `Tu contrato ${contrato} no tiene adeudos pendientes.\n\n¿Te puedo ayudar con algo más?`,
                data: { contrato, totalDeuda: 0, mensaje: "sin adeudo" }
            }) }] };
        }

        let formattedResponse = `Estado de cuenta del contrato ${contrato}:\n\n`;
        formattedResponse += `💰 **Total a pagar: $${data.totalDeuda.toFixed(2)}**\n`;
        if (data.nombreCliente) formattedResponse += `👤 Cliente: ${data.nombreCliente}\n`;

        if (data.vencido > 0) formattedResponse += `🔴 Vencido: $${data.vencido.toFixed(2)}\n`;
        if (data.porVencer > 0) formattedResponse += `🟡 Por vencer: $${data.porVencer.toFixed(2)}\n`;

        if (data.facturas.length > 0) {
            formattedResponse += `\n📋 **Recibos pendientes:**\n`;
            for (const factura of data.facturas) {
                const emoji = factura.estadoTexto === "vencido" ? "🔴" : "🟡";
                const venceInfo = factura.fechaVencimiento
                    ? ` - Vence: ${new Date(factura.fechaVencimiento).toLocaleDateString("es-MX")}`
                    : "";
                formattedResponse += `${emoji} ${factura.ciclo}: $${factura.importeTotal.toFixed(2)} (${factura.estadoTexto})${venceInfo}\n`;
            }
        }

        formattedResponse += `\n¿Quieres realizar un pago o tienes dudas sobre tu saldo?`;

        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            formatted_response: formattedResponse,
            data: {
                contrato,
                totalDeuda: data.totalDeuda,
                vencido: data.vencido,
                porVencer: data.porVencer,
                nombreCliente: data.nombreCliente,
                facturas: data.facturas
            }
        }) }] };
    }
);

// ============================================
// GET CONSUMO
// ============================================

export const getConsumoTool = tool(
    "get_consumo",
    `Obtiene el historial de consumo de agua de un contrato.

PARÁMETROS:
- contrato: Número de contrato Hydropolis (requerido)
- year: Año específico para filtrar (opcional, ej: 2022, 2023)

RETORNA:
- consumos: Lista de consumos por periodo (m³) con año y mes
- promedioMensual: Promedio de consumo mensual
- tendencia: Si el consumo está aumentando, estable o disminuyendo

Usa cuando el usuario pregunte por su consumo, historial de lecturas, o cuánta agua ha gastado.
Si el usuario pide un año específico (ej: "consumo de 2022"), usa el parámetro year para filtrar.`,
    {
        contrato: z.string().describe("Número de contrato Hydropolis"),
        year: z.number().optional().describe("Año específico para filtrar los consumos (ej: 2022)")
    },
    async ({ contrato, year }) => {
        console.log(`[get_consumo] Fetching consumption for contract: ${contrato}, year: ${year || "all"}`);

        const result = await getConsumos(contrato);

        if (!result.success || !result.data) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: result.error || "No data found"
            }) }] };
        }

        const data = result.data;

        // Extract year from periodo string (e.g., "MAR 2026" → 2026)
        const parseYear = (periodo: string): number => {
            const match = periodo.match(/\d{4}/);
            return match ? parseInt(match[0]) : 0;
        };

        let consumosFiltrados = data.consumos;
        if (year) {
            consumosFiltrados = data.consumos.filter(c => parseYear(c.periodo) === year);
        }

        const añosDisponibles = [...new Set(data.consumos.map(c => parseYear(c.periodo)))].filter(a => a > 0).sort((a, b) => b - a);

        const promedioFiltrado = consumosFiltrados.length > 0
            ? consumosFiltrados.reduce((sum, c) => sum + c.consumoM3, 0) / consumosFiltrados.length
            : 0;

        const totalAño = consumosFiltrados.reduce((sum, c) => sum + c.consumoM3, 0);

        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            contrato,
            yearConsultado: year || "todos",
            yearsDisponibles: añosDisponibles,
            totalRegistros: data.consumos.length,
            registrosFiltrados: consumosFiltrados.length,
            promedioMensual: Math.round(promedioFiltrado),
            totalConsumoM3: totalAño,
            tendencia: data.tendencia,
            consumos: consumosFiltrados.map(c => ({
                periodo: c.periodo,
                consumoM3: c.consumoM3,
                tipoLectura: c.tipoLectura
            })),
            resumen: year
                ? `Consumo ${year}: Total ${totalAño.toFixed(0)} m³, Promedio mensual ${Math.round(promedioFiltrado)} m³`
                : `Historial completo: ${data.consumos.length} registros`
        }) }] };
    }
);

// ============================================
// GET CONTRACT DETAILS
// ============================================

export const getContratoTool = tool(
    "get_contract_details",
    `Obtiene los detalles de un contrato Hydropolis.

RETORNA:
- titular: Nombre del titular
- direccion: Dirección del servicio
- tarifa: Tipo de tarifa
- estado: Estado del contrato (activo/suspendido/cortado)

Usa para validar un contrato o conocer detalles del servicio.`,
    {
        contrato: z.string().describe("Número de contrato Hydropolis")
    },
    async ({ contrato }) => {
        console.log(`[get_contract_details] Fetching contract: ${contrato}`);

        const result = await getContrato(contrato);

        if (!result.success || !result.data) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: result.error,
                formatted_response: `No encontré información para el contrato ${contrato}. ¿Puedes verificar el número?`
            }) }] };
        }

        const data = result.data;
        const formattedResponse = renderTemplate("contract_info", {
            contract_number: contrato,
            titular: data.nombreTitular,
            direccion: data.direccion,
            colonia: data.colonia,
            tarifa: data.tarifa,
            estado: data.estado
        });

        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            formatted_response: formattedResponse,
            data: {
                numeroContrato: data.contrato,
                titular: data.nombreTitular,
                direccion: data.direccion,
                colonia: data.colonia,
                codigoPostal: data.cp,
                tarifa: data.tarifa,
                estado: data.estado,
                fechaAlta: data.fechaAlta,
                ultimaLectura: data.ultimaLectura
            }
        }) }] };
    }
);

// ============================================
// GET RECIBO PDF LINK
// ============================================

export const getReciboPdfTool = tool(
    "get_recibo_link",
    `Genera un enlace seguro para descargar el recibo digital (PDF) de un contrato.

USA ESTA HERRAMIENTA CUANDO:
- El usuario pida que le envíen su recibo digital
- El usuario quiera descargar su recibo
- El usuario pregunte cómo obtener su recibo

PARÁMETROS:
- contrato: Número de contrato Hydropolis (requerido)
- periodo: Mes específico si el usuario pide un recibo de un mes en particular (opcional, ej: "enero", "febrero 2025")

Siempre ofrece: "Si necesitas de otro mes avísame y te ayudo"`,
    {
        contrato: z.string().describe("Número de contrato Hydropolis"),
        periodo: z.string().optional().describe("Periodo específico si el usuario pide un mes en particular (ej: 'enero', 'febrero 2025')")
    },
    async ({ contrato, periodo }) => {
        console.log(`[get_recibo_link] Fetching recibos for contract: ${contrato}, periodo: ${periodo || "latest"}`);

        const result = await getRecibos(contrato);

        if (!result.success || !result.data || result.data.recibos.length === 0) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                formatted_response: `No encontré recibos disponibles para el contrato ${contrato}. ¿Puedes verificar el número de contrato?`
            }) }] };
        }

        const recibos = result.data.recibos;
        let target = recibos[0]; // default: most recent

        if (periodo) {
            const periodoLower = periodo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const match = recibos.find(r => {
                const textoLower = r.periodo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return textoLower.includes(periodoLower) || periodoLower.includes(textoLower);
            });

            if (!match) {
                const available = recibos.map(r => r.periodo).join(", ");
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    formatted_response: `No encontré un recibo para "${periodo}". Los recibos disponibles son: ${available}. ¿De cuál mes necesitas el recibo?`
                }) }] };
            }
            target = match;
        }

        const formattedResponse = `Aquí está tu recibo de *${target.periodo}* del contrato ${contrato}:\n\n` +
            `📄 ${target.downloadUrl}\n\n` +
            `Si necesitas de otro mes avísame y te ayudo.`;

        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            formatted_response: formattedResponse,
            data: {
                contrato,
                factura: target.numFactura,
                periodo: target.periodo,
                download_url: target.downloadUrl
            }
        }) }] };
    }
);
```

- [ ] **Step 2: Delete the old cea-api.ts**

```bash
rm src/tools/cea-api.ts
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsc --noEmit src/tools/supra-api.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/supra-api.ts
git rm src/tools/cea-api.ts
git commit -m "feat(atlantis): rewrite API tools to use SUPRA REST

Replace SOAP XML calls with simple fetch+JSON for get_deuda,
get_consumo, get_contract_details, and get_recibo_link."
```

---

## Task 3: Rewrite `tools/identity.ts`

**Files:**
- Rewrite: `src/tools/identity.ts`

- [ ] **Step 1: Rewrite identity.ts**

```typescript
// src/tools/identity.ts
// ============================================
// Identity Tools - Contract holder validation, customer search
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { validarContrato, getCliente } from "../services/supra-client.js";
import type { RequestContext } from "../types.js";

// ============================================
// VALIDATE CONTRACT HOLDER (context tool)
// ============================================

export function createValidateContractHolderTool(ctx: RequestContext) {
    return tool(
        "validate_contract_holder",
        `Valida la identidad del usuario comparando el nombre proporcionado con el titular del contrato.

USA ESTA HERRAMIENTA ANTES de mostrar datos sensibles (saldo, detalles, consumo, tickets) de un contrato.

PARÁMETROS:
- contrato: Número de contrato Hydropolis
- nombre_proporcionado: Nombre o apellido que el usuario proporcionó

RETORNA:
- validated: true si el nombre coincide con el titular
- validated: false si no coincide
- skipped: true si no se pudo verificar (error de API)`,
        {
            contrato: z.string().describe("Número de contrato Hydropolis"),
            nombre_proporcionado: z.string().describe("Nombre o apellido proporcionado por el usuario")
        },
        async ({ contrato, nombre_proporcionado }) => {
            console.log(`[validate_contract_holder] Validating "${nombre_proporcionado}" against contract ${contrato}`);

            const result = await validarContrato(contrato, nombre_proporcionado);

            if (!result.success || !result.data) {
                console.log(`[validate_contract_holder] API error, skipping verification`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: true,
                    skipped: true,
                    reason: "No se pudo verificar, se omite validación"
                }) }] };
            }

            const data = result.data;

            if (data.validated) {
                ctx.verifiedContracts.add(contrato);
                console.log(`[validate_contract_holder] Contract ${contrato} verified for conversation ${ctx.conversationId}`);

                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: true,
                    confidence: data.confidence,
                    method: data.method
                }) }] };
            }

            return { content: [{ type: "text" as const, text: JSON.stringify({
                validated: false,
                message: "El nombre no coincide con el titular del contrato. ¿Puedes verificar e intentarlo de nuevo?"
            }) }] };
        }
    );
}

// ============================================
// SEARCH CUSTOMER BY CONTRACT
// ============================================

export const searchCustomerByContractTool = tool(
    "search_customer_by_contract",
    "Busca un cliente por su número de contrato en la base de datos Hydropolis (AGORA contacts).",
    {
        contract_number: z.string().describe("Número de contrato Hydropolis")
    },
    async ({ contract_number }) => {
        console.log(`[search_customer] Searching for contract: ${contract_number}`);

        const result = await getCliente(contract_number);

        if (!result.success || !result.data) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                found: false,
                message: "Cliente no encontrado"
            }) }] };
        }

        const data = result.data;
        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            found: true,
            customer: {
                id: data.id,
                nombre: data.nombre,
                contrato: data.contrato,
                email: data.email,
                whatsapp: data.whatsapp || data.telefono,
                recibo_digital: data.reciboDigital
            }
        }) }] };
    }
);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsc --noEmit src/tools/identity.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/identity.ts
git commit -m "feat(atlantis): rewrite identity tools to use SUPRA REST

Replace SOAP+fuzzy matching with POST /api/contrato/validar.
Replace PG query with GET /api/cliente."
```

---

## Task 4: Rewrite `tools/tickets.ts`

**Files:**
- Rewrite: `src/tools/tickets.ts`

- [ ] **Step 1: Rewrite tickets.ts**

```typescript
// src/tools/tickets.ts
// ============================================
// Ticket Tools - Create, List, Update, Lookup
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
    createTicket as supraCreateTicket,
    getTicketsByContrato,
    getTicketsByConversation,
    getTicketByFolio,
    updateTicket as supraUpdateTicket,
} from "../services/supra-client.js";
import type { RequestContext, CategoryCode, TicketPriority } from "../types.js";
import { getCategoryEmoji, getTicketEmoji, renderTemplate } from "../config/response-templates.js";

// ============================================
// CREATE TICKET (context tool)
// ============================================

export function createCreateTicketTool(ctx: RequestContext) {
    return tool(
        "create_ticket",
        `Crea un ticket en el sistema AGORA Hydropolis y retorna el folio generado.

CATEGORÍAS (AGORA - códigos directos de BD):
- INF: Información (consultas generales, consumos, horarios, requisitos)
- FAC: Facturación (recibos, aclaraciones, ajustes, pagos, convenios)
- TRA: Trámites (contratos nuevos, cambios titular, fracturas, adendas)
- REP: Reportes de servicio (fugas, drenaje, calidad del agua)
- SRV: Servicios técnicos (medidores, instalaciones, revisiones)

⚠️ CUÁNDO PEDIR CONTRATO:
- REP (fugas en vía pública, drenaje en calle): NO pidas contrato, solo ubicación
- REP (fuga de medidor, problema dentro de propiedad): SÍ pide contrato
- FAC, TRA, SRV: SÍ requieren contrato
- INF: Depende de la consulta

IMPORTANTE: Siempre incluye el folio en tu respuesta al usuario.`,
        {
            category_code: z.enum(["INF", "FAC", "TRA", "REP", "SRV"])
                .describe("Código de categoría AGORA (directo de BD)"),
            subcategory_code: z.string().optional()
                .describe("Código de subcategoría (ej: FAC-DIG, REP-FG-001)"),
            titulo: z.string().describe("Título breve del ticket"),
            descripcion: z.string().describe("Descripción detallada del problema"),
            contract_number: z.string().optional().describe("Número de contrato - NO requerido para fugas/drenaje en vía pública"),
            client_name: z.string().optional().describe("Nombre del cliente (del perfil de WhatsApp o proporcionado)"),
            phone: z.string().optional().describe("Teléfono del cliente (del perfil de WhatsApp)"),
            email: z.string().optional().describe("Email del cliente (si aplica)"),
            ubicacion: z.string().optional().describe("Ubicación - REQUERIDO para reportes REP en vía pública"),
            latitude: z.number().optional().describe("Latitud de la ubicación"),
            longitude: z.number().optional().describe("Longitud de la ubicación"),
            priority: z.enum(["low", "medium", "high", "urgent"]).default("medium")
                .describe("Prioridad del ticket")
        },
        async (input) => {
            console.log(`[create_ticket] Context: conv=${ctx.chatwootConversationId}, acct=${ctx.chatwootAccountId}`);

            const result = await supraCreateTicket({
                contratoNumero: input.contract_number,
                titulo: input.titulo,
                descripcion: input.descripcion,
                prioridad: input.priority,
                tipoServicio: input.subcategory_code || input.category_code,
                conversationId: ctx.chatwootConversationId || undefined,
                categoria: input.category_code,
                subcategoria: input.subcategory_code,
                clientName: input.client_name,
                phone: input.phone,
                email: input.email,
                ubicacion: input.ubicacion,
                latitude: input.latitude,
                longitude: input.longitude,
            });

            if (!result.success || !result.data) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    formatted_response: "No pude crear tu ticket en este momento. ¿Podrías intentar de nuevo en unos minutos?"
                }) }] };
            }

            // Clear pendingLectura flag after successful FAC-LEC ticket
            if (input.subcategory_code === "FAC-LEC" && ctx.onLecturaTicketCreated) {
                ctx.onLecturaTicketCreated();
            }

            const emoji = getCategoryEmoji(input.category_code) || getTicketEmoji(input.titulo);
            const formattedResponse = renderTemplate("ticket_created", {
                folio: result.data.folio,
                emoji,
                tipo: input.titulo,
                ubicacion: input.ubicacion || "",
                estatus: result.data.status
            });

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                folio: result.data.folio,
                ticketId: String(result.data.ticketId),
                message: `Ticket creado exitosamente con folio ${result.data.folio}`,
                formatted_response: formattedResponse
            }) }] };
        }
    );
}

// ============================================
// GET CLIENT TICKETS (context tool)
// ============================================

export function createGetClientTicketsTool(ctx: RequestContext) {
    return tool(
        "get_client_tickets",
        `Obtiene los tickets de un cliente. Dos modos:

1. SIN contract_number: Busca tickets de esta conversación (no requiere verificación de identidad)
2. CON contract_number: Busca tickets por contrato (requiere verificación previa)

Cuando el usuario pide "mis tickets" sin especificar contrato, usa modo 1 primero.
Después de mostrar resultados, pregunta: "¿Quieres ver tickets relacionados a un contrato?"

RETORNA lista de tickets con:
- folio: Número de ticket
- status: Estado (abierto, en_proceso, cerrado, etc.)
- titulo: Título del ticket
- created_at: Fecha de creación`,
        {
            contract_number: z.string().optional().describe("Número de contrato Hydropolis (opcional - si no se da, busca por conversación)")
        },
        async ({ contract_number }) => {
            const queryMode = contract_number ? "contract" : "conversation";
            console.log(`[get_client_tickets] Mode: ${queryMode}`);

            const result = contract_number
                ? await getTicketsByContrato(contract_number)
                : await getTicketsByConversation(ctx.chatwootConversationId);

            if (!result.success) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: result.error || "No se pudieron consultar los tickets"
                }) }] };
            }

            const tickets = result.data || [];

            if (tickets.length === 0) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    tickets: [],
                    query_mode: queryMode,
                    message: contract_number
                        ? "No se encontraron tickets para este contrato"
                        : "No se encontraron tickets en esta conversación"
                }) }] };
            }

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                query_mode: queryMode,
                tickets: tickets.map(t => ({
                    folio: t.folio,
                    status: t.status,
                    titulo: t.titulo,
                    service_type: t.tipoServicio,
                    created_at: t.createdAt,
                    descripcion: t.descripcion?.substring(0, 100)
                })),
                count: tickets.length
            }) }] };
        }
    );
}

// ============================================
// LOOKUP TICKET BY FOLIO
// ============================================

export const lookupTicketByFolioTool = tool(
    "lookup_ticket_by_folio",
    `Busca un ticket específico por su número de folio o ticket.

USA ESTA HERRAMIENTA CUANDO:
- El usuario da un número de ticket/reporte/folio específico
- Ej: "quiero checar mi reporte 12345", "mi ticket ABC-999", "estatus del folio CEA-456"

SI NO SE ENCUENTRA:
- Dile al usuario: "No pude encontrar ese número de ticket en nuestro sistema. Déjame canalizarte con un asesor para que te ayude mejor."
- Luego usa handoff_to_human con razón "Ticket no encontrado en sistema: {folio}"`,
    {
        folio: z.string().describe("Número de folio/ticket que dio el usuario (tal cual lo proporcionó)")
    },
    async ({ folio }) => {
        console.log(`[lookup_ticket_by_folio] Looking up folio: ${folio}`);

        const result = await getTicketByFolio(folio);

        if (!result.success || !result.data) {
            console.log(`[lookup_ticket_by_folio] Not found: ${folio}`);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                found: false,
                message: "No se encontró ningún ticket con ese folio en nuestro sistema"
            }) }] };
        }

        const t = result.data;
        console.log(`[lookup_ticket_by_folio] Found: ${t.folio} (status: ${t.status})`);
        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            found: true,
            ticket: {
                folio: t.folio,
                status: t.status,
                titulo: t.titulo,
                descripcion: t.descripcion?.substring(0, 200),
                created_at: t.createdAt,
                priority: t.prioridad
            }
        }) }] };
    }
);

// ============================================
// UPDATE TICKET
// ============================================

export const updateTicketTool = tool(
    "update_ticket",
    `Actualiza el estado u otros campos de un ticket existente.

⚠️ RESTRICCIÓN IMPORTANTE:
- Los usuarios NO pueden cerrar tickets
- Si el usuario pide cerrar un ticket, usa handoff_to_human en su lugar
- Solo los agentes humanos pueden marcar tickets como "cerrado"

ESTADOS PERMITIDOS para María:
- en_proceso, esperando_cliente, escalado`,
    {
        folio: z.string().describe("Folio del ticket a actualizar"),
        status: z.enum(["abierto", "en_proceso", "cerrado"]).optional()
            .describe("Nuevo estado del ticket"),
        priority: z.enum(["baja", "media", "alta", "urgente"]).optional()
            .describe("Nueva prioridad del ticket"),
        notes: z.string().optional().describe("Notas adicionales")
    },
    async ({ folio, status, priority, notes }) => {
        console.log(`[update_ticket] Updating ticket: ${folio}`);

        // RESTRICTION: Users cannot close tickets
        if (status === "cerrado") {
            console.log(`[update_ticket] BLOCKED: User attempted to close ticket`);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                blocked: true,
                formatted_response: "Los tickets solo pueden ser cerrados por un asesor. Te comunico con uno para que te ayude con esto 👤"
            }) }] };
        }

        // We need the ticket ID to call PUT /api/tickets/:id
        // First look up the ticket by folio to get the ID
        const lookup = await getTicketByFolio(folio);
        if (!lookup.success || !lookup.data) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: "Ticket no encontrado"
            }) }] };
        }

        const result = await supraUpdateTicket(folio, {
            estado: status,
            prioridad: priority,
            notas: notes,
        });

        if (!result.success) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: result.error || "Error al actualizar ticket"
            }) }] };
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            folio,
            message: `Ticket ${folio} actualizado correctamente`
        }) }] };
    }
);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsc --noEmit src/tools/tickets.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/tickets.ts
git commit -m "feat(atlantis): rewrite ticket tools to use SUPRA REST

Replace direct PG INSERT/SELECT/UPDATE with SUPRA REST endpoints.
Remove local folio generation and dedup map."
```

---

## Task 5: Rewrite `tools/location.ts`

**Files:**
- Rewrite: `src/tools/location.ts`

- [ ] **Step 1: Rewrite location.ts**

```typescript
// src/tools/location.ts
// ============================================
// Location Tools - Offices, nearest locations, geocoding
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getUbicaciones, buscarUbicacion, reverseGeocode as supraReverseGeocode } from "../services/supra-client.js";

// ============================================
// GET MAIN OFFICE
// ============================================

export const getMainOfficeTool = tool(
    "get_main_office",
    `Obtiene la información de la oficina principal de Hydropolis.
    Devuelve nombre, dirección, teléfono y horario actualizados.
    Usa esta herramienta SIEMPRE que necesites dar información de oficinas, horarios o teléfonos de Hydropolis.
    NUNCA des esta información de memoria.`,
    {},
    async () => {
        console.log("[get_main_office] Querying main office info");

        const result = await getUbicaciones({ tipo: "oficina", limite: 1 });

        if (!result.success || !result.data || result.data.length === 0) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                formatted_response: "Oficina principal Hydropolis. Línea Hydropolis: 442-441-0000. Horario: Lun-Vie 8:00-17:00."
            }) }] };
        }

        const hq = result.data[0];
        let schedule = "Lun-Vie 8:00-17:00";
        if (hq.horario) {
            if (hq.horario.lun_vie) schedule = `Lun-Vie ${hq.horario.lun_vie}`;
            if (hq.horario.sab && hq.horario.sab !== "Cerrado") schedule += `, Sáb ${hq.horario.sab}`;
        }

        const info = `*${hq.nombre}*\nDirección: ${hq.direccion}\nTeléfono: ${hq.telefono || "442-441-0000"}\nHorario: ${schedule}`;

        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            formatted_response: info
        }) }] };
    }
);

// ============================================
// FIND NEAREST LOCATIONS
// ============================================

export const findNearestLocationsTool = tool(
    "find_nearest_locations",
    `Encuentra las oficinas, cajeros y puntos de pago Hydropolis más cercanos al usuario.

PARÁMETROS:
- lat/lng: Coordenadas GPS (de ubicación compartida por WhatsApp)
- colonia: Nombre de la colonia del usuario (se busca por coincidencia aproximada)
- tipo: Filtrar por "oficina", "cajero", o "all" (default: "all")
- limit: Máximo de resultados (default: 3)

USA ESTA HERRAMIENTA CUANDO:
- El usuario pregunte "¿dónde puedo pagar?"
- El usuario pregunte por oficinas o cajeros cercanos
- El usuario comparta su ubicación GPS
- El usuario mencione su colonia y pregunte por ubicaciones

IMPORTANTE:
- Si el usuario comparte ubicación GPS, usa lat/lng
- Si el usuario dice su colonia, usa el parámetro colonia
- Si no tienes ni ubicación ni colonia, pregúntale al usuario antes de llamar este tool`,
    {
        lat: z.number().optional().describe("Latitud GPS del usuario"),
        lng: z.number().optional().describe("Longitud GPS del usuario"),
        colonia: z.string().optional().describe("Nombre de la colonia del usuario"),
        tipo: z.enum(["oficina", "cajero", "all"]).default("all").describe("Tipo de ubicación a buscar"),
        limit: z.number().default(3).describe("Máximo de resultados a retornar")
    },
    async ({ lat, lng, colonia, tipo, limit }) => {
        console.log(`[find_nearest_locations] lat=${lat}, lng=${lng}, colonia="${colonia}", tipo=${tipo}, limit=${limit}`);

        let searchLat = lat;
        let searchLng = lng;
        let searchMethod = "gps";

        // If no GPS, try to resolve colonia via location search
        if ((searchLat === undefined || searchLng === undefined) && colonia) {
            searchMethod = "colonia";
            console.log(`[find_nearest_locations] Resolving colonia: "${colonia}"`);

            const coloniaResult = await buscarUbicacion(colonia + " Querétaro");

            if (coloniaResult.success && coloniaResult.data && coloniaResult.data.length > 0) {
                searchLat = coloniaResult.data[0].latitud;
                searchLng = coloniaResult.data[0].longitud;
                console.log(`[find_nearest_locations] Resolved colonia to ${searchLat}, ${searchLng}`);
            } else {
                // Fallback: return main office info
                const fallback = await getUbicaciones({ tipo: "oficina", limite: 1 });
                const fallbackText = fallback.success && fallback.data?.[0]
                    ? `*${fallback.data[0].nombre}*\n📍 ${fallback.data[0].direccion}\n📞 ${fallback.data[0].telefono}`
                    : "Oficina principal Hydropolis. Línea: 442-441-0000.";

                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: "colonia_not_found",
                    formatted_response: `No encontré la colonia "${colonia}". ¿Me puedes compartir tu ubicación o decirme otra referencia de zona?\n\n${fallbackText}`
                }) }] };
            }
        }

        if (searchLat === undefined || searchLng === undefined) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: "no_location",
                formatted_response: "Para encontrar la oficina o cajero más cercano, necesito tu ubicación. ¿Me puedes compartir tu ubicación por WhatsApp o decirme en qué colonia estás?"
            }) }] };
        }

        const result = await getUbicaciones({ lat: searchLat, lng: searchLng, tipo, limite: limit });

        if (!result.success || !result.data || result.data.length === 0) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                search_method: searchMethod,
                data: { locations: [] },
                formatted_response: "No encontré ubicaciones cercanas del tipo solicitado."
            }) }] };
        }

        // Build WhatsApp-friendly formatted response
        let formatted = "";
        for (let i = 0; i < result.data.length; i++) {
            const loc = result.data[i];
            const num = i + 1;
            const isOpen = loc.horario?.lun_vie && loc.horario.lun_vie !== "Cerrado";
            const statusEmoji = isOpen ? "🟢" : "🔴";
            const statusText = isOpen ? "Abierto" : "Cerrado";

            formatted += `*${num}. ${loc.nombre}* (${loc.tipoLabel})\n`;
            formatted += `📍 ${loc.direccion} — ${loc.distancia}\n`;
            formatted += `${statusEmoji} ${statusText}`;
            if (loc.horario?.lun_vie) formatted += ` | Horario: ${loc.horario.lun_vie}`;
            formatted += "\n";
            if (loc.telefono) formatted += `📞 ${loc.telefono}\n`;
            formatted += `🗺️ ${loc.mapsUrl}\n`;
            if (i < result.data.length - 1) formatted += "\n";
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            search_method: searchMethod,
            data: { locations: result.data },
            formatted_response: formatted
        }) }] };
    }
);

// ============================================
// SEARCH LOCATION
// ============================================

export const searchLocationTool = tool(
    "search_location",
    `Busca una ubicación informal o punto de referencia en Querétaro y retorna dirección estructurada con coordenadas.

USA ESTE TOOL CUANDO el usuario describe una ubicación de forma informal:
- "cerca del Oxxo del Campanario"
- "frente a la primaria Benito Juárez"
- "en la esquina de Constituyentes y 5 de Febrero"

NO uses este tool cuando el usuario ya dio una dirección completa (calle, número, colonia).

PARÁMETROS:
- query: Búsqueda estructurada que TÚ construyes a partir de lo que dijo el usuario.
  Siempre agrega "Querétaro" al final.

RETORNA: Lista de 1-3 resultados con nombre, dirección y coordenadas.`,
    {
        query: z.string().describe("Búsqueda estructurada extraída del mensaje del usuario (siempre incluir Querétaro)"),
        original_description: z.string().describe("Lo que dijo el usuario textualmente, para contexto")
    },
    async ({ query, original_description }) => {
        console.log(`[search_location] Query: "${query}" (original: "${original_description}")`);

        const result = await buscarUbicacion(query);

        if (!result.success || !result.data || result.data.length === 0) {
            // If SUPRA search fails (e.g., Google Maps not configured), return a helpful message
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                results_count: 0,
                results: [],
                formatted_response: `No encontré resultados para "${original_description}". ¿Puedes darme la dirección exacta (calle, número, colonia)?`
            }) }] };
        }

        const results = result.data.map((loc, i) => ({
            index: i + 1,
            name: loc.nombre,
            address: loc.direccion,
            latitude: loc.latitud,
            longitude: loc.longitud,
            maps_link: loc.mapsUrl
        }));

        let formatted: string;
        if (results.length === 1) {
            formatted = `Encontré esta ubicación:\n📍 ${results[0].name} — ${results[0].address}`;
        } else {
            formatted = `Encontré ${results.length} resultados:\n` +
                results.map(r => `${r.index}. ${r.name} — ${r.address}`).join("\n");
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            results_count: results.length,
            results,
            original_description,
            formatted_response: formatted
        }) }] };
    }
);

// ============================================
// REVERSE GEOCODE
// ============================================

export const reverseGeocodeTool = tool(
    "reverse_geocode",
    `Convierte coordenadas GPS (latitud/longitud) a una dirección legible.

USA ESTE TOOL CUANDO:
- El usuario compartió su ubicación GPS por WhatsApp (el mensaje contiene "[Ubicacion compartida: Lat X, Long Y]")
- Necesitas convertir coordenadas a una dirección para confirmar con el usuario

RETORNA: Dirección formateada con calle, colonia, ciudad.`,
    {
        latitude: z.number().describe("Latitud (ej: 20.5888)"),
        longitude: z.number().describe("Longitud (ej: -100.3899)")
    },
    async ({ latitude, longitude }) => {
        console.log(`[reverse_geocode] Coordinates: ${latitude}, ${longitude}`);

        const result = await supraReverseGeocode(latitude, longitude);

        if (!result.success || !result.data) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: result.error || "no_results",
                formatted_response: `Recibí tu ubicación (${latitude}, ${longitude}) pero no pude obtener la dirección. ¿Puedes decirme la calle, número y colonia?`
            }) }] };
        }

        const data = result.data;
        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            formatted_address: data.formatted_address,
            street: data.street,
            street_number: data.street_number,
            colonia: data.colonia,
            city: data.city,
            latitude,
            longitude,
            maps_link: data.maps_link,
            formatted_response: `📍 ${data.formatted_address}`
        }) }] };
    }
);
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsc --noEmit src/tools/location.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/location.ts
git commit -m "feat(atlantis): rewrite location tools to use SUPRA REST

Replace PG queries and Google Maps API with SUPRA ubicaciones
and geocode endpoints."
```

---

## Task 6: Update `tools/index.ts` imports

**Files:**
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Update imports from cea-api to supra-api**

Change this line:
```typescript
import { getDeudaTool, getConsumoTool, getContratoTool, getReciboPdfTool } from "./cea-api.js";
```
To:
```typescript
import { getDeudaTool, getConsumoTool, getContratoTool, getReciboPdfTool } from "./supra-api.js";
```

And update the re-export at the bottom:
```typescript
export { getDeudaTool, getConsumoTool, getContratoTool, getReciboPdfTool } from "./cea-api.js";
```
To:
```typescript
export { getDeudaTool, getConsumoTool, getContratoTool, getReciboPdfTool } from "./supra-api.js";
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsc --noEmit src/tools/index.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/index.ts
git commit -m "chore(atlantis): update tool imports from cea-api to supra-api"
```

---

## Task 7: Update `server.ts` — remove recibo route

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Remove recibo-related imports**

Remove these two imports:
```typescript
import { verifyReciboToken } from "./services/recibo-token.js";
import { fetchReciboPdf } from "./services/soap-client.js";
```

- [ ] **Step 2: Remove the `/recibo/:contrato` route**

Remove the entire route block (lines 60-91 in current file):
```typescript
app.get("/recibo/:contrato", async (req, res) => {
    // ... entire route ...
});
```

- [ ] **Step 3: Update the server banner**

Remove the recibo line from the banner:
```
║   • GET  /recibo/:contrato - Recibo PDF download           ║
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsc --noEmit src/server.ts`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "chore(atlantis): remove recibo proxy route from server

SUPRA provides signed download URLs directly, no local proxy needed."
```

---

## Task 8: Delete old service files

**Files:**
- Delete: `src/services/soap-client.ts`
- Delete: `src/services/name-matching.ts`
- Delete: `src/services/contract-resolver.ts`
- Delete: `src/services/recibo-token.ts`

- [ ] **Step 1: Delete all four old service files**

```bash
cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk
rm src/services/soap-client.ts
rm src/services/name-matching.ts
rm src/services/contract-resolver.ts
rm src/services/recibo-token.ts
```

- [ ] **Step 2: Verify full project compiles**

Run: `cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsc --noEmit`
Expected: No errors. If there are errors, they indicate stale imports that were missed.

- [ ] **Step 3: Commit**

```bash
git rm src/services/soap-client.ts src/services/name-matching.ts src/services/contract-resolver.ts src/services/recibo-token.ts
git commit -m "chore(atlantis): delete old SOAP/PG service files

Removed 775 lines: soap-client.ts, name-matching.ts,
contract-resolver.ts, recibo-token.ts. All replaced by supra-client.ts."
```

---

## Task 9: Update `package.json` and `.env.example`

**Files:**
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Remove pg dependencies from package.json**

Remove `"pg"` from `dependencies` and `"@types/pg"` from `devDependencies`.

- [ ] **Step 2: Run npm install to update lockfile**

```bash
cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npm install
```

- [ ] **Step 3: Rewrite .env.example**

Replace the full contents of `.env.example` with:

```env
# Anthropic API Key (required)
ANTHROPIC_API_KEY=your_api_key_here

# SUPRA API
SUPRA_API_BASE=https://supra-back.whoopflow.com

# Chatwoot Configuration
CHATWOOT_BASE_URL=
CHATWOOT_API_TOKEN=
CHATWOOT_USER_API_TOKEN=
CHATWOOT_ACCOUNT_ID=
CHATWOOT_INBOX_ID=

# Google Gemini API (for video/image analysis)
GEMINI_API_KEY=
GEMINI_CLASSIFY_MODEL=
GEMINI_ANALYZE_MODEL=
GEMINI_RECEIPT_MODEL=

# OpenAI API (for audio transcription)
OPENAI_API_KEY=

# Server Configuration
PORT=3003
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore(atlantis): remove pg dependency, update env config

Remove pg and @types/pg. Add SUPRA_API_BASE env var.
Remove 16 obsolete env vars (PG, HYDRA, CEA_PROXY, GOOGLE_MAPS, etc)."
```

---

## Task 10: Full build verification and smoke test

**Files:** None (verification only)

- [ ] **Step 1: Full TypeScript compile**

```bash
cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 2: Build**

```bash
cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npm run build
```
Expected: Compiles to `dist/` with no errors.

- [ ] **Step 3: Smoke test — hit SUPRA through the client**

```bash
cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && npx tsx -e "
import { getDeuda, getConsumos, getContrato, getRecibos, validarContrato, getCliente, getUbicaciones } from './src/services/supra-client.js';

async function test() {
    console.log('=== getDeuda SUP-002 ===');
    const d = await getDeuda('SUP-002');
    console.log('success:', d.success, 'totalDeuda:', d.data?.totalDeuda);

    console.log('=== getConsumos SUP-002 ===');
    const c = await getConsumos('SUP-002');
    console.log('success:', c.success, 'records:', c.data?.consumos?.length);

    console.log('=== getContrato SUP-006 ===');
    const ct = await getContrato('SUP-006');
    console.log('success:', ct.success, 'estado:', ct.data?.estado);

    console.log('=== getRecibos SUP-002 ===');
    const r = await getRecibos('SUP-002');
    console.log('success:', r.success, 'recibos:', r.data?.recibos?.length);

    console.log('=== validarContrato SUP-002 Ramírez ===');
    const v = await validarContrato('SUP-002', 'Ramírez');
    console.log('success:', v.success, 'validated:', v.data?.validated);

    console.log('=== getCliente SUP-002 ===');
    const cl = await getCliente('SUP-002');
    console.log('success:', cl.success, 'nombre:', cl.data?.nombre);

    console.log('=== getUbicaciones ===');
    const u = await getUbicaciones({ lat: 20.58, lng: -100.38, tipo: 'oficina', limite: 2 });
    console.log('success:', u.success, 'count:', u.data?.length);

    console.log('\\n=== ALL TESTS PASSED ===');
}
test();
"
```
Expected: All 7 calls return `success: true` with valid data.

- [ ] **Step 4: Verify no stale imports remain**

```bash
cd /Users/fernandocamacholombardo/agents-maria/maria-atlantis-sdk && grep -r "soap-client\|name-matching\|contract-resolver\|recibo-token\|CEA_API_BASE\|cea-api" src/ --include="*.ts" || echo "No stale imports found"
```
Expected: "No stale imports found"
