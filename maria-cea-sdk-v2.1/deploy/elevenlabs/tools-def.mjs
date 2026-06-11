// ============================================
// Shared ElevenLabs webhook-tool definitions for Maria CEA voice (v2.1).
// Used by push-test-agent.mjs (clone) and update-live-agent.mjs (live).
// Single source of truth for the 13 tools.
// ============================================

const str = (description, opts = {}) => ({ type: "string", description, ...opts });
const int = (description) => ({ type: "integer", description });

// System dynamic variables EL injects, so the server can key the shared session
// by identity. Our voice/tools.ts identityKey() reads system__caller_id /
// system__conversation_id (and plain phone/conversation_id).
// EL rule: a request_body property sets exactly ONE of description / dynamic_variable /
// is_system_provided / constant_value / is_omitted. System variables use dynamic_variable alone.
export const SYSTEM_FIELDS = {
    system__conversation_id: { type: "string", dynamic_variable: "system__conversation_id" },
    system__caller_id: { type: "string", dynamic_variable: "system__caller_id" },
};

export const TOOLS = [
    { name: "validar_titular", description: "Valida la identidad: compara el nombre dado con el titular del contrato. Úsala ANTES de dar saldo, consumo, datos del contrato, recibos o reportes del contrato.",
      props: { contrato: str("Número de contrato CEA", { required: true }), nombre_titular: str("Nombre del titular que dio el usuario", { required: true }) } },
    { name: "consultar_saldo", description: "Saldo y adeudo de un contrato. Requiere identidad validada.",
      props: { contrato: str("Número de contrato CEA", { required: true }) } },
    { name: "consultar_consumo", description: "Consumo de agua: promedio, total y mes más alto de un periodo. Para 'los últimos N meses' o 'consumos anteriores' pasa `meses` (p. ej. 12). Para un año específico pasa `year`. Requiere identidad validada.",
      props: { contrato: str("Número de contrato CEA", { required: true }), meses: int("Cuántos meses recientes resumir (p. ej. 12; por defecto 12)"), year: int("Año específico a consultar (opcional)") } },
    { name: "consultar_pagos", description: "Recibos/facturación: cuánto se facturó cada mes y si está pagado, pendiente o vencido. Úsala para 'cuánto pagué', 'cuánto fue mi recibo' o 'cuánto debo de tal mes'. Pasa meses (recientes, por defecto 6) o year. Requiere identidad validada.",
      props: { contrato: str("Número de contrato CEA", { required: true }), meses: int("Cuántos meses recientes traer (por defecto 6)"), year: int("Año específico (opcional)") } },
    { name: "consultar_contrato", description: "Datos del contrato y titular. Requiere identidad validada.",
      props: { contrato: str("Número de contrato CEA", { required: true }) } },
    { name: "consultar_tickets", description: "Reportes activos del cliente por contrato. Requiere identidad validada.",
      props: { contrato: str("Número de contrato CEA", { required: true }) } },
    { name: "enviar_recibo", description: "Envía el recibo digital al WhatsApp del cliente (vía AGORA). Requiere identidad validada. No leas el enlace en voz.",
      props: { contrato: str("Número de contrato CEA", { required: true }), periodo: str("Mes/periodo del recibo (opcional)") } },
    { name: "crear_reporte", description: "Crea un reporte. tipo: fuga, fuga_domicilio, drenaje, sin_agua, sin_agua_general, baja_presion, calidad, medidor, reconexion. Fugas/drenaje en vía pública solo requieren ubicación; sin_agua/sin_agua_general/reconexion requieren contrato e identidad validada.",
      props: { tipo: str("Tipo de reporte", { required: true }), sub_tipo: str("Sub-ubicación de la fuga: banqueta, arroyo de la calle o calle (opcional)"), ubicacion: str("Dirección o cruce (requerido en vía pública)"), descripcion: str("Descripción detallada del problema reportado por el usuario: qué ocurre, magnitud y referencias", { required: true }), nombre: str("Nombre que dio el usuario durante la llamada (si lo dio)"), contrato: str("Contrato (requerido para reportes en domicilio)") } },
    { name: "actualizar_reporte", description: "Actualiza el estado de un reporte. Los usuarios no pueden cerrarlo.",
      props: { folio: str("Folio del reporte", { required: true }), status: str("Nuevo estado (opcional)") } },
    { name: "buscar_folio", description: "Consulta un reporte por su folio.",
      props: { folio: str("Folio que dio el usuario", { required: true }) } },
    { name: "info_oficina", description: "Información de la oficina principal de CEA (Pabellón Campestre).",
      props: {} },
    { name: "oficina_cercana", description: "Oficina o cajero más cercano por colonia (sin GPS en llamada).",
      props: { colonia: str("Colonia del usuario") } },
    { name: "transferir_humano", description: "Transfiere la llamada a un asesor humano.",
      props: { motivo: str("Motivo breve de la transferencia", { required: true }) } },
    { name: "revisar_whatsapp", description: "Revisa si el cliente envió una foto/mensaje por WhatsApp durante la llamada (p. ej. dijo 'ya la mandé').",
      props: {} },
];

export function buildToolConfig(t, serverUrl) {
    const properties = {};
    const required = [];
    for (const [key, def] of Object.entries(t.props)) {
        const { required: req, ...rest } = def;
        properties[key] = rest;
        if (req) required.push(key);
    }
    Object.assign(properties, SYSTEM_FIELDS);
    return {
        tool_config: {
            type: "webhook",
            name: t.name,
            description: t.description,
            response_timeout_secs: 20,
            api_schema: {
                url: `${serverUrl}/webhook/${t.name}`,
                method: "POST",
                request_body_schema: { type: "object", properties, required },
                content_type: "application/json",
            },
        },
    };
}
