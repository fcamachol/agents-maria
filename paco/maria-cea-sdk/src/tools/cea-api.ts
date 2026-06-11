// ============================================
// CEA API Tools - Debt, Consumption, Contract, Recibo
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
    fetchWithRetry,
    buildDeudaContratoSOAP,
    buildDeudaTotalConFacturasSOAP,
    buildConsumoSOAP,
    buildContratoSOAP,
    buildPuntoServicioPorContadorSOAP,
    buildGetFacturasSOAP,
    parseDeudaContratoResponse,
    parseDeudaTotalConFacturasResponse,
    parseConsumoResponse,
    parseContratoResponse,
    parsePuntoServicioEstado,
    fetchPuntoServicioEstado,
    parseGetFacturasResponse,
    parseXMLValue,
    CEA_API_BASE,
} from "../services/soap-client.js";
import { resolveContract } from "../services/contract-resolver.js";
import { generateReciboToken, SERVER_BASE_URL } from "../services/recibo-token.js";
import { renderTemplate } from "../config/response-templates.js";
import type { ConsumoResponse, FacturaPendiente, FacturaInfo } from "../types.js";

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
    async ({ contrato: rawContrato }) => {
        const contrato = await resolveContract(rawContrato);
        console.log(`[get_deuda] Fetching debt for contract: ${contrato}`);

        try {
            // Step 1: getDeudaContrato (PRIMARY — same params as old working getDeuda)
            console.log(`[get_deuda] Calling getDeudaContrato (primary)...`);
            const primaryResponse = await fetchWithRetry(
                `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                    body: buildDeudaContratoSOAP(contrato)
                }
            );
            const primaryXml = await primaryResponse.text();
            console.log(`[get_deuda] Primary response (first 500 chars):`, primaryXml.substring(0, 500));
            const primaryParsed = parseDeudaContratoResponse(primaryXml);
            console.log(`[get_deuda] Primary parsed:`, JSON.stringify(primaryParsed));

            if (primaryParsed.success && (primaryParsed.totalDeuda ?? 0) > 0) {
                const { totalDeuda = 0, nombreCliente, direccion } = primaryParsed;

                // Step 2: Try getDeudaTotalConFacturas for invoice breakdown (ENRICHMENT)
                let facturas: FacturaPendiente[] = [];
                let vencido = 0;
                let porVencer = 0;
                try {
                    console.log(`[get_deuda] Enriching with getDeudaTotalConFacturas...`);
                    const enrichResponse = await fetchWithRetry(
                        `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                            body: buildDeudaTotalConFacturasSOAP(contrato)
                        }
                    );
                    const enrichXml = await enrichResponse.text();
                    const enrichParsed = parseDeudaTotalConFacturasResponse(enrichXml);
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

            const fallbackResponse = await fetchWithRetry(
                `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                    body: buildDeudaTotalConFacturasSOAP(contrato)
                }
            );

            const fallbackXml = await fallbackResponse.text();
            console.log(`[get_deuda] Fallback response (first 500 chars):`, fallbackXml.substring(0, 500));
            const fallbackParsed = parseDeudaTotalConFacturasResponse(fallbackXml);
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
    async ({ contrato: rawContrato, year }) => {
        const contrato = await resolveContract(rawContrato);
        console.log(`[get_consumo] Fetching consumption for contract: ${contrato}, year: ${year || 'all'}`);

        try {
            // Try explotacion=1 first (most common), then 12 if no data
            const explotaciones = ["1", "12"];
            let parsed: ConsumoResponse = { success: false, error: "No data found" };

            for (const explotacion of explotaciones) {
                console.log(`[get_consumo] Trying explotacion=${explotacion}`);
                const response = await fetchWithRetry(
                    `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                        body: buildConsumoSOAP(contrato, explotacion)
                    }
                );

                const xml = await response.text();
                parsed = parseConsumoResponse(xml);

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
    async ({ contrato: rawContrato }) => {
        const contrato = await resolveContract(rawContrato);
        console.log(`[get_contract_details] Fetching contract: ${contrato}`);

        try {
            const response = await fetchWithRetry(
                `${CEA_API_BASE}/InterfazGenericaContratacionWS`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                    body: buildContratoSOAP(contrato)
                }
            );

            const xml = await response.text();
            const parsed = parseContratoResponse(xml);

            if (!parsed.success) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: parsed.error,
                    formatted_response: `No encontré información para el contrato ${contrato}. ¿Puedes verificar el número?`
                }) }] };
            }

            // ENRICHMENT: Get real service status from punto de servicio
            const numeroContador = parseXMLValue(xml, "numeroContador");
            console.log(`[get_contract_details] numeroContador from XML: ${numeroContador}`);
            if (numeroContador && parsed.data) {
                try {
                    const psEstado = await fetchPuntoServicioEstado(numeroContador);
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
                const facturasResponse = await fetchWithRetry(
                    `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
                    { method: 'POST', headers: { 'Content-Type': 'text/xml;charset=UTF-8' }, body: buildGetFacturasSOAP(contrato, explotacion) }
                );
                const facturasXml = await facturasResponse.text();
                parsed = parseGetFacturasResponse(facturasXml);
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
