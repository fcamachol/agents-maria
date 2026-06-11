// ============================================
// Maria Claude - Main Entry Point
// ============================================

import { config } from "dotenv";
config();

// Re-export for programmatic usage
export { runWorkflow, getAgentHealth } from "./agent.js";
export { SKILL_REGISTRY, getSkill, getAllSkills } from "./skills/index.js";
export * from "./types.js";

// Start server if running directly
import "./server.js";
