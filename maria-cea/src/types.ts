// ============================================
// Maria Claude - Type Definitions
// AGORA Category System Integration
// ============================================

import { z } from "zod";

// ============================================
// AGORA Category Codes
// ============================================

export type CategoryCode = "CON" | "FAC" | "CTR" | "CVN" | "REP" | "SRV" | "CNS";

export const CategorySchema = z.enum(["CON", "FAC", "CTR", "CVN", "REP", "SRV", "CNS"]);

export interface CategoryDefinition {
    code: CategoryCode;
    name: string;
    description: string;
}

export const AGORA_CATEGORIES: Record<CategoryCode, CategoryDefinition> = {
    CON: {
        code: "CON",
        name: "Consultas",
        description: "Preguntas generales, información, dudas sobre servicios"
    },
    FAC: {
        code: "FAC",
        name: "Facturación",
        description: "Recibos, aclaraciones de cobro, ajustes y pagos"
    },
    CTR: {
        code: "CTR",
        name: "Contratos",
        description: "Altas, bajas, cambios de titular y modificaciones contractuales"
    },
    CVN: {
        code: "CVN",
        name: "Convenios",
        description: "Convenios de pago y programas de apoyo"
    },
    REP: {
        code: "REP",
        name: "Reportes de Servicio",
        description: "Reportes de fallas, fugas, calidad del agua e infraestructura"
    },
    SRV: {
        code: "SRV",
        name: "Servicios Técnicos",
        description: "Instalaciones, revisiones, medidores y trabajos técnicos"
    },
    CNS: {
        code: "CNS",
        name: "Consumos",
        description: "Historial de consumo de agua, lecturas y tendencias"
    }
};

// ============================================
// Subcategory Codes (Based on AGORA Migration)
// ============================================

// Subcategory codes - using string to allow flexibility between old/new codes
// DB codes: FAC-ACL, REP-FVP, TRA-NUE, INF-GEN, etc.
export type SubcategoryCode = string;

// ============================================
// Ticket Types (Legacy compatibility)
// ============================================

export type TicketType =
    | "fuga"
    | "aclaraciones"
    | "pagos"
    | "lecturas"
    | "revision_recibo"
    | "recibo_digital"
    | "urgente"
    | "consulta"
    | "contrato"
    | "convenio"
    | "servicio_tecnico";

export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketStatus = "open" | "in_progress" | "escalated" | "waiting_client" | "waiting_internal" | "resolved" | "closed" | "cancelled";

// ============================================
// API Response Types
// ============================================

export interface DeudaData {
    totalDeuda: number;
    vencido: number;
    porVencer: number;
    mensaje?: string;
    conceptos: Array<{
        periodo: string;
        concepto: string;
        monto: number;
        fechaVencimiento: string;
        estado: "vencido" | "por_vencer";
    }>;
}

export interface DeudaResponse {
    success: boolean;
    data?: DeudaData;
    error?: string;
    rawResponse?: string;
}

export interface ConsumoData {
    consumos: Array<{
        periodo: string;
        consumoM3: number;
        lecturaAnterior: number;
        lecturaActual: number;
        fechaLectura: string;
        tipoLectura: "real" | "estimada";
        año: number;
        mes: string;
    }>;
    promedioMensual: number;
    tendencia: "aumentando" | "estable" | "disminuyendo";
}

export interface ConsumoResponse {
    success: boolean;
    data?: ConsumoData;
    error?: string;
}

export interface ContratoData {
    numeroContrato: string;
    titular: string;
    direccion: string;
    colonia: string;
    codigoPostal: string;
    tarifa: string;
    estado: "activo" | "suspendido" | "cortado";
    fechaAlta: string;
    ultimaLectura?: string;
}

export interface ContratoResponse {
    success: boolean;
    data?: ContratoData;
    error?: string;
}

// ============================================
// Ticket Types
// ============================================

export interface CreateTicketInput {
    category_code: CategoryCode;
    subcategory_code?: SubcategoryCode;
    titulo: string;
    descripcion: string;
    contract_number?: string | null;
    email?: string | null;
    ubicacion?: string | null;
    priority?: TicketPriority;
}

export interface CreateTicketResult {
    success: boolean;
    folio?: string;
    ticketId?: string;
    message?: string;
    warning?: string;
    error?: string;
}

// ============================================
// Workflow Types
// ============================================

export interface WorkflowInput {
    input_as_text: string;
    conversationId?: string;
    metadata?: {
        phone?: string;
        name?: string;
        email?: string;
        custom_attributes?: Record<string, unknown>;
        contractNumber?: string;
    };
    // Chatwoot context for handoff
    chatwootAccountId?: number;
    chatwootConversationId?: number;
}

export interface WorkflowOutput {
    output_text: string;
    output_messages: string[];
    category?: CategoryCode;
    subcategory?: SubcategoryCode;
    toolsUsed?: string[];
    error?: string;
}

// ============================================
// Skill Definition Types
// ============================================

export interface Skill {
    code: CategoryCode;
    name: string;
    description: string;
    systemPrompt: string;
    tools: string[];
    subcategories: Array<{
        code: SubcategoryCode;
        name: string;
        group?: string;
    }>;
}

// ============================================
// Classification Schema
// ============================================

export const ClassificationSchema = z.object({
    category: CategorySchema,
    subcategory: z.string().nullable().describe("Subcategory code if determined"),
    confidence: z.number().min(0).max(1).nullable().describe("Confidence score"),
    extractedContract: z.string().nullable().describe("Extracted contract number if found")
});

export type Classification = z.infer<typeof ClassificationSchema>;

// ============================================
// Chatwoot/Agora Types
// ============================================

export interface ChatwootSender {
    id: number;
    name: string;
    avatar: string | null;
    type: "contact" | "user" | "agent_bot";
    email?: string | null;
    phone_number?: string;
    identifier?: string;
    custom_attributes?: Record<string, unknown>;
    additional_attributes?: Record<string, unknown>;
}

export interface ChatwootInbox {
    id: number;
    name: string;
}

export interface ChatwootConversation {
    id: number;
    inbox_id: number;
    status: "open" | "resolved" | "pending" | "snoozed";
    agent_last_seen_at: string | null;
    contact_last_seen_at: string | null;
    timestamp: string;
    additional_attributes: Record<string, unknown>;
    channel: string;
}

export interface ChatwootAccount {
    id: number;
    name: string;
}

export interface ChatwootAttachment {
    id: number;
    message_id: number;
    file_type: "image" | "audio" | "video" | "file" | "location" |
               "fallback" | "share" | "story_mention" | "contact" |
               "ig_reel" | "ig_post" | "ig_story" | "embed";
    account_id: number;
    extension: string | null;
    data_url: string | null;
    thumb_url: string | null;
    file_size: number;
    coordinates_lat?: number;
    coordinates_long?: number;
    fallback_title?: string;
}

export interface ChatwootWebhookPayload {
    event: "message_created" | "message_updated" | "conversation_created" |
           "conversation_updated" | "conversation_status_changed" |
           "webwidget_triggered" | "conversation_typing_on" | "conversation_typing_off";
    id: number;
    content: string | null;
    created_at: string;
    message_type: "incoming" | "outgoing" | "activity" | "template";
    content_type: string;
    content_attributes: Record<string, unknown>;
    source_id: string | null;
    sender: ChatwootSender;
    inbox: ChatwootInbox;
    conversation: ChatwootConversation;
    account: ChatwootAccount;
    attachments: ChatwootAttachment[];
}
