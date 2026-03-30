// ============================================
// Location Tools - Offices, nearest locations, geocoding
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getUbicaciones, buscarUbicacion, reverseGeocode, UbicacionEntry } from "../services/supra-client.js";

// ============================================
// Helpers
// ============================================

function isLocationOpen(horario: UbicacionEntry["horario"]): boolean {
    // Simple heuristic: open if lun_vie exists and is not "Cerrado"
    return !!(horario?.lun_vie && horario.lun_vie !== "Cerrado");
}

function formatOffice(loc: UbicacionEntry): string {
    let schedule = "";
    if (loc.horario) {
        if (loc.horario.lun_vie && loc.horario.lun_vie !== "Cerrado") {
            schedule += `Lun-Vie ${loc.horario.lun_vie}`;
        }
        if (loc.horario.sab && loc.horario.sab !== "Cerrado") {
            schedule += `, Sáb ${loc.horario.sab}`;
        }
        if (loc.horario.dom && loc.horario.dom !== "Cerrado") {
            schedule += `, Dom ${loc.horario.dom}`;
        }
    }

    let info = `*${loc.nombre}*\n`;
    if (loc.direccion) info += `Dirección: ${loc.direccion}\n`;
    if (loc.telefono) info += `Teléfono: ${loc.telefono}\n`;
    if (schedule) info += `Horario: ${schedule}`;
    return info.trim();
}

// ============================================
// GET MAIN OFFICE
// ============================================

export const getMainOfficeTool = tool(
    "get_main_office",
    `Obtiene la información de la oficina principal de Hydropolis.
    Devuelve nombre, dirección, teléfono y horario actualizados desde SUPRA.
    Usa esta herramienta SIEMPRE que necesites dar información de oficinas, horarios o teléfonos de Hydropolis.
    NUNCA des esta información de memoria.`,
    {},
    async () => {
        console.log("[get_main_office] Querying HQ office info via SUPRA");

        const FALLBACK = "Oficina principal Hydropolis. Línea Hydropolis: 442-441-0000. Horario: Lun-Vie 8:00-17:00.";

        try {
            // Use Querétaro center coords to get closest office
            const ubicaciones = await getUbicaciones({ lat: 20.5888, lng: -100.3899, tipo: "oficina", limite: 1 });

            if (!ubicaciones || ubicaciones.length === 0) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    formatted_response: FALLBACK
                }) }] };
            }

            const office = ubicaciones[0];
            const formatted = formatOffice(office);

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                formatted_response: formatted
            }) }] };
        } catch (error) {
            console.error("[get_main_office] Error:", error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                formatted_response: FALLBACK
            }) }] };
        }
    }
);

// ============================================
// FIND NEAREST LOCATIONS
// ============================================

export const findNearestLocationsTool = tool(
    "find_nearest_locations",
    `Encuentra las oficinas, cajeros y puntos de pago Hydropolis más cercanos al usuario.

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
    async ({ lat, lng, colonia, tipo, limit }) => {
        console.log(`[find_nearest_locations] lat=${lat}, lng=${lng}, colonia="${colonia}", tipo=${tipo}, limit=${limit}`);

        try {
            let searchLat: number | undefined = lat;
            let searchLng: number | undefined = lng;

            // If no GPS coordinates, try to resolve colonia via buscarUbicacion
            if ((searchLat === undefined || searchLng === undefined) && colonia) {
                console.log(`[find_nearest_locations] Resolving colonia: "${colonia}" via buscarUbicacion`);

                try {
                    const coloniaResults = await buscarUbicacion(colonia + " Querétaro");
                    if (coloniaResults && coloniaResults.length > 0) {
                        searchLat = coloniaResults[0].latitud;
                        searchLng = coloniaResults[0].longitud;
                        console.log(`[find_nearest_locations] Resolved "${colonia}" → ${searchLat}, ${searchLng}`);
                    } else {
                        console.log(`[find_nearest_locations] No results for colonia "${colonia}"`);
                    }
                } catch (coloniaError) {
                    console.warn(`[find_nearest_locations] buscarUbicacion failed for colonia "${colonia}":`, coloniaError);
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        error: "colonia_search_failed",
                        formatted_response: `No pude buscar la colonia "${colonia}" en este momento. ¿Puedes compartirme tu ubicación GPS por WhatsApp?`
                    }) }] };
                }

                if (searchLat === undefined || searchLng === undefined) {
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        error: "colonia_not_found",
                        formatted_response: `No encontré la colonia "${colonia}". ¿Me puedes compartir tu ubicación o decirme otra referencia de zona?`
                    }) }] };
                }
            }

            // If still no coordinates, ask user
            if (searchLat === undefined || searchLng === undefined) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: "no_location",
                    formatted_response: "Para encontrar la oficina o cajero más cercano, necesito tu ubicación. ¿Me puedes compartir tu ubicación por WhatsApp o decirme en qué colonia estás?"
                }) }] };
            }

            const tipoParam = tipo === "all" ? undefined : tipo;
            const locations = await getUbicaciones({ lat: searchLat, lng: searchLng, tipo: tipoParam, limite: limit });

            if (!locations || locations.length === 0) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    data: { locations: [] },
                    formatted_response: "No encontré ubicaciones cercanas del tipo solicitado."
                }) }] };
            }

            // Build WhatsApp-friendly formatted response
            let formatted = "";
            for (let i = 0; i < locations.length; i++) {
                const loc = locations[i];
                const num = i + 1;
                const open = isLocationOpen(loc.horario);
                const statusEmoji = open ? "🟢" : "🔴";
                const statusLabel = open ? "Abierto" : "Cerrado";

                formatted += `*${num}. ${loc.nombre}* (${loc.tipoLabel})\n`;
                formatted += `📍 ${loc.direccion} — ${loc.distancia}\n`;
                formatted += `${statusEmoji} ${statusLabel}`;
                if (loc.horario?.lun_vie) {
                    formatted += ` | Horario: ${loc.horario.lun_vie}`;
                }
                formatted += "\n";
                if (loc.telefono) {
                    formatted += `📞 ${loc.telefono}\n`;
                }
                formatted += `🗺️ ${loc.mapsUrl}\n`;
                if (i < locations.length - 1) {
                    formatted += "\n";
                }
            }

            const locationResults = locations.map(loc => ({
                name: loc.nombre,
                tipo: loc.tipo,
                tipo_label: loc.tipoLabel,
                address: loc.direccion,
                municipio: loc.municipio,
                distance: loc.distancia,
                distance_meters: loc.distanciaMetros,
                is_open: isLocationOpen(loc.horario),
                horario: loc.horario,
                telefono: loc.telefono,
                servicios: loc.servicios,
                maps_link: loc.mapsUrl,
                notas: loc.notas
            }));

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                data: { locations: locationResults },
                formatted_response: formatted
            }) }] };

        } catch (error) {
            console.error(`[find_nearest_locations] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Error desconocido",
                formatted_response: "No pude buscar ubicaciones en este momento. Intenta más tarde."
            }) }] };
        }
    }
);

// ============================================
// SEARCH LOCATION
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
    async ({ query, original_description }) => {
        console.log(`[search_location] Query: "${query}" (original: "${original_description}")`);

        try {
            const ubicaciones = await buscarUbicacion(query);

            if (!ubicaciones || ubicaciones.length === 0) {
                console.log(`[search_location] No results for "${query}"`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    results_count: 0,
                    results: [],
                    formatted_response: `No encontré resultados para "${original_description}". ¿Puedes darme la dirección exacta (calle, número, colonia)?`
                }) }] };
            }

            const results = ubicaciones.map((loc, i) => ({
                index: i + 1,
                name: loc.nombre,
                address: loc.direccion,
                latitude: loc.latitud,
                longitude: loc.longitud,
                maps_link: loc.mapsUrl
            }));

            console.log(`[search_location] Found ${results.length} results`);

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                results_count: results.length,
                results,
                original_description,
                formatted_response: results.length === 1
                    ? `Encontré esta ubicación:\n📍 ${results[0].name} — ${results[0].address}`
                    : `Encontré ${results.length} resultados:\n` + results.map(r => `${r.index}. ${r.name} — ${r.address}`).join("\n")
            }) }] };

        } catch (error) {
            console.error(`[search_location] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                formatted_response: `No encontré resultados para "${original_description}". ¿Puedes darme la dirección exacta (calle, número, colonia)?`
            }) }] };
        }
    }
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
    async ({ latitude, longitude }) => {
        console.log(`[reverse_geocode] Coordinates: ${latitude}, ${longitude}`);

        try {
            const geocodeData = await reverseGeocode(latitude, longitude);

            console.log(`[reverse_geocode] Resolved: ${geocodeData.formatted_address}`);

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                ...geocodeData,
                formatted_response: `📍 ${geocodeData.formatted_address}`
            }) }] };
        } catch (error) {
            console.error(`[reverse_geocode] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                formatted_response: "Recibí tu ubicación pero no pude obtener la dirección. ¿Puedes decirme la calle, número y colonia?"
            }) }] };
        }
    }
);
