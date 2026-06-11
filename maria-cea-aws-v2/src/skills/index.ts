// ============================================
// Maria Claude - Skills Registry
// ============================================

export type { Skill, SubcategoryInfo } from "./base.js";
export { createSkill, buildSystemContext } from "./base.js";

// Import all skills
export { consultasSkill } from "./consultas.js";
export { facturacionSkill } from "./facturacion.js";
export { contratosSkill } from "./contratos.js";
export { conveniosSkill } from "./convenios.js";
export { reportesSkill } from "./reportes.js";
export { serviciosSkill } from "./servicios.js";
export { consumosSkill } from "./consumos.js";

// Re-export for convenience
import { consultasSkill } from "./consultas.js";
import { facturacionSkill } from "./facturacion.js";
import { contratosSkill } from "./contratos.js";
import { conveniosSkill } from "./convenios.js";
import { reportesSkill } from "./reportes.js";
import { serviciosSkill } from "./servicios.js";
import { consumosSkill } from "./consumos.js";
import type { Skill } from "./base.js";
import type { CategoryCode } from "../types.js";

/**
 * Registry of all skills mapped by AGORA category code
 */
export const SKILL_REGISTRY: Record<CategoryCode, Skill> = {
    CON: consultasSkill,
    FAC: facturacionSkill,
    CTR: contratosSkill,
    CVN: conveniosSkill,
    REP: reportesSkill,
    SRV: serviciosSkill,
    CNS: consumosSkill
};

/**
 * Get a skill by category code
 */
export function getSkill(code: CategoryCode): Skill {
    return SKILL_REGISTRY[code];
}

/**
 * Get all skills as an array
 */
export function getAllSkills(): Skill[] {
    return Object.values(SKILL_REGISTRY);
}

/**
 * Get skill descriptions for classification
 */
export function getSkillDescriptions(): string {
    return getAllSkills()
        .map(skill => `- ${skill.code} (${skill.name}): ${skill.description}`)
        .join('\n');
}
