// ============================================
// Vision Tool - CEA Receipt Extraction via Gemini
// ============================================

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";

// ============================================
// System Instruction for Gemini
// ============================================

const CEA_RECEIPT_SYSTEM_INSTRUCTION = `# SYSTEM ROLE
You are a forensic document parser specialized in CEA Querétaro water utility receipts.
Extract ALL billing data with absolute precision.

# STRICT RULES
1. ZERO GUESSWORK: If a value is blurry or obscured, use the string "ilegible" instead of guessing.
2. NEGATIVE VALUES: Preserve negative signs (-) for credits or adjustments.
3. DATA CLEANING: Remove currency symbols ($) and commas from numbers. Format dates as YYYY-MM-DD.
4. COMPLETENESS: Extract EVERY concept/line item from the concepts table — never summarize or skip rows.

# SPATIAL ANCHORS (where to find data on a CEA receipt)
* contrato: 10-digit number in the top-left header area, labeled "No. de Cuenta" or "Contrato"
* titular: Name below the contract number, labeled "Contribuyente" or "Titular"
* direccion: Address below the name
* no_factura: 18-digit string in the center-right blue grid, labeled "No. de factura"
* referencia: 8-digit code in the blue grid AND repeated in the bottom-right barcode area
* rfc_emisor: Always "CEA-800313-C95" for CEA Querétaro (hardcoded)
* uuid_fiscal: 36-character UUID string in the tiny CFDI text block at the bottom-left
* technical_grid: Central box with blue borders containing Medidor, Lecturas, Consumo
* concepts_table: Table in the middle section below the technical grid with columns: Descripción, Valor Unitario, Importe, IVA
* financial_summary: Right side panel above the bottom barcode showing totals and due date

# VALIDATION LOGIC (you MUST check these)
1. lectura_actual - lectura_anterior must equal consumo_m3. If not, set validation_warning=true and explain in audit_notes.
2. total_periodo + facturas_pendientes must equal total_a_pagar. If not, set validation_warning=true and explain in audit_notes.
3. Sum of all concept importe values should approximate total_periodo. Note discrepancies in audit_notes.

# PRECISION INSTRUCTIONS
- For small or dense text (UUID fiscal, RFC, reference codes): zoom in mentally and read character by character.
- For numbers in the concepts table: read each digit individually. Do not round or approximate.
- If a digit is ambiguous between two values (e.g., 3 vs 8, 1 vs 7), choose the most likely based on context and note it in audit_notes.`;

// ============================================
// Gemini Structured Output Schema
// ============================================

const geminiReceiptSchema: Schema = {
    type: SchemaType.OBJECT as const,
    properties: {
        identification: {
            type: SchemaType.OBJECT as const,
            description: "Invoice identification numbers",
            properties: {
                contrato: { type: SchemaType.STRING as const, description: "10-digit account/contract number from top-left" },
                titular: { type: SchemaType.STRING as const, description: "Account holder name" },
                direccion: { type: SchemaType.STRING as const, description: "Service address" },
                no_factura: { type: SchemaType.STRING as const, description: "18-digit invoice number from the blue grid" },
                referencia: { type: SchemaType.STRING as const, description: "8-digit reference code from blue grid and barcode area" },
                rfc_emisor: { type: SchemaType.STRING as const, description: "Always CEA-800313-C95" },
                uuid_fiscal: { type: SchemaType.STRING as const, description: "36-char CFDI UUID from bottom-left text block" },
            },
            required: ["contrato", "titular", "direccion", "no_factura", "referencia", "rfc_emisor", "uuid_fiscal"] as const,
        },
        technical_grid: {
            type: SchemaType.OBJECT as const,
            description: "Meter readings and consumption data from the central blue-bordered box",
            properties: {
                no_medidor: { type: SchemaType.STRING as const, description: "Water meter serial number" },
                lectura_actual: { type: SchemaType.STRING as const, description: "Current meter reading in m³" },
                lectura_anterior: { type: SchemaType.STRING as const, description: "Previous meter reading in m³" },
                consumo_m3: { type: SchemaType.STRING as const, description: "Water consumption in cubic meters for this period" },
                periodo_facturacion: { type: SchemaType.STRING as const, description: "Billing period in YYYY/MM format" },
            },
            required: ["no_medidor", "lectura_actual", "lectura_anterior", "consumo_m3", "periodo_facturacion"] as const,
        },
        concepts_table: {
            type: SchemaType.ARRAY as const,
            description: "ALL line items from the concepts/charges table — extract every single row",
            items: {
                type: SchemaType.OBJECT as const,
                properties: {
                    descripcion: { type: SchemaType.STRING as const, description: "Concept description (agua, drenaje, saneamiento, etc.)" },
                    valor_unitario: { type: SchemaType.NUMBER as const, description: "Unit price without $ symbol" },
                    importe: { type: SchemaType.NUMBER as const, description: "Total amount for this concept without $ symbol" },
                    iva: { type: SchemaType.STRING as const, description: "IVA tax indication (percentage, exempt, or amount)" },
                },
                required: ["descripcion", "valor_unitario", "importe", "iva"] as const,
            },
        },
        financial_summary: {
            type: SchemaType.OBJECT as const,
            description: "Payment totals from the right-side panel",
            properties: {
                total_periodo: { type: SchemaType.NUMBER as const, description: "Total charges for current billing period" },
                facturas_pendientes: { type: SchemaType.NUMBER as const, description: "Outstanding balance from previous invoices" },
                total_a_pagar: { type: SchemaType.NUMBER as const, description: "Grand total amount due" },
                fecha_vencimiento: { type: SchemaType.STRING as const, description: "Payment due date in YYYY-MM-DD format" },
            },
            required: ["total_periodo", "facturas_pendientes", "total_a_pagar", "fecha_vencimiento"] as const,
        },
        validation_warning: {
            type: SchemaType.BOOLEAN as const,
            description: "True if any math validation failed (readings vs consumption, or totals mismatch)",
        },
        audit_notes: {
            type: SchemaType.STRING as const,
            description: "Notes on illegible fields, math discrepancies, or assumptions made during extraction. Empty string if none.",
        },
    },
    required: [
        "identification", "technical_grid", "concepts_table",
        "financial_summary", "validation_warning", "audit_notes",
    ] as const,
};

// ============================================
// EXTRACT CEA RECEIPT Tool
// ============================================

export const extractCEAReceiptTool = tool(
    "extract_cea_receipt",
    `Extrae datos estructurados de una imagen de recibo/factura de la CEA Querétaro usando visión por computadora (Gemini).
Devuelve JSON con: identificación (contrato, factura, UUID fiscal), cuadro técnico (medidor, lecturas, consumo),
tabla de conceptos (todos los cargos), y resumen financiero (totales, fecha de vencimiento).
Incluye validación matemática automática. Usa esta herramienta cuando el usuario envíe una foto de su recibo de agua
y necesites extraer datos precisos para aclaraciones, auditoría o verificación de cobros.`,
    {
        image_url: z.string().describe("URL de la imagen del recibo de CEA (from Chatwoot attachment or direct URL)"),
    },
    async ({ image_url }: { image_url: string }) => {
        console.log(`[extract_cea_receipt] Starting extraction from: ${image_url}`);

        try {
            // 1. Download the image
            const geminiKey = process.env.GEMINI_API_KEY;
            if (!geminiKey) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: "GEMINI_API_KEY not configured",
                    formatted_response: "No puedo analizar el recibo en este momento. Error de configuración interno."
                }) }] };
            }

            console.log(`[extract_cea_receipt] Downloading image...`);
            const response = await fetch(image_url, { signal: AbortSignal.timeout(30000) });
            if (!response.ok) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: `Image download failed: HTTP ${response.status}`,
                    formatted_response: "No pude descargar la imagen del recibo. ¿Podrías enviarla de nuevo?"
                }) }] };
            }

            const contentType = response.headers.get("content-type") || "image/jpeg";
            const arrayBuffer = await response.arrayBuffer();
            const imageBuffer = Buffer.from(arrayBuffer);

            // Reject if too large (10MB)
            if (imageBuffer.length > 10 * 1024 * 1024) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: `Image too large: ${(imageBuffer.length / (1024 * 1024)).toFixed(1)}MB`,
                    formatted_response: "La imagen es demasiado grande. ¿Podrías enviar una foto más pequeña del recibo?"
                }) }] };
            }

            const base64Image = imageBuffer.toString("base64");
            let mimeType = "image/jpeg";
            if (contentType.includes("png")) mimeType = "image/png";
            else if (contentType.includes("webp")) mimeType = "image/webp";

            console.log(`[extract_cea_receipt] Image: ${(imageBuffer.length / 1024).toFixed(0)}KB, type: ${mimeType}`);

            // 2. Call Gemini with structured output
            const genAI = new GoogleGenerativeAI(geminiKey);
            const modelName = process.env.GEMINI_RECEIPT_MODEL || "gemini-2.5-flash";
            const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: CEA_RECEIPT_SYSTEM_INSTRUCTION,
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: geminiReceiptSchema,
                    temperature: 0,
                },
            });

            console.log(`[extract_cea_receipt] Calling Gemini (${modelName}) for structured extraction...`);
            const result = await model.generateContent([
                { inlineData: { data: base64Image, mimeType } },
                { text: "Extrae todos los datos de este recibo de la CEA Querétaro. Revisa cada campo con cuidado y valida las matemáticas." },
            ]);

            const responseText = result.response.text();
            if (!responseText) {
                return { content: [{ type: "text" as const, text: JSON.stringify({
                    success: false,
                    error: "Gemini returned empty response",
                    formatted_response: "No pude leer el recibo. ¿La imagen es clara y muestra el recibo completo?"
                }) }] };
            }

            const extracted = JSON.parse(responseText);

            // 3. Post-extraction math validation
            const warnings: string[] = [];

            // Validate readings: actual - anterior = consumo
            const lectActual = parseFloat(extracted.technical_grid?.lectura_actual);
            const lectAnterior = parseFloat(extracted.technical_grid?.lectura_anterior);
            const consumo = parseFloat(extracted.technical_grid?.consumo_m3);

            if (!isNaN(lectActual) && !isNaN(lectAnterior) && !isNaN(consumo)) {
                const expectedConsumo = lectActual - lectAnterior;
                if (Math.abs(expectedConsumo - consumo) > 0.5) {
                    warnings.push(
                        `Lectura actual (${lectActual}) - anterior (${lectAnterior}) = ${expectedConsumo}, pero consumo reportado = ${consumo}`
                    );
                }
            }

            // Validate totals: periodo + pendientes = total
            const totalPeriodo = extracted.financial_summary?.total_periodo;
            const pendientes = extracted.financial_summary?.facturas_pendientes;
            const totalPagar = extracted.financial_summary?.total_a_pagar;

            if (totalPeriodo != null && pendientes != null && totalPagar != null) {
                const expectedTotal = totalPeriodo + pendientes;
                if (Math.abs(expectedTotal - totalPagar) > 0.01) {
                    warnings.push(
                        `Total periodo ($${totalPeriodo}) + pendientes ($${pendientes}) = $${expectedTotal.toFixed(2)}, pero total a pagar = $${totalPagar}`
                    );
                }
            }

            // Validate sum of concepts ~ total_periodo
            if (Array.isArray(extracted.concepts_table) && totalPeriodo != null) {
                const conceptsSum = extracted.concepts_table.reduce(
                    (sum: number, c: { importe?: number }) => sum + (c.importe || 0), 0
                );
                if (Math.abs(conceptsSum - totalPeriodo) > 1.0) {
                    warnings.push(
                        `Suma de conceptos ($${conceptsSum.toFixed(2)}) difiere del total del periodo ($${totalPeriodo})`
                    );
                }
            }

            // Merge validation results
            if (warnings.length > 0) {
                extracted.validation_warning = true;
                const existingNotes = extracted.audit_notes || "";
                extracted.audit_notes = [existingNotes, "[POST-VALIDATION]", ...warnings]
                    .filter(Boolean).join(" ");
            }

            console.log(`[extract_cea_receipt] Extraction complete. Validation warnings: ${warnings.length}`);

            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: true,
                data: extracted,
                validation_passed: warnings.length === 0,
                formatted_response: warnings.length === 0
                    ? `Recibo extraído correctamente. Contrato: ${extracted.identification?.contrato || "N/A"}, Total: $${extracted.financial_summary?.total_a_pagar || "N/A"}`
                    : `Recibo extraído con ${warnings.length} advertencia(s) de validación. Revisa audit_notes para detalles.`
            }) }] };

        } catch (error) {
            console.error(`[extract_cea_receipt] Error:`, error);
            return { content: [{ type: "text" as const, text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
                formatted_response: "Ocurrió un error al analizar el recibo. ¿Podrías intentar enviar la foto de nuevo?"
            }) }] };
        }
    }
);
