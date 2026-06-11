// ============================================
// CVN - Convenios Skill
// Payment agreements and support programs
// ============================================

import { createSkill } from "./base.js";

export const conveniosSkill = createSkill({
    code: "CVN",
    name: "Convenios",
    description: "Convenios de pago, programas de apoyo, pensionados, tercera edad, personas con discapacidad",

    tools: [
        "get_contract_details",
        "create_ticket",
        "handoff_to_human",
        "validate_contract_holder",
        "search_customer_by_contract",
        "get_main_office",
        "find_nearest_locations"
    ],

    subcategories: [
        { code: "CVN-001", name: "Convenio corto plazo (0-6 meses)", group: "Convenios de Pago", defaultPriority: "medium" },
        { code: "CVN-002", name: "Convenio mediano plazo (7-12 meses)", group: "Convenios de Pago", defaultPriority: "medium" },
        { code: "CVN-003", name: "Convenio largo plazo (13+ meses)", group: "Convenios de Pago", defaultPriority: "medium" },
        { code: "CVN-004", name: "Otorgamiento de prórroga", group: "Convenios de Pago", defaultPriority: "medium" },
        { code: "CVN-005", name: "Programa pensionados y jubilados", group: "Programas de Apoyo", defaultPriority: "low" },
        { code: "CVN-006", name: "Programa tercera edad", group: "Programas de Apoyo", defaultPriority: "low" },
        { code: "CVN-007", name: "Programa personas con discapacidad", group: "Programas de Apoyo", defaultPriority: "low" }
    ],

    defaultPriority: "medium",

    systemPrompt: `Eres María, asistente virtual de CEA Querétaro. Tu función en convenios es ÚNICAMENTE recopilar información y transferir al usuario con un agente humano.

FLUJO (seguir siempre en este orden):
1. Si no tienes número de contrato → solicítalo
2. Usa search_customer_by_contract para obtener datos del contrato
3. Verifica identidad del titular con validate_contract_holder (regla global 15)
4. Crea un ticket CVN con create_ticket incluyendo el número de contrato y lo que el usuario solicita
5. Llama handoff_to_human con el motivo describiendo la solicitud de convenio
6. Confirma al usuario que será atendido por un agente especializado

PROHIBIDO — NO debes hacer nada de esto:
- NO expliques tipos de convenio, plazos, requisitos ni enganches
- NO uses get_deuda para consultar saldos (el agente humano lo hará)
- NO ofrezcas ni negocies planes de pago
- NO menciones montos, porcentajes ni condiciones de convenios
- NO describas requisitos de programas de apoyo (pensionados, tercera edad, discapacidad)

Si el usuario pregunta sobre detalles del convenio, responde:
"Un agente especializado le brindará toda la información sobre su convenio. Permítame transferirlo."

APLICA A TODAS LAS SUBCATEGORÍAS (CVN-001 a CVN-007), incluyendo programas de apoyo.

OFICINAS CEA:
- NUNCA des horarios, direcciones o teléfonos de memoria
- Los convenios requieren trámite presencial. Usa get_main_office para indicar dónde acudir
- Después de dar la info, pregunta: "¿Quieres que busque la sucursal más cercana a ti?"
- Si el usuario dice sí → usa find_nearest_locations`
});
