// ============================================
// Voice tools — ElevenLabs webhook handlers
//
// Each handler calls shared `core/*` (single source of truth), gates sensitive
// data through the session hub (re-verify per channel), and renders spoken
// Spanish (digits spelled out, no markdown/emoji, ≤2 short sentences).
// ============================================

import { resolveContract, isValidContractFormat } from "../services/contract-resolver.js";
import {
    normalizePhone,
    isVerified,
    markVerified,
    setActiveCall,
    clearActiveCall,
    readEvents,
} from "../session/index.js";
import { getDeudaCore } from "../core/deuda.js";
import { getConsumoCore } from "../core/consumo.js";
import { getPagosCore } from "../core/pagos.js";
import { getContratoCore } from "../core/contrato.js";
import { getReciboLinkCore } from "../core/recibo.js";
import { validateContractHolderCore, searchContactByPhoneCore } from "../core/identity.js";
import { normalizeName, shouldWriteName, updateAgoraContactName } from "../core/contact.js";
import {
    createTicketCore,
    getClientTicketsCore,
    lookupTicketByFolioCore,
    updateTicketCore,
} from "../core/tickets.js";
import { getMainOfficeCore, findNearestLocationsCore } from "../core/location.js";
import { sendArtifactToWhatsApp } from "../core/notify.js";
import type { CategoryCode } from "../types.js";
import {
    formatCurrencyForVoice,
    spellDigits,
    formatFolioForVoice,
    numberToSpanishWords,
} from "./utils/number-to-words.js";

export interface VoiceToolResult {
    success: boolean;
    response: string;
    action?: string;
    metadata?: Record<string, unknown>;
}

type Params = Record<string, unknown>;

// ============================================
// Helpers
// ============================================

/** Resolve the cross-channel identity key from EL params (phone preferred). */
function identityKey(p: Params): string | null {
    const phoneRaw = String(p.phone ?? p.caller_id ?? p.system__caller_id ?? "");
    const phone = normalizePhone(phoneRaw);
    if (phone) return phone;
    const conv = String(p.conversation_id ?? p.system__conversation_id ?? "");
    return conv ? `conv:${conv}` : null;
}

function normalizeContrato(p: Params): string {
    return String(p.contrato ?? p.contract_number ?? "").replace(/[^0-9]/g, "");
}

/**
 * Resolve the caller's AGORA contact from the EL caller_id so tickets link to
 * the real contact (name + contact_phone) instead of a floating "Cliente Llamada".
 * When found, returns the AGORA-stored phone_number verbatim — AGORA's
 * find_or_create_contact matches phone_number exactly, so this guarantees the
 * link instead of spawning a duplicate contact. Falls back to the raw caller id.
 */
async function resolveCallerContact(p: Params): Promise<{ id?: number; name?: string; phone?: string }> {
    const raw = String(p.system__caller_id ?? p.caller_id ?? p.phone ?? "").trim();
    const normalized = normalizePhone(raw);
    if (!normalized) return {};
    try {
        const contact = await searchContactByPhoneCore(normalized);
        if (contact.found) {
            return { id: contact.id, name: contact.name, phone: contact.phone_number || raw };
        }
    } catch (error) {
        console.error("[voice/resolveCallerContact] lookup error:", error);
    }
    return { phone: raw };
}

/** Strip markdown/emoji-ish formatting so TTS reads clean prose. */
function stripForVoice(s: string): string {
    return s
        .replace(/[*_#`]/g, "")
        .replace(/https?:\/\/\S+/g, "")          // never read URLs aloud
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
        .replace(/\s*\n+\s*/g, ". ")
        .replace(/\s{2,}/g, " ")
        .replace(/\.\s*\./g, ".")
        .trim();
}

// In-call name-verification attempt counter (single voice process; call-scoped).
const verifyAttempts = new Map<string, number>();
function attemptKey(key: string, contrato: string) { return `${key}:${contrato}`; }

// ============================================
// Identity
// ============================================

async function validarTitular(p: Params): Promise<VoiceToolResult> {
    const key = identityKey(p);
    const nombre = String(p.nombre_titular ?? p.nombre_proporcionado ?? "").trim();
    const rawContrato = normalizeContrato(p);
    if (!rawContrato) return { success: false, response: "¿Me compartes tu número de contrato, por favor?" };
    if (!isValidContractFormat(rawContrato)) {
        return {
            success: false,
            response: `Ese número tiene ${rawContrato.length} dígitos, pero los contratos son de seis. ¿Me lo confirmas dígito por dígito?`,
        };
    }
    if (!nombre) return { success: false, response: `¿A nombre de quién está el contrato ${spellDigits(rawContrato)}?` };
    if (!key) return { success: false, response: "Tuve un problema para identificar tu llamada. ¿Puedes intentar de nuevo?" };

    const contrato = await resolveContract(rawContrato);
    const { result, verified } = await validateContractHolderCore(contrato, nombre);

    // Real match → verified for this channel.
    if (verified) {
        await markVerified(key, "voice", contrato);
        verifyAttempts.delete(attemptKey(key, contrato));
        return { success: true, response: "Gracias, confirmé tu identidad." };
    }

    // Fail-open (API/titular unavailable): don't block the caller.
    if (result.skipped) {
        await markVerified(key, "voice", contrato);
        verifyAttempts.delete(attemptKey(key, contrato));
        return { success: true, response: "Listo, ya te puedo ayudar." };
    }

    // Malformed contract (backstop; normally caught above before resolveContract).
    if (result.invalid_format) {
        return { success: false, response: stripForVoice(String(result.message)) };
    }

    // Contract not found.
    if (result.contract_not_found) {
        return { success: false, response: `No encontré el contrato ${spellDigits(contrato)} en el sistema. ¿Lo puedes verificar?` };
    }

    // Name mismatch → retry, with anti-bruteforce transfer after 2 attempts.
    const ak = attemptKey(key, contrato);
    const attempts = (verifyAttempts.get(ak) ?? 0) + 1;
    verifyAttempts.set(ak, attempts);
    if (attempts >= 2) {
        verifyAttempts.delete(ak);
        return {
            success: false,
            response: "No pude confirmar el titular. Te comunico con un asesor para ayudarte mejor.",
            action: "transfer",
            metadata: { intent: "identidad_no_confirmada", contrato },
        };
    }
    return { success: false, response: "Ese nombre no coincide con el titular del contrato. ¿Lo intentamos de nuevo?" };
}

/** Gate: returns a spoken refusal if the contract isn't verified on voice, else null. */
async function requireVerified(key: string | null, contrato: string): Promise<string | null> {
    if (!key) return "Tuve un problema para identificar tu llamada. ¿Puedes intentar de nuevo?";
    if (await isVerified(key, "voice", contrato)) return null;
    return `Primero necesito confirmar tu identidad. ¿A nombre de quién está el contrato ${spellDigits(contrato)}?`;
}

// ============================================
// Data tools (verified-gated)
// ============================================

async function consultarSaldo(p: Params): Promise<VoiceToolResult> {
    const key = identityKey(p);
    const rawContrato = normalizeContrato(p);
    if (!rawContrato) return { success: false, response: "¿Me das tu número de contrato?" };
    const contrato = await resolveContract(rawContrato);
    const gate = await requireVerified(key, contrato);
    if (gate) return { success: false, response: gate };

    const res = await getDeudaCore(contrato);
    const data = res.data as { totalDeuda?: number; vencido?: number; porVencer?: number } | undefined;
    if (!res.success || !data) {
        return { success: false, response: `No encontré información de saldo para el contrato ${spellDigits(contrato)}. ¿Lo puedes verificar?` };
    }
    const { totalDeuda = 0, vencido = 0, porVencer = 0 } = data;
    if (totalDeuda === 0) {
        return { success: true, response: "Tu cuenta está al corriente, no tienes saldo pendiente. ¿Algo más?" };
    }
    let response = `Tu saldo total es de ${formatCurrencyForVoice(totalDeuda)}.`;
    if (vencido > 0) response += ` Tienes ${formatCurrencyForVoice(vencido)} vencidos.`;
    response += " ¿Quieres las opciones de pago?";
    return { success: true, response, metadata: { intent: "consulta_saldo", contrato } };
}

async function consultarConsumo(p: Params): Promise<VoiceToolResult> {
    const key = identityKey(p);
    const rawContrato = normalizeContrato(p);
    if (!rawContrato) return { success: false, response: "¿Me das tu número de contrato?" };
    const contrato = await resolveContract(rawContrato);
    const gate = await requireVerified(key, contrato);
    if (gate) return { success: false, response: gate };

    // Optional time window. Callers ask for "los últimos N meses" (rolling window,
    // default 12) or a specific calendar year. Without honoring this the handler
    // used to slice(0,3) + speak an all-time average, so "consumos anteriores" and
    // 12-month averages were never delivered even though the API returns years of data.
    const yearNum = Number((p as Params).year ?? (p as Params).año ?? 0) || undefined;
    const mesesReq = Number((p as Params).meses ?? (p as Params).months ?? 0) || 0;

    const res = await getConsumoCore(contrato, yearNum);
    const consumos = (res as { consumos?: Array<{ consumoM3: number; periodo?: string; year?: number }> }).consumos;
    if (!res.success || !consumos || consumos.length === 0) {
        return {
            success: false,
            response: yearNum
                ? `No encontré consumo de ${numberToSpanishWords(yearNum)} para el contrato ${spellDigits(contrato)}.`
                : `No encontré historial de consumo para el contrato ${spellDigits(contrato)}.`,
        };
    }

    // Window: a full year when `year` is given, else the most recent N months.
    const ventana = yearNum ? consumos : consumos.slice(0, Math.min(mesesReq || 12, consumos.length));
    const valores = ventana.map(c => c.consumoM3);
    const total = valores.reduce((s, v) => s + v, 0);
    const promedio = Math.round(total / valores.length);
    const maximo = Math.max(...valores);

    const response = yearNum
        ? `En ${numberToSpanishWords(yearNum)} consumiste un total de ${numberToSpanishWords(total)} metros cúbicos, es decir ${numberToSpanishWords(total * 1000)} litros, con un promedio de ${numberToSpanishWords(promedio)} metros cúbicos al mes.`
        : `En los últimos ${numberToSpanishWords(ventana.length)} meses tu consumo promedió ${numberToSpanishWords(promedio)} metros cúbicos, es decir ${numberToSpanishWords(promedio * 1000)} litros, al mes; el mes más alto fue de ${numberToSpanishWords(maximo)} metros cúbicos.`;
    return { success: true, response, metadata: { intent: "consulta_consumo", contrato, meses: ventana.length, year: yearNum } };
}

async function consultarPagos(p: Params): Promise<VoiceToolResult> {
    const key = identityKey(p);
    const rawContrato = normalizeContrato(p);
    if (!rawContrato) return { success: false, response: "¿Me das tu número de contrato?" };
    const contrato = await resolveContract(rawContrato);
    const gate = await requireVerified(key, contrato);
    if (gate) return { success: false, response: gate };

    const yearNum = Number((p as Params).year ?? (p as Params).año ?? 0) || undefined;
    const mesesReq = Number((p as Params).meses ?? (p as Params).months ?? 0) || 0;

    const res = await getPagosCore(contrato, mesesReq || 6, yearNum);
    const recibos = (res as { recibos?: Array<{ periodo: string; importe: number; estado: string }> }).recibos;
    if (!res.success || !recibos || recibos.length === 0) {
        return { success: false, response: `No encontré recibos para el contrato ${spellDigits(contrato)}.` };
    }
    // Concise spoken list of the most recent recibos; the agent picks the month
    // the user asked about. Report billed amount + status (pagado/pendiente/vencido).
    const list = recibos.slice(0, 12)
        .map(r => `${r.periodo}, ${formatCurrencyForVoice(r.importe)}, ${r.estado}`)
        .join("; ");
    return { success: true, response: `Tus recibos recientes: ${list}.`, metadata: { intent: "consulta_pagos", contrato } };
}

async function consultarContrato(p: Params): Promise<VoiceToolResult> {
    const key = identityKey(p);
    const rawContrato = normalizeContrato(p);
    if (!rawContrato) return { success: false, response: "¿Me das tu número de contrato?" };
    const contrato = await resolveContract(rawContrato);
    const gate = await requireVerified(key, contrato);
    if (gate) return { success: false, response: gate };

    const res = await getContratoCore(contrato);
    const data = res.data as { titular?: string; direccion?: string; estado?: string } | undefined;
    if (!res.success || !data) {
        return { success: false, response: `No encontré los datos del contrato ${spellDigits(contrato)}.` };
    }
    let response = `El contrato está a nombre de ${data.titular ?? "titular no disponible"}`;
    if (data.direccion) response += `, en ${data.direccion}`;
    response += ".";
    if (data.estado) response += ` El servicio está ${data.estado}.`;
    return { success: true, response, metadata: { intent: "consulta_contrato", contrato } };
}

async function consultarTickets(p: Params): Promise<VoiceToolResult> {
    const key = identityKey(p);
    const rawContrato = normalizeContrato(p);
    if (!rawContrato) return { success: false, response: "¿De qué contrato quieres revisar tus reportes?" };
    const contrato = await resolveContract(rawContrato);
    const gate = await requireVerified(key, contrato);
    if (gate) return { success: false, response: gate };

    const res = await getClientTicketsCore({ contract_number: contrato });
    const tickets = (res as { tickets?: Array<{ folio: string; status: string; titulo?: string }> }).tickets;
    if (!res.success || !tickets || tickets.length === 0) {
        return { success: true, response: "No encontré reportes activos para tu contrato. ¿Algo más?" };
    }
    const t = tickets[0];
    const cnt = tickets.length;
    const cntWord = numberToSpanishWords(cnt);
    let response = cnt === 1
        ? `Tienes un reporte: ${t.titulo ?? "reporte"}, con folio ${formatFolioForVoice(t.folio)}.`
        : `Tienes ${cntWord} reportes. El más reciente es ${t.titulo ?? "un reporte"}, folio ${formatFolioForVoice(t.folio)}.`;
    return { success: true, response };
}

// ============================================
// Receipt → delivered via AGORA WhatsApp
// ============================================

async function enviarRecibo(p: Params): Promise<VoiceToolResult> {
    const key = identityKey(p);
    const rawContrato = normalizeContrato(p);
    const periodo = p.periodo ? String(p.periodo) : undefined;
    if (!rawContrato) return { success: false, response: "¿De qué contrato necesitas el recibo?" };
    const contrato = await resolveContract(rawContrato);
    const gate = await requireVerified(key, contrato);
    if (gate) return { success: false, response: gate };

    const res = await getReciboLinkCore(contrato, periodo);
    const data = res.data as { download_url?: string; periodo?: string } | undefined;
    if (!res.success || !data?.download_url) {
        return { success: false, response: stripForVoice(String(res.formatted_response ?? "No pude generar tu recibo en este momento.")) };
    }
    const msg = `Aquí está tu recibo${data.periodo ? ` de ${data.periodo}` : ""} del contrato ${contrato}: ${data.download_url}\n\nEl enlace es válido por 48 horas.`;
    const sent = await sendArtifactToWhatsApp(contrato, msg);
    if (!sent.success) {
        return { success: false, response: "Generé tu recibo pero no pude enviarlo por WhatsApp en este momento. ¿Lo intento de nuevo en un momento?" };
    }
    return { success: true, response: "Listo, te envié el recibo por WhatsApp. ¿Algo más?" };
}

// ============================================
// Reports
// ============================================

interface ReporteMap { category: CategoryCode; subcategory: string; titulo: string; viaPublica: boolean; }
const REPORTE_TIPOS: Record<string, ReporteMap> = {
    fuga:             { category: "REP", subcategory: "REP-FVP", titulo: "Fuga de agua en vía pública", viaPublica: true },
    fuga_domicilio:   { category: "REP", subcategory: "REP-FTD", titulo: "Fuga en domicilio", viaPublica: false },
    drenaje:          { category: "REP", subcategory: "REP-DRO", titulo: "Drenaje obstruido", viaPublica: true },
    sin_agua:         { category: "REP", subcategory: "REP-FSA", titulo: "Falta de agua", viaPublica: false },
    sin_agua_general: { category: "REP", subcategory: "REP-FGA", titulo: "Falta de agua general (vecinos)", viaPublica: false },
    baja_presion:     { category: "REP", subcategory: "REP-BAP", titulo: "Baja presión", viaPublica: false },
    calidad:          { category: "REP", subcategory: "REP-AOL", titulo: "Calidad del agua", viaPublica: false },
    medidor:          { category: "REP", subcategory: "REP-MED", titulo: "Problema con el medidor", viaPublica: false },
    reconexion:       { category: "SRV", subcategory: "SRV-RCN", titulo: "Reconexión de servicio", viaPublica: false },
};

async function crearReporte(p: Params): Promise<VoiceToolResult> {
    const tipo = String(p.tipo ?? "").toLowerCase();
    const ubicacion = p.ubicacion ? String(p.ubicacion) : undefined;
    const descripcion = String(p.descripcion ?? "").trim();
    const subTipo = p.sub_tipo ? String(p.sub_tipo).trim() : "";
    const map = REPORTE_TIPOS[tipo];
    if (!map) return { success: false, response: "¿Qué tipo de problema quieres reportar? Por ejemplo, una fuga, drenaje o falta de agua." };
    if (!map.viaPublica) {
        // Domiciliary reports need a contract (and ideally verification handled by the prompt flow).
        const rawContrato = normalizeContrato(p);
        if (!rawContrato) return { success: false, response: "Para ese reporte necesito tu número de contrato. ¿Me lo compartes?" };
    }
    if (map.viaPublica && !ubicacion) {
        return { success: false, response: "¿En qué dirección o cruce está el problema?" };
    }

    // Fuga sub-location (banqueta / arroyo de la calle / calle) stays on REP-FVP;
    // it only sharpens the title and description for the technician.
    const titulo = tipo === "fuga" && subTipo ? `Fuga de agua en ${subTipo}` : map.titulo;
    const descBase = descripcion || map.titulo;
    const descripcionFinal = subTipo ? `Ubicación: ${subTipo}. ${descBase}` : descBase;

    const caller = await resolveCallerContact(p);
    // The AGORA contact is the source of truth for the name. A real stored name
    // wins and is never overwritten; an empty/placeholder one is filled with the
    // name spoken in-call (shouldWriteName policy), updating the contact too.
    const nombre = normalizeName(String(p.nombre ?? ""));
    let clientName = caller.name;
    if (caller.id && nombre && shouldWriteName(caller.name, nombre)) {
        clientName = nombre;
        const updated = await updateAgoraContactName(caller.id, nombre);
        if (!updated.success) console.error(`[voice/crear_reporte] contact ${caller.id} name update failed:`, updated.error);
    } else if (!caller.id && nombre) {
        clientName = nombre; // new contact: AGORA creates it with the spoken name
    }
    const res = await createTicketCore({
        category_code: map.category,
        subcategory_code: map.subcategory,
        titulo,
        descripcion: descripcionFinal,
        contract_number: normalizeContrato(p) || undefined,
        client_name: clientName || "Cliente Llamada",
        phone: caller.phone || undefined,
        channel: "phone",
        contact_phone: caller.phone || undefined,
        ubicacion: ubicacion,
        priority: "medium",
    });
    const folio = (res as { folio?: string }).folio;
    if (res.success === false || !folio) {
        return { success: false, response: "No pude registrar tu reporte en este momento. ¿Lo intentamos de nuevo?" };
    }
    return {
        success: true,
        response: `Listo, registré tu reporte con folio ${formatFolioForVoice(folio)}. Un técnico lo atenderá. ¿Algo más?`,
        metadata: { intent: "reporte_creado", folio },
    };
}

async function actualizarReporte(p: Params): Promise<VoiceToolResult> {
    const folio = String(p.folio ?? "").trim();
    if (!folio) return { success: false, response: "¿Cuál es el folio del reporte que quieres actualizar?" };
    const status = p.status ? String(p.status) as never : undefined;
    const res = await updateTicketCore({ folio, status });
    if ((res as { blocked?: boolean }).blocked) {
        return {
            success: false,
            response: "Los reportes solo los puede cerrar un asesor. Te comunico con uno.",
            action: "transfer",
            metadata: { intent: "cerrar_ticket", folio },
        };
    }
    if (res.success === false) return { success: false, response: "No pude actualizar el reporte en este momento." };
    return { success: true, response: `Listo, actualicé el reporte ${formatFolioForVoice(folio)}.` };
}

async function buscarFolio(p: Params): Promise<VoiceToolResult> {
    const folio = String(p.folio ?? "").trim();
    if (!folio) return { success: false, response: "¿Cuál es el número de folio que quieres consultar?" };
    const res = await lookupTicketByFolioCore(folio);
    const found = (res as { found?: boolean }).found;
    const ticket = (res as { ticket?: { folio: string; status: string; titulo?: string } }).ticket;
    if (!res.success || !found || !ticket) {
        return {
            success: false,
            response: "No encontré ese folio en el sistema. Te comunico con un asesor para ayudarte mejor.",
            action: "transfer",
            metadata: { intent: "folio_no_encontrado", folio },
        };
    }
    return { success: true, response: `El reporte ${formatFolioForVoice(ticket.folio)} está en estado ${ticket.status}.` };
}

// ============================================
// Locations
// ============================================

async function infoOficina(): Promise<VoiceToolResult> {
    const res = await getMainOfficeCore();
    return { success: true, response: stripForVoice(String(res.formatted_response ?? "")) || "Te puedo dar la información de nuestra oficina principal." };
}

async function oficinaCercana(p: Params): Promise<VoiceToolResult> {
    const colonia = p.colonia ? String(p.colonia) : undefined;
    if (!colonia) {
        return { success: false, response: "¿En qué colonia estás? Así te digo la oficina o cajero más cercano." };
    }
    const res = await findNearestLocationsCore({ colonia, tipo: "all", limit: 2 });
    if (res.success === false) {
        return { success: false, response: stripForVoice(String(res.formatted_response ?? "No encontré esa colonia. ¿Me das otra referencia?")) };
    }
    const locs = (res.data as { locations?: Array<{ name: string; address: string; is_open?: boolean }> } | undefined)?.locations ?? [];
    if (locs.length === 0) return { success: true, response: stripForVoice(String(res.formatted_response ?? "No encontré ubicaciones cercanas.")) };
    const first = locs[0];
    let response = `La más cercana es ${first.name}, en ${first.address}.`;
    if (first.is_open !== undefined) response += first.is_open ? " Está abierta ahora." : " Está cerrada ahora.";
    return { success: true, response: stripForVoice(response) };
}

// ============================================
// Handoff
// ============================================

async function transferirHumano(p: Params): Promise<VoiceToolResult> {
    const key = identityKey(p);
    const motivo = String(p.motivo ?? p.reason ?? "Solicitud del usuario");
    if (key) await clearActiveCall(key);
    return {
        success: true,
        response: "Entendido, te comunico con un asesor. Un momento por favor.",
        action: "transfer",
        metadata: { intent: "transferencia", motivo },
    };
}

// ============================================
// Cross-channel: pick up WhatsApp media sent mid-call (pull model)
// ============================================

async function revisarWhatsapp(p: Params): Promise<VoiceToolResult> {
    const key = identityKey(p);
    if (!key) return { success: false, response: "No pude revisar tu WhatsApp en este momento." };
    // Look at the last few minutes of cross-channel events for this customer.
    const since = Date.now() - 5 * 60 * 1000;
    const events = await readEvents(key, since);
    const media = events.filter(e => e.channel === "whatsapp" && (e.type === "media" || e.type === "message")).slice(-1)[0];
    if (!media) {
        return { success: false, response: "Todavía no me llega nada por WhatsApp. Cuando lo mandes, dime y lo reviso." };
    }
    const desc = String((media.payload as { analysis?: string; summary?: string; kind?: string }).analysis
        ?? (media.payload as { summary?: string }).summary
        ?? "lo que me enviaste");
    return { success: true, response: stripForVoice(`Sí, ya recibí por WhatsApp ${desc}. Gracias.`) };
}

// ============================================
// Dispatcher
// ============================================

const HANDLERS: Record<string, (p: Params) => Promise<VoiceToolResult>> = {
    validar_titular: validarTitular,
    consultar_saldo: consultarSaldo,
    consultar_consumo: consultarConsumo,
    consultar_pagos: consultarPagos,
    consultar_contrato: consultarContrato,
    consultar_tickets: consultarTickets,
    enviar_recibo: enviarRecibo,
    crear_reporte: crearReporte,
    actualizar_reporte: actualizarReporte,
    buscar_folio: buscarFolio,
    info_oficina: infoOficina,
    oficina_cercana: oficinaCercana,
    transferir_humano: transferirHumano,
    revisar_whatsapp: revisarWhatsapp,
};

export async function executeVoiceTool(toolName: string, params: Params): Promise<VoiceToolResult> {
    // Mark the call active (best-effort) so the WhatsApp side knows.
    const key = identityKey(params);
    if (key) {
        const conv = String(params.conversation_id ?? params.system__conversation_id ?? "");
        if (conv) { try { await setActiveCall(key, conv); } catch { /* non-fatal */ } }
    }

    const handler = HANDLERS[toolName];
    if (!handler) {
        console.warn(`[voice] Unknown tool: ${toolName}`);
        return { success: false, response: "No entendí esa solicitud. ¿Me la repites?" };
    }
    return handler(params);
}
