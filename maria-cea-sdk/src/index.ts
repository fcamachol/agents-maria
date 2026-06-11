// ============================================
// Maria CEA SDK - Main Entry Point
// ============================================

import { config } from "dotenv";
config();

// Re-export for programmatic usage
export { runWorkflow, getAgentHealth } from "./agent.js";
export * from "./types.js";

// Start server if running directly
import "./server.js";
