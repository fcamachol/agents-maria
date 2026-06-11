import type { CategoryCode, SubcategoryCode } from "../types.js";

export interface SubcategoryInfo {
    code: SubcategoryCode;
    name: string;
    group?: string;
    repairCode?: string;
    defaultPriority?: "low" | "medium" | "high" | "urgent";
    requiresContract?: boolean;
}

export interface LoadedSkill {
    code: CategoryCode;
    name: string;
    description: string;
    version: string;
    priority: string;
    rigid: boolean;
    triggers: { keywords: string[] };
    tools: string[];
    composes: Record<string, string>;
    subcategories: SubcategoryInfo[];
    systemPrompt: string;
    examples: string[];
    lastLoaded: Date;
}

export function buildSystemContext(): string {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
    const dateStr = now.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    return `[Fecha: ${dateStr}, Hora: ${timeStr} (hora de Queretaro)]`;
}
