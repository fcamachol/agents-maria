import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import matter from "gray-matter";
import { CategorySchema } from "../types.js";
import type { CategoryCode } from "../types.js";
import type { LoadedSkill, SubcategoryInfo } from "./base.js";
import { buildSystemContext } from "./base.js";

// ── Zod schema for skill frontmatter ──

const SubcategorySchema = z.object({
    code: z.string(),
    name: z.string(),
    group: z.string().optional(),
    repairCode: z.string().optional(),
    defaultPriority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    requiresContract: z.boolean().optional(),
});

const SkillFrontmatterSchema = z.object({
    code: CategorySchema,
    name: z.string(),
    description: z.string(),
    version: z.string(),
    tools: z.array(z.string()),
    subcategories: z.array(SubcategorySchema),
    triggers: z.object({ keywords: z.array(z.string()) }),
    priority: z.string().optional().default("medium"),
    rigid: z.boolean().optional().default(false),
    composes: z.record(z.string(), z.string()).optional().default({}),
});

// ── Resolve skills directory ──

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve skills directory: .md files live in src/skills/ even when running from dist/
function resolveSkillsDir(): string {
    // If running from source (tsx/ts-node), __dirname is already src/skills/
    const candidate = __dirname.endsWith("/skills") ? __dirname : join(__dirname, "skills");
    if (existsSync(join(candidate, "_global"))) return candidate;

    // If running from dist/skills/, resolve to src/skills/
    const projectRoot = join(__dirname, "..", "..");
    const srcSkills = join(projectRoot, "src", "skills");
    if (existsSync(join(srcSkills, "_global"))) return srcSkills;

    // Fallback
    return candidate;
}

const SKILLS_DIR = resolveSkillsDir();

// ── Skill category directories ──

const SKILL_DIRS: Record<CategoryCode, string> = {
    CON: "consultas",
    FAC: "facturacion",
    CTR: "contratos",
    CVN: "convenios",
    REP: "reportes",
    SRV: "servicios",
    CNS: "consumos",
};

// ── SkillLoader class ──

export class SkillLoader {
    private skills = new Map<CategoryCode, LoadedSkill>();
    private globalRules: string = "";
    private classificationPrompt: string = "";

    constructor() {
        this.loadAll();
    }

    /** Load all skills and global files */
    loadAll(): void {
        this.loadGlobals();

        for (const [code, dir] of Object.entries(SKILL_DIRS)) {
            this.loadSkill(code as CategoryCode, dir);
        }

        console.log(`[SkillLoader] Loaded ${this.skills.size} skills`);
    }

    /** Reload one skill or all skills */
    reload(code?: CategoryCode): void {
        if (code) {
            const dir = SKILL_DIRS[code];
            if (dir) {
                this.loadSkill(code, dir);
                console.log(`[SkillLoader] Reloaded skill: ${code}`);
            }
        } else {
            this.skills.clear();
            this.loadAll();
        }
    }

    /** Get a single loaded skill */
    getSkill(code: CategoryCode): LoadedSkill | undefined {
        return this.skills.get(code);
    }

    /** Get all loaded skills */
    getAllSkills(): Map<CategoryCode, LoadedSkill> {
        return this.skills;
    }

    /** Get the raw classification prompt template */
    getClassificationPrompt(): string {
        return this.classificationPrompt;
    }

    /** Build the full system prompt for a specific skill */
    buildSystemPrompt(code: CategoryCode): string | undefined {
        const skill = this.skills.get(code);
        if (!skill) return undefined;

        const sections: string[] = [];

        // 1. System context (date/time)
        sections.push(buildSystemContext());

        // 2. Global rules
        if (this.globalRules) {
            sections.push(this.globalRules);
        }

        // 3. Skill body
        sections.push(skill.systemPrompt);

        // 4. Composition section
        if (Object.keys(skill.composes).length > 0) {
            const composeParts = ["## Composiciones disponibles", ""];
            for (const [key, desc] of Object.entries(skill.composes)) {
                composeParts.push(`- **${key}**: ${desc}`);
            }
            sections.push(composeParts.join("\n"));
        }

        // 5. Examples
        if (skill.examples.length > 0) {
            const exampleParts = ["## Ejemplos de conversacion", ""];
            for (const example of skill.examples) {
                exampleParts.push(example);
                exampleParts.push("---");
            }
            sections.push(exampleParts.join("\n"));
        }

        return sections.join("\n\n");
    }

    /** Get formatted skill descriptions for the classification prompt */
    getSkillDescriptions(): string {
        const lines: string[] = [];
        for (const [code, skill] of this.skills) {
            const subcatList = skill.subcategories.map(s => `${s.code}: ${s.name}`).join(", ");
            lines.push(`- **${code}** (${skill.name}): ${skill.description}`);
            if (subcatList) {
                lines.push(`  Subcategorias: ${subcatList}`);
            }
            if (skill.triggers.keywords.length > 0) {
                lines.push(`  Keywords: ${skill.triggers.keywords.join(", ")}`);
            }
        }
        return lines.join("\n");
    }

    // ── Private methods ──

    private loadGlobals(): void {
        const globalDir = join(SKILLS_DIR, "_global");

        const rulesPath = join(globalDir, "rules.md");
        if (existsSync(rulesPath)) {
            this.globalRules = readFileSync(rulesPath, "utf-8").trim();
        } else {
            console.warn("[SkillLoader] _global/rules.md not found");
            this.globalRules = "";
        }

        const classPath = join(globalDir, "classification.md");
        if (existsSync(classPath)) {
            this.classificationPrompt = readFileSync(classPath, "utf-8").trim();
        } else {
            console.warn("[SkillLoader] _global/classification.md not found");
            this.classificationPrompt = "";
        }
    }

    private loadSkill(code: CategoryCode, dir: string): void {
        const skillDir = join(SKILLS_DIR, dir);
        const skillPath = join(skillDir, "skill.md");

        if (!existsSync(skillPath)) {
            console.warn(`[SkillLoader] Skill file not found: ${skillPath}`);
            return;
        }

        try {
            const raw = readFileSync(skillPath, "utf-8");
            const { data: frontmatter, content } = matter(raw);

            const parsed = SkillFrontmatterSchema.safeParse(frontmatter);
            if (!parsed.success) {
                console.error(`[SkillLoader] Validation failed for ${code}:`, parsed.error.format());
                return;
            }

            const fm = parsed.data;

            // Load examples
            const examples = this.loadExamples(skillDir);

            const loaded: LoadedSkill = {
                code: fm.code,
                name: fm.name,
                description: fm.description,
                version: fm.version,
                priority: fm.priority,
                rigid: fm.rigid,
                triggers: { keywords: fm.triggers.keywords },
                tools: fm.tools,
                composes: fm.composes,
                subcategories: fm.subcategories as SubcategoryInfo[],
                systemPrompt: content.trim(),
                examples,
                lastLoaded: new Date(),
            };

            this.skills.set(code, loaded);
        } catch (err) {
            console.error(`[SkillLoader] Failed to load skill ${code}:`, err);
        }
    }

    private loadExamples(skillDir: string): string[] {
        const examplesDir = join(skillDir, "examples");
        if (!existsSync(examplesDir)) return [];

        try {
            const files = readdirSync(examplesDir)
                .filter(f => f.endsWith(".md"))
                .sort();

            return files.map(f => readFileSync(join(examplesDir, f), "utf-8").trim());
        } catch {
            return [];
        }
    }
}
