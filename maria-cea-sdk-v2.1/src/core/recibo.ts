// ============================================
// Core: get_recibo_link — receipt PDF link orchestration
// Extracted verbatim from tools/cea-api.ts (getReciboPdfTool handler).
// Returns the signed download URL in `data.download_url` so callers can
// deliver it however they like (WhatsApp text, AGORA push, etc.).
// ============================================

import {
    fetchWithRetry,
    buildGetFacturasSOAP,
    parseGetFacturasResponse,
    CEA_API_BASE,
} from "../services/soap-client.js";
import { resolveContract } from "../services/contract-resolver.js";
import { getContractInfo, invalidateContractInfo } from "../services/contract-info.js";
import { generateReciboToken, SERVER_BASE_URL } from "../services/recibo-token.js";
import type { FacturaInfo } from "../types.js";
import type { ToolResultObject } from "./types.js";

export async function getReciboLinkCore(rawContrato: string, periodo?: string): Promise<ToolResultObject> {
    const contrato = await resolveContract(rawContrato);
    console.log(`[get_recibo_link] Generating PDF link for contract: ${contrato}, periodo: ${periodo || 'latest'}`);

    const info = await getContractInfo(contrato);
    if (!info) {
        return {
            success: false,
            formatted_response: `No encontré el contrato ${contrato} en el sistema. ¿Puedes verificar el número de contrato?`
        };
    }

    const fetchFacturas = async (explotacion: string) => {
        const facturasResponse = await fetchWithRetry(
            `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
            { method: 'POST', headers: { 'Content-Type': 'text/xml;charset=UTF-8' }, body: buildGetFacturasSOAP(contrato, explotacion) }
        );
        return parseGetFacturasResponse(await facturasResponse.text());
    };

    try {
        let parsed: { success: boolean; facturas: FacturaInfo[]; error?: string } = await fetchFacturas(info.explotacion);

        // Defense in depth: cached zone returned nothing — bust cache and retry once.
        if (!parsed.success || parsed.facturas.length === 0) {
            console.log(`[get_recibo_link] empty result with cached explotacion=${info.explotacion}, refreshing zone`);
            await invalidateContractInfo(contrato);
            const refreshed = await getContractInfo(contrato);
            if (refreshed && refreshed.explotacion && refreshed.explotacion !== info.explotacion) {
                parsed = await fetchFacturas(refreshed.explotacion);
            }
        }

        if (!parsed.success || parsed.facturas.length === 0) {
            return {
                success: false,
                formatted_response: `No encontré recibos disponibles para el contrato ${contrato}. ¿Puedes verificar el número de contrato?`
            };
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
                return {
                    success: false,
                    formatted_response: `No encontré un recibo para "${periodo}". Los recibos disponibles son: ${availablePeriods}. ¿De cuál mes necesitas el recibo?`
                };
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

        return {
            success: true,
            formatted_response: formattedResponse,
            data: {
                contrato,
                factura: targetFactura.numero,
                periodo: targetFactura.periodoTexto,
                download_url: downloadUrl
            }
        };
    } catch (error) {
        console.error(`[get_recibo_link] Error:`, error);
        return {
            success: false,
            formatted_response: "No se pudo generar el enlace del recibo en este momento. ¿Puedes intentar en unos minutos?"
        };
    }
}
