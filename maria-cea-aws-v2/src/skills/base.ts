// ============================================
// Maria Claude - Base Skill Definition
// ============================================

import type { CategoryCode, SubcategoryCode } from "../types.js";

/**
 * Skill interface for AGORA-mapped agent skills
 * Each skill corresponds to one AGORA category
 */
export interface Skill {
    /** AGORA category code */
    code: CategoryCode;

    /** Human-readable skill name */
    name: string;

    /** Description for classification */
    description: string;

    /** System prompt for the agent when using this skill */
    systemPrompt: string;

    /** List of tool names this skill can use */
    tools: string[];

    /** Subcategories this skill handles */
    subcategories: SubcategoryInfo[];

    /** Default priority for tickets created by this skill */
    defaultPriority?: "low" | "medium" | "high" | "urgent";
}

export interface SubcategoryInfo {
    code: SubcategoryCode;
    name: string;
    group?: string;
    repairCode?: string;
    defaultPriority?: "low" | "medium" | "high" | "urgent";
}

/**
 * Helper to create a skill with type safety
 */
export function createSkill(config: Skill): Skill {
    return config;
}

/**
 * Build context with current date/time for Mexico
 */
export function buildSystemContext(): string {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
    const dateStr = now.toLocaleDateString('es-MX', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    return `[Fecha: ${dateStr}, Hora: ${timeStr} (hora de Querétaro)]`;
}
