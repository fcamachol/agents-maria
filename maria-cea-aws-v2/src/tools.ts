// ============================================
// Maria Claude - Native Tools for Claude Agent SDK
// ============================================

import { config } from "dotenv";
config();

import crypto from "crypto";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import type {
    CreateTicketInput,
    ConsumoResponse,
    ContratoResponse,
    TicketPriority,
    RequestContext,
} from "./types.js";
import {
    renderTemplate,
    formatField,
    getCategoryEmoji,
    getTicketEmoji
} from "./config/response-templates.js";
import { updateConversationStatus } from "./chatwoot.js";
import * as ceaApi from "./services/cea-api.js";
import { resolveContract } from "./services/hydra-db.js";
import * as agoraDb from "./services/agora-db.js";
import { validateContrato, validateFolio, ValidationError } from "./services/validation.js";
import type { FacturaInfo, FacturaPendiente, DeudaContratoResult, DeudaTotalResult } from "./services/cea-api.js";

// ============================================
// Utility Functions
// ============================================

export function getMexicoDate(): Date {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
}

// ============================================
// Recibo PDF - HMAC Token Utilities
// ============================================

const RECIBO_TOKEN_SECRET = process.env.RECIBO_TOKEN_SECRET || crypto.randomBytes(32).toString("hex");
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || "https://info-cea.cea-info.workers.dev";

function generateReciboToken(contrato: string, expiresAt: number): string {
    const payload = `${contrato}:${expiresAt}`;
    return crypto.createHmac("sha256", RECIBO_TOKEN_SECRET).update(payload).digest("hex");
}

export function verifyReciboToken(contrato: string, token: string, expires: string): boolean {
    const expiresAt = parseInt(expires);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return false;
    const expected = generateReciboToken(contrato, expiresAt);
    if (token.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// ============================================
// Name Matching Utilities (for contract holder verification)
// ============================================

function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Strip diacritical marks (á→a, ñ→n, etc.)
        .replace(/\s+/g, " ")
        .trim();
}

function bigramSimilarity(a: string, b: string): number {
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

    const getBigrams = (s: string): Set<string> => {
        const bigrams = new Set<string>();
        for (let i = 0; i < s.length - 1; i++) {
            bigrams.add(s.substring(i, i + 2));
        }
        return bigrams;
    };

    const bigramsA = getBigrams(a);
    const bigramsB = getBigrams(b);
    let intersection = 0;
    for (const bg of bigramsA) {
        if (bigramsB.has(bg)) intersection++;
    }

    // Dice coefficient
    return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function matchName(userInput: string, holderName: string): { match: boolean; confidence: number; method: string } {
    const normalizedInput = normalizeName(userInput);
    const normalizedHolder = normalizeName(holderName);

    if (!normalizedInput || !normalizedHolder) {
        return { match: false, confidence: 0, method: "empty" };
    }

    // 1. Exact full match after normalization
    if (normalizedInput === normalizedHolder) {
        return { match: true, confidence: 1.0, method: "exact" };
    }

    // 2. Substring match (user's input found in holder name)
    if (normalizedHolder.includes(normalizedInput)) {
        return { match: true, confidence: 0.9, method: "substring" };
    }

    // 3. Word-level exact match (any word >=3 chars matches)
    const inputWords = normalizedInput.split(" ").filter(w => w.length >= 3);
    const holderWords = normalizedHolder.split(" ").filter(w => w.length >= 3);

    for (const iw of inputWords) {
        for (const hw of holderWords) {
            if (iw === hw) {
                return { match: true, confidence: 0.85, method: "word_match" };
            }
        }
    }

    // 4. Fuzzy word match (Dice >= 0.65 on any word pair)
    let bestScore = 0;
    for (const iw of inputWords) {
        for (const hw of holderWords) {
            if (iw.length < 5 || hw.length < 5) continue;
            const score = bigramSimilarity(iw, hw);
            if (score > bestScore) bestScore = score;
        }
    }

    if (bestScore >= 0.75) {
        return { match: true, confidence: bestScore, method: "fuzzy_word" };
    }

    // 5. No match
    return { match: false, confidence: bestScore, method: "none" };
}

// ============================================
// Verified Contracts Tracking (per conversation)
// ============================================

const verifiedContractsMap = new Map<string, Set<string>>();
const verifiedContractsTimestamps = new Map<string, number>();

// TTL-based cleanup: 2-hour expiry, 5-minute sweep
setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of verifiedContractsTimestamps.entries()) {
        if (now - ts > 7200000) {
            verifiedContractsMap.delete(id);
            verifiedContractsTimestamps.delete(id);
        }
    }
}, 300000);

export function getVerifiedContracts(conversationId: string): Set<string> {
    // Refresh timestamp on read
    if (verifiedContractsMap.has(conversationId)) {
        verifiedContractsTimestamps.set(conversationId, Date.now());
    }
    return verifiedContractsMap.get(conversationId) || new Set();
}


// ============================================
// CLAUDE AGENT SDK TOOLS
// Using zod v4 schema shape format
// ============================================

/**
 * GET DEUDA - Retrieves debt/balance information
 */
export const getDeudaTool = tool(
    "get_deuda",
    `Obtiene el saldo y adeudo de un contrato CEA.

RETORNA:
- totalDeuda: Total a pagar
- vencido: Monto vencido
- porVencer: Monto por vencer
- facturas: Desglose de facturas pendientes

Usa este tool cuando el usuario pregunte por su saldo, deuda, cuánto debe, o quiera pagar.`,
    {
        contrato: z.string().describe("Número de contrato CEA (ej: 123456)")
    },
    async ({ contrato: rawContrato }) => {
        const contrato = await resolveContract(rawContrato);
        console.log(`[get_deuda] Fetching debt for contract: ${contrato}`);

        try {
            // Step 1: getDeudaContrato (PRIMARY — same params as old working getDeuda)
            console.log(`[get_deuda] Calling getDeudaContrato (primary)...`);
            const primaryParsed = await ceaApi.getDeudaContrato(contrato);
            console.log(`[get_deuda] Primary parsed:`, JSON.stringify(primaryParsed));

            if (primaryParsed.success && (primaryParsed.totalDeuda ?? 0) > 0) {
                const { totalDeuda = 0, nombreCliente, direccion } = primaryParsed;

                // Step 2: Try getDeudaTotalConFacturas for invoice breakdown (ENRICHMENT)
                let facturas: FacturaPendiente[] = [];
                let vencido = 0;
                let porVencer = 0;
                try {
                    console.log(`[get_deuda] Enriching with getDeudaTotalConFacturas...`);
                    const enrichParsed = await ceaApi.getDeudaTotalConFacturas(contrato);
                    if (enrichParsed.success && (enrichParsed.facturas?.length ?? 0) > 0) {
                        facturas = enrichParsed.facturas!;
                        for (const f of facturas) {
                            if (f.estadoTexto === "vencido") vencido += f.importe;
                            else porVencer += f.importe;
                        }
                        console.log(`[get_deuda] Enrichment: ${facturas.length} invoices found`);
                    }
                } catch (e) {
                    console.log(`[get_deuda] Enrichment failed, continuing with totals only`);
                }

                // Build formatted response
                let formattedResponse = `Estado de cuenta del contrato ${contrato}:\n\n`;
                formattedResponse += `💰 **Total a pagar: $${totalDeuda.toFixed(2)}**\n`;
                if (nombreCliente) formattedResponse += `👤 Cliente: ${nombreCliente}\n`;

                if (facturas.length > 0) {
                    if (vencido > 0) {
                        formattedResponse += `🔴 Vencido: $${vencido.toFixed(2)}\n`;
                    }
                    if (porVencer > 0) {
                        formattedResponse += `🟡 Por vencer: $${porVencer.toFixed(2)}\n`;
                    }

                    formattedResponse += `\n📋 **Recibos pendientes:**\n`;
                    for (const factura of facturas) {
                        const emoji = factura.estadoTexto === "vencido" ? "🔴" : "🟡";
                        const label = factura.periodo || factura.numero;
                        const venceInfo = factura.fechaVencimiento ? ` - Vence: ${factura.fechaVencimiento}` : "";
                        formattedResponse += `${emoji} ${label}: $${factura.importe.toFixed(2)} (${factura.estadoTexto})${venceInfo}\n`;
                    }
                }

                formattedResponse += `\n¿Quieres realizar un pago o tienes dudas sobre tu saldo?`;

                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    formatted_response: formattedResponse,
                    data: {
                        contrato,
                        totalDeuda,
                        vencido,
                        porVencer,
                        nombreCliente,
                        facturas
                    }
                }) }] };
            }

            // Primary returned 0 debt — genuinely no debt from the reliable endpoint
            if (primaryParsed.success && (primaryParsed.totalDeuda ?? 0) === 0) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    formatted_response: `Tu contrato ${contrato} no tiene adeudos pendientes.\n\n¿Te puedo ayudar con algo más?`,
                    data: { contrato, totalDeuda: 0, mensaje: "sin adeudo" }
                }) }] };
            }

            // Primary failed — check if it's a definitive error (contract not found)
            if (primaryParsed.codigoError === -501 || primaryParsed.error?.includes("no existe")) {
                console.log(`[get_deuda] Contract not found (code ${primaryParsed.codigoError}): ${primaryParsed.error}`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: "contrato_no_encontrado",
                    codigoError: primaryParsed.codigoError,
                    formatted_response: `No encontré el contrato ${contrato} en el sistema. Por favor verifica que el número sea correcto. Lo puedes encontrar en tu recibo de agua en la parte superior.`
                }) }] };
            }

            // Primary failed for other reasons — try getDeudaTotalConFacturas as last resort
            console.log(`[get_deuda] Primary failed (${primaryParsed.error}), trying getDeudaTotalConFacturas fallback...`);

            const fallbackParsed = await ceaApi.getDeudaTotalConFacturas(contrato);
            console.log(`[get_deuda] Fallback parsed:`, JSON.stringify(fallbackParsed));

            if (fallbackParsed.success) {
                const { totalDeuda = 0, facturas = [], nombreCliente } = fallbackParsed;

                if (facturas.length === 0 && totalDeuda === 0) {
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: true,
                        formatted_response: `Tu contrato ${contrato} está en proceso de facturación. En cuanto se complete, podrás consultar tu saldo actualizado.`,
                        data: { contrato, totalDeuda: 0, mensaje: "proceso de facturación" }
                    }) }] };
                }

                let vencido = 0;
                let porVencer = 0;
                for (const f of facturas) {
                    if (f.estadoTexto === "vencido") vencido += f.importe;
                    else porVencer += f.importe;
                }

                let formattedResponse = `Estado de cuenta del contrato ${contrato}:\n\n`;
                formattedResponse += `💰 **Total a pagar: $${totalDeuda.toFixed(2)}**\n`;

                if (facturas.length > 0) {
                    if (vencido > 0) {
                        formattedResponse += `🔴 Vencido: $${vencido.toFixed(2)}\n`;
                    }
                    if (porVencer > 0) {
                        formattedResponse += `🟡 Por vencer: $${porVencer.toFixed(2)}\n`;
                    }

                    formattedResponse += `\n📋 **Recibos pendientes:**\n`;
                    for (const factura of facturas) {
                        const emoji = factura.estadoTexto === "vencido" ? "🔴" : "🟡";
                        const label = factura.periodo || factura.numero;
                        const venceInfo = factura.fechaVencimiento ? ` - Vence: ${factura.fechaVencimiento}` : "";
                        formattedResponse += `${emoji} ${label}: $${factura.importe.toFixed(2)} (${factura.estadoTexto})${venceInfo}\n`;
                    }
                }

                formattedResponse += `\n¿Quieres realizar un pago o tienes dudas sobre tu saldo?`;

                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    formatted_response: formattedResponse,
                    data: { contrato, totalDeuda, vencido, porVencer, nombreCliente, facturas }
                }) }] };
            }

            // Both calls failed
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: fallbackParsed.error,
                formatted_response: `No encontré información de adeudo para el contrato ${contrato}. ¿Puedes verificar el número?`
            }) }] };
        } catch (error) {
            console.error(`[get_deuda] Error:`, error);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: `No se pudo consultar el saldo: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                        formatted_response: "El sistema de consulta no está disponible en este momento. ¿Puedes intentar en unos minutos?"
                    })
                }]
            };
        }
    }
);

/**
 * GET CONSUMO - Retrieves consumption history
 */
export const getConsumoTool = tool(
    "get_consumo",
    `Obtiene el historial de consumo de agua de un contrato.

PARÁMETROS:
- contrato: Número de contrato CEA (requerido)
- year: Año específico para filtrar (opcional, ej: 2022, 2023)

RETORNA:
- consumos: Lista de consumos por periodo (m³) con año y mes
- promedioMensual: Promedio de consumo mensual
- tendencia: Si el consumo está aumentando, estable o disminuyendo
- añosDisponibles: Lista de años con datos disponibles

Usa cuando el usuario pregunte por su consumo, historial de lecturas, o cuánta agua ha gastado.
Si el usuario pide un año específico (ej: "consumo de 2022"), usa el parámetro year para filtrar.`,
    {
        contrato: z.string().describe("Número de contrato CEA"),
        year: z.number().optional().describe("Año específico para filtrar los consumos (ej: 2022)")
    },
    async ({ contrato: rawContrato, year }) => {
        const contrato = await resolveContract(rawContrato);
        console.log(`[get_consumo] Fetching consumption for contract: ${contrato}, year: ${year || 'all'}`);

        try {
            // Try explotacion=1 first (most common), then 12 if no data
            const explotaciones = ["1", "12"];
            let parsed: ConsumoResponse = { success: false, error: "No data found" };

            for (const explotacion of explotaciones) {
                console.log(`[get_consumo] Trying explotacion=${explotacion}`);
                parsed = await ceaApi.getConsumos(contrato, explotacion);

                // If we got data, break out of the loop
                if (parsed.success && parsed.data && parsed.data.consumos.length > 0) {
                    console.log(`[get_consumo] Found ${parsed.data.consumos.length} records with explotacion=${explotacion}`);
                    break;
                }
            }

            if (!parsed.success) {
                return { content: [{ type: "text" as const, text: JSON.stringify({ error: parsed.error, success: false }) }] };
            }

            const data = parsed.data!;

            // Get unique years available
            const añosDisponibles = [...new Set(data.consumos.map(c => c.año))].filter(a => a > 0).sort((a, b) => b - a);

            // Filter by year if specified
            let consumosFiltrados = data.consumos;
            if (year) {
                consumosFiltrados = data.consumos.filter(c => c.año === year);
            }

            // Calculate average for filtered data
            const promedioFiltrado = consumosFiltrados.length > 0
                ? consumosFiltrados.reduce((sum, c) => sum + c.consumoM3, 0) / consumosFiltrados.length
                : 0;

            // Calculate total for the year
            const totalAño = consumosFiltrados.reduce((sum, c) => sum + c.consumoM3, 0);

            const result = {
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
                    year: c.año,
                    mes: c.mes,
                    tipoLectura: c.tipoLectura
                })),
                resumen: year
                    ? `Consumo ${year}: Total ${totalAño} m³, Promedio mensual ${Math.round(promedioFiltrado)} m³`
                    : `Historial completo: ${data.consumos.length} registros desde ${añosDisponibles[añosDisponibles.length - 1] || 'N/A'} hasta ${añosDisponibles[0] || 'N/A'}`
            };

            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
            console.error(`[get_consumo] Error:`, error);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: `No se pudo consultar el consumo: ${error instanceof Error ? error.message : 'Error desconocido'}`
                    })
                }]
            };
        }
    }
);

/**
 * GET CONTRACT DETAILS - Retrieves contract information
 */
export const getContratoTool = tool(
    "get_contract_details",
    `Obtiene los detalles de un contrato CEA.

RETORNA:
- titular: Nombre del titular
- direccion: Dirección del servicio
- tarifa: Tipo de tarifa
- estado: Estado del contrato (activo/suspendido/cortado)

Usa para validar un contrato o conocer detalles del servicio.`,
    {
        contrato: z.string().describe("Número de contrato CEA")
    },
    async ({ contrato: rawContrato }) => {
        const contrato = await resolveContract(rawContrato);
        console.log(`[get_contract_details] Fetching contract: ${contrato}`);

        try {
            const { parsed, rawXml } = await ceaApi.getContratoDetails(contrato);

            if (!parsed.success) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: parsed.error,
                    formatted_response: `No encontré información para el contrato ${contrato}. ¿Puedes verificar el número?`
                }) }] };
            }

            // ENRICHMENT: Get real service status from punto de servicio
            const numeroContador = ceaApi.parseXMLValue(rawXml, "numeroContador");
            console.log(`[get_contract_details] numeroContador from XML: ${numeroContador}`);
            if (numeroContador && parsed.data) {
                try {
                    const psEstado = await ceaApi.fetchPuntoServicioEstado(numeroContador);
                    if (psEstado) {
                        console.log(`[get_contract_details] Punto servicio enrichment: ${parsed.data.estado} -> ${psEstado}`);
                        parsed.data.estado = psEstado;
                    }
                } catch (e) {
                    console.log(`[get_contract_details] Punto servicio enrichment failed, using default status`);
                }
            } else {
                console.log(`[get_contract_details] Enrichment skipped: numeroContador=${numeroContador}`);
            }

            // Generate formatted response using template
            const data = parsed.data!;
            const formattedResponse = renderTemplate("contract_info", {
                contract_number: contrato,
                titular: data.titular,
                direccion: data.direccion,
                colonia: data.colonia,
                tarifa: data.tarifa,
                estado: data.estado
            });

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                formatted_response: formattedResponse,
                // Raw data also available if needed
                data: parsed.data
            }) }] };
        } catch (error) {
            console.error(`[get_contract_details] Error:`, error);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: `No se pudo consultar el contrato: ${error instanceof Error ? error.message : 'Error desconocido'}`,
                        formatted_response: "El sistema de consulta no está disponible en este momento. ¿Puedes intentar en unos minutos?"
                    })
                }]
            };
        }
    }
);

// create_ticket is now generated per-request via createContextTools() — see bottom of file

/**
 * GET CLIENT TICKETS - Retrieves tickets for a contract
 */
export const getClientTicketsTool = tool(
    "get_client_tickets",
    `Obtiene los tickets de un cliente por número de contrato.

RETORNA lista de tickets con:
- folio: Número de ticket
- status: Estado (open, in_progress, resolved, etc.)
- titulo: Título del ticket
- created_at: Fecha de creación`,
    {
        contract_number: z.string().describe("Número de contrato CEA")
    },
    async ({ contract_number }) => {
        console.log(`[get_client_tickets] Fetching tickets for contract: ${contract_number}`);

        try {
            const tickets = await agoraDb.getClientTickets(contract_number);

            if (!tickets || tickets.length === 0) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: true,
                            tickets: [],
                            message: "No se encontraron tickets para este contrato"
                        })
                    }]
                };
            }

            const result = {
                success: true,
                tickets: tickets.map((t) => ({
                    folio: t.folio,
                    status: t.status,
                    titulo: t.title,
                    service_type: t.service_type,
                    created_at: t.created_at,
                    descripcion: t.description?.substring(0, 100)
                })),
                count: tickets.length
            };

            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
            console.error(`[get_client_tickets] Error:`, error);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: `No se pudieron consultar los tickets: ${error instanceof Error ? error.message : 'Error desconocido'}`
                    })
                }]
            };
        }
    }
);

/**
 * SEARCH CUSTOMER BY CONTRACT - Finds customer in contacts table
 */
export const searchCustomerByContractTool = tool(
    "search_customer_by_contract",
    "Busca un cliente por su número de contrato en la base de datos CEA (AGORA contacts).",
    {
        contract_number: z.string().describe("Número de contrato CEA")
    },
    async ({ contract_number }) => {
        console.log(`[search_customer] Searching for contract: ${contract_number}`);

        try {
            const contacts = await agoraDb.searchCustomerByContract(contract_number);

            if (!contacts || contacts.length === 0) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            found: false,
                            message: "Cliente no encontrado"
                        })
                    }]
                };
            }

            const contact = contacts[0];
            const customAttrs = contact.custom_attributes || {};

            const result = {
                success: true,
                found: true,
                customer: {
                    id: contact.id,
                    nombre: contact.name || 'Sin nombre',
                    contrato: contact.identifier || (customAttrs as Record<string, string>).contract_number || contract_number,
                    email: contact.email || (customAttrs as Record<string, string>).email || null,
                    whatsapp: contact.phone_number || (customAttrs as Record<string, string>).whatsapp || null,
                    recibo_digital: (customAttrs as Record<string, boolean>).recibo_digital || false
                }
            };

            return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
            console.error(`[search_customer] Error:`, error);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: error instanceof Error ? error.message : 'Error desconocido'
                    })
                }]
            };
        }
    }
);

/**
 * UPDATE TICKET STATUS - Updates a ticket
 * NOTE: Users CANNOT close/resolve tickets - only agents can
 */
export const updateTicketTool = tool(
    "update_ticket",
    `Actualiza el estado u otros campos de un ticket existente.

⚠️ RESTRICCIÓN IMPORTANTE:
- Los usuarios NO pueden cerrar tickets
- Si el usuario pide cerrar un ticket, usa handoff_to_human en su lugar
- Solo los agentes humanos pueden marcar tickets como "resolved" o "closed"

ESTADOS PERMITIDOS para María:
- in_progress, waiting_client, waiting_internal, escalated`,
    {
        folio: z.string().describe("Folio del ticket a actualizar"),
        status: z.enum(["open", "in_progress", "waiting_client", "waiting_internal", "escalated", "resolved", "closed", "cancelled"]).optional()
            .describe("Nuevo estado del ticket"),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional()
            .describe("Nueva prioridad del ticket"),
        notes: z.string().optional().describe("Notas adicionales")
    },
    async ({ folio, status, priority, notes }) => {
        console.log(`[update_ticket] Updating ticket: ${folio}`);

        // RESTRICTION: Users cannot close/resolve tickets
        if (status === "resolved" || status === "closed" || status === "cancelled") {
            console.log(`[update_ticket] BLOCKED: User attempted to set status to ${status}`);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        blocked: true,
                        formatted_response: "Los tickets solo pueden ser cerrados por un asesor. Te comunico con uno para que te ayude con esto 👤"
                    })
                }]
            };
        }

        try {
            await agoraDb.updateTicket(folio, { status, priority, notes });

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        folio,
                        message: `Ticket ${folio} actualizado correctamente`
                    })
                }]
            };
        } catch (error) {
            console.error(`[update_ticket] Error:`, error);
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        error: error instanceof Error ? error.message : 'Error desconocido'
                    })
                }]
            };
        }
    }
);

// handoff_to_human is now generated per-request via createContextTools() — see bottom of file

// ============================================
// GET RECIBO PDF - Generates signed download link for receipt PDF
// ============================================

export const getReciboPdfTool = tool(
    "get_recibo_link",
    `Genera un enlace seguro para descargar el recibo digital (PDF) de un contrato.

USA ESTA HERRAMIENTA CUANDO:
- El usuario pida que le envíen su recibo digital
- El usuario quiera descargar su recibo
- El usuario pregunte cómo obtener su recibo

PARÁMETROS:
- contrato: Número de contrato CEA (requerido)
- periodo: Mes específico si el usuario pide un recibo de un mes en particular (opcional, ej: "enero", "febrero 2025")

El enlace es válido por 48 horas. Siempre ofrece: "Si necesitas de otro mes avísame y te ayudo"`,
    {
        contrato: z.string().describe("Número de contrato CEA"),
        periodo: z.string().optional().describe("Periodo específico si el usuario pide un mes en particular (ej: 'enero', 'febrero 2025')")
    },
    async ({ contrato: rawContrato, periodo }) => {
        const contrato = await resolveContract(rawContrato);
        console.log(`[get_recibo_link] Generating PDF link for contract: ${contrato}, periodo: ${periodo || 'latest'}`);

        try {
            // Call getFacturas to verify invoices exist and find the right one
            // Try explotacion=1 first, then fallback to explotacion=12
            let parsed: { success: boolean; facturas: FacturaInfo[]; error?: string } = { success: false, facturas: [] };
            for (const explotacion of ["1", "12"]) {
                parsed = await ceaApi.getFacturas(contrato, explotacion);
                if (parsed.success && parsed.facturas.length > 0) {
                    console.log(`[get_recibo_link] Found ${parsed.facturas.length} facturas with explotacion=${explotacion}`);
                    break;
                }
            }

            if (!parsed.success || parsed.facturas.length === 0) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    formatted_response: `No encontré recibos disponibles para el contrato ${contrato}. ¿Puedes verificar el número de contrato?`
                }) }] };
            }

            // Find the target factura
            let targetFactura = parsed.facturas[0]; // default: most recent

            if (periodo) {
                const periodoLower = periodo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const matchingFactura = parsed.facturas.find(f => {
                    const textoLower = f.periodoTexto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return textoLower.includes(periodoLower) || periodoLower.includes(textoLower);
                });

                if (!matchingFactura) {
                    const availablePeriods = parsed.facturas.map(f => f.periodoTexto).join(", ");
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        formatted_response: `No encontré un recibo para "${periodo}". Los recibos disponibles son: ${availablePeriods}. ¿De cuál mes necesitas el recibo?`
                    }) }] };
                }
                targetFactura = matchingFactura;
            }

            // Generate signed URL (48h expiry)
            const expiresAt = Date.now() + 48 * 60 * 60 * 1000;
            const token = generateReciboToken(contrato, expiresAt);
            const downloadUrl = `${SERVER_BASE_URL}/recibo/${contrato}?token=${token}&expires=${expiresAt}&factura=${targetFactura.numero}`;

            const formattedResponse = `Aquí está tu recibo de *${targetFactura.periodoTexto}* del contrato ${contrato}:\n\n` +
                `📄 ${downloadUrl}\n\n` +
                `El enlace es válido por 48 horas. Si necesitas de otro mes avísame y te ayudo.`;

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                formatted_response: formattedResponse,
                data: {
                    contrato,
                    factura: targetFactura.numero,
                    periodo: targetFactura.periodoTexto,
                    download_url: downloadUrl
                }
            }) }] };
        } catch (error) {
            console.error(`[get_recibo_link] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                formatted_response: "No se pudo generar el enlace del recibo en este momento. ¿Puedes intentar en unos minutos?"
            }) }] };
        }
    }
);

// validate_contract_holder is now generated per-request via createContextTools() — see bottom of file

// ============================================
// GET MAIN OFFICE - HQ office info from DB
// ============================================

async function getHQOfficeInfo(): Promise<string> {
    try {
        const rows = await agoraDb.getMainOffice();

        if (rows.length === 0) {
            return "Oficina principal CEA Pabellón Campestre. Línea CEA: 442-211-0066. Horario: Lun-Vie 8:00-17:00.";
        }

        const hq = rows[0];
        const address = `${hq.address_street}, Col. ${hq.colonia}, ${hq.municipio}${hq.codigo_postal ? `, C.P. ${hq.codigo_postal}` : ""}`;
        const phone = hq.telefono || "442-211-0066";

        // Format schedule from horario JSON (keys: lun_vie, sab, dom)
        let schedule = "Lun-Vie 8:00-17:00";
        if (hq.horario) {
            if (hq.horario.lun_vie) {
                schedule = `Lun-Vie ${hq.horario.lun_vie}`;
            }
            if (hq.horario.sab) schedule += `, Sáb ${hq.horario.sab}`;
            if (hq.horario.dom) schedule += `, Dom ${hq.horario.dom}`;
        }

        return `*${hq.name}*\nDirección: ${address}\nTeléfono: ${phone}\nHorario: ${schedule}`;
    } catch (error) {
        console.error("[getHQOfficeInfo] Error querying DB:", error);
        return "Oficina principal CEA Pabellón Campestre. Línea CEA: 442-211-0066. Horario: Lun-Vie 8:00-17:00.";
    }
}

export const getMainOfficeTool = tool(
    "get_main_office",
    `Obtiene la información de la oficina principal de CEA (Pabellón Campestre).
    Devuelve nombre, dirección, teléfono y horario actualizados desde la base de datos.
    Usa esta herramienta SIEMPRE que necesites dar información de oficinas, horarios o teléfonos de CEA.
    NUNCA des esta información de memoria.`,
    {},
    async () => {
        console.log("[get_main_office] Querying HQ office info");
        const info = await getHQOfficeInfo();
        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            formatted_response: info
        }) }] };
    }
);

// ============================================
// FIND NEAREST LOCATIONS - PostGIS-based location finder
// ============================================

function isLocationOpen(horario: Record<string, string | null>): { is_open: boolean; current_schedule: string | null } {
    const now = getMexicoDate();
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    let scheduleKey: string;
    if (dayOfWeek === 0) {
        scheduleKey = "dom";
    } else if (dayOfWeek === 6) {
        scheduleKey = "sab";
    } else {
        scheduleKey = "lun_vie";
    }

    const schedule = horario[scheduleKey];
    if (!schedule) {
        return { is_open: false, current_schedule: null };
    }

    const [openTime, closeTime] = schedule.split("-");
    if (!openTime || !closeTime) {
        return { is_open: false, current_schedule: schedule };
    }

    const [openH, openM] = openTime.split(":").map(Number);
    const [closeH, closeM] = closeTime.split(":").map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    return {
        is_open: currentMinutes >= openMinutes && currentMinutes < closeMinutes,
        current_schedule: schedule
    };
}

function formatDistance(meters: number): string {
    if (meters < 1000) {
        return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
}

export const findNearestLocationsTool = tool(
    "find_nearest_locations",
    `Encuentra las oficinas, cajeros y puntos de pago CEA más cercanos al usuario.

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

        const FALLBACK_HQ = await getHQOfficeInfo();

        try {
            let searchLat: number | undefined = lat;
            let searchLng: number | undefined = lng;
            let searchMethod = "gps";

            // If no GPS coordinates, try to resolve colonia
            if ((searchLat === undefined || searchLng === undefined) && colonia) {
                searchMethod = "colonia";
                const coloniaName = colonia.toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/\s+/g, " ")
                    .trim();

                console.log(`[find_nearest_locations] Resolving colonia: "${coloniaName}"`);

                const coloniaResult = await agoraDb.resolveColonia(coloniaName);

                if (coloniaResult.length > 0) {
                    searchLat = coloniaResult[0].lat;
                    searchLng = coloniaResult[0].lng;
                    console.log(`[find_nearest_locations] Resolved "${colonia}" → "${coloniaResult[0].name}" (similarity: ${coloniaResult[0].similarity.toFixed(2)}) at ${searchLat}, ${searchLng}`);
                } else {
                    console.log(`[find_nearest_locations] Could not resolve colonia "${colonia}"`);
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        error: "colonia_not_found",
                        formatted_response: `No encontré la colonia "${colonia}". ¿Me puedes compartir tu ubicación o decirme otra referencia de zona?\n\n${FALLBACK_HQ}`
                    }) }] };
                }
            }

            // If still no coordinates, ask user
            if (searchLat === undefined || searchLng === undefined) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: "no_location",
                    formatted_response: "Para encontrar la oficina o cajero más cercano, necesito tu ubicación. ¿Me puedes compartir tu ubicación por WhatsApp o decirme en qué colonia estás?"
                }) }] };
            }

            const locations = await agoraDb.findNearestLocations(searchLat, searchLng, tipo, limit);

            if (locations.length === 0) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    search_method: searchMethod,
                    data: { locations: [] },
                    formatted_response: `No encontré ubicaciones cercanas del tipo solicitado.\n\n${FALLBACK_HQ}`
                }) }] };
            }

            // Build response
            const tipoLabels: Record<string, string> = {
                "oficina": "Oficina",
                "cajero": "CEAmático",
                "autopago": "Autopago"
            };

            const locationResults = locations.map(loc => {
                const openStatus = isLocationOpen(loc.horario);
                const mapsLink = `https://maps.google.com/?q=${loc.lat},${loc.lng}`;

                return {
                    name: loc.name,
                    tipo: loc.tipo,
                    tipo_label: tipoLabels[loc.tipo] || loc.tipo,
                    address: `${loc.address_street}, Col. ${loc.colonia}`,
                    municipio: loc.municipio,
                    distance: formatDistance(loc.distance_meters),
                    distance_meters: Math.round(loc.distance_meters),
                    is_open: openStatus.is_open,
                    horario: loc.horario,
                    current_schedule: openStatus.current_schedule,
                    telefono: loc.telefono,
                    servicios: loc.servicios,
                    maps_link: mapsLink,
                    notas: loc.notas
                };
            });

            // Build WhatsApp-friendly formatted response
            let formatted = "";
            for (let i = 0; i < locationResults.length; i++) {
                const loc = locationResults[i];
                const num = i + 1;
                const statusIcon = loc.is_open ? "Abierto" : "Cerrado";
                const statusEmoji = loc.is_open ? "🟢" : "🔴";

                formatted += `*${num}. ${loc.name}* (${loc.tipo_label})\n`;
                formatted += `📍 ${loc.address} — ${loc.distance}\n`;
                formatted += `${statusEmoji} ${statusIcon}`;
                if (loc.current_schedule) {
                    formatted += ` | Horario: ${loc.current_schedule}`;
                }
                formatted += "\n";
                if (loc.telefono) {
                    formatted += `📞 ${loc.telefono}\n`;
                }
                formatted += `🗺️ ${loc.maps_link}\n`;
                if (i < locationResults.length - 1) {
                    formatted += "\n";
                }
            }

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                search_method: searchMethod,
                data: { locations: locationResults },
                formatted_response: formatted
            }) }] };

        } catch (error) {
            console.error(`[find_nearest_locations] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Error desconocido",
                formatted_response: `No pude buscar ubicaciones en este momento.\n\n${FALLBACK_HQ}`
            }) }] };
        }
    }
);

// ============================================
// Google Maps Location Resolution Tools
// ============================================

function getGoogleMapsKey(): string { return process.env.GOOGLE_MAPS_API_KEY || ""; }

// Querétaro state bounding box (strict restriction — no results outside this area)
const QRO_BOUNDS = {
    sw: { lat: 20.01, lng: -100.60 },  // Southwest corner (near Amealco)
    ne: { lat: 21.65, lng: -99.03 }    // Northeast corner (near Jalpan de Serra)
};

export const searchLocationTool = tool(
    "search_location",
    `Busca una ubicación informal o punto de referencia en Querétaro y retorna dirección estructurada con coordenadas.

USA ESTE TOOL CUANDO el usuario describe una ubicación de forma informal:
- "cerca del Oxxo del Campanario"
- "frente a la primaria Benito Juárez"
- "en la esquina de Constituyentes y 5 de Febrero"
- "atrás del centro comercial Antea"
- "por el parque de Juriquilla"

NO uses este tool cuando el usuario ya dio una dirección completa (calle, número, colonia).

PARÁMETROS:
- query: Búsqueda estructurada que TÚ construyes a partir de lo que dijo el usuario.
  Siempre agrega "Querétaro" al final. Ejemplos:
  "cerca del oxxo del campanario" → query: "Oxxo Campanario Querétaro"
  "frente a la primaria Benito Juárez en Juriquilla" → query: "Primaria Benito Juárez Juriquilla Querétaro"
  "esquina de Constituyentes y 5 de Febrero" → query: "Constituyentes y 5 de Febrero Querétaro"

RETORNA: Lista de 1-3 resultados con nombre, dirección y coordenadas.
- Si hay 1 resultado: confirma con el usuario
- Si hay múltiples: presenta opciones numeradas para que elija
- Si hay 0 resultados: pide más detalles o dirección exacta`,
    {
        query: z.string().describe("Búsqueda estructurada extraída del mensaje del usuario (siempre incluir Querétaro)"),
        original_description: z.string().describe("Lo que dijo el usuario textualmente, para contexto")
    },
    async ({ query, original_description }) => {
        console.log(`[search_location] Query: "${query}" (original: "${original_description}")`);

        const apiKey = getGoogleMapsKey();
        if (!apiKey) {
            console.warn("[search_location] No GOOGLE_MAPS_API_KEY configured");
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: "no_api_key",
                formatted_response: "No pude buscar la ubicación en este momento. ¿Puedes darme la dirección exacta (calle, número, colonia)?"
            }) }] };
        }

        try {
            const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": apiKey,
                    "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.shortFormattedAddress"
                },
                body: JSON.stringify({
                    textQuery: query,
                    locationRestriction: {
                        rectangle: {
                            low: { latitude: QRO_BOUNDS.sw.lat, longitude: QRO_BOUNDS.sw.lng },
                            high: { latitude: QRO_BOUNDS.ne.lat, longitude: QRO_BOUNDS.ne.lng }
                        }
                    },
                    languageCode: "es",
                    maxResultCount: 3
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[search_location] Google Places API error ${response.status}: ${errorText}`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: `api_error_${response.status}`,
                    formatted_response: "No pude buscar la ubicación. ¿Puedes darme la dirección exacta (calle, número, colonia)?"
                }) }] };
            }

            const data = await response.json() as {
                places?: Array<{
                    displayName?: { text?: string };
                    formattedAddress?: string;
                    shortFormattedAddress?: string;
                    location?: { latitude?: number; longitude?: number };
                }>;
            };

            const places = data.places || [];

            if (places.length === 0) {
                console.log(`[search_location] No results for "${query}"`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    results_count: 0,
                    results: [],
                    formatted_response: `No encontré resultados para "${original_description}". ¿Puedes darme la dirección exacta (calle, número, colonia)?`
                }) }] };
            }

            const results = places.map((place, i) => ({
                index: i + 1,
                name: place.displayName?.text || "Sin nombre",
                address: place.formattedAddress || place.shortFormattedAddress || "Sin dirección",
                latitude: place.location?.latitude || null,
                longitude: place.location?.longitude || null,
                maps_link: place.location?.latitude && place.location?.longitude
                    ? `https://maps.google.com/?q=${place.location.latitude},${place.location.longitude}`
                    : null
            }));

            console.log(`[search_location] Found ${results.length} results`);

            let formatted: string;
            if (results.length === 1) {
                const r = results[0];
                formatted = `Encontré esta ubicación:\n📍 ${r.name} — ${r.address}`;
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
        } catch (error) {
            console.error(`[search_location] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                formatted_response: "No pude buscar la ubicación en este momento. ¿Puedes darme la dirección exacta (calle, número, colonia)?"
            }) }] };
        }
    }
);

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

        const apiKey = getGoogleMapsKey();
        if (!apiKey) {
            console.warn("[reverse_geocode] No GOOGLE_MAPS_API_KEY configured");
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: "no_api_key",
                formatted_response: `Recibí tu ubicación (${latitude}, ${longitude}) pero no pude obtener la dirección. ¿Puedes decirme la calle, número y colonia?`
            }) }] };
        }

        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&language=es&key=${apiKey}`;
            const response = await fetch(url);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[reverse_geocode] Google Geocoding API error ${response.status}: ${errorText}`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: `api_error_${response.status}`,
                    formatted_response: `Recibí tu ubicación pero no pude obtener la dirección. ¿Puedes decirme la calle, número y colonia?`
                }) }] };
            }

            const data = await response.json() as {
                status: string;
                results?: Array<{
                    formatted_address?: string;
                    address_components?: Array<{
                        long_name?: string;
                        types?: string[];
                    }>;
                }>;
            };

            if (data.status !== "OK" || !data.results?.length) {
                console.log(`[reverse_geocode] No results for ${latitude}, ${longitude}`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: "no_results",
                    formatted_response: `Recibí tu ubicación pero no encontré una dirección. ¿Puedes decirme la calle, número y colonia?`
                }) }] };
            }

            const best = data.results[0];
            const components = best.address_components || [];
            const getComponent = (type: string) =>
                components.find(c => c.types?.includes(type))?.long_name || null;

            const result = {
                formatted_address: best.formatted_address || "Sin dirección",
                street: getComponent("route"),
                street_number: getComponent("street_number"),
                colonia: getComponent("sublocality_level_1") || getComponent("sublocality") || getComponent("neighborhood"),
                city: getComponent("locality"),
                state: getComponent("administrative_area_level_1"),
                postal_code: getComponent("postal_code"),
                latitude,
                longitude,
                maps_link: `https://maps.google.com/?q=${latitude},${longitude}`
            };

            console.log(`[reverse_geocode] Resolved: ${result.formatted_address}`);

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                ...result,
                formatted_response: `📍 ${result.formatted_address}`
            }) }] };
        } catch (error) {
            console.error(`[reverse_geocode] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                formatted_response: `No pude obtener la dirección de tu ubicación. ¿Puedes decirme la calle, número y colonia?`
            }) }] };
        }
    }
);

// ============================================
// CEA Receipt Extraction Tool (Gemini Vision)
// ============================================

const CEA_RECEIPT_SYSTEM_INSTRUCTION = `# SYSTEM ROLE
You are a forensic document parser specialized in CEA Querétaro water utility receipts.
Extract ALL billing data with absolute precision.

# STRICT RULES
1. ZERO GUESSWORK: If a value is blurry or obscured, use the string "ilegible" instead of guessing.
2. NEGATIVE VALUES: Preserve negative signs (-) for credits or adjustments.
3. DATA CLEANING: Remove currency symbols ($) and commas from numbers. Format dates as YYYY-MM-DD.
4. COMPLETENESS: Extract EVERY concept/line item from the concepts table — never summarize or skip rows.

# SPATIAL ANCHORS (where to find data on a CEA receipt)
* contrato: 10-digit number in the top-left header area, labeled "No. de Cuenta" or "Contrato"
* titular: Name below the contract number, labeled "Contribuyente" or "Titular"
* direccion: Address below the name
* no_factura: 18-digit string in the center-right blue grid, labeled "No. de factura"
* referencia: 8-digit code in the blue grid AND repeated in the bottom-right barcode area
* rfc_emisor: Always "CEA-800313-C95" for CEA Querétaro (hardcoded)
* uuid_fiscal: 36-character UUID string in the tiny CFDI text block at the bottom-left
* technical_grid: Central box with blue borders containing Medidor, Lecturas, Consumo
* concepts_table: Table in the middle section below the technical grid with columns: Descripción, Valor Unitario, Importe, IVA
* financial_summary: Right side panel above the bottom barcode showing totals and due date

# VALIDATION LOGIC (you MUST check these)
1. lectura_actual - lectura_anterior must equal consumo_m3. If not, set validation_warning=true and explain in audit_notes.
2. total_periodo + facturas_pendientes must equal total_a_pagar. If not, set validation_warning=true and explain in audit_notes.
3. Sum of all concept importe values should approximate total_periodo. Note discrepancies in audit_notes.

# PRECISION INSTRUCTIONS
- For small or dense text (UUID fiscal, RFC, reference codes): zoom in mentally and read character by character.
- For numbers in the concepts table: read each digit individually. Do not round or approximate.
- If a digit is ambiguous between two values (e.g., 3 vs 8, 1 vs 7), choose the most likely based on context and note it in audit_notes.`;

const geminiReceiptSchema: Schema = {
    type: SchemaType.OBJECT as const,
    properties: {
        identification: {
            type: SchemaType.OBJECT as const,
            description: "Invoice identification numbers",
            properties: {
                contrato: { type: SchemaType.STRING as const, description: "10-digit account/contract number from top-left" },
                titular: { type: SchemaType.STRING as const, description: "Account holder name" },
                direccion: { type: SchemaType.STRING as const, description: "Service address" },
                no_factura: { type: SchemaType.STRING as const, description: "18-digit invoice number from the blue grid" },
                referencia: { type: SchemaType.STRING as const, description: "8-digit reference code from blue grid and barcode area" },
                rfc_emisor: { type: SchemaType.STRING as const, description: "Always CEA-800313-C95" },
                uuid_fiscal: { type: SchemaType.STRING as const, description: "36-char CFDI UUID from bottom-left text block" },
            },
            required: ["contrato", "titular", "direccion", "no_factura", "referencia", "rfc_emisor", "uuid_fiscal"] as const,
        },
        technical_grid: {
            type: SchemaType.OBJECT as const,
            description: "Meter readings and consumption data from the central blue-bordered box",
            properties: {
                no_medidor: { type: SchemaType.STRING as const, description: "Water meter serial number" },
                lectura_actual: { type: SchemaType.STRING as const, description: "Current meter reading in m³" },
                lectura_anterior: { type: SchemaType.STRING as const, description: "Previous meter reading in m³" },
                consumo_m3: { type: SchemaType.STRING as const, description: "Water consumption in cubic meters for this period" },
                periodo_facturacion: { type: SchemaType.STRING as const, description: "Billing period in YYYY/MM format" },
            },
            required: ["no_medidor", "lectura_actual", "lectura_anterior", "consumo_m3", "periodo_facturacion"] as const,
        },
        concepts_table: {
            type: SchemaType.ARRAY as const,
            description: "ALL line items from the concepts/charges table — extract every single row",
            items: {
                type: SchemaType.OBJECT as const,
                properties: {
                    descripcion: { type: SchemaType.STRING as const, description: "Concept description (agua, drenaje, saneamiento, etc.)" },
                    valor_unitario: { type: SchemaType.NUMBER as const, description: "Unit price without $ symbol" },
                    importe: { type: SchemaType.NUMBER as const, description: "Total amount for this concept without $ symbol" },
                    iva: { type: SchemaType.STRING as const, description: "IVA tax indication (percentage, exempt, or amount)" },
                },
                required: ["descripcion", "valor_unitario", "importe", "iva"] as const,
            },
        },
        financial_summary: {
            type: SchemaType.OBJECT as const,
            description: "Payment totals from the right-side panel",
            properties: {
                total_periodo: { type: SchemaType.NUMBER as const, description: "Total charges for current billing period" },
                facturas_pendientes: { type: SchemaType.NUMBER as const, description: "Outstanding balance from previous invoices" },
                total_a_pagar: { type: SchemaType.NUMBER as const, description: "Grand total amount due" },
                fecha_vencimiento: { type: SchemaType.STRING as const, description: "Payment due date in YYYY-MM-DD format" },
            },
            required: ["total_periodo", "facturas_pendientes", "total_a_pagar", "fecha_vencimiento"] as const,
        },
        validation_warning: {
            type: SchemaType.BOOLEAN as const,
            description: "True if any math validation failed (readings vs consumption, or totals mismatch)",
        },
        audit_notes: {
            type: SchemaType.STRING as const,
            description: "Notes on illegible fields, math discrepancies, or assumptions made during extraction. Empty string if none.",
        },
    },
    required: [
        "identification", "technical_grid", "concepts_table",
        "financial_summary", "validation_warning", "audit_notes",
    ] as const,
};

export const extractCEAReceiptTool = tool(
    "extract_cea_receipt",
    `Extrae datos estructurados de una imagen de recibo/factura de la CEA Querétaro usando visión por computadora (Gemini).
Devuelve JSON con: identificación (contrato, factura, UUID fiscal), cuadro técnico (medidor, lecturas, consumo),
tabla de conceptos (todos los cargos), y resumen financiero (totales, fecha de vencimiento).
Incluye validación matemática automática. Usa esta herramienta cuando el usuario envíe una foto de su recibo de agua
y necesites extraer datos precisos para aclaraciones, auditoría o verificación de cobros.`,
    {
        image_url: z.string().describe("URL de la imagen del recibo de CEA (from Chatwoot attachment or direct URL)"),
    },
    async ({ image_url }: { image_url: string }) => {
            console.log(`[extract_cea_receipt] Starting extraction from: ${image_url}`);

            try {
                // 1. Download the image
                const geminiKey = process.env.GEMINI_API_KEY;
                if (!geminiKey) {
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        error: "GEMINI_API_KEY not configured",
                        formatted_response: "No puedo analizar el recibo en este momento. Error de configuración interno."
                    }) }] };
                }

                console.log(`[extract_cea_receipt] Downloading image...`);
                const response = await fetch(image_url, { signal: AbortSignal.timeout(30000) });
                if (!response.ok) {
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        error: `Image download failed: HTTP ${response.status}`,
                        formatted_response: "No pude descargar la imagen del recibo. ¿Podrías enviarla de nuevo?"
                    }) }] };
                }

                const contentType = response.headers.get("content-type") || "image/jpeg";
                const arrayBuffer = await response.arrayBuffer();
                const imageBuffer = Buffer.from(arrayBuffer);

                // Reject if too large (10MB)
                if (imageBuffer.length > 10 * 1024 * 1024) {
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        error: `Image too large: ${(imageBuffer.length / (1024 * 1024)).toFixed(1)}MB`,
                        formatted_response: "La imagen es demasiado grande. ¿Podrías enviar una foto más pequeña del recibo?"
                    }) }] };
                }

                const base64Image = imageBuffer.toString("base64");
                let mimeType = "image/jpeg";
                if (contentType.includes("png")) mimeType = "image/png";
                else if (contentType.includes("webp")) mimeType = "image/webp";

                console.log(`[extract_cea_receipt] Image: ${(imageBuffer.length / 1024).toFixed(0)}KB, type: ${mimeType}`);

                // 2. Call Gemini with structured output
                // Model priority: gemini-3-flash-preview (best doc extraction accuracy, +13pt on PDFs per Box benchmarks)
                // Fallbacks: gemini-3.1-flash-lite (cheapest at $0.25/M, 2.5x faster), gemini-2.5-flash (proven stable)
                const genAI = new GoogleGenerativeAI(geminiKey);
                const modelName = process.env.GEMINI_RECEIPT_MODEL || "gemini-3-flash-preview";
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: CEA_RECEIPT_SYSTEM_INSTRUCTION,
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: geminiReceiptSchema,
                        temperature: 0,
                    },
                });

                console.log(`[extract_cea_receipt] Calling Gemini (${modelName}) for structured extraction...`);
                const result = await model.generateContent([
                    { inlineData: { data: base64Image, mimeType } },
                    { text: "Extrae todos los datos de este recibo de la CEA Querétaro. Revisa cada campo con cuidado y valida las matemáticas." },
                ]);

                const responseText = result.response.text();
                if (!responseText) {
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        error: "Gemini returned empty response",
                        formatted_response: "No pude leer el recibo. ¿La imagen es clara y muestra el recibo completo?"
                    }) }] };
                }

                const extracted = JSON.parse(responseText);

                // 3. Post-extraction math validation
                const warnings: string[] = [];

                // Validate readings: actual - anterior = consumo
                const lectActual = parseFloat(extracted.technical_grid?.lectura_actual);
                const lectAnterior = parseFloat(extracted.technical_grid?.lectura_anterior);
                const consumo = parseFloat(extracted.technical_grid?.consumo_m3);

                if (!isNaN(lectActual) && !isNaN(lectAnterior) && !isNaN(consumo)) {
                    const expectedConsumo = lectActual - lectAnterior;
                    if (Math.abs(expectedConsumo - consumo) > 0.5) {
                        warnings.push(
                            `Lectura actual (${lectActual}) - anterior (${lectAnterior}) = ${expectedConsumo}, pero consumo reportado = ${consumo}`
                        );
                    }
                }

                // Validate totals: periodo + pendientes = total
                const totalPeriodo = extracted.financial_summary?.total_periodo;
                const pendientes = extracted.financial_summary?.facturas_pendientes;
                const totalPagar = extracted.financial_summary?.total_a_pagar;

                if (totalPeriodo != null && pendientes != null && totalPagar != null) {
                    const expectedTotal = totalPeriodo + pendientes;
                    if (Math.abs(expectedTotal - totalPagar) > 0.01) {
                        warnings.push(
                            `Total periodo ($${totalPeriodo}) + pendientes ($${pendientes}) = $${expectedTotal.toFixed(2)}, pero total a pagar = $${totalPagar}`
                        );
                    }
                }

                // Validate sum of concepts ≈ total_periodo
                if (Array.isArray(extracted.concepts_table) && totalPeriodo != null) {
                    const conceptsSum = extracted.concepts_table.reduce(
                        (sum: number, c: { importe?: number }) => sum + (c.importe || 0), 0
                    );
                    if (Math.abs(conceptsSum - totalPeriodo) > 1.0) {
                        warnings.push(
                            `Suma de conceptos ($${conceptsSum.toFixed(2)}) difiere del total del periodo ($${totalPeriodo})`
                        );
                    }
                }

                // Merge validation results
                if (warnings.length > 0) {
                    extracted.validation_warning = true;
                    const existingNotes = extracted.audit_notes || "";
                    extracted.audit_notes = [existingNotes, "[POST-VALIDATION]", ...warnings]
                        .filter(Boolean).join(" ");
                }

                console.log(`[extract_cea_receipt] Extraction complete. Validation warnings: ${warnings.length}`);

                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    data: extracted,
                    validation_passed: warnings.length === 0,
                    formatted_response: warnings.length === 0
                        ? `Recibo extraído correctamente. Contrato: ${extracted.identification?.contrato || "N/A"}, Total: $${extracted.financial_summary?.total_a_pagar || "N/A"}`
                        : `Recibo extraído con ${warnings.length} advertencia(s) de validación. Revisa audit_notes para detalles.`
                }) }] };

            } catch (error) {
                console.error(`[extract_cea_receipt] Error:`, error);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                    formatted_response: "Ocurrió un error al analizar el recibo. ¿Podrías intentar enviar la foto de nuevo?"
                }) }] };
            }
        }
);

// ============================================
// Static tools (no per-request context needed)
// ============================================

export const staticTools = [
    // CEA API Tools
    getDeudaTool,
    getConsumoTool,
    getContratoTool,
    // Ticket Tools
    getClientTicketsTool,
    searchCustomerByContractTool,
    updateTicketTool,
    // Utility Tools
    getReciboPdfTool,
    // Location Tools
    getMainOfficeTool,
    findNearestLocationsTool,
    searchLocationTool,
    reverseGeocodeTool,
    // Vision Extraction Tools
    extractCEAReceiptTool
];

// ============================================
// Per-request context tools factory
// Closures capture context at creation — language-level guarantee against race conditions
// ============================================

export function createContextTools(ctx: RequestContext) {
    const createTicketCtxTool = tool(
        "create_ticket",
        `Crea un ticket en el sistema AGORA CEA y retorna el folio generado.

CATEGORÍAS (AGORA):
- CON: Consultas generales
- FAC: Facturación (recibos, aclaraciones, ajustes)
- CTR: Contratos (altas, bajas, cambios)
- CVN: Convenios de pago
- REP: Reportes de servicio (fugas, drenaje, calidad)
- SRV: Servicios técnicos (medidores, instalaciones)

⚠️ CUÁNDO PEDIR CONTRATO:
- REP (fugas en vía pública, drenaje en calle): NO pidas contrato, solo ubicación
- REP (fuga de medidor, problema dentro de propiedad): SÍ pide contrato
- FAC, CTR, CVN, SRV: SÍ requieren contrato
- CON: Depende de la consulta

IMPORTANTE: Siempre incluye el folio en tu respuesta al usuario.`,
        {
            category_code: z.enum(["CON", "FAC", "CTR", "CVN", "REP", "SRV"])
                .describe("Código de categoría AGORA"),
            subcategory_code: z.string().optional()
                .describe("Código de subcategoría (ej: FAC-001, REP-FG-001)"),
            titulo: z.string().describe("Título breve del ticket"),
            descripcion: z.string().describe("Descripción detallada del problema"),
            contract_number: z.string().optional().describe("Número de contrato - NO requerido para fugas/drenaje en vía pública"),
            client_name: z.string().optional().describe("Nombre del cliente (del perfil de WhatsApp o proporcionado)"),
            phone: z.string().optional().describe("Teléfono del cliente (del perfil de WhatsApp)"),
            email: z.string().optional().describe("Email del cliente (si aplica)"),
            ubicacion: z.string().optional().describe("Ubicación - REQUERIDO para reportes REP en vía pública"),
            latitude: z.number().optional().describe("Latitud de la ubicación (si se resolvió con search_location o reverse_geocode)"),
            longitude: z.number().optional().describe("Longitud de la ubicación (si se resolvió con search_location o reverse_geocode)"),
            priority: z.enum(["low", "medium", "high", "urgent"]).default("medium")
                .describe("Prioridad del ticket")
        },
        async (input) => {
            console.log(`[create_ticket] Context: conv=${ctx.chatwootConversationId}, acct=${ctx.chatwootAccountId}`);

            // Defense: check service status before creating REP tickets with a contract
            if (input.category_code === "REP" && input.contract_number) {
                try {
                    const { parsed: contratoParsed, rawXml: contratoXml } = await ceaApi.getContratoDetails(input.contract_number);
                    const contadorTag = ceaApi.parseXMLValue(contratoXml, "numeroContador");
                    if (contadorTag) {
                        const estado = await ceaApi.fetchPuntoServicioEstado(contadorTag);
                        if (estado === 'cortado' || estado === 'suspendido') {
                            console.log(`[create_ticket] BLOCKED: Contract ${input.contract_number} is ${estado}`);
                            return { content: [{ type: "text" as const, text: JSON.stringify({
                                success: false,
                                blocked: true,
                                estado,
                                formatted_response: `Tu servicio se encuentra ${estado} por falta de pago. Para reactivarlo:\n\n` +
                                    `- En línea: https://appcea.ceaqueretaro.gob.mx/PagoEnLinea/\n` +
                                    `- Sucursales CEA\n- Oxxo (con tu recibo)\n- Bancos autorizados\n\n` +
                                    `Una vez realizado el pago, tu servicio se restablece en un plazo de 24-48 horas.`
                            }) }] };
                        }
                    }
                } catch (e) {
                    console.log(`[create_ticket] Status check failed, proceeding with ticket creation`);
                }
            }

            const ticketInput: CreateTicketInput = {
                category_code: input.category_code,
                subcategory_code: input.subcategory_code as any,
                titulo: input.titulo,
                descripcion: input.descripcion,
                contract_number: input.contract_number,
                client_name: input.client_name,
                phone: input.phone,
                email: input.email,
                conversation_id: ctx.chatwootConversationId || undefined,
                ubicacion: input.ubicacion,
                latitude: input.latitude,
                longitude: input.longitude,
                priority: input.priority as TicketPriority
            };

            const result = await agoraDb.createTicket(ticketInput, ctx.chatwootAccountId);

            if (!result.success) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    formatted_response: "No pude crear tu ticket en este momento. ¿Podrías intentar de nuevo en unos minutos?"
                }) }] };
            }

            // Clear pendingLectura flag after successful FAC-LEC ticket
            if (input.subcategory_code === "FAC-LEC" && ctx.onLecturaTicketCreated) {
                ctx.onLecturaTicketCreated();
            }

            // Generate formatted response using template
            const emoji = getCategoryEmoji(input.category_code) || getTicketEmoji(input.titulo);
            const formattedResponse = renderTemplate("ticket_created", {
                folio: result.folio,
                emoji,
                tipo: input.titulo,
                ubicacion: input.ubicacion || "",
                estatus: "open"
            });

            return { content: [{ type: "text" as const, text: JSON.stringify({
                ...result,
                formatted_response: formattedResponse
            }) }] };
        }
    );

    const handoffToHumanCtxTool = tool(
        "handoff_to_human",
        `Transfiere la conversación a un agente humano de CEA.

USA ESTA HERRAMIENTA CUANDO:
- El usuario pida hablar con una persona/humano/agente
- El usuario diga "quiero hablar con alguien"
- El usuario esté frustrado y pida atención personal
- No puedas resolver el problema del usuario`,
        {
            reason: z.string().describe("Motivo de la transferencia (breve)")
        },
        async ({ reason }) => {
            const conversationId = ctx.chatwootConversationId;
            const accountId = ctx.chatwootAccountId;

            console.log(`[handoff_to_human] Context: conv=${conversationId}, acct=${accountId}`);

            if (!conversationId || !accountId) {
                console.log(`[handoff_to_human] Missing context - conversation: ${conversationId}, account: ${accountId}`);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            formatted_response: "No puedo transferir la conversación en este momento. Por favor intenta más tarde o llama al 442-238-8200."
                        })
                    }]
                };
            }

            console.log(`[handoff_to_human] Transferring conversation ${conversationId} to human. Reason: ${reason}`);

            const result = await updateConversationStatus(accountId, conversationId, "open");

            if (result.success) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: true,
                            formatted_response: "Listo, ya le avisé al equipo, en cuanto alguien esté disponible sigue contigo. 😊"
                        })
                    }]
                };
            }

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        message: "No se pudo transferir la conversación",
                        formatted_response: "No pude transferir la conversación. Por favor llama al 442-238-8200 para atención inmediata."
                    })
                }]
            };
        }
    );

    const validateContractHolderCtxTool = tool(
        "validate_contract_holder",
        `Valida la identidad del usuario comparando el nombre proporcionado con el titular del contrato.

USA ESTA HERRAMIENTA ANTES de mostrar datos sensibles (saldo, detalles, consumo, tickets) de un contrato.

PARÁMETROS:
- contrato: Número de contrato CEA
- nombre_proporcionado: Nombre o apellido que el usuario proporcionó

RETORNA:
- validated: true si el nombre coincide con el titular
- validated: false si no coincide
- skipped: true si no se pudo verificar (sin datos de titular o error de API)`,
        {
            contrato: z.string().describe("Número de contrato CEA"),
            nombre_proporcionado: z.string().describe("Nombre o apellido proporcionado por el usuario")
        },
        async ({ contrato: rawContrato, nombre_proporcionado }) => {
            const contrato = await resolveContract(rawContrato);
            console.log(`[validate_contract_holder] Context: conv=${ctx.conversationId}`);
            console.log(`[validate_contract_holder] Validating "${nombre_proporcionado}" against contract ${contrato}`);

            try {
                const { parsed, rawXml } = await ceaApi.getContratoDetails(contrato);

                if (!parsed.success || !parsed.data) {
                    console.log(`[validate_contract_holder] API error or no data, skipping verification`);
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        validated: true,
                        skipped: true,
                        reason: "No se pudo obtener datos del contrato"
                    }) }] };
                }

                // ENRICHMENT: Get real service status from punto de servicio
                const numeroContador = ceaApi.parseXMLValue(rawXml, "numeroContador");
                console.log(`[validate_contract_holder] numeroContador from XML: ${numeroContador}`);
                if (numeroContador && parsed.data) {
                    try {
                        const psEstado = await ceaApi.fetchPuntoServicioEstado(numeroContador);
                        if (psEstado) {
                            console.log(`[validate_contract_holder] Punto servicio enrichment: ${parsed.data.estado} -> ${psEstado}`);
                            parsed.data.estado = psEstado;
                        }
                    } catch (e) {
                        console.log(`[validate_contract_holder] Punto servicio enrichment failed, using default status`);
                    }
                } else {
                    console.log(`[validate_contract_holder] Enrichment skipped: numeroContador=${numeroContador}`);
                }

                const titular = parsed.data.titular;
                if (!titular || titular.trim() === "") {
                    console.log(`[validate_contract_holder] No titular data, skipping verification`);
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        validated: true,
                        skipped: true,
                        reason: "El contrato no tiene datos de titular"
                    }) }] };
                }

                const nameResult = matchName(nombre_proporcionado, titular);
                console.log(`[validate_contract_holder] Match result: ${JSON.stringify(nameResult)}`);

                if (nameResult.match) {
                    // Mark contract as verified for this conversation (uses closure ctx)
                    const convId = ctx.conversationId;
                    if (convId) {
                        if (!verifiedContractsMap.has(convId)) {
                            verifiedContractsMap.set(convId, new Set());
                        }
                        verifiedContractsMap.get(convId)!.add(contrato);
                        verifiedContractsTimestamps.set(convId, Date.now());
                        console.log(`[validate_contract_holder] Contract ${contrato} verified for conversation ${convId}`);
                    }

                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        validated: true,
                        confidence: nameResult.confidence,
                        method: nameResult.method,
                        estado: parsed.data.estado
                    }) }] };
                }

                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: false,
                    message: "El nombre no coincide con el titular del contrato. ¿Puedes verificar e intentarlo de nuevo?"
                }) }] };

            } catch (error) {
                console.error(`[validate_contract_holder] Error:`, error);
                // Fail-open: don't block the user if the API is down
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    validated: true,
                    skipped: true,
                    reason: "Error al verificar, se omite validación"
                }) }] };
            }
        }
    );

    return [createTicketCtxTool, handoffToHumanCtxTool, validateContractHolderCtxTool];
}

// Re-export service functions used by other modules (agent.ts, server.ts)
export { translateContract } from "./services/hydra-db.js";
