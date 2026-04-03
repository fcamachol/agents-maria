// ============================================
// Type Definitions - v2
// ============================================

import { z } from "zod";

// Contract number validation (6-10 digits)
export const ContractNumber = z.string().regex(/^\d{6,10}$/, "Contract must be 6-10 digits");

// ============================================
// Request / Response
// ============================================

export const ChatRequestSchema = z.object({
    message: z.string().min(1).max(2000),
    conversationId: z.string().optional(),
    contactId: z.coerce.number().int().positive().optional(),
    metadata: z.object({
        whatsapp: z.string().optional(),
        channel: z.enum(["whatsapp", "web", "api"]).optional(),
    }).passthrough().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export interface ChatResponse {
    response: string;
    classification?: Classification;
    conversationId: string;
    ticketFolio?: string;
    error?: string;
    metadata?: {
        toolsUsed?: string[];
        processingTimeMs?: number;
        requestId?: string;
    };
}

// ============================================
// Classifications & Enums
// ============================================

export type Classification =
    | "fuga"
    | "pagos"
    | "hablar_asesor"
    | "informacion"
    | "consumos"
    | "contrato"
    | "tickets";

export type TicketType =
    | "fuga"
    | "aclaraciones"
    | "pagos"
    | "lecturas"
    | "revision_recibo"
    | "recibo_digital"
    | "urgente";

export type TicketStatus =
    | "abierto"
    | "en_proceso"
    | "esperando_cliente"
    | "esperando_interno"
    | "escalado"
    | "resuelto"
    | "cerrado"
    | "cancelado";

export type TicketPriority = "urgente" | "alta" | "media" | "baja";

// ============================================
// Mapping Tables
// ============================================

export const TICKET_CODES: Record<TicketType, string> = {
    fuga: "FUG",
    aclaraciones: "ACL",
    pagos: "PAG",
    lecturas: "LEC",
    revision_recibo: "REV",
    recibo_digital: "DIG",
    urgente: "URG",
};

export const SERVICE_TYPE_MAP: Record<TicketType, string> = {
    fuga: "leak_report",
    aclaraciones: "clarifications",
    pagos: "payment",
    lecturas: "report_reading",
    revision_recibo: "receipt_review",
    recibo_digital: "digital_receipt",
    urgente: "human_agent",
};

export const PRIORITY_MAP: Record<string, string> = {
    baja: "low",
    media: "medium",
    alta: "high",
    urgente: "urgent",
};

export const STATUS_MAP: Record<string, string> = {
    abierto: "open",
    en_proceso: "in_progress",
    escalado: "escalated",
    esperando_cliente: "waiting_client",
    esperando_interno: "waiting_internal",
    resuelto: "resolved",
    cerrado: "closed",
    cancelado: "cancelled",
};

// ============================================
// SOAP / API Response Types
// ============================================

export interface DeudaResponse {
    success: boolean;
    data?: {
        totalDeuda: number;
        vencido: number;
        porVencer: number;
        conceptos: ConceptoDeuda[];
        nombreCliente?: string;
        direccion?: string;
    };
    error?: string;
}

export interface ConceptoDeuda {
    periodo: string;
    concepto: string;
    monto: number;
    fechaVencimiento: string;
    estado: "vencido" | "por_vencer" | "pagado";
}

export interface ConsumoResponse {
    success: boolean;
    data?: {
        consumos: ConsumoHistorial[];
        promedioMensual: number;
        tendencia: "aumentando" | "estable" | "disminuyendo";
    };
    error?: string;
}

export interface ConsumoHistorial {
    periodo: string;
    consumoM3: number;
    lecturaAnterior: number;
    lecturaActual: number;
    fechaLectura: string;
    tipoLectura: "real" | "estimada";
}

export interface ContratoResponse {
    success: boolean;
    data?: {
        numeroContrato: string;
        titular: string;
        direccion: string;
        colonia: string;
        codigoPostal: string;
        tarifa: string;
        estado: "activo" | "suspendido" | "cortado";
        fechaAlta: string;
        ultimaLectura?: string;
    };
    error?: string;
}

// ============================================
// Workflow Types
// ============================================

export interface WorkflowInput {
    input_as_text: string;
    conversationId?: string;
    contactId?: number;
    requestId?: string;
    metadata?: {
        whatsapp?: string;
        channel?: "whatsapp" | "web" | "api";
        [key: string]: unknown;
    };
}

export interface WorkflowOutput {
    output_text?: string;
    classification?: Classification;
    ticketFolio?: string;
    error?: string;
    toolsUsed?: string[];
}

// ============================================
// Ticket Types
// ============================================

export interface CreateTicketInput {
    service_type: TicketType;
    titulo: string;
    descripcion: string;
    contract_number?: string | null;
    email?: string | null;
    ubicacion?: string | null;
    priority?: TicketPriority;
    client_name?: string | null;
    contact_id?: number | null;
    conversation_id?: number | null;
    inbox_id?: number | null;
}

export interface CreateTicketResult {
    success: boolean;
    folio?: string;
    ticketId?: string;
    error?: string;
    message?: string;
    warning?: string;
}
