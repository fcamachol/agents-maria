// ============================================
// Location Tools - Offices, nearest locations, geocoding
//
// Thin SDK `tool()` wrappers over `../core/location.ts`.
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { toToolResult } from "../core/types.js";
import {
    getMainOfficeCore,
    findNearestLocationsCore,
    searchLocationCore,
    reverseGeocodeCore,
} from "../core/location.js";

// ============================================
// GET MAIN OFFICE
// ============================================

export const getMainOfficeTool = tool(
    "get_main_office",
    `Obtiene la información de la oficina principal de CEA (Pabellón Campestre).
    Devuelve nombre, dirección, teléfono y horario actualizados desde la base de datos.
    Usa esta herramienta SIEMPRE que necesites dar información de oficinas, horarios o teléfonos de CEA.
    NUNCA des esta información de memoria.`,
    {},
    async () => toToolResult(await getMainOfficeCore())
);

// ============================================
// FIND NEAREST LOCATIONS
// ============================================

export const findNearestLocationsTool = tool(
    "find_nearest_locations",
    `Encuentra las oficinas, cajeros y puntos de pago CEA más cercanos al usuario.

PARÁMETROS:
- lat/lng: Coordenadas GPS (de ubicación compartida por WhatsApp)
- colonia: Nombre de la colonia del usuario (se busca por coincidencia aproximada)
- tipo: Filtrar por "oficina", "cajero", o "all" (default: "all")
- limit: Máximo de resultados (default: 3)

USA ESTA HERRAMIENTA CUANDO:
- El usuario pregunte "¿dónde puedo pagar?"
- El usuario pregunte por oficinas o cajeros cercanos
- El usuario comparta su ubicación GPS
- El usuario mencione su colonia y pregunte por ubicaciones

IMPORTANTE:
- Si el usuario comparte ubicación GPS, usa lat/lng
- Si el usuario dice su colonia, usa el parámetro colonia
- Si no tienes ni ubicación ni colonia, pregúntale al usuario antes de llamar este tool`,
    {
        lat: z.number().optional().describe("Latitud GPS del usuario"),
        lng: z.number().optional().describe("Longitud GPS del usuario"),
        colonia: z.string().optional().describe("Nombre de la colonia del usuario"),
        tipo: z.enum(["oficina", "cajero", "all"]).default("all").describe("Tipo de ubicación a buscar"),
        limit: z.number().default(3).describe("Máximo de resultados a retornar")
    },
    async ({ lat, lng, colonia, tipo, limit }) => toToolResult(
        await findNearestLocationsCore({ lat, lng, colonia, tipo, limit })
    )
);

// ============================================
// SEARCH LOCATION - Google Places text search
// ============================================

export const searchLocationTool = tool(
    "search_location",
    `Busca una ubicación informal o punto de referencia en Querétaro y retorna dirección estructurada con coordenadas.

USA ESTE TOOL CUANDO el usuario describe una ubicación de forma informal:
- "cerca del Oxxo del Campanario"
- "frente a la primaria Benito Juárez"
- "en la esquina de Constituyentes y 5 de Febrero"

NO uses este tool cuando el usuario ya dio una dirección completa (calle, número, colonia).

PARÁMETROS:
- query: Búsqueda estructurada que TÚ construyes a partir de lo que dijo el usuario.
  Siempre agrega "Querétaro" al final.

RETORNA: Lista de 1-3 resultados con nombre, dirección y coordenadas.`,
    {
        query: z.string().describe("Búsqueda estructurada extraída del mensaje del usuario (siempre incluir Querétaro)"),
        original_description: z.string().describe("Lo que dijo el usuario textualmente, para contexto")
    },
    async ({ query, original_description }) => toToolResult(
        await searchLocationCore(query, original_description)
    )
);

// ============================================
// REVERSE GEOCODE - Coordinates to address
// ============================================

export const reverseGeocodeTool = tool(
    "reverse_geocode",
    `Convierte coordenadas GPS (latitud/longitud) a una dirección legible.

USA ESTE TOOL CUANDO:
- El usuario compartió su ubicación GPS por WhatsApp (el mensaje contiene "[Ubicacion compartida: Lat X, Long Y]")
- Necesitas convertir coordenadas a una dirección para confirmar con el usuario

RETORNA: Dirección formateada con calle, colonia, ciudad.`,
    {
        latitude: z.number().describe("Latitud (ej: 20.5888)"),
        longitude: z.number().describe("Longitud (ej: -100.3899)")
    },
    async ({ latitude, longitude }) => toToolResult(await reverseGeocodeCore(latitude, longitude))
);
