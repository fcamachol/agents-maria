// ============================================
// Centralized Configuration - All env vars validated at startup
// ============================================

import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
    // Required
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),

    // Server
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // Models - configurable per environment
    CLASSIFIER_MODEL: z.string().default("gpt-4.1-mini"),
    SPECIALIST_MODEL: z.string().default("gpt-4.1"),
    INFO_MODEL: z.string().default("gpt-4.1-mini"),

    // CEA SOAP API
    CEA_API_BASE: z.string().url().default("https://aquacis-cf-int.ceaqueretaro.gob.mx/Comercial/services"),
    CEA_SOAP_USERNAME: z.string().default("WSGESTIONDEUDA"),
    CEA_SOAP_PASSWORD: z.string().default("WSGESTIONDEUDA"),
    CEA_PROXY_URL: z.string().optional(),

    // PostgreSQL
    PGHOST: z.string().default("localhost"),
    PGPORT: z.coerce.number().default(5432),
    PGUSER: z.string().default("postgres"),
    PGPASSWORD: z.string().default(""),
    PGDATABASE: z.string().default("agora_production"),
    PGPOOL_MAX: z.coerce.number().min(1).max(50).default(10),

    // Chatwoot
    CHATWOOT_ACCOUNT_ID: z.coerce.number().default(2),

    // Conversation store
    CONVERSATION_TTL_MS: z.coerce.number().default(3_600_000),     // 1 hour
    CONVERSATION_CLEANUP_MS: z.coerce.number().default(300_000),   // 5 min
    MAX_HISTORY_MESSAGES: z.coerce.number().default(20),

    // Security
    API_KEY: z.string().optional(),
    ALLOWED_ORIGINS: z.string().default(""),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),      // 1 min
    RATE_LIMIT_MAX: z.coerce.number().default(30),

    // HTTP
    MAX_RETRIES: z.coerce.number().default(3),
    RETRY_BASE_DELAY_MS: z.coerce.number().default(1000),
    REQUEST_TIMEOUT_MS: z.coerce.number().default(30_000),
    MAX_PAYLOAD_SIZE: z.string().default("100kb"),

    // Logging
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("Invalid environment configuration:");
    for (const issue of parsed.error.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
}

export const cfg = parsed.data;
