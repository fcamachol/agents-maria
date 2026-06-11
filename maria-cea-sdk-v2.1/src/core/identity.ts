// ============================================
// Core: validate_contract_holder + search_customer_by_contract
// Extracted from tools/identity.ts.
//
// IMPORTANT: the original tool mutated `ctx.verifiedContracts.add(contrato)`
// ONLY on a real name match (not on fail-open `skipped`). The core must NOT
// own that state — it returns the public `result` object (byte-identical to the
// previous JSON) plus a separate `verified` signal. Each caller persists:
//   - text agent → ctx.verifiedContracts
//   - voice       → its own per-call session
// ============================================

import { matchName } from "../services/name-matching.js";
import {
    fetchWithRetry,
    buildContratoSOAP,
    parseContratoResponse,
    parseXMLValue,
    fetchPuntoServicioEstado,
    pgQuery,
    CEA_API_BASE,
} from "../services/soap-client.js";
import { resolveContract, isValidContractFormat } from "../services/contract-resolver.js";
import { primeContractInfo } from "../services/contract-info.js";
import type { ToolResultObject } from "./types.js";

export interface ValidateContractHolderCoreResult {
    /** The public object to stringify as tool output (byte-identical to the original). */
    result: ToolResultObject;
    /** True ONLY when the provided name actually matched the titular — caller should mark verified. */
    verified: boolean;
    /** The resolved (translated) contract number. */
    contrato: string;
}

export async function validateContractHolderCore(
    rawContrato: string,
    nombre_proporcionado: string
): Promise<ValidateContractHolderCoreResult> {
    // Deterministic format guard: reject malformed numbers (wrong digit count)
    // BEFORE hitting the CEA API, so a mis-spoken contract gets a clear
    // "re-confirm" instead of a misleading "contrato no encontrado".
    const digits = (rawContrato ?? "").replace(/\D/g, "");
    if (!isValidContractFormat(digits)) {
        console.log(`[validate_contract_holder] Invalid contract format: "${rawContrato}" (${digits.length} digits)`);
        return {
            contrato: digits,
            verified: false,
            result: {
                validated: false,
                invalid_format: true,
                message: `El número de contrato debe tener 6 dígitos (o 9 si es un contrato anterior); el que me diste tiene ${digits.length}. ¿Lo puedes verificar?`,
            },
        };
    }

    const contrato = await resolveContract(rawContrato);
    console.log(`[validate_contract_holder] Validating "${nombre_proporcionado}" against contract ${contrato}`);

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

        if (!parsed.success || !parsed.data) {
            // codigoError -501 means the parser detected a not-found contract
            // (well-formed but empty SOAP body). Fail-closed: don't let agent proceed.
            if (parsed.codigoError === -501) {
                console.log(`[validate_contract_holder] Contract ${contrato} not found in CEA system`);
                return {
                    contrato,
                    verified: false,
                    result: {
                        validated: false,
                        contract_not_found: true,
                        message: `No se encontró el contrato ${contrato} en el sistema. ¿Puedes verificar el número?`
                    }
                };
            }
            console.log(`[validate_contract_holder] API error or no data, skipping verification`);
            return {
                contrato,
                verified: false,
                result: {
                    validated: true,
                    skipped: true,
                    reason: "No se pudo obtener datos del contrato"
                }
            };
        }

        // Prime the contract-info cache so any downstream tool (recibos, consumos,
        // deuda) has the resolved zona de explotación pre-cached and skips its own
        // lookup. Reuses the same parsed response we just paid for.
        if (parsed.data.explotacion) {
            await primeContractInfo(contrato, parsed.data);
        }

        // ENRICHMENT: Get real service status from punto de servicio
        const numeroContador = parseXMLValue(xml, "numeroContador");
        console.log(`[validate_contract_holder] numeroContador from XML: ${numeroContador}`);
        if (numeroContador && parsed.data) {
            try {
                const psEstado = await fetchPuntoServicioEstado(numeroContador);
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
            return {
                contrato,
                verified: false,
                result: {
                    validated: true,
                    skipped: true,
                    reason: "El contrato no tiene datos de titular"
                }
            };
        }

        const nameResult = matchName(nombre_proporcionado, titular);
        console.log(`[validate_contract_holder] Match result: ${JSON.stringify(nameResult)}`);

        if (nameResult.match) {
            return {
                contrato,
                verified: true,
                result: {
                    validated: true,
                    confidence: nameResult.confidence,
                    method: nameResult.method,
                    estado: parsed.data.estado
                }
            };
        }

        return {
            contrato,
            verified: false,
            result: {
                validated: false,
                message: "El nombre no coincide con el titular del contrato. ¿Puedes verificar e intentarlo de nuevo?"
            }
        };

    } catch (error) {
        console.error(`[validate_contract_holder] Error:`, error);
        // Fail-open: don't block the user if the API is down
        return {
            contrato,
            verified: false,
            result: {
                validated: true,
                skipped: true,
                reason: "Error al verificar, se omite validación"
            }
        };
    }
}

// ============================================
// SEARCH CUSTOMER BY CONTRACT
// ============================================

export async function searchCustomerByContractCore(contract_number: string): Promise<ToolResultObject> {
    console.log(`[search_customer] Searching for contract: ${contract_number}`);

    try {
        const contacts = await pgQuery<{
            id: number;
            name: string;
            email: string | null;
            phone_number: string | null;
            identifier: string | null;
            custom_attributes: Record<string, unknown> | null;
        }>(`
                SELECT id, name, email, phone_number, identifier, custom_attributes
                FROM contacts
                WHERE identifier = $1
                   OR custom_attributes->>'contract_number' = $1
                LIMIT 1
            `, [contract_number]);

        if (!contacts || contacts.length === 0) {
            return {
                success: false,
                found: false,
                message: "Cliente no encontrado"
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

        return result;
    } catch (error) {
        console.error(`[search_customer] Error:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Error desconocido'
        };
    }
}

// ============================================
// SEARCH CONTACT BY PHONE
//
// Used by the voice conversation-initiation webhook to greet a known caller by
// name. Matches contacts.phone_number on the LAST 10 digits, mirroring the
// session hub's normalizePhone() so voice (Twilio) and WhatsApp (AGORA) numbers
// collapse to the same contact.
// ============================================

export interface ContactByPhone {
    found: boolean;
    id?: number;
    name?: string;
    phone_number?: string | null;
}

export async function searchContactByPhoneCore(phone: string): Promise<ContactByPhone> {
    // Defensive normalization: keep the last 10 digits (same rule as normalizePhone).
    const digits = (phone || "").replace(/\D/g, "");
    if (digits.length < 10) {
        return { found: false };
    }
    const last10 = digits.slice(-10);

    try {
        const contacts = await pgQuery<{
            id: number;
            name: string | null;
            phone_number: string | null;
        }>(`
                SELECT id, name, phone_number
                FROM contacts
                WHERE RIGHT(regexp_replace(phone_number, '\\D', '', 'g'), 10) = $1
                ORDER BY id
                LIMIT 1
            `, [last10]);

        if (!contacts || contacts.length === 0) {
            return { found: false };
        }

        const contact = contacts[0];
        return {
            found: true,
            id: contact.id,
            name: contact.name || undefined,
            phone_number: contact.phone_number,
        };
    } catch (error) {
        console.error(`[search_contact_by_phone] Error:`, error);
        return { found: false };
    }
}
