// ============================================
// CEA API Tools - SOAP clients with contract validation
// ============================================

import { tool } from "@openai/agents";
import { z } from "zod";
import { cfg } from "../config/index.js";
import { fetchWithRetry } from "../utils/http.js";
import { buildDeudaSOAP, buildConsumoSOAP, buildContratoSOAP } from "./soap-builders.js";
import { parseDeudaResponse, parseConsumoResponse, parseContratoResponse } from "./soap-parsers.js";
import { childLogger } from "../utils/logger.js";

const log = childLogger("cea-api");

// Contract number validation pattern
const contractParam = z.object({
    contrato: z.string().regex(/^\d{6,10}$/, "Número de contrato debe ser 6-10 dígitos"),
});

export const getDeudaTool = tool({
    name: "get_deuda",
    description: `Obtiene el saldo y adeudo de un contrato CEA.

RETORNA:
- totalDeuda: Total a pagar
- vencido: Monto vencido
- porVencer: Monto por vencer
- conceptos: Desglose de adeudos

Usa este tool cuando el usuario pregunte por su saldo, deuda, cuánto debe, o quiera pagar.`,
    parameters: contractParam,
    execute: async ({ contrato }) => {
        log.info({ contrato }, "Fetching debt");

        try {
            const response = await fetchWithRetry(
                `${cfg.CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
                { method: "POST", headers: { "Content-Type": "text/xml;charset=UTF-8" }, body: buildDeudaSOAP(contrato) }
            );

            const xml = await response.text();
            const parsed = parseDeudaResponse(xml);

            if (!parsed.success) return { error: parsed.error, success: false };

            const data = parsed.data!;
            return {
                success: true,
                contrato,
                totalDeuda: data.totalDeuda,
                vencido: data.vencido,
                porVencer: data.porVencer,
                resumen: `Saldo total: ${data.totalDeuda.toFixed(2)} MXN${data.vencido > 0 ? ` (Vencido: ${data.vencido.toFixed(2)})` : ""}`,
                conceptos: data.conceptos.slice(0, 5),
            };
        } catch (error) {
            log.error({ err: error, contrato }, "Error fetching debt");
            return { success: false, error: `No se pudo consultar el saldo: ${error instanceof Error ? error.message : "Error desconocido"}` };
        }
    },
});

export const getConsumoTool = tool({
    name: "get_consumo",
    description: `Obtiene el historial de consumo de agua de un contrato.

RETORNA:
- consumos: Lista de consumos por periodo (m³)
- promedioMensual: Promedio de consumo mensual
- tendencia: Si el consumo está aumentando, estable o disminuyendo

Usa cuando el usuario pregunte por su consumo, historial de lecturas, o cuánta agua ha gastado.`,
    parameters: contractParam,
    execute: async ({ contrato }) => {
        log.info({ contrato }, "Fetching consumption");

        try {
            const response = await fetchWithRetry(
                `${cfg.CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
                { method: "POST", headers: { "Content-Type": "text/xml;charset=UTF-8" }, body: buildConsumoSOAP(contrato) }
            );

            const xml = await response.text();
            const parsed = parseConsumoResponse(xml);

            if (!parsed.success) return { error: parsed.error, success: false };

            const data = parsed.data!;
            const allConsumos = data.consumos.slice(0, 36);

            const consumosPorAño: Record<string, typeof allConsumos> = {};
            for (const c of allConsumos) {
                const year = c.periodo.split(" ").pop() || "Unknown";
                if (!consumosPorAño[year]) consumosPorAño[year] = [];
                consumosPorAño[year].push(c);
            }

            return {
                success: true,
                contrato,
                promedioMensual: Math.round(data.promedioMensual),
                tendencia: data.tendencia,
                consumos: allConsumos.slice(0, 12),
                consumosPorAño,
                añosDisponibles: Object.keys(consumosPorAño).sort().reverse(),
                resumen: `Promedio mensual: ${Math.round(data.promedioMensual)} m³ (Tendencia: ${data.tendencia}). Datos: ${Object.keys(consumosPorAño).sort().reverse().join(", ")}`,
            };
        } catch (error) {
            log.error({ err: error, contrato }, "Error fetching consumption");
            return { success: false, error: `No se pudo consultar el consumo: ${error instanceof Error ? error.message : "Error desconocido"}` };
        }
    },
});

export const getContratoTool = tool({
    name: "get_contract_details",
    description: `Obtiene los detalles de un contrato CEA.

RETORNA:
- titular: Nombre del titular
- direccion: Dirección del servicio
- tarifa: Tipo de tarifa
- estado: Estado del contrato (activo/suspendido/cortado)

Usa para validar un contrato o conocer detalles del servicio.`,
    parameters: contractParam,
    execute: async ({ contrato }) => {
        log.info({ contrato }, "Fetching contract details");

        try {
            const response = await fetchWithRetry(
                `${cfg.CEA_API_BASE}/InterfazGenericaContratacionWS`,
                { method: "POST", headers: { "Content-Type": "text/xml;charset=UTF-8" }, body: buildContratoSOAP(contrato) }
            );

            const xml = await response.text();
            const parsed = parseContratoResponse(xml);

            if (!parsed.success) return { error: parsed.error, success: false };
            return { success: true, ...parsed.data };
        } catch (error) {
            log.error({ err: error, contrato }, "Error fetching contract");
            return { success: false, error: `No se pudo consultar el contrato: ${error instanceof Error ? error.message : "Error desconocido"}` };
        }
    },
});

export const searchCustomerByContractTool = tool({
    name: "search_customer_by_contract",
    description: "Busca un cliente por su número de contrato en la base de datos CEA.",
    parameters: z.object({
        contract_number: z.string().regex(/^\d{6,10}$/).describe("Número de contrato CEA (6-10 dígitos)"),
    }),
    execute: async ({ contract_number }) => {
        log.info({ contract_number }, "Searching customer");

        try {
            const { pgQuery } = await import("../services/database.js");
            const contacts = await pgQuery<{
                id: number; name: string; email: string | null;
                phone_number: string | null; identifier: string | null;
                custom_attributes: Record<string, unknown> | null;
            }>(`
                SELECT id, name, email, phone_number, identifier, custom_attributes
                FROM contacts
                WHERE identifier = $1 OR custom_attributes->>'contract_number' = $1
                LIMIT 1
            `, [contract_number]);

            if (contacts.length === 0) {
                return { success: false, found: false, message: "Cliente no encontrado" };
            }

            const contact = contacts[0];
            const attrs = contact.custom_attributes || {};

            return {
                success: true,
                found: true,
                customer: {
                    id: contact.id,
                    nombre: contact.name || "Sin nombre",
                    contrato: contact.identifier || (attrs.contract_number as string) || contract_number,
                    email: contact.email || (attrs.email as string) || null,
                    whatsapp: contact.phone_number || (attrs.whatsapp as string) || null,
                    recibo_digital: (attrs.recibo_digital as boolean) || false,
                },
            };
        } catch (error) {
            log.error({ err: error }, "Error searching customer");
            return { success: false, error: error instanceof Error ? error.message : "Error desconocido" };
        }
    },
});
