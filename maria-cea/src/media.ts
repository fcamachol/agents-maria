// ============================================
// Media Processing Module
// Handles audio transcription and image analysis
// ============================================

import Anthropic from "@anthropic-ai/sdk";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// ============================================
// Download Media from URL
// ============================================

async function downloadMedia(url: string): Promise<{ data: Buffer; contentType: string } | null> {
    try {
        console.log(`[Media] Downloading from: ${url}`);
        const response = await fetch(url);

        if (!response.ok) {
            console.error(`[Media] Download failed: ${response.status}`);
            return null;
        }

        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const arrayBuffer = await response.arrayBuffer();
        const data = Buffer.from(arrayBuffer);

        console.log(`[Media] Downloaded ${data.length} bytes, type: ${contentType}`);
        return { data, contentType };
    } catch (error) {
        console.error(`[Media] Download error:`, error);
        return null;
    }
}

// ============================================
// Transcribe Audio using OpenAI Whisper
// ============================================

export async function transcribeAudio(audioUrl: string): Promise<string | null> {
    if (!OPENAI_API_KEY) {
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
                "Authorization": `Bearer ${OPENAI_API_KEY}`
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
// Analyze Image using Claude Vision
// ============================================

export async function analyzeImage(imageUrl: string): Promise<string | null> {
    try {
        const media = await downloadMedia(imageUrl);
        if (!media) {
            return null;
        }

        // Determine media type for Claude
        let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
        if (media.contentType.includes("png")) {
            mediaType = "image/png";
        } else if (media.contentType.includes("gif")) {
            mediaType = "image/gif";
        } else if (media.contentType.includes("webp")) {
            mediaType = "image/webp";
        }

        // Convert to base64
        const base64Data = media.data.toString("base64");

        // Use Claude to analyze the image
        const client = new Anthropic();

        console.log(`[Media] Analyzing image with Claude Vision...`);
        const response = await client.messages.create({
            model: "claude-sonnet-4-5-20250929",
            max_tokens: 500,
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
                        {
                            type: "text",
                            text: `Eres un asistente de la CEA Querétaro (agua y drenaje). Analiza esta imagen y responde con el siguiente formato:

CLASIFICACIÓN: [una de: FUGA_AGUA, DRENAJE, INFRAESTRUCTURA, MEDIDOR, RECIBO, NO_RELACIONADO]
DESCRIPCIÓN: [1-2 oraciones describiendo lo que se ve]

Guía de clasificación:
- FUGA_AGUA: Se ve agua saliendo de tubería, calle mojada por fuga, charco por fuga, tubería rota
- DRENAJE: Drenaje tapado, agua sucia saliendo, alcantarilla desbordada
- INFRAESTRUCTURA: Tapa de registro dañada, hundimiento, daño en vía pública relacionado con agua/drenaje
- MEDIDOR: Foto de medidor de agua
- RECIBO: Recibo, factura, o documento de la CEA
- NO_RELACIONADO: Cualquier imagen que NO muestre un problema de agua, drenaje, infraestructura hídrica, medidor ni recibo de la CEA`
                        }
                    ]
                }
            ]
        });

        const textBlock = response.content.find(block => block.type === "text");
        if (textBlock && textBlock.type === "text") {
            console.log(`[Media] Image analysis: "${textBlock.text.substring(0, 100)}..."`);
            return textBlock.text;
        }

        return null;
    } catch (error) {
        console.error(`[Media] Image analysis error:`, error);
        return null;
    }
}

// ============================================
// Process Media Attachments
// Returns text description of all media
// ============================================

interface MediaAttachment {
    file_type: string;
    data_url: string | null;
}

export async function processMediaAttachments(attachments: MediaAttachment[]): Promise<string> {
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
                const analysis = await analyzeImage(attachment.data_url);
                if (analysis) {
                    results.push(`[Imagen enviada por el usuario]: ${analysis}`);
                } else {
                    results.push(`[Imagen adjunta - no se pudo analizar]`);
                }
                break;
            }

            case "video":
                results.push(`[Video adjunto - no puedo procesar videos. El usuario envió un video.]`);
                break;

            case "location":
                results.push(`[Ubicación compartida]`);
                break;

            case "file":
                results.push(`[Archivo adjunto]`);
                break;

            default:
                results.push(`[Adjunto tipo: ${attachment.file_type}]`);
        }
    }

    return results.join("\n");
}
