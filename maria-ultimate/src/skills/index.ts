export type { SubcategoryInfo, LoadedSkill } from "./base.js";
export { buildSystemContext } from "./base.js";
export { SkillLoader } from "./loader.js";

import type { CategoryCode } from "../types.js";
import { SkillLoader } from "./loader.js";

// Singleton instance - loadAll() is called in the constructor
const loader = new SkillLoader();

export function getSkill(code: CategoryCode) {
    return loader.getSkill(code);
}

export function getAllSkills() {
    return loader.getAllSkills();
}

export function getSkillDescriptions() {
    return loader.getSkillDescriptions();
}

export function getClassificationPrompt() {
    return loader.getClassificationPrompt();
}

export function buildSystemPrompt(code: CategoryCode) {
    return loader.buildSystemPrompt(code);
}

export function reloadSkills(code?: CategoryCode) {
    loader.reload(code);
}

export { loader };
