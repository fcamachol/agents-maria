// ============================================
// Media Processing Module
// Handles audio transcription, image analysis,
// and video analysis (via Gemini) with specialized
// analyzers for Hydropolis-specific content
//
// Flow: Photo → classify (pass 1) → specialist analyzer (pass 2) → text for agent
// Flow: Video → single-pass classify + analyze via Gemini → text for agent
// Supported: MEDIDOR, FUGA, RECIBO, NO_RELACIONADO
// ============================================

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// NOTE: Read env vars lazily via getters. In ESM, module-level code runs
// before dotenv.config(), so top-level consts would capture empty strings.
function getOpenAIKey(): string { return process.env.OPENAI_API_KEY || ""; }
function getGeminiKey(): string { return process.env.GEMINI_API_KEY || ""; }

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

// ============================================
// Download Media from URL
// ============================================

async function downloadMedia(url: string, retries = 3): Promise<{ data: Buffer; contentType: string } | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`[Media] Downloading from: ${url}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
            const response = await fetch(url);

            if (!response.ok) {
                if (response.status === 404 && attempt < retries) {
                    console.warn(`[Media] Download got 404, retrying in ${attempt * 2}s...`);
                    await new Promise(r => setTimeout(r, attempt * 2000));
                    continue;
                }
                console.error(`[Media] Download failed: ${response.status}`);
                return null;
            }

            const contentType = response.headers.get("content-type") || "application/octet-stream";
            const arrayBuffer = await response.arrayBuffer();
            const data = Buffer.from(arrayBuffer);

            console.log(`[Media] Downloaded ${data.length} bytes, type: ${contentType}`);
            return { data, contentType };
        } catch (error) {
            if (attempt < retries) {
                console.warn(`[Media] Download error, retrying in ${attempt * 2}s...`, error);
                await new Promise(r => setTimeout(r, attempt * 2000));
                continue;
            }
            console.error(`[Media] Download error:`, error);
            return null;
        }
    }
    return null;
}

// ============================================
// Helpers
// ============================================

function getImageMediaType(contentType: string): ImageMediaType {
    if (contentType.includes("png")) return "image/png";
    if (contentType.includes("gif")) return "image/gif";
    if (contentType.includes("webp")) return "image/webp";
    return "image/jpeg";
}

function extractClassification(analysis: string): string {
    const match = analysis.match(/CLASIFICACIÓN:\s*(\S+)/);
    return match ? match[1] : "NO_RELACIONADO";
}

async function callClaudeVision(
    base64Data: string,
    mediaType: ImageMediaType,
    prompt: string,
    maxTokens: number = 500
): Promise<string | null> {
    try {
        const client = new Anthropic();
        const response = await client.messages.create({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: maxTokens,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: mediaType,
                                data: base64Data
                            }
                        },
                        { type: "text", text: prompt }
                    ]
                }
            ]
        });

        const textBlock = response.content.find(block => block.type === "text");
        if (textBlock && textBlock.type === "text") {
            return textBlock.text;
        }
        return null;
    } catch (error) {
        console.error(`[Media] Claude Vision error:`, error);
        return null;
    }
}

// ============================================
// Gemini Video Analysis (2-pass: classify cheap, analyze smart)
// Pass 1: gemini-2.5-flash-lite (cheapest) → classification
// Pass 2: gemini-2.5-flash (smarter) → specialist analysis
// ============================================

const GEMINI_CLASSIFY_MODEL = process.env.GEMINI_CLASSIFY_MODEL || "gemini-2.5-flash-lite";
const GEMINI_ANALYZE_MODEL = process.env.GEMINI_ANALYZE_MODEL || "gemini-2.5-flash";

async function callGeminiVideo(
    base64Data: string,
    mimeType: string,
    prompt: string,
    modelName: string,
    maxTokens: number = 500
): Promise<string | null> {
    try {
        const genAI = new GoogleGenerativeAI(getGeminiKey());
        const model = genAI.getGenerativeModel({ model: modelName });

        console.log(`[Media] Calling Gemini (${modelName})...`);
        const result = await model.generateContent([
            {
                inlineData: {
                    data: base64Data,
                    mimeType
                }
            },
            { text: prompt }
        ]);

        const response = result.response;
        const text = response.text();
        return text || null;
    } catch (error) {
        console.error(`[Media] Gemini (${modelName}) error:`, error);
        return null;
    }
}

// Pass 1: Classify video with cheap model
async function classifyVideo(base64Data: string, mimeType: string): Promise<string | null> {
    console.log(`[Media] Video Pass 1: Classifying with ${GEMINI_CLASSIFY_MODEL}...`);
    return callGeminiVideo(base64Data, mimeType, `Eres un asistente de Hydropolis (agua y drenaje). Analiza este video y responde con el siguiente formato:

CLASIFICACIÓN: [una de: FUGA_AGUA, DRENAJE, INFRAESTRUCTURA, MEDIDOR, RECIBO, NO_RELACIONADO]
DESCRIPCIÓN: [1-2 oraciones describiendo lo que se ve]

Guía de clasificación:
- FUGA_AGUA: Se ve agua saliendo de tubería, calle mojada por fuga, chorro de agua, tubería rota
- DRENAJE: Drenaje tapado, agua sucia saliendo, alcantarilla desbordada
- INFRAESTRUCTURA: Tapa de registro dañada, hundimiento, daño en vía pública relacionado con agua/drenaje
- MEDIDOR: Video de medidor de agua
- RECIBO: Video de recibo o factura de Hydropolis
- NO_RELACIONADO: Cualquier video que NO muestre un problema de agua, drenaje, infraestructura hídrica, medidor ni recibo de Hydropolis

IMPORTANTE para NO_RELACIONADO: Si el video NO está relacionado, describe claramente QUÉ se ve (ej: "Se ve una persona caminando", "Se ve tráfico en una calle") para que el agente pueda explicar al usuario por qué el video no es relevante.`, GEMINI_CLASSIFY_MODEL, 200);
}

// Pass 2: Specialist analyzers with smarter model
async function analyzeVideoFuga(base64Data: string, mimeType: string): Promise<string | null> {
    console.log(`[Media] Video Pass 2: Analyzing fuga with ${GEMINI_ANALYZE_MODEL}...`);
    return callGeminiVideo(base64Data, mimeType, `Eres un inspector técnico de Hydropolis especializado en fugas de agua y drenaje. Analiza este video con máximo detalle para que el equipo de campo pueda actuar sin necesidad de más información.

Responde con el siguiente formato EXACTO:

[ANÁLISIS DE VIDEO - FUGA]:
- Ubicación: [vía pública / banqueta / toma domiciliaria / interior de propiedad / registro] — [describe lo que se ve alrededor]
- Superficie: [asfalto / concreto / tierra / adoquín / dentro de registro]
- Tipo de agua: [limpia (probable agua potable) / sucia (probable drenaje) / mixta / no determinable]
- Volumen estimado: [goteo / flujo leve / flujo constante / chorro a presión / inundación]
- Área afectada: [charco pequeño (<1m) / mediano (1-3m) / grande (3-5m) / calle inundada (>5m)]
- Tiempo estimado: [reciente / moderado / prolongada]
- Daño a pavimento: [sin daño / grietas / hundimiento / socavón / pavimento levantado]
- Infraestructura afectada: [ninguna / tapa de registro rota / tubería expuesta / válvula dañada / registro abierto]
- Riesgo peatonal: [sí/no] — [detalle]
- Riesgo vehicular: [sí/no] — [detalle]
- Observaciones del video: [detalles que solo el video revela: flujo de agua en movimiento, dirección del flujo, sonido de presión, cambios en el tiempo, volumen real del agua, etc.]
- Subcategoría sugerida: [REP-FVP / REP-FTD / REP-FRD / REP-FDR / REP-DRO / REP-TAP / REP-HUN]
- Prioridad sugerida: [medium / high / urgent]
- Descripción para ticket: [2-3 oraciones resumiendo todo lo observado]

GUÍA DE SUBCATEGORÍAS:
- REP-FVP: Agua limpia saliendo en calle o banqueta
- REP-FTD: Fuga en la conexión entre la red y la propiedad (cerca del medidor)
- REP-FRD: Fuga grande en red principal, mucho volumen
- REP-FDR: Agua sucia o negra saliendo, olor a drenaje
- REP-DRO: Drenaje tapado, agua estancada sucia
- REP-TAP: Tapa de registro rota, faltante o hundida
- REP-HUN: Hundimiento del pavimento relacionado con agua o drenaje

GUÍA DE PRIORIDAD:
- urgent: chorro a presión, inundación, socavón, riesgo inmediato
- high: flujo constante, daño a infraestructura, área grande
- medium: goteo o flujo leve, sin riesgo inmediato

IMPORTANTE: Aprovecha la información temporal del video (movimiento del agua, dirección del flujo, sonidos, cambios). Esto es más valioso que una foto estática.`, GEMINI_ANALYZE_MODEL, 800);
}

async function analyzeVideoMedidor(base64Data: string, mimeType: string): Promise<string | null> {
    console.log(`[Media] Video Pass 2: Analyzing medidor with ${GEMINI_ANALYZE_MODEL}...`);
    return callGeminiVideo(base64Data, mimeType, `Eres un técnico especialista en medidores de agua de Hydropolis. Analiza este video de medidor y extrae TODA la información visible.

ANTES DE RESPONDER, sigue estos pasos mentalmente:

PASO 1 — IDENTIFICAR RODILLOS:
Localiza la fila horizontal de rodillos/tambores giratorios en la parte superior del medidor.

PASO 2 — CONTAR Y LEER CADA RODILLO:
De IZQUIERDA a DERECHA, cuenta cuántos rodillos hay y lee el dígito de cada uno. Si un rodillo está entre dos números (transición), usa el número MENOR.
ATENCIÓN CON LOS DÍGITOS: Presta máxima atención a cada número. Dígitos como 1 y 7 se confunden fácilmente — observa si hay un trazo horizontal superior (7) o solo un trazo vertical (1).

PASO 3 — IDENTIFICAR EL RODILLO DECIMAL:
En TODOS los medidores de agua (Cicasa, Zenner, Elster, etc.), el ÚLTIMO rodillo (el más a la derecha) mide DÉCIMAS de m³. Este rodillo:
- Tiene fondo de color ROJO o rojizo (los demás tienen fondo NEGRO o oscuro)
- Es el que gira más rápido
- NUNCA es parte de la lectura entera de m³

PASO 4 — CALCULAR LA LECTURA:
La lectura = todos los dígitos de los rodillos EXCEPTO el último.
- 5 rodillos mostrando 0, 0, 0, 0, 7 → descartar el último (7) → lectura = 0 m³
- 5 rodillos mostrando 0, 4, 5, 2, 3 → descartar el último (3) → lectura = 452 m³
- 4 rodillos mostrando 1, 2, 3, 7 → descartar el último (7) → lectura = 123 m³

PASO 5 — IGNORAR DIALES INFERIORES:
Debajo de los rodillos hay 3 o 4 pequeños diales circulares de color rojo. Estos miden fracciones sub-litro y NO son parte de la lectura.

Ahora responde con el siguiente formato EXACTO:

[ANÁLISIS DE VIDEO - MEDIDOR]:
- Rodillos (izq → der): [enumera cada rodillo: posición, dígito, color de fondo]
  Ej: "1→0(negro) 2→0(negro) 3→0(negro) 4→0(negro) 5→7(rojo)"
- Último rodillo descartado (decimal): [dígito y color de fondo]
- Lectura: [dígitos restantes después de descartar el último rodillo] m³ (confianza: [alta/media/baja])
- Serie: [número de serie si es visible, o "no visible"]
- Tipo: [analógico/digital]
- Estado físico: [buen estado / vidrio empañado / vidrio roto / dañado / corroído / ilegible]
- Movimiento: [girando activamente (hay consumo) / estático (sin consumo) / no determinable]
- Velocidad de giro: [rápido (posible fuga interna) / normal / lento / no aplica]
- Detalles adicionales: [observaciones relevantes del video]

REGLA CRÍTICA: Si ves que TODOS los rodillos excepto el último muestran 0, la lectura es 0 (CERO) sin importar qué muestre el último rodillo. El último rodillo SIEMPRE se descarta.

IMPORTANTE: El video puede revelar si el medidor está girando (indica consumo activo o posible fuga). Observa cuidadosamente el movimiento de los rodillos y diales.`, GEMINI_ANALYZE_MODEL, 700);
}

async function analyzeVideoRecibo(base64Data: string, mimeType: string): Promise<string | null> {
    console.log(`[Media] Video Pass 2: Analyzing recibo with ${GEMINI_ANALYZE_MODEL}...`);
    return callGeminiVideo(base64Data, mimeType, `Eres un especialista en facturación de Hydropolis. Analiza este video de recibo o factura de agua y extrae TODA la información visible.

Responde con el siguiente formato EXACTO:

[ANÁLISIS DE VIDEO - RECIBO]:
- Contrato: [número de contrato si es visible, o "no visible"]
- Titular: [nombre del titular si es visible, o "no visible"]
- Dirección: [dirección del servicio si es visible, o "no visible"]
- Periodo: [periodo de facturación, o "no visible"]
- Monto total: $[monto total a pagar, o "no visible"]
- Fecha de vencimiento: [fecha límite de pago, o "no visible"]
- Lectura anterior: [lectura anterior en m³, o "no visible"]
- Lectura actual: [lectura actual en m³, o "no visible"]
- Consumo: [consumo del periodo en m³, o "no visible"]
- Estado: [pagado / pendiente / vencido, o "no determinable"]
- Detalles adicionales: [cualquier otra información relevante]

INSTRUCCIONES:
- Lee con cuidado todos los campos visibles en el video.
- Si hay sellos de "PAGADO", indica el estado como "pagado".
- Si la imagen es borrosa o parcial, extrae lo que puedas y marca lo demás como "no visible".`, GEMINI_ANALYZE_MODEL, 700);
}

// ============================================
// Transcribe Audio using OpenAI Whisper
// ============================================

export async function transcribeAudio(audioUrl: string): Promise<string | null> {
    if (!getOpenAIKey()) {
        console.warn("[Media] No OPENAI_API_KEY configured for audio transcription");
        return null;
    }

    try {
        const media = await downloadMedia(audioUrl);
        if (!media) {
            return null;
        }

        // Create form data for Whisper API
        const formData = new FormData();
        const blob = new Blob([media.data], { type: media.contentType });
        formData.append("file", blob, "audio.ogg");
        formData.append("model", "whisper-1");
        formData.append("language", "es");

        console.log(`[Media] Sending audio to Whisper API...`);
        const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${getOpenAIKey()}`
            },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Media] Whisper API error ${response.status}: ${errorText}`);
            return null;
        }

        const result = await response.json() as { text: string };
        console.log(`[Media] Transcription: "${result.text.substring(0, 100)}..."`);
        return result.text;
    } catch (error) {
        console.error(`[Media] Transcription error:`, error);
        return null;
    }
}

// ============================================
// Pass 1: Classify Image
// ============================================

async function classifyImage(base64Data: string, mediaType: ImageMediaType): Promise<string | null> {
    console.log(`[Media] Pass 1: Classifying image...`);
    return callClaudeVision(base64Data, mediaType, `Eres un asistente de Hydropolis (agua y drenaje). Analiza esta imagen y responde con el siguiente formato:

CLASIFICACIÓN: [una de: FUGA_AGUA, DRENAJE, INFRAESTRUCTURA, MEDIDOR, RECIBO, NO_RELACIONADO]
DESCRIPCIÓN: [1-2 oraciones describiendo lo que se ve]

Guía de clasificación:
- FUGA_AGUA: Se ve agua saliendo de tubería, calle mojada por fuga, charco por fuga, tubería rota
- DRENAJE: Drenaje tapado, agua sucia saliendo, alcantarilla desbordada
- INFRAESTRUCTURA: Tapa de registro dañada, hundimiento, daño en vía pública relacionado con agua/drenaje
- MEDIDOR: Foto de medidor de agua
- RECIBO: Recibo, factura, o documento de Hydropolis
- NO_RELACIONADO: Cualquier imagen que NO muestre un problema de agua, drenaje, infraestructura hídrica, medidor ni recibo de Hydropolis

IMPORTANTE para NO_RELACIONADO: Si la imagen NO está relacionada, describe claramente QUÉ es lo que se ve (ej: "Se ve una selfie de una persona", "Se ve un platillo de comida", "Se ve un paisaje") para que el agente pueda explicar al usuario por qué la imagen no es relevante y pedirle la correcta.`);
}

// ============================================
// Pass 2: Specialized Analyzers
// ============================================

async function analyzeMedidor(base64Data: string, mediaType: ImageMediaType): Promise<string | null> {
    console.log(`[Media] Pass 2: Analyzing medidor in detail...`);
    return callClaudeVision(base64Data, mediaType, `Eres un técnico especialista en medidores de agua de Hydropolis. Analiza esta foto de medidor y extrae TODA la información visible.

ANTES DE RESPONDER, sigue estos pasos mentalmente:

PASO 1 — IDENTIFICAR RODILLOS:
Localiza la fila horizontal de rodillos/tambores giratorios en la parte superior del medidor. Estos son cilindros mecánicos que muestran un dígito cada uno.

PASO 2 — CONTAR Y LEER CADA RODILLO:
De IZQUIERDA a DERECHA, cuenta cuántos rodillos hay y lee el dígito de cada uno. Si un rodillo está entre dos números (transición), usa el número MENOR.

VERIFICACIÓN OBLIGATORIA DE CADA DÍGITO:
Para CADA rodillo, antes de decidir el número, describe mentalmente lo que ves:
- ¿Tiene trazo horizontal arriba? → probablemente 7 (NO es 1)
- ¿Es solo un trazo vertical sin nada arriba? → es 1
- ¿Tiene curvas? → podría ser 3, 5, 6, 8, 9
- ¿Es completamente cerrado/ovalado? → es 0 o 8

ERRORES COMUNES EN MEDIDORES DE AGUA — REVISA DOS VECES:
- 7 leído como 1: El 7 tiene un trazo horizontal en la parte superior y baja en diagonal. El 1 es SOLO una línea vertical recta. Si hay CUALQUIER trazo horizontal o diagonal, NO es 1.
- 1 leído como 7: El 1 es estrictamente vertical. Si no hay absolutamente ningún trazo horizontal superior, es 1.
- 3 leído como 8: El 3 está abierto por la izquierda, el 8 está cerrado.
- 5 leído como 6: El 5 no tiene curva inferior cerrada, el 6 sí.

PASO 3 — IDENTIFICAR EL RODILLO DECIMAL:
En TODOS los medidores de agua (Cicasa, Zenner, Elster, etc.), el ÚLTIMO rodillo (el más a la derecha) mide DÉCIMAS de m³. Este rodillo:
- Tiene fondo de color ROJO o rojizo (los demás tienen fondo NEGRO o oscuro)
- Es el que gira más rápido
- NUNCA es parte de la lectura entera de m³

PASO 4 — CALCULAR LA LECTURA:
La lectura = todos los dígitos de los rodillos EXCEPTO el último.
- 6 rodillos mostrando 0, 0, 1, 7, 3, 5 → descartar el último (5) → lectura = 173 m³
- 5 rodillos mostrando 0, 0, 0, 0, 7 → descartar el último (7) → lectura = 0 m³
- 5 rodillos mostrando 0, 4, 5, 2, 3 → descartar el último (3) → lectura = 452 m³
- 4 rodillos mostrando 1, 2, 3, 7 → descartar el último (7) → lectura = 123 m³

PASO 5 — IGNORAR DIALES INFERIORES:
Debajo de los rodillos hay 3 o 4 pequeños diales circulares de color rojo. Estos miden fracciones sub-litro y NO son parte de la lectura.

PASO 6 — DOBLE VERIFICACIÓN DE DÍGITOS AMBIGUOS:
Vuelve a revisar CADA rodillo que leíste como 1. ¿Realmente es solo una línea vertical? ¿No tiene un pequeño trazo horizontal arriba que indicaría un 7? En medidores de agua analógicos, el 7 es MUCHO más común que el 1 en posiciones intermedias.

Ahora responde con el siguiente formato EXACTO:

[ANÁLISIS DE MEDIDOR]:
- Rodillos (izq → der): [para cada rodillo: posición, forma observada, dígito, color de fondo]
  Ej: "1→vertical+horizontal arriba=7(negro) 2→ovalado=0(negro) 3→ovalado=0(negro) 4→ovalado=0(negro) 5→curva cerrada=0(negro) 6→vertical+horizontal arriba=7(rojo)"
- Último rodillo descartado (decimal): [dígito y color de fondo]
- Lectura: [dígitos restantes después de descartar el último rodillo] m³ (confianza: [alta/media/baja])
- Serie: [número de serie si es visible, o "no visible"]
- Tipo: [analógico/digital]
- Estado físico: [buen estado / vidrio empañado / vidrio roto / dañado / corroído / ilegible]
- Detalles adicionales: [marca, modelo, calibre, posición, accesibilidad, observaciones]

REGLA CRÍTICA: Si ves que TODOS los rodillos excepto el último muestran 0, la lectura es 0 (CERO) sin importar qué muestre el último rodillo. El último rodillo SIEMPRE se descarta.`, 700);
}

async function analyzeFuga(base64Data: string, mediaType: ImageMediaType): Promise<string | null> {
    console.log(`[Media] Pass 2: Analyzing fuga in detail...`);
    return callClaudeVision(base64Data, mediaType, `Eres un inspector técnico de Hydropolis especializado en fugas de agua y drenaje. Analiza esta foto con máximo detalle para que el equipo de campo pueda actuar sin necesidad de más información.

Responde con el siguiente formato EXACTO:

[ANÁLISIS DE FUGA]:
- Ubicación: [vía pública / banqueta / toma domiciliaria / interior de propiedad / terreno baldío / registro o caja de válvulas] — [describe lo que se ve alrededor: fachadas de casas, coches estacionados, señalización, tipo de calle, comercios, etc.]
- Superficie: [asfalto / concreto / tierra / adoquín / dentro de registro / piso interior]
- Tipo de agua: [limpia o transparente (probable agua potable) / sucia u oscura (probable drenaje o aguas negras) / mixta / no determinable]
- Volumen estimado: [goteo / flujo leve / flujo constante / chorro a presión / inundación]
- Área afectada: [charco pequeño (menos de 1m) / charco mediano (1-3m) / área grande (3-5m) / calle inundada (más de 5m)]
- Tiempo estimado: [reciente (agua limpia, sin erosión) / moderado (algo de sedimento, humedad en paredes) / prolongada (musgo, erosión, hundimiento, manchas de humedad antiguas)]
- Daño a pavimento: [sin daño visible / grietas / hundimiento / socavón / pavimento levantado]
- Infraestructura afectada: [ninguna / tapa de registro rota / tubería expuesta / válvula dañada / registro abierto / boca de tormenta obstruida]
- Riesgo peatonal: [sí o no] — [detalle: charco profundo, socavón, área resbalosa, ninguno]
- Riesgo vehicular: [sí o no] — [detalle: hundimiento en carril, inundación de calle, ninguno]
- Subcategoría sugerida: [REP-FVP / REP-FTD / REP-FRD / REP-FDR / REP-DRO / REP-TAP / REP-HUN]
- Prioridad sugerida: [medium / high / urgent]
- Descripción para ticket: [2-3 oraciones que resuman TODO lo observado, incluyendo ubicación, tipo de problema, severidad, riesgos y daños. Esta descripción será usada directamente en el ticket de servicio.]

GUÍA DE SUBCATEGORÍAS:
- REP-FVP: Agua limpia saliendo en calle o banqueta (NO dentro de propiedad)
- REP-FTD: Fuga en la conexión entre la red y la propiedad (cerca del medidor, en la acera frente a casa)
- REP-FRD: Fuga grande en red principal, mucho volumen, afecta varias propiedades
- REP-FDR: Agua sucia o negra saliendo, olor a drenaje
- REP-DRO: Drenaje tapado, agua estancada sucia
- REP-TAP: Tapa de registro rota, faltante o hundida
- REP-HUN: Hundimiento del pavimento relacionado con agua o drenaje

GUÍA DE PRIORIDAD:
- urgent: chorro a presión, inundación, socavón, riesgo inmediato para personas
- high: flujo constante, daño a infraestructura, área afectada grande
- medium: goteo o flujo leve, sin riesgo inmediato, daño menor`, 800);
}

async function analyzeRecibo(base64Data: string, mediaType: ImageMediaType): Promise<string | null> {
    console.log(`[Media] Pass 2: Analyzing recibo in detail...`);
    return callClaudeVision(base64Data, mediaType, `Eres un especialista en facturación de Hydropolis. Analiza esta imagen de recibo o factura de agua y extrae TODA la información visible.

Responde con el siguiente formato EXACTO:

[ANÁLISIS DE RECIBO]:
- Contrato: [número de contrato si es visible, o "no visible"]
- Titular: [nombre del titular si es visible, o "no visible"]
- Dirección: [dirección del servicio si es visible, o "no visible"]
- Periodo: [periodo de facturación, ej: "Ene-Feb 2026", o "no visible"]
- Monto total: $[monto total a pagar, o "no visible"]
- Fecha de vencimiento: [fecha límite de pago, o "no visible"]
- Lectura anterior: [lectura anterior en m³, o "no visible"]
- Lectura actual: [lectura actual en m³, o "no visible"]
- Consumo: [consumo del periodo en m³, o "no visible"]
- Estado: [pagado / pendiente / vencido, basado en sellos o marcas visibles, o "no determinable"]
- Detalles adicionales: [cualquier otra información relevante: cargos extra, descuentos, avisos, número de factura, desglose de conceptos (agua, drenaje, saneamiento), etc.]

INSTRUCCIONES:
- Lee con cuidado todos los campos impresos en el recibo.
- Si hay sellos de "PAGADO" o marcas similares, indica el estado como "pagado".
- Si la fecha de vencimiento ya pasó y no hay sello de pago, indica "vencido".
- Si ves conceptos desglosados (agua, drenaje, saneamiento), menciónalos en detalles adicionales.
- Si la imagen es borrosa o parcial, extrae lo que puedas y marca lo demás como "no visible".`, 700);
}

// ============================================
// Process Media Attachments
// Returns text description of all media
//
// For images: classify first, then run specialist
// analyzer if MEDIDOR/FUGA/RECIBO. For NO_RELACIONADO,
// the classification already includes what the image
// shows so the agent can explain why it's not relevant.
// ============================================

interface MediaAttachment {
    file_type: string;
    data_url: string | null;
}

export async function processMediaAttachments(attachments: MediaAttachment[], pendingLectura = false): Promise<string> {
    const results: string[] = [];

    for (const attachment of attachments) {
        if (!attachment.data_url) {
            continue;
        }

        switch (attachment.file_type) {
            case "audio": {
                const transcription = await transcribeAudio(attachment.data_url);
                if (transcription) {
                    results.push(`[Mensaje de voz del usuario]: "${transcription}"`);
                } else {
                    results.push(`[Audio adjunto - no se pudo transcribir. El usuario envió un mensaje de voz.]`);
                }
                break;
            }

            case "image": {
                // Step 1: Download image once (reused for both passes)
                const media = await downloadMedia(attachment.data_url);
                if (!media) {
                    results.push(`[Imagen adjunta - no se pudo descargar]`);
                    break;
                }

                const mediaType = getImageMediaType(media.contentType);
                const base64Data = media.data.toString("base64");

                // Step 2: Pass 1 — Classify
                const classification = await classifyImage(base64Data, mediaType);
                if (!classification) {
                    results.push(`[Imagen adjunta - no se pudo analizar]`);
                    break;
                }

                const category = extractClassification(classification);
                console.log(`[Media] Image classified as: ${category}`);

                // Step 3: Pass 2 — Specialist analysis based on classification
                let specialistAnalysis: string | null = null;

                try {
                    if (category === "MEDIDOR" && !pendingLectura) {
                        specialistAnalysis = await analyzeMedidor(base64Data, mediaType);
                    } else if (category === "MEDIDOR" && pendingLectura) {
                        console.log(`[Media] Skipping Pass 2 for MEDIDOR — pendingLectura, classification is sufficient`);
                        specialistAnalysis = `[ACCIÓN REQUERIDA]: La foto del medidor ha sido validada. DEBES llamar la herramienta create_ticket con category_code "FAC", subcategory_code "FAC-LEC", titulo "Reporte de lectura de medidor", y el contract_number del usuario. NO inventes un folio — usa el que devuelve create_ticket.`;
                    } else if (["FUGA_AGUA", "DRENAJE", "INFRAESTRUCTURA"].includes(category)) {
                        specialistAnalysis = await analyzeFuga(base64Data, mediaType);
                    } else if (category === "RECIBO") {
                        specialistAnalysis = await analyzeRecibo(base64Data, mediaType);
                    }
                    // NO_RELACIONADO and others: no specialist pass needed
                } catch (error) {
                    console.error(`[Media] Specialist analysis failed for ${category}:`, error);
                    // Fallback: continue with just the classification
                }

                // Step 4: Build output — always include classification, append specialist if available
                let output = `[Imagen enviada por el usuario]: ${classification}`;
                if (specialistAnalysis) {
                    output += `\n\n${specialistAnalysis}`;
                }
                results.push(output);
                break;
            }

            case "video": {
                if (!getGeminiKey()) {
                    results.push(`[Video adjunto - no puedo procesar videos. El usuario envió un video.]`);
                    break;
                }

                const videoMedia = await downloadMedia(attachment.data_url);
                if (!videoMedia) {
                    results.push(`[Video adjunto - no se pudo descargar]`);
                    break;
                }

                // 20MB limit
                if (videoMedia.data.length > 20 * 1024 * 1024) {
                    results.push(`[Video demasiado grande para analizar (${(videoMedia.data.length / (1024 * 1024)).toFixed(1)}MB, máximo 20MB). El usuario envió un video.]`);
                    break;
                }

                const videoBase64 = videoMedia.data.toString("base64");
                const videoMimeType = videoMedia.contentType || "video/mp4";
                console.log(`[Media] Processing video: ${(videoMedia.data.length / (1024 * 1024)).toFixed(1)}MB, type: ${videoMimeType}`);

                // Pass 1: Classify with cheap model
                const videoClassification = await classifyVideo(videoBase64, videoMimeType);
                if (!videoClassification) {
                    results.push(`[Video adjunto - no se pudo analizar el video. El usuario envió un video.]`);
                    break;
                }

                const videoCategory = extractClassification(videoClassification);
                console.log(`[Media] Video classified as: ${videoCategory}`);

                // Pass 2: Specialist analysis with smarter model
                let videoSpecialist: string | null = null;

                try {
                    if (["FUGA_AGUA", "DRENAJE", "INFRAESTRUCTURA"].includes(videoCategory)) {
                        videoSpecialist = await analyzeVideoFuga(videoBase64, videoMimeType);
                    } else if (videoCategory === "MEDIDOR") {
                        videoSpecialist = await analyzeVideoMedidor(videoBase64, videoMimeType);
                    } else if (videoCategory === "RECIBO") {
                        videoSpecialist = await analyzeVideoRecibo(videoBase64, videoMimeType);
                    }
                    // NO_RELACIONADO: no specialist pass needed, classification has the description
                } catch (error) {
                    console.error(`[Media] Video specialist analysis failed for ${videoCategory}:`, error);
                }

                let videoOutput = `[Video enviado por el usuario]: ${videoClassification}`;
                if (videoSpecialist) {
                    videoOutput += `\n\n${videoSpecialist}`;
                }
                results.push(videoOutput);
                break;
            }

            case "location":
                results.push(`[Ubicación compartida]`);
                break;

            case "file":
                results.push(`[Documento adjunto - NO procesable]`);
                break;

            default:
                results.push(`[Adjunto tipo: ${attachment.file_type}]`);
        }
    }

    return results.join("\n");
}
