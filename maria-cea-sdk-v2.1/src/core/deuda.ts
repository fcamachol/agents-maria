// ============================================
// Core: get_deuda — debt/balance orchestration
// Extracted verbatim from tools/cea-api.ts (getDeudaTool handler).
// Returns the exact object the tool previously stringified.
// ============================================

import {
    fetchWithRetry,
    buildDeudaContratoSOAP,
    buildDeudaTotalConFacturasSOAP,
    parseDeudaContratoResponse,
    parseDeudaTotalConFacturasResponse,
    CEA_API_BASE,
} from "../services/soap-client.js";
import { resolveContract } from "../services/contract-resolver.js";
import { getContractInfo } from "../services/contract-info.js";
import type { FacturaPendiente } from "../types.js";
import type { ToolResultObject } from "./types.js";

export async function getDeudaCore(rawContrato: string): Promise<ToolResultObject> {
    const contrato = await resolveContract(rawContrato);
    console.log(`[get_deuda] Fetching debt for contract: ${contrato}`);

    const info = await getContractInfo(contrato);
    if (!info) {
        return {
            success: false,
            error: "contrato_no_encontrado",
            formatted_response: `No encontré el contrato ${contrato} en el sistema. Por favor verifica que el número sea correcto. Lo puedes encontrar en tu recibo de agua en la parte superior.`
        };
    }
    const explotacion = info.explotacion;

    try {
        // Step 1: getDeudaContrato (PRIMARY — same params as old working getDeuda)
        console.log(`[get_deuda] Calling getDeudaContrato (primary)...`);
        const primaryResponse = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                body: buildDeudaContratoSOAP(contrato, explotacion)
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
                        body: buildDeudaTotalConFacturasSOAP(contrato, explotacion)
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

            return {
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
            };
        }

        // Primary returned 0 debt — genuinely no debt from the reliable endpoint
        if (primaryParsed.success && (primaryParsed.totalDeuda ?? 0) === 0) {
            return {
                success: true,
                formatted_response: `Tu contrato ${contrato} no tiene adeudos pendientes.\n\n¿Te puedo ayudar con algo más?`,
                data: { contrato, totalDeuda: 0, mensaje: "sin adeudo" }
            };
        }

        // Primary failed — check if it's a definitive error (contract not found)
        if (primaryParsed.codigoError === -501 || primaryParsed.error?.includes("no existe")) {
            console.log(`[get_deuda] Contract not found (code ${primaryParsed.codigoError}): ${primaryParsed.error}`);
            return {
                success: false,
                error: "contrato_no_encontrado",
                codigoError: primaryParsed.codigoError,
                formatted_response: `No encontré el contrato ${contrato} en el sistema. Por favor verifica que el número sea correcto. Lo puedes encontrar en tu recibo de agua en la parte superior.`
            };
        }

        // Primary failed for other reasons — try getDeudaTotalConFacturas as last resort
        console.log(`[get_deuda] Primary failed (${primaryParsed.error}), trying getDeudaTotalConFacturas fallback...`);

        const fallbackResponse = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
                body: buildDeudaTotalConFacturasSOAP(contrato, explotacion)
            }
        );

        const fallbackXml = await fallbackResponse.text();
        console.log(`[get_deuda] Fallback response (first 500 chars):`, fallbackXml.substring(0, 500));
        const fallbackParsed = parseDeudaTotalConFacturasResponse(fallbackXml);
        console.log(`[get_deuda] Fallback parsed:`, JSON.stringify(fallbackParsed));

        if (fallbackParsed.success) {
            const { totalDeuda = 0, facturas = [], nombreCliente } = fallbackParsed;

            if (facturas.length === 0 && totalDeuda === 0) {
                return {
                    success: true,
                    formatted_response: `Tu contrato ${contrato} está en proceso de facturación. En cuanto se complete, podrás consultar tu saldo actualizado.`,
                    data: { contrato, totalDeuda: 0, mensaje: "proceso de facturación" }
                };
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

            return {
                success: true,
                formatted_response: formattedResponse,
                data: { contrato, totalDeuda, vencido, porVencer, nombreCliente, facturas }
            };
        }

        // Both calls failed
        return {
            success: false,
            error: fallbackParsed.error,
            formatted_response: `No encontré información de adeudo para el contrato ${contrato}. ¿Puedes verificar el número?`
        };
    } catch (error) {
        console.error(`[get_deuda] Error:`, error);
        return {
            success: false,
            error: `No se pudo consultar el saldo: ${error instanceof Error ? error.message : 'Error desconocido'}`,
            formatted_response: "El sistema de consulta no está disponible en este momento. ¿Puedes intentar en unos minutos?"
        };
    }
}
