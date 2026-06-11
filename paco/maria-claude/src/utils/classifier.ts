// ============================================
// Maria CEA - LLM-Based Intent Classifier
// ============================================

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CategoryCode } from "../types.js";
import { AGORA_CATEGORIES } from "../types.js";
import { logger } from "./logger.js";

// Classification result type
export interface ClassificationResult {
    category: CategoryCode;
    subcategory?: string;
    confidence: number;
    extractedContract?: string;
    intent: string;
    reasoning?: string;
}

// Simple keyword fallback for quick classification
const KEYWORD_PATTERNS: Record<CategoryCode, RegExp[]> = {
    REP: [
        /\b(fuga|no hay agua|agua turbia|drenaje|no tengo agua|inundaci[oó]n|falta de agua|baja presi[oó]n|olor|sabor|medidor roto)\b/i,
        /\b(tapa de registro|hundimiento|alcantarilla|pozo de visita)\b/i
    ],
    FAC: [
        /\b(recibo|factura|aclaraci[oó]n|ajuste|cobro|pagar|pago|devoluci[oó]n|multa|no adeudo)\b/i,
        /\b(cu[aá]nto debo|saldo|adeudo|historial de pagos)\b/i
    ],
    CTR: [
        /\b(contrato|titular|baja|alta|cambio de nombre|nueva toma|domiciliaci[oó]n)\b/i,
        /\b(fraccionamiento|condominio|datos fiscales|rfc)\b/i
    ],
    CVN: [
        /\b(convenio|plan de pago|pensionado|jubilado|tercera edad|discapacidad|pr[oó]rroga)\b/i,
        /\b(no puedo pagar|pagos parciales|descuento|apoyo)\b/i
    ],
    SRV: [
        /\b(medidor|lectura|reconexi[oó]n|instalaci[oó]n|relocalizaci[oó]n|reposici[oó]n)\b/i,
        /\b(revisi[oó]n t[eé]cnica|fuga no visible|instalaci[oó]n de)\b/i
    ],
    CNS: [
        /\b(consumo|historial de consumo|cu[aá]nta agua|metros c[uú]bicos|gasto de agua)\b/i,
        /\b(lectura del medidor|promedio de consumo|tendencia)\b/i
    ],
    CON: [
        /\b(hola|buenos d[ií]as|buenas tardes|buenas noches|informaci[oó]n|horario|oficina)\b/i,
        /\b(estado de mi ticket|seguimiento|ticket|folio|qu[eé] puedes hacer)\b/i
    ]
};

// Pattern to extract contract number
const CONTRACT_PATTERN = /\b(\d{6,10})\b/g;

/**
 * LLM-based classifier for accurate intent classification
 */
export async function classifyWithLLM(
    input: string,
    conversationHistory: string[] = []
): Promise<ClassificationResult> {
    const startTime = Date.now();

    const categoriesDescription = Object.values(AGORA_CATEGORIES)
        .map(c => `- ${c.code}: ${c.name} - ${c.description}`)
        .join("\n");

    const prompt = `Eres un clasificador de intenciones experto para el sistema AGORA de CEA Queretaro (Comision Estatal de Aguas).

CATEGORIAS DISPONIBLES:
${categoriesDescription}

INSTRUCCIONES DE CLASIFICACION:

1. CON (Consultas): Saludos, preguntas generales, consulta de saldo, horarios, estatus de tickets
   - "Hola", "Cuanto debo?", "Cual es el horario?", "Estado de mi ticket?"

2. FAC (Facturacion): Todo relacionado con recibos, pagos, aclaraciones, ajustes, devoluciones
   - "Quiero mi recibo", "No entiendo mi recibo", "Aclaracion de cobro", "Carta de no adeudo"

3. CTR (Contratos): Altas, bajas, cambios de titular, modificaciones contractuales
   - "Quiero un contrato nuevo", "Cambio de nombre", "Dar de baja", "Cambio de tarifa"

4. CVN (Convenios): Convenios de pago, programas de apoyo para pensionados, tercera edad, discapacidad
   - "Plan de pagos", "No puedo pagar todo", "Soy pensionado", "Descuento por tercera edad"

5. REP (Reportes de Servicio): Fugas, falta de agua, drenaje, calidad del agua, infraestructura danada
   - "Hay una fuga", "No tengo agua", "Agua turbia", "Drenaje tapado", "Tapa de registro rota"

6. SRV (Servicios Tecnicos): Medidores, lecturas, instalaciones, revisiones tecnicas
   - "Medidor danado", "Reportar lectura", "Reconexion", "Instalacion de alcantarillado"

7. CNS (Consumos): Historial de consumo de agua, lecturas, tendencias
   - "Ver mi consumo", "Historial de consumo", "Cuanta agua gaste?"

REGLAS IMPORTANTES:
- "No tengo agua" -> REP (es un reporte de servicio)
- "Carta de no adeudo" -> FAC (es facturacion, no contrato)
- "Cuanto debo" -> CON (es consulta de saldo)
- Prioriza la intencion principal del usuario

HISTORIAL DE CONVERSACION:
${conversationHistory.slice(-3).join("\n")}

MENSAJE DEL USUARIO: "${input}"

Responde UNICAMENTE con un JSON valido en este formato exacto:
{
  "category": "CODIGO_DE_CATEGORIA",
  "subcategory": "codigo de subcategoria si aplica o null",
  "confidence": 0.95,
  "extractedContract": "numero de contrato si se detecta o null",
  "intent": "descripcion breve de la intencion",
  "reasoning": "explicacion corta de por que elegiste esta categoria"
}`;

    try {
        const result = query({
            prompt,
            options: {
                model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929",
                maxBudgetUsd: 0.05, // Very cheap for classification
                permissionMode: "bypassPermissions",
                allowDangerouslySkipPermissions: true,
                persistSession: false,
                tools: [],
                cwd: process.cwd(),
                env: process.env
            }
        });

        let responseText = "";
        let totalCost = 0;

        for await (const message of result) {
            if (message.type === "assistant") {
                const content = message.message.content;
                if (Array.isArray(content)) {
                    for (const block of content) {
                        if (block.type === "text") {
                            responseText += block.text;
                        }
                    }
                } else if (typeof content === "string") {
                    responseText += content;
                }
            } else if (message.type === "result") {
                totalCost = message.total_cost_usd;
            }
        }

        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("No JSON found in classification response");
        }

        const parsed = JSON.parse(jsonMatch[0]);

        const classification: ClassificationResult = {
            category: parsed.category as CategoryCode,
            subcategory: parsed.subcategory || undefined,
            confidence: parsed.confidence || 0.5,
            extractedContract: parsed.extractedContract || extractContractNumber(input),
            intent: parsed.intent || "unknown",
            reasoning: parsed.reasoning || ""
        };

        const processingTime = Date.now() - startTime;

        logger.debug({
            classification,
            processingTimeMs: processingTime,
            costUsd: totalCost
        }, "LLM classification completed");

        return classification;

    } catch (error) {
        logger.warn({ error, input: input.slice(0, 100) }, "LLM classification failed, using fallback");
        return classifyWithFallback(input);
    }
}

/**
 * Fast keyword-based fallback classifier
 */
export function classifyWithFallback(input: string): ClassificationResult {
    const inputLower = input.toLowerCase();

    // Score each category
    const scores: Record<CategoryCode, number> = {
        CON: 0, FAC: 0, CTR: 0, CVN: 0, REP: 0, SRV: 0, CNS: 0
    };

    for (const [category, patterns] of Object.entries(KEYWORD_PATTERNS)) {
        for (const pattern of patterns) {
            const matches = inputLower.match(pattern);
            if (matches) {
                scores[category as CategoryCode] += matches.length;
            }
        }
    }

    // Find highest score
    let bestCategory: CategoryCode = "CON";
    let maxScore = 0;

    for (const [category, score] of Object.entries(scores)) {
        if (score > maxScore) {
            maxScore = score;
            bestCategory = category as CategoryCode;
        }
    }

    // Calculate confidence based on score difference
    const sortedScores = Object.values(scores).sort((a, b) => b - a);
    const confidence = maxScore > 0
        ? Math.min(0.95, 0.5 + (maxScore - (sortedScores[1] || 0)) * 0.1)
        : 0.5;

    return {
        category: bestCategory,
        confidence,
        extractedContract: extractContractNumber(input),
        intent: "detected by keyword fallback",
        reasoning: `Keyword matching: ${maxScore} matches for ${bestCategory}`
    };
}

/**
 * Extract contract number from input
 */
export function extractContractNumber(input: string): string | undefined {
    const matches = input.match(CONTRACT_PATTERN);
    return matches ? matches[0] : undefined;
}

/**
 * Main classification function - tries LLM first, falls back to keywords
 */
export async function classifyIntent(
    input: string,
    conversationHistory: string[] = [],
    useLLM: boolean = true
): Promise<ClassificationResult> {
    if (useLLM) {
        return await classifyWithLLM(input, conversationHistory);
    }
    return classifyWithFallback(input);
}
