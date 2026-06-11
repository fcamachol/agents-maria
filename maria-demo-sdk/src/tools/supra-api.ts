// ============================================
// Hydropolis API Tools - Debt, Consumption, Contract, Recibo
// Backed by SUPRA REST API via supra-client.ts
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getDeuda, getConsumos, getContrato, getRecibos, ContratoNoEncontradoError } from "../services/supra-client.js";
import { renderTemplate } from "../config/response-templates.js";

// ============================================
// GET DEUDA - Retrieves debt/balance information
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
        try {
            const data = await getDeuda(contrato);

            if (data.totalDeuda === 0) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: true,
                            formatted_response: `Tu contrato ${contrato} no tiene adeudos pendientes.\n\n¿Te puedo ayudar con algo más?`,
                            data: { contrato, totalDeuda: 0 }
                        })
                    }]
                };
            }

            // Build formatted response
            let formattedResponse = `Estado de cuenta del contrato ${contrato}:\n\n`;
            formattedResponse += `💰 **Total a pagar: $${data.totalDeuda.toFixed(2)}**\n`;
            if (data.nombreCliente) formattedResponse += `👤 Cliente: ${data.nombreCliente}\n`;
            if (data.vencido > 0) formattedResponse += `🔴 Vencido: $${data.vencido.toFixed(2)}\n`;
            if (data.porVencer > 0) formattedResponse += `🟡 Por vencer: $${data.porVencer.toFixed(2)}\n`;

            if (data.facturas && data.facturas.length > 0) {
                formattedResponse += `\n📋 **Recibos pendientes:**\n`;
                for (const factura of data.facturas) {
                    const emoji = factura.estadoTexto === "vencido" ? "🔴" : "🟡";
                    const venceInfo = factura.fechaVencimiento ? ` - Vence: ${factura.fechaVencimiento}` : "";
                    formattedResponse += `${emoji} ${factura.ciclo}: $${factura.importeTotal.toFixed(2)} (${factura.estadoTexto})${venceInfo}\n`;
                }
            }

            formattedResponse += `\n¿Quieres realizar un pago o tienes dudas sobre tu saldo?`;

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        formatted_response: formattedResponse,
                        data
                    })
                }]
            };
        } catch (error) {
            console.error(`[get_deuda] Error:`, error);
            const notFound = error instanceof ContratoNoEncontradoError;
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        formatted_response: notFound
                            ? `No encontré tu contrato, ¿puedes revisar el número?`
                            : `No pude consultar tu saldo en este momento, intenta de nuevo en unos minutos.`
                    })
                }]
            };
        }
    }
);

// ============================================
// GET CONSUMO - Retrieves consumption history
// ============================================

export const getConsumoTool = tool(
    "get_consumo",
    `Obtiene el historial de consumo de agua de un contrato.

PARÁMETROS:
- contrato: Número de contrato Hydropolis (requerido)
- year: Año específico para filtrar (opcional, ej: 2022, 2023)

RETORNA:
- consumos: Lista de consumos por periodo (m³)
- promedioMensual: Promedio de consumo mensual
- tendencia: Si el consumo está aumentando, estable o disminuyendo
- añosDisponibles: Lista de años con datos disponibles

Usa cuando el usuario pregunte por su consumo, historial de lecturas, o cuánta agua ha gastado.
Si el usuario pide un año específico (ej: "consumo de 2022"), usa el parámetro year para filtrar.`,
    {
        contrato: z.string().describe("Número de contrato Hydropolis"),
        year: z.number().optional().describe("Año específico para filtrar los consumos (ej: 2022)")
    },
    async ({ contrato, year }) => {
        console.log(`[get_consumo] Fetching consumption for contract: ${contrato}, year: ${year ?? "all"}`);
        try {
            const data = await getConsumos(contrato);

            // Extract year from periodo string (e.g., "MAR 2026" → 2026)
            const añosDisponibles = [
                ...new Set(
                    data.consumos
                        .map(c => {
                            const match = c.periodo.match(/\d{4}/);
                            return match ? parseInt(match[0], 10) : null;
                        })
                        .filter((y): y is number => y !== null)
                )
            ].sort((a, b) => b - a);

            // Filter by year if specified
            let consumosFiltrados = data.consumos;
            if (year !== undefined) {
                consumosFiltrados = data.consumos.filter(c => {
                    const match = c.periodo.match(/\d{4}/);
                    return match ? parseInt(match[0], 10) === year : false;
                });
            }

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        formatted_response: year
                            ? `Consumo ${year}: ${consumosFiltrados.length} registros encontrados. Promedio mensual: ${data.promedioMensual} m³.`
                            : `Historial de consumo: ${data.consumos.length} registros. Promedio mensual: ${data.promedioMensual} m³. Tendencia: ${data.tendencia}.`,
                        data: {
                            contrato: data.contrato,
                            consumos: consumosFiltrados,
                            promedioMensual: data.promedioMensual,
                            tendencia: data.tendencia,
                            añosDisponibles
                        }
                    })
                }]
            };
        } catch (error) {
            console.error(`[get_consumo] Error:`, error);
            const notFound = error instanceof ContratoNoEncontradoError;
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        formatted_response: notFound
                            ? `No encontré tu contrato, ¿puedes revisar el número?`
                            : `No pude consultar tu historial de consumo en este momento, intenta de nuevo en unos minutos.`
                    })
                }]
            };
        }
    }
);

// ============================================
// GET CONTRACT DETAILS - Retrieves contract information
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
        try {
            const data = await getContrato(contrato);

            const formattedResponse = renderTemplate("contract_info", {
                contract_number: contrato,
                titular: data.nombreTitular,
                direccion: data.direccion,
                colonia: data.colonia,
                tarifa: data.tarifa,
                estado: data.estado
            });

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        formatted_response: formattedResponse,
                        data
                    })
                }]
            };
        } catch (error) {
            console.error(`[get_contract_details] Error:`, error);
            const notFound = error instanceof ContratoNoEncontradoError;
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        formatted_response: notFound
                            ? `No encontré tu contrato, ¿puedes revisar el número?`
                            : `No pude consultar los detalles de tu contrato en este momento, intenta de nuevo en unos minutos.`
                    })
                }]
            };
        }
    }
);

// ============================================
// GET PAYMENT LINK - Returns prefilled online payment URL
// ============================================

const PAYMENT_PORTAL_BASE = "https://supra.humansoftware.mx/portal";

export const getPaymentLinkTool = tool(
    "get_payment_link",
    `Genera un enlace al portal de pago en línea prellenado con el número de contrato.

USA ESTA HERRAMIENTA CUANDO:
- El usuario pida un link, enlace o liga de pago
- El usuario quiera pagar en línea
- El usuario pida "mándame el link para pagar" o similar

PARÁMETROS:
- contrato: Número de contrato Hydropolis (requerido)

La herramienta valida que el contrato existe antes de devolver el enlace. Si no existe, devuelve un mensaje claro para que el usuario revise el número.`,
    {
        contrato: z.string().describe("Número de contrato Hydropolis")
    },
    async ({ contrato }) => {
        console.log(`[get_payment_link] Generating link for contract: ${contrato}`);
        try {
            await getContrato(contrato);
            const url = `${PAYMENT_PORTAL_BASE}?contrato=${encodeURIComponent(contrato)}`;
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        formatted_response: `Aquí está tu link de pago del contrato ${contrato}:\n\n${url}\n\n¿Te puedo ayudar con algo más?`,
                        data: { contrato, url }
                    })
                }]
            };
        } catch (error) {
            console.error(`[get_payment_link] Error:`, error);
            const notFound = error instanceof ContratoNoEncontradoError;
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        formatted_response: notFound
                            ? `No encontré tu contrato, ¿puedes revisar el número?`
                            : `No pude generar tu link de pago en este momento, intenta de nuevo en unos minutos.`
                    })
                }]
            };
        }
    }
);

// ============================================
// GET RECIBO LINK - Returns download URL for receipt PDF
// ============================================

export const getReciboPdfTool = tool(
    "get_recibo_link",
    `Genera un enlace para descargar el recibo digital (PDF) de un contrato.

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
        console.log(`[get_recibo_link] Fetching recibos for contract: ${contrato}, periodo: ${periodo ?? "latest"}`);
        try {
            const data = await getRecibos(contrato);

            if (!data.recibos || data.recibos.length === 0) {
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify({
                            success: false,
                            formatted_response: `No encontré recibos disponibles para el contrato ${contrato}. ¿Puedes verificar el número de contrato?`
                        })
                    }]
                };
            }

            // Find target recibo: match by periodo or use most recent
            let targetRecibo = data.recibos[0];

            if (periodo) {
                const periodoNorm = periodo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const match = data.recibos.find(r => {
                    const rNorm = r.periodo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                    return rNorm.includes(periodoNorm) || periodoNorm.includes(rNorm);
                });

                if (!match) {
                    const available = data.recibos.map(r => r.periodo).join(", ");
                    return {
                        content: [{
                            type: "text" as const,
                            text: JSON.stringify({
                                success: false,
                                formatted_response: `No encontré un recibo para "${periodo}". Los recibos disponibles son: ${available}. ¿De cuál mes necesitas el recibo?`
                            })
                        }]
                    };
                }
                targetRecibo = match;
            }

            const formattedResponse =
                `Aquí está tu recibo de *${targetRecibo.periodo}* del contrato ${contrato}:\n\n` +
                `📄 ${targetRecibo.downloadUrl}\n\n` +
                `Si necesitas de otro mes avísame`;

            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: true,
                        formatted_response: formattedResponse,
                        data: {
                            contrato: data.contrato,
                            recibo: targetRecibo
                        }
                    })
                }]
            };
        } catch (error) {
            console.error(`[get_recibo_link] Error:`, error);
            const notFound = error instanceof ContratoNoEncontradoError;
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({
                        success: false,
                        formatted_response: notFound
                            ? `No encontré tu contrato, ¿puedes revisar el número?`
                            : `No pude obtener tu recibo en este momento, intenta de nuevo en unos minutos.`
                    })
                }]
            };
        }
    }
);
