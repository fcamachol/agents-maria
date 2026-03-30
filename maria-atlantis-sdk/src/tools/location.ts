// ============================================
// Location Tools - Offices, nearest locations, geocoding
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { pgQuery, getMexicoDate } from "../services/soap-client.js";

// ============================================
// Types
// ============================================

interface CeaLocationRow {
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

// ============================================
// Helpers
// ============================================

function isLocationOpen(horario: Record<string, string | null>): { is_open: boolean; current_schedule: string | null } {
    const now = getMexicoDate();
    const dayOfWeek = now.getDay();

    let scheduleKey: string;
    if (dayOfWeek === 0) {
        scheduleKey = "dom";
    } else if (dayOfWeek === 6) {
        scheduleKey = "sab";
    } else {
        scheduleKey = "lun_vie";
    }

    const schedule = horario[scheduleKey];
    if (!schedule) {
        return { is_open: false, current_schedule: null };
    }

    const [openTime, closeTime] = schedule.split("-");
    if (!openTime || !closeTime) {
        return { is_open: false, current_schedule: schedule };
    }

    const [openH, openM] = openTime.split(":").map(Number);
    const [closeH, closeM] = closeTime.split(":").map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    return {
        is_open: currentMinutes >= openMinutes && currentMinutes < closeMinutes,
        current_schedule: schedule
    };
}

function formatDistance(meters: number): string {
    if (meters < 1000) {
        return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
}

async function getHQOfficeInfo(): Promise<string> {
    try {
        const rows = await pgQuery<{
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

        if (rows.length === 0) {
            return "Oficina principal Hydropolis Pabellón Campestre. Línea Hydropolis: 442-211-0066. Horario: Lun-Vie 8:00-17:00.";
        }

        const hq = rows[0];
        const address = `${hq.address_street}, Col. ${hq.colonia}, ${hq.municipio}${hq.codigo_postal ? `, C.P. ${hq.codigo_postal}` : ""}`;
        const phone = hq.telefono || "442-211-0066";

        let schedule = "Lun-Vie 8:00-17:00";
        if (hq.horario) {
            if (hq.horario.lun_vie) {
                schedule = `Lun-Vie ${hq.horario.lun_vie}`;
            }
            if (hq.horario.sab) schedule += `, Sáb ${hq.horario.sab}`;
            if (hq.horario.dom) schedule += `, Dom ${hq.horario.dom}`;
        }

        return `*${hq.name}*\nDirección: ${address}\nTeléfono: ${phone}\nHorario: ${schedule}`;
    } catch (error) {
        console.error("[getHQOfficeInfo] Error querying DB:", error);
        return "Oficina principal Hydropolis Pabellón Campestre. Línea Hydropolis: 442-211-0066. Horario: Lun-Vie 8:00-17:00.";
    }
}

// ============================================
// Google Maps helpers
// ============================================

function getGoogleMapsKey(): string { return process.env.GOOGLE_MAPS_API_KEY || ""; }

const QRO_BOUNDS = {
    sw: { lat: 20.01, lng: -100.60 },
    ne: { lat: 21.65, lng: -99.03 }
};

// ============================================
// GET MAIN OFFICE
// ============================================

export const getMainOfficeTool = tool(
    "get_main_office",
    `Obtiene la información de la oficina principal de Hydropolis (Pabellón Campestre).
    Devuelve nombre, dirección, teléfono y horario actualizados desde la base de datos.
    Usa esta herramienta SIEMPRE que necesites dar información de oficinas, horarios o teléfonos de Hydropolis.
    NUNCA des esta información de memoria.`,
    {},
    async () => {
        console.log("[get_main_office] Querying HQ office info");
        const info = await getHQOfficeInfo();
        return { content: [{ type: "text" as const, text: JSON.stringify({
            success: true,
            formatted_response: info
        }) }] };
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

        const FALLBACK_HQ = await getHQOfficeInfo();

        try {
            let searchLat: number | undefined = lat;
            let searchLng: number | undefined = lng;
            let searchMethod = "gps";

            // If no GPS coordinates, try to resolve colonia
            if ((searchLat === undefined || searchLng === undefined) && colonia) {
                searchMethod = "colonia";
                const coloniaName = colonia.toLowerCase()
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .replace(/\s+/g, " ")
                    .trim();

                console.log(`[find_nearest_locations] Resolving colonia: "${coloniaName}"`);

                const coloniaResult = await pgQuery<{
                    name: string;
                    latitude: number;
                    longitude: number;
                    similarity: number;
                }>(`
                    SELECT
                        name,
                        latitude,
                        longitude,
                        similarity(name_normalized, $1) AS similarity
                    FROM colonias_zones
                    WHERE similarity(name_normalized, $1) > 0.2
                    ORDER BY similarity(name_normalized, $1) DESC
                    LIMIT 1
                `, [coloniaName]);

                if (coloniaResult.length > 0) {
                    searchLat = coloniaResult[0].latitude;
                    searchLng = coloniaResult[0].longitude;
                    console.log(`[find_nearest_locations] Resolved "${colonia}" → "${coloniaResult[0].name}" (similarity: ${coloniaResult[0].similarity.toFixed(2)}) at ${searchLat}, ${searchLng}`);
                } else {
                    console.log(`[find_nearest_locations] Could not resolve colonia "${colonia}"`);
                    return { content: [{ type: "text" as const, text: JSON.stringify({
                        success: false,
                        error: "colonia_not_found",
                        formatted_response: `No encontré la colonia "${colonia}". ¿Me puedes compartir tu ubicación o decirme otra referencia de zona?\n\n${FALLBACK_HQ}`
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

            // Haversine distance query (no PostGIS required)
            const tipoFilter = tipo === "all" ? "" : "AND tipo = $4";
            const params: unknown[] = [searchLat, searchLng, limit];
            if (tipo !== "all") {
                params.push(tipo);
            }

            const locations = await pgQuery<CeaLocationRow>(`
                SELECT
                    id, slug, name, tipo, address_street, colonia, municipio, codigo_postal,
                    latitude AS lat, longitude AS lng,
                    (6371000 * acos(LEAST(1.0,
                        cos(radians($1)) * cos(radians(latitude)) *
                        cos(radians(longitude) - radians($2)) +
                        sin(radians($1)) * sin(radians(latitude))
                    ))) AS distance_meters,
                    horario, telefono, servicios, notas
                FROM cea_locations
                WHERE is_active = true ${tipoFilter}
                ORDER BY (latitude - $1)^2 + (longitude - $2)^2
                LIMIT $3
            `, params);

            if (locations.length === 0) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    search_method: searchMethod,
                    data: { locations: [] },
                    formatted_response: `No encontré ubicaciones cercanas del tipo solicitado.\n\n${FALLBACK_HQ}`
                }) }] };
            }

            // Build response
            const tipoLabels: Record<string, string> = {
                "oficina": "Oficina",
                "cajero": "Hydropolis Cajero",
                "autopago": "Autopago"
            };

            const locationResults = locations.map(loc => {
                const openStatus = isLocationOpen(loc.horario);
                const mapsLink = `https://maps.google.com/?q=${loc.lat},${loc.lng}`;

                return {
                    name: loc.name,
                    tipo: loc.tipo,
                    tipo_label: tipoLabels[loc.tipo] || loc.tipo,
                    address: `${loc.address_street}, Col. ${loc.colonia}`,
                    municipio: loc.municipio,
                    distance: formatDistance(loc.distance_meters),
                    distance_meters: Math.round(loc.distance_meters),
                    is_open: openStatus.is_open,
                    horario: loc.horario,
                    current_schedule: openStatus.current_schedule,
                    telefono: loc.telefono,
                    servicios: loc.servicios,
                    maps_link: mapsLink,
                    notas: loc.notas
                };
            });

            // Build WhatsApp-friendly formatted response
            let formatted = "";
            for (let i = 0; i < locationResults.length; i++) {
                const loc = locationResults[i];
                const num = i + 1;
                const statusIcon = loc.is_open ? "Abierto" : "Cerrado";
                const statusEmoji = loc.is_open ? "🟢" : "🔴";

                formatted += `*${num}. ${loc.name}* (${loc.tipo_label})\n`;
                formatted += `📍 ${loc.address} — ${loc.distance}\n`;
                formatted += `${statusEmoji} ${statusIcon}`;
                if (loc.current_schedule) {
                    formatted += ` | Horario: ${loc.current_schedule}`;
                }
                formatted += "\n";
                if (loc.telefono) {
                    formatted += `📞 ${loc.telefono}\n`;
                }
                formatted += `🗺️ ${loc.maps_link}\n`;
                if (i < locationResults.length - 1) {
                    formatted += "\n";
                }
            }

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                search_method: searchMethod,
                data: { locations: locationResults },
                formatted_response: formatted
            }) }] };

        } catch (error) {
            console.error(`[find_nearest_locations] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Error desconocido",
                formatted_response: `No pude buscar ubicaciones en este momento.\n\n${FALLBACK_HQ}`
            }) }] };
        }
    }
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
    async ({ query, original_description }) => {
        console.log(`[search_location] Query: "${query}" (original: "${original_description}")`);

        const apiKey = getGoogleMapsKey();
        if (!apiKey) {
            console.warn("[search_location] No GOOGLE_MAPS_API_KEY configured");
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: "no_api_key",
                formatted_response: "No pude buscar la ubicación en este momento. ¿Puedes darme la dirección exacta (calle, número, colonia)?"
            }) }] };
        }

        try {
            const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": apiKey,
                    "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.shortFormattedAddress"
                },
                body: JSON.stringify({
                    textQuery: query,
                    locationRestriction: {
                        rectangle: {
                            low: { latitude: QRO_BOUNDS.sw.lat, longitude: QRO_BOUNDS.sw.lng },
                            high: { latitude: QRO_BOUNDS.ne.lat, longitude: QRO_BOUNDS.ne.lng }
                        }
                    },
                    languageCode: "es",
                    maxResultCount: 3
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[search_location] Google Places API error ${response.status}: ${errorText}`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: `api_error_${response.status}`,
                    formatted_response: "No pude buscar la ubicación. ¿Puedes darme la dirección exacta (calle, número, colonia)?"
                }) }] };
            }

            const data = await response.json() as {
                places?: Array<{
                    displayName?: { text?: string };
                    formattedAddress?: string;
                    shortFormattedAddress?: string;
                    location?: { latitude?: number; longitude?: number };
                }>;
            };

            const places = data.places || [];

            if (places.length === 0) {
                console.log(`[search_location] No results for "${query}"`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: true,
                    results_count: 0,
                    results: [],
                    formatted_response: `No encontré resultados para "${original_description}". ¿Puedes darme la dirección exacta (calle, número, colonia)?`
                }) }] };
            }

            const results = places.map((place, i) => ({
                index: i + 1,
                name: place.displayName?.text || "Sin nombre",
                address: place.formattedAddress || place.shortFormattedAddress || "Sin dirección",
                latitude: place.location?.latitude || null,
                longitude: place.location?.longitude || null,
                maps_link: place.location?.latitude && place.location?.longitude
                    ? `https://maps.google.com/?q=${place.location.latitude},${place.location.longitude}`
                    : null
            }));

            console.log(`[search_location] Found ${results.length} results`);

            let formatted: string;
            if (results.length === 1) {
                const r = results[0];
                formatted = `Encontré esta ubicación:\n📍 ${r.name} — ${r.address}`;
            } else {
                formatted = `Encontré ${results.length} resultados:\n` +
                    results.map(r => `${r.index}. ${r.name} — ${r.address}`).join("\n");
            }

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                results_count: results.length,
                results,
                original_description,
                formatted_response: formatted
            }) }] };
        } catch (error) {
            console.error(`[search_location] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                formatted_response: "No pude buscar la ubicación en este momento. ¿Puedes darme la dirección exacta (calle, número, colonia)?"
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

        const apiKey = getGoogleMapsKey();
        if (!apiKey) {
            console.warn("[reverse_geocode] No GOOGLE_MAPS_API_KEY configured");
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: "no_api_key",
                formatted_response: `Recibí tu ubicación (${latitude}, ${longitude}) pero no pude obtener la dirección. ¿Puedes decirme la calle, número y colonia?`
            }) }] };
        }

        try {
            const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&language=es&key=${apiKey}`;
            const response = await fetch(url);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[reverse_geocode] Google Geocoding API error ${response.status}: ${errorText}`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: `api_error_${response.status}`,
                    formatted_response: `Recibí tu ubicación pero no pude obtener la dirección. ¿Puedes decirme la calle, número y colonia?`
                }) }] };
            }

            const data = await response.json() as {
                status: string;
                results?: Array<{
                    formatted_address?: string;
                    address_components?: Array<{
                        long_name?: string;
                        types?: string[];
                    }>;
                }>;
            };

            if (data.status !== "OK" || !data.results?.length) {
                console.log(`[reverse_geocode] No results for ${latitude}, ${longitude}`);
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: "no_results",
                    formatted_response: `Recibí tu ubicación pero no encontré una dirección. ¿Puedes decirme la calle, número y colonia?`
                }) }] };
            }

            const best = data.results[0];
            const components = best.address_components || [];
            const getComponent = (type: string) =>
                components.find(c => c.types?.includes(type))?.long_name || null;

            const result = {
                formatted_address: best.formatted_address || "Sin dirección",
                street: getComponent("route"),
                street_number: getComponent("street_number"),
                colonia: getComponent("sublocality_level_1") || getComponent("sublocality") || getComponent("neighborhood"),
                city: getComponent("locality"),
                state: getComponent("administrative_area_level_1"),
                postal_code: getComponent("postal_code"),
                latitude,
                longitude,
                maps_link: `https://maps.google.com/?q=${latitude},${longitude}`
            };

            console.log(`[reverse_geocode] Resolved: ${result.formatted_address}`);

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                ...result,
                formatted_response: `📍 ${result.formatted_address}`
            }) }] };
        } catch (error) {
            console.error(`[reverse_geocode] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                formatted_response: `No pude obtener la dirección de tu ubicación. ¿Puedes decirme la calle, número y colonia?`
            }) }] };
        }
    }
);
