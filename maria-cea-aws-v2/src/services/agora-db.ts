// ============================================
// AGORA Database Service
// PostgreSQL reads + REST API for ticket creation
// ============================================

import pg from "pg";
import { validateContrato, validateFolio } from "./validation.js";
import type { CreateTicketInput, CreateTicketResult, CategoryCode } from "../types.js";

// ============================================
// Configuration — credentials from env only
// ============================================

const PG_CONFIG = {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432'),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'agora_production',
    max: parseInt(process.env.PGPOOL_MAX || '10'),
    ssl: process.env.PGSSLMODE !== 'disable' ? { rejectUnauthorized: false } : false,
};

const pgPool = new pg.Pool(PG_CONFIG);

export async function pgQuery<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]> {
    const client = await pgPool.connect();
    try {
        const result = await client.query(query, params);
        return result.rows as T[];
    } finally {
        client.release();
    }
}

// ============================================
// AGORA API Configuration
// ============================================

const AGORA_BASE_URL = process.env.CHATWOOT_BASE_URL || "";
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN || "";

// ============================================
// Ticket Creation via AGORA REST API
// ============================================

// Dedup guard: prevent duplicate ticket creation within a short window
const recentTicketCreations = new Map<string, { folio: string; timestamp: number }>();

export async function createTicket(
    input: CreateTicketInput,
    accountId: number
): Promise<CreateTicketResult> {
    console.log(`[agora-db] Creating ticket via API:`, {
        category: input.category_code,
        title: input.titulo,
        contract: input.contract_number,
        conversation_id: input.conversation_id
    });

    try {
        // Dedup check: reject duplicate creation within 30s for same conversation+category+location
        const deduplicationKey = `${input.conversation_id || ''}-${input.category_code}-${input.ubicacion || input.contract_number || ''}`;
        const recent = recentTicketCreations.get(deduplicationKey);
        if (recent && (Date.now() - recent.timestamp) < 30000) {
            console.log(`[agora-db] DEDUP: Already created ${recent.folio} for key ${deduplicationKey}`);
            return { success: true, folio: recent.folio, ticketId: '', message: `Ticket ya creado: ${recent.folio}` };
        }

        if (!AGORA_BASE_URL || !AGENT_API_TOKEN) {
            console.error("[agora-db] Missing CHATWOOT_BASE_URL or AGENT_API_TOKEN for ticket creation");
            return { success: false, error: "Ticket API not configured" };
        }

        // Build description with location info if present
        let fullDescription = input.descripcion;
        if (input.ubicacion) {
            fullDescription += `\nUbicación: ${input.ubicacion}`;
        }
        if (input.latitude && input.longitude) {
            fullDescription += `\nCoordenadas: ${input.latitude}, ${input.longitude}`;
            fullDescription += `\nMapa: https://maps.google.com/?q=${input.latitude},${input.longitude}`;
        }

        const url = `${AGORA_BASE_URL}/api/v1/accounts/${accountId}/agent/tickets`;

        const body: Record<string, unknown> = {
            title: input.titulo,
            description: fullDescription,
            priority: input.priority || "medium",
            ticket_type: input.category_code,
            service_type: input.subcategory_code || "general",
            contract_number: input.contract_number || undefined,
            conversation_id: input.conversation_id || undefined,
            contact_name: input.client_name || undefined,
            contact_phone: input.phone || undefined,
            contact_email: input.email || undefined,
        };

        // Remove undefined values
        for (const key of Object.keys(body)) {
            if (body[key] === undefined) delete body[key];
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Agent-Token": AGENT_API_TOKEN,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[agora-db] Ticket API error ${response.status}: ${errorBody}`);
            return {
                success: false,
                error: `API error: ${response.status}`,
                message: "No se pudo crear el ticket en este momento."
            };
        }

        const result = await response.json() as {
            success: boolean;
            folio?: string;
            ticket_id?: number;
            message?: string;
            error?: string;
        };

        if (!result.success) {
            return {
                success: false,
                error: result.error || "Unknown API error",
                message: result.message || "No se pudo crear el ticket."
            };
        }

        const folio = result.folio || `TKT-${result.ticket_id}`;
        console.log(`[agora-db] Created ticket with folio: ${folio}`);

        // Record creation for dedup
        recentTicketCreations.set(deduplicationKey, { folio, timestamp: Date.now() });
        setTimeout(() => recentTicketCreations.delete(deduplicationKey), 60000);

        return {
            success: true,
            folio,
            ticketId: String(result.ticket_id || ''),
            message: result.message || `Ticket creado exitosamente con folio ${folio}`
        };
    } catch (error) {
        console.error(`[agora-db] createTicket error:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Error desconocido",
            message: "No se pudo crear el ticket en este momento."
        };
    }
}

// ============================================
// Ticket Queries (direct DB — read operations)
// ============================================

export async function getClientTickets(rawContractNumber: string) {
    const contract = validateContrato(rawContractNumber);
    return pgQuery<{
        folio: string;
        status: string;
        title: string;
        service_type: string;
        created_at: Date;
        description: string;
    }>(`
        SELECT folio, status, title, service_type, created_at, description
        FROM tickets
        WHERE contract_number = $1
        ORDER BY created_at DESC
        LIMIT 10
    `, [contract]);
}

export async function searchCustomerByContract(rawContractNumber: string) {
    const contract = validateContrato(rawContractNumber);
    return pgQuery<{
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
    `, [contract]);
}

export async function updateTicket(rawFolio: string, updates: {
    status?: string;
    priority?: string;
    notes?: string;
}) {
    const folio = validateFolio(rawFolio);
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (updates.status) {
        setClauses.push(`status = $${paramIndex++}`);
        params.push(updates.status);
    }
    if (updates.priority) {
        setClauses.push(`priority = $${paramIndex++}`);
        params.push(updates.priority);
    }
    if (updates.notes) {
        setClauses.push(`resolution_notes = $${paramIndex++}`);
        params.push(updates.notes);
    }

    params.push(folio);

    return pgQuery(`
        UPDATE tickets
        SET ${setClauses.join(', ')}
        WHERE folio = $${paramIndex}
    `, params);
}

// ============================================
// Location Queries
// ============================================

export interface CeaLocationRow {
    id: number;
    slug: string;
    name: string;
    tipo: string;
    address_street: string;
    colonia: string;
    municipio: string;
    codigo_postal: string | null;
    lat: number;
    lng: number;
    distance_meters: number;
    horario: Record<string, string | null>;
    telefono: string | null;
    servicios: string[];
    notas: string | null;
}

export async function getMainOffice() {
    return pgQuery<{
        name: string;
        address_street: string;
        colonia: string;
        municipio: string;
        codigo_postal: string | null;
        telefono: string | null;
        horario: Record<string, string | null>;
    }>(`
        SELECT name, address_street, colonia, municipio, codigo_postal, telefono, horario
        FROM cea_locations WHERE slug = 'pabellon-campestre' AND is_active = true
        LIMIT 1
    `);
}

export async function findNearestLocations(lat: number, lng: number, tipo: string, limit: number) {
    const tipoFilter = tipo === "all" ? "" : "AND tipo = $4";
    const params: unknown[] = [lat, lng, limit];
    if (tipo !== "all") {
        params.push(tipo);
    }

    return pgQuery<CeaLocationRow>(`
        SELECT
            id, slug, name, tipo, address_street, colonia, municipio, codigo_postal,
            lat, lng,
            (6371000 * acos(LEAST(1.0,
                cos(radians($1)) * cos(radians(lat)) *
                cos(radians(lng) - radians($2)) +
                sin(radians($1)) * sin(radians(lat))
            ))) AS distance_meters,
            horario, telefono, servicios, notas
        FROM cea_locations
        WHERE is_active = true ${tipoFilter}
        ORDER BY (lat - $1)^2 + (lng - $2)^2
        LIMIT $3
    `, params);
}

export async function resolveColonia(coloniaName: string) {
    return pgQuery<{
        name: string;
        lat: number;
        lng: number;
        similarity: number;
    }>(`
        SELECT
            name,
            lat,
            lng,
            similarity(name_normalized, $1) AS similarity
        FROM colonias_zones
        WHERE similarity(name_normalized, $1) > 0.2
        ORDER BY similarity(name_normalized, $1) DESC
        LIMIT 1
    `, [coloniaName]);
}
