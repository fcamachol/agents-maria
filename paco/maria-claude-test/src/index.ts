// ============================================
// Maria Claude - Main Entry Point
// ============================================

import { config } from "dotenv";
config();

import { logger } from "./utils/logger.js";

// Re-export for programmatic usage
export { runWorkflow, getAgentHealth } from "./agent.js";
export { SKILL_REGISTRY, getSkill, getAllSkills } from "./skills/index.js";
export * from "./types.js";

// Banner
console.log(`
╔═══════════════════════════════════════════════╗
║            MARIA CLAUDE                         ║
║    CEA Queretaro - AI Customer Service          ║
║                                                 ║
║  Claude Agent SDK + AGORA Skills                ║
║  Full business logic + production utils         ║
╚═══════════════════════════════════════════════╝
`);

logger.info({
    nodeVersion: process.version,
    platform: process.platform,
    env: process.env.NODE_ENV || "development"
}, "Starting Maria Claude");

// Start server
import "./server.js";
