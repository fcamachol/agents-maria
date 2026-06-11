// ============================================
// Maria CEA - Persistent Memory System (SQLite)
// ============================================

import Database from "better-sqlite3";
import { logger } from "./logger.js";
import type { CategoryCode } from "../types.js";
import * as fs from "fs";
import * as path from "path";

const DB_PATH = process.env.MEMORY_DB_PATH || "./data/maria_memory.db";
const RETENTION_DAYS = parseInt(process.env.MEMORY_RETENTION_DAYS || "30");

export interface ConversationRow {
    id: string;
    created_at: string;
    updated_at: string;
    last_accessed: string;
    contract_number: string | null;
    category: CategoryCode | null;
    user_name: string | null;
    user_phone: string | null;
    user_email: string | null;
    custom_attributes: string | null;
    message_count: number;
    total_cost_usd: number;
    handoff_occurred: number;
}

export interface MessageRow {
    id: number;
    conversation_id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    tools_used: string | null;
    category: CategoryCode | null;
}

class MemoryStore {
    private db: Database.Database;

    constructor() {
        // Ensure data directory exists
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(DB_PATH);
        this.initializeTables();
        logger.info({ dbPath: DB_PATH }, "Memory store initialized");
    }

    private initializeTables() {
        // Conversations table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
                contract_number TEXT,
                category TEXT,
                user_name TEXT,
                user_phone TEXT,
                user_email TEXT,
                custom_attributes TEXT,
                message_count INTEGER DEFAULT 0,
                total_cost_usd REAL DEFAULT 0,
                handoff_occurred INTEGER DEFAULT 0
            )
        `);

        // Messages table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                tools_used TEXT,
                category TEXT,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )
        `);

        // Create indexes
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_accessed ON conversations(last_accessed)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(user_phone)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_contract ON conversations(contract_number)`);

        // Clean up old conversations
        this.cleanupOldConversations();
    }

    private cleanupOldConversations() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

        const result = this.db.prepare(
            `DELETE FROM conversations WHERE last_accessed < ?`
        ).run(cutoffDate.toISOString());

        if (result.changes > 0) {
            logger.info({ deleted: result.changes, retentionDays: RETENTION_DAYS }, "Cleaned up old conversations");
        }
    }

    /**
     * Get a conversation by ID
     */
    getConversation(id: string): ConversationRow | null {
        const row = this.db.prepare(
            `SELECT * FROM conversations WHERE id = ?`
        ).get(id) as ConversationRow | undefined;

        if (row) {
            // Update last accessed
            this.db.prepare(
                `UPDATE conversations SET last_accessed = CURRENT_TIMESTAMP WHERE id = ?`
            ).run(id);
        }

        return row || null;
    }

    /**
     * Create a new conversation or get existing
     */
    createConversation(
        id: string,
        metadata?: {
            name?: string;
            phone?: string;
            email?: string;
            customAttributes?: Record<string, unknown>;
        }
    ): ConversationRow {
        const existing = this.getConversation(id);
        if (existing) return existing;

        this.db.prepare(`
            INSERT INTO conversations (
                id, user_name, user_phone, user_email, custom_attributes
            ) VALUES (?, ?, ?, ?, ?)
        `).run(
            id,
            metadata?.name || null,
            metadata?.phone || null,
            metadata?.email || null,
            metadata?.customAttributes ? JSON.stringify(metadata.customAttributes) : null
        );

        return this.getConversation(id)!;
    }

    /**
     * Update conversation data
     */
    updateConversation(
        id: string,
        updates: {
            contractNumber?: string;
            category?: CategoryCode;
            handoffOccurred?: boolean;
            costIncrement?: number;
        }
    ) {
        const sets: string[] = [];
        const values: (string | number | null)[] = [];

        if (updates.contractNumber !== undefined) {
            sets.push("contract_number = ?");
            values.push(updates.contractNumber);
        }
        if (updates.category !== undefined) {
            sets.push("category = ?");
            values.push(updates.category);
        }
        if (updates.handoffOccurred !== undefined) {
            sets.push("handoff_occurred = ?");
            values.push(updates.handoffOccurred ? 1 : 0);
        }
        if (updates.costIncrement !== undefined) {
            sets.push("total_cost_usd = total_cost_usd + ?");
            values.push(updates.costIncrement);
        }

        if (sets.length === 0) return;

        sets.push("updated_at = CURRENT_TIMESTAMP");
        values.push(id);

        this.db.prepare(
            `UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`
        ).run(...values);
    }

    /**
     * Add a message to the conversation
     */
    addMessage(
        conversationId: string,
        role: "user" | "assistant",
        content: string,
        metadata?: {
            toolsUsed?: string[];
            category?: CategoryCode;
        }
    ) {
        this.db.prepare(`
            INSERT INTO messages (conversation_id, role, content, tools_used, category)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            conversationId,
            role,
            content,
            metadata?.toolsUsed ? JSON.stringify(metadata.toolsUsed) : null,
            metadata?.category || null
        );

        // Increment message count
        this.db.prepare(`
            UPDATE conversations SET message_count = message_count + 1 WHERE id = ?
        `).run(conversationId);
    }

    /**
     * Get conversation history
     */
    getHistory(
        conversationId: string,
        limit: number = 10
    ): Array<{ role: "user" | "assistant"; content: string; timestamp: string }> {
        const rows = this.db.prepare(`
            SELECT role, content, timestamp
            FROM messages
            WHERE conversation_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(conversationId, limit) as MessageRow[];

        return rows.reverse().map(r => ({
            role: r.role,
            content: r.content,
            timestamp: r.timestamp
        }));
    }

    /**
     * Get conversation statistics
     */
    getStats(): {
        totalConversations: number;
        totalMessages: number;
        avgMessagesPerConversation: number;
        handoffRate: number;
        totalCostUsd: number;
    } {
        const stats = this.db.prepare(`
            SELECT
                COUNT(*) as total_conversations,
                SUM(message_count) as total_messages,
                AVG(message_count) as avg_messages,
                SUM(CASE WHEN handoff_occurred = 1 THEN 1 ELSE 0 END) as handoffs,
                SUM(total_cost_usd) as total_cost
            FROM conversations
        `).get() as {
            total_conversations: number;
            total_messages: number;
            avg_messages: number;
            handoffs: number;
            total_cost: number;
        };

        return {
            totalConversations: stats.total_conversations || 0,
            totalMessages: stats.total_messages || 0,
            avgMessagesPerConversation: Math.round(stats.avg_messages || 0),
            handoffRate: stats.total_conversations > 0
                ? Math.round((stats.handoffs / stats.total_conversations) * 100)
                : 0,
            totalCostUsd: stats.total_cost || 0
        };
    }

    /**
     * Find conversation by phone number
     */
    findByPhone(phone: string): ConversationRow | null {
        const row = this.db.prepare(
            `SELECT * FROM conversations WHERE user_phone = ? ORDER BY last_accessed DESC LIMIT 1`
        ).get(phone) as ConversationRow | undefined;

        return row || null;
    }

    /**
     * Find conversation by contract number
     */
    findByContract(contractNumber: string): ConversationRow | null {
        const row = this.db.prepare(
            `SELECT * FROM conversations WHERE contract_number = ? ORDER BY last_accessed DESC LIMIT 1`
        ).get(contractNumber) as ConversationRow | undefined;

        return row || null;
    }

    close() {
        this.db.close();
        logger.info("Memory store closed");
    }
}

// Singleton instance
let memoryStore: MemoryStore | null = null;

export function getMemoryStore(): MemoryStore {
    if (!memoryStore) {
        memoryStore = new MemoryStore();
    }
    return memoryStore;
}

export function closeMemoryStore() {
    if (memoryStore) {
        memoryStore.close();
        memoryStore = null;
    }
}
