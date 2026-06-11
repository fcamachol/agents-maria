// ============================================
// CEA API Tools - Debt, Consumption, Contract, Recibo
//
// These are thin SDK `tool()` wrappers. All orchestration lives in `../core/*`
// so it can be reused by other channels (e.g. maria-voz voice webhooks).
// Each wrapper calls its core function and stringifies the result via
// `toToolResult`, producing byte-identical output to the previous inline logic.
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { toToolResult } from "../core/types.js";
import { getDeudaCore } from "../core/deuda.js";
import { getConsumoCore } from "../core/consumo.js";
import { getContratoCore } from "../core/contrato.js";
import { getReciboLinkCore } from "../core/recibo.js";

// ============================================
// GET DEUDA - Retrieves debt/balance information
// ============================================

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
    async ({ contrato }) => toToolResult(await getDeudaCore(contrato))
);

// ============================================
// GET CONSUMO - Retrieves consumption history
// ============================================

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
    async ({ contrato, year }) => toToolResult(await getConsumoCore(contrato, year))
);

// ============================================
// GET CONTRACT DETAILS - Retrieves contract information
// ============================================

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
    async ({ contrato }) => toToolResult(await getContratoCore(contrato))
);

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
    async ({ contrato, periodo }) => toToolResult(await getReciboLinkCore(contrato, periodo))
);
