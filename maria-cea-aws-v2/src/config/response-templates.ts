// ============================================
// Maria Claude - Response Templates
// Standardized formatting for consistent AI responses
// ============================================

import type { CategoryCode, TicketStatus, TicketPriority } from "../types.js";

// ============================================
// Type Definitions
// ============================================

export type FormatType =
    | "text"
    | "name"
    | "currency"
    | "date"
    | "datetime"
    | "status"
    | "address"
    | "phone"
    | "contract"
    | "percentage";

export interface TemplateField {
    key: string;
    label: string;
    format: FormatType;
    optional?: boolean;
}

export interface ResponseTemplate {
    header: string;
    fields: TemplateField[];
    footer: string;
}

export interface StatusDisplayItem {
    emoji: string;
    text: string;
}

// ============================================
// Status Display Mappings
// ============================================

export const STATUS_DISPLAY: Record<string, StatusDisplayItem> = {
    // Service/Contract Status
    activo: { emoji: "✅", text: "Activo" },
    suspendido: { emoji: "⚠️", text: "Suspendido" },
    cortado: { emoji: "🔴", text: "Cortado" },
    inactivo: { emoji: "⚫", text: "Inactivo" },

    // Ticket Status
    open: { emoji: "🔵", text: "Abierto" },
    in_progress: { emoji: "🔄", text: "En proceso" },
    escalated: { emoji: "⬆️", text: "Escalado" },
    waiting_client: { emoji: "🕐", text: "Esperando respuesta" },
    waiting_internal: { emoji: "🕐", text: "En revisión" },
    resolved: { emoji: "✅", text: "Resuelto" },
    closed: { emoji: "✔️", text: "Cerrado" },
    cancelled: { emoji: "❌", text: "Cancelado" },

    // Work Order Status
    pendiente: { emoji: "🕐", text: "Pendiente" },
    programado: { emoji: "📅", text: "Programado" },
    en_proceso: { emoji: "🔄", text: "En proceso" },
    completado: { emoji: "✅", text: "Completado" },

    // Payment Status
    pagado: { emoji: "✅", text: "Pagado" },
    vencido: { emoji: "🔴", text: "Vencido" },
    por_vencer: { emoji: "⚠️", text: "Por vencer" },

    // Generic
    si: { emoji: "✅", text: "Sí" },
    no: { emoji: "❌", text: "No" }
};

// ============================================
// Category Emojis
// ============================================

export const CATEGORY_EMOJIS: Record<CategoryCode, string> = {
    CON: "ℹ️",
    FAC: "📄",
    CTR: "📋",
    CVN: "💳",
    REP: "🔧",
    SRV: "⚙️",
    CNS: "💧"
};

// Additional emojis for ticket types
export const TICKET_TYPE_EMOJIS: Record<string, string> = {
    fuga: "🔧",
    agua: "🔧",
    drenaje: "🚰",
    medidor: "📊",
    recibo: "📄",
    pago: "💳",
    contrato: "📋",
    urgente: "🚨"
};

// ============================================
// Format Functions
// ============================================

/**
 * Format a single field value based on format type
 */
export function formatField(value: unknown, format: FormatType): string {
    if (value === null || value === undefined || value === "") {
        return "No disponible";
    }

    switch (format) {
        case "text":
            return String(value);

        case "name":
            // Capitalize proper names
            return String(value)
                .split(" ")
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(" ");

        case "currency":
            const num = typeof value === "number" ? value : parseFloat(String(value));
            if (isNaN(num)) return String(value);
            return `$${num.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        case "date":
            try {
                const date = new Date(value as string);
                if (isNaN(date.getTime())) return String(value);
                return date.toLocaleDateString("es-MX", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric"
                });
            } catch {
                return String(value);
            }

        case "datetime":
            try {
                const datetime = new Date(value as string);
                if (isNaN(datetime.getTime())) return String(value);
                return datetime.toLocaleDateString("es-MX", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                });
            } catch {
                return String(value);
            }

        case "status":
            const statusKey = String(value).toLowerCase();
            const statusInfo = STATUS_DISPLAY[statusKey];
            if (statusInfo) {
                return `${statusInfo.emoji} ${statusInfo.text}`;
            }
            return String(value);

        case "address":
            // Clean up address formatting
            return String(value)
                .replace(/\s+/g, " ")
                .trim();

        case "phone":
            const phoneStr = String(value).replace(/\D/g, "");
            if (phoneStr.length === 10) {
                return `${phoneStr.slice(0, 3)}-${phoneStr.slice(3, 6)}-${phoneStr.slice(6)}`;
            }
            return phoneStr;

        case "contract":
            return String(value);

        case "percentage":
            const pct = typeof value === "number" ? value : parseFloat(String(value));
            if (isNaN(pct)) return String(value);
            return `${pct.toFixed(1)}%`;

        default:
            return String(value);
    }
}

/**
 * Get emoji for a category code
 */
export function getCategoryEmoji(category: CategoryCode | string): string {
    return CATEGORY_EMOJIS[category as CategoryCode] || "📌";
}

/**
 * Get status display with emoji
 */
export function getStatusDisplay(status: string): StatusDisplayItem {
    const key = status.toLowerCase();
    return STATUS_DISPLAY[key] || { emoji: "•", text: status };
}

// ============================================
// Response Templates
// ============================================

export const RESPONSE_TEMPLATES: Record<string, ResponseTemplate> = {
    contract_info: {
        header: "Estos son los detalles de tu contrato {contract_number}:",
        fields: [
            { key: "titular", label: "Titular", format: "name" },
            { key: "direccion", label: "Dirección", format: "address" },
            { key: "colonia", label: "Colonia", format: "text" },
            { key: "tarifa", label: "Tarifa", format: "text" },
            { key: "estado", label: "Estado del servicio", format: "status" }
        ],
        footer: "¿Necesitas realizar algún trámite o tienes alguna duda?"
    },

    balance_info: {
        header: "Este es el estado de cuenta del contrato {contract_number}:",
        fields: [
            { key: "titular", label: "Titular", format: "name" },
            { key: "saldo_actual", label: "Saldo actual", format: "currency" },
            { key: "vencido", label: "Monto vencido", format: "currency", optional: true },
            { key: "por_vencer", label: "Por vencer", format: "currency", optional: true },
            { key: "fecha_corte", label: "Fecha de corte", format: "date", optional: true }
        ],
        footer: "¿Necesitas realizar un pago o tienes alguna duda sobre tu saldo?"
    },

    ticket_created: {
        header: "Listo, creé tu reporte con folio {folio} {emoji}",
        fields: [
            { key: "tipo", label: "Tipo", format: "text" },
            { key: "ubicacion", label: "Ubicación", format: "address", optional: true },
            { key: "estatus", label: "Estatus", format: "status" }
        ],
        footer: "Te notificaremos cuando haya actualizaciones. ¿Algo más en que pueda ayudarte?"
    },

    ticket_status: {
        header: "Estado de tu reporte con folio {folio}:",
        fields: [
            { key: "tipo", label: "Tipo", format: "text" },
            { key: "estatus", label: "Estatus", format: "status" },
            { key: "fecha_creacion", label: "Fecha de creación", format: "date" },
            { key: "ultima_actualizacion", label: "Última actualización", format: "datetime", optional: true },
            { key: "notas", label: "Notas", format: "text", optional: true }
        ],
        footer: "¿Necesitas más información o tienes alguna duda?"
    },

    work_order_status: {
        header: "Estado de tu orden de trabajo {work_order_id}:",
        fields: [
            { key: "tipo_trabajo", label: "Tipo", format: "text" },
            { key: "fecha_programada", label: "Fecha programada", format: "datetime", optional: true },
            { key: "cuadrilla", label: "Cuadrilla asignada", format: "text", optional: true },
            { key: "estatus", label: "Estatus", format: "status" }
        ],
        footer: "¿Necesitas reprogramar o tienes alguna duda?"
    },

    consumption_history: {
        header: "Historial de consumo del contrato {contract_number}:",
        fields: [
            { key: "promedio_mensual", label: "Promedio mensual", format: "text" },
            { key: "tendencia", label: "Tendencia", format: "text" },
            { key: "ultimo_consumo", label: "Último consumo registrado", format: "text" },
            { key: "fecha_lectura", label: "Fecha de lectura", format: "date" }
        ],
        footer: "¿Tienes alguna duda sobre tu consumo?"
    },

    payment_confirmation: {
        header: "Confirmación de pago:",
        fields: [
            { key: "contrato", label: "Contrato", format: "contract" },
            { key: "monto", label: "Monto pagado", format: "currency" },
            { key: "fecha", label: "Fecha", format: "datetime" },
            { key: "referencia", label: "Referencia", format: "text", optional: true },
            { key: "nuevo_saldo", label: "Nuevo saldo", format: "currency", optional: true }
        ],
        footer: "¿Necesitas algo más?"
    },

    payment_options: {
        header: "Opciones de pago para el contrato {contract_number}:",
        fields: [
            { key: "saldo_total", label: "Saldo total", format: "currency" },
            { key: "fecha_limite", label: "Fecha límite", format: "date", optional: true }
        ],
        footer: "Puedes pagar en línea en cea.gob.mx, en Oxxo, 7-Eleven, bancos o directamente en nuestras oficinas. ¿Te ayudo con algo más?"
    },

    error_response: {
        header: "No pude completar la consulta:",
        fields: [
            { key: "motivo", label: "Motivo", format: "text" }
        ],
        footer: "¿Puedo ayudarte con algo más?"
    }
};

// ============================================
// Template Rendering
// ============================================

/**
 * Render a response template with data
 */
export function renderTemplate(
    templateKey: string,
    data: Record<string, unknown>
): string {
    const template = RESPONSE_TEMPLATES[templateKey];

    if (!template) {
        console.warn(`[renderTemplate] Template not found: ${templateKey}`);
        return JSON.stringify(data);
    }

    // Build header with variable substitution
    let result = template.header.replace(/{(\w+)}/g, (_, key) => {
        const value = data[key];
        if (value === null || value === undefined) return "";
        return String(value);
    });

    result += "\n";

    // Build fields list
    for (const field of template.fields) {
        const value = data[field.key];

        // Skip optional fields with no value
        if (field.optional && (value === null || value === undefined || value === "")) {
            continue;
        }

        const formattedValue = formatField(value, field.format);
        result += `\n- ${field.label}: ${formattedValue}`;
    }

    // Add footer
    result += `\n\n${template.footer}`;

    return result;
}

/**
 * Render template with automatic emoji selection based on category
 */
export function renderTemplateWithCategory(
    templateKey: string,
    data: Record<string, unknown>,
    category?: CategoryCode
): string {
    // Add category emoji if not already present
    if (category && !data.emoji) {
        data.emoji = getCategoryEmoji(category);
    }

    return renderTemplate(templateKey, data);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format a list of consumption records for display
 */
export function formatConsumptionList(
    consumos: Array<{ periodo: string; consumoM3: number; tipoLectura: string }>
): string {
    if (!consumos || consumos.length === 0) {
        return "No hay registros de consumo disponibles.";
    }

    return consumos
        .slice(0, 6) // Last 6 periods
        .map(c => {
            const tipo = c.tipoLectura === "real" ? "" : " (estimada)";
            return `• ${c.periodo}: ${c.consumoM3} m³${tipo}`;
        })
        .join("\n");
}

/**
 * Format a debt breakdown for display
 */
export function formatDebtBreakdown(
    conceptos: Array<{ periodo: string; concepto: string; monto: number; estado: string }>
): string {
    if (!conceptos || conceptos.length === 0) {
        return "";
    }

    return conceptos
        .slice(0, 5) // Top 5 items
        .map(c => {
            const status = getStatusDisplay(c.estado);
            return `• ${c.periodo}: ${formatField(c.monto, "currency")} ${status.emoji}`;
        })
        .join("\n");
}

/**
 * Get appropriate emoji for ticket type based on keywords
 */
export function getTicketEmoji(tipo: string): string {
    const tipoLower = tipo.toLowerCase();

    if (tipoLower.includes("fuga") || tipoLower.includes("agua")) {
        return TICKET_TYPE_EMOJIS.fuga;
    }
    if (tipoLower.includes("drenaje") || tipoLower.includes("alcantarillado")) {
        return TICKET_TYPE_EMOJIS.drenaje;
    }
    if (tipoLower.includes("medidor") || tipoLower.includes("lectura")) {
        return TICKET_TYPE_EMOJIS.medidor;
    }
    if (tipoLower.includes("recibo") || tipoLower.includes("factura")) {
        return TICKET_TYPE_EMOJIS.recibo;
    }
    if (tipoLower.includes("pago") || tipoLower.includes("convenio")) {
        return TICKET_TYPE_EMOJIS.pago;
    }
    if (tipoLower.includes("contrato")) {
        return TICKET_TYPE_EMOJIS.contrato;
    }
    if (tipoLower.includes("urgente") || tipoLower.includes("emergencia")) {
        return TICKET_TYPE_EMOJIS.urgente;
    }

    return "📋";
}
