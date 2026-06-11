// ============================================
// Maria CEA - Metrics and Observability
// ============================================

import { logger } from "./logger.js";
import type { CategoryCode } from "../types.js";

interface ConversationMetric {
    conversationId: string;
    startTime: number;
    messageCount: number;
    toolsUsed: Set<string>;
    totalCostUsd: number;
    classification?: CategoryCode;
    errors: string[];
    handoffOccurred: boolean;
}

class MetricsCollector {
    private conversations: Map<string, ConversationMetric> = new Map();
    private totalRequests: number = 0;
    private totalErrors: number = 0;
    private classificationDistribution: Map<CategoryCode, number> = new Map();
    private toolUsage: Map<string, number> = new Map();
    private responseTimes: number[] = [];

    startConversation(conversationId: string): ConversationMetric {
        const metric: ConversationMetric = {
            conversationId,
            startTime: Date.now(),
            messageCount: 0,
            toolsUsed: new Set(),
            totalCostUsd: 0,
            errors: [],
            handoffOccurred: false
        };
        this.conversations.set(conversationId, metric);
        this.totalRequests++;
        return metric;
    }

    recordMessage(
        conversationId: string,
        data: {
            toolsUsed?: string[];
            costUsd?: number;
            classification?: CategoryCode;
            responseTimeMs?: number;
            error?: string;
        }
    ) {
        let metric = this.conversations.get(conversationId);
        if (!metric) {
            metric = this.startConversation(conversationId);
        }

        metric.messageCount++;

        if (data.toolsUsed) {
            for (const tool of data.toolsUsed) {
                metric.toolsUsed.add(tool);
                this.toolUsage.set(tool, (this.toolUsage.get(tool) || 0) + 1);
            }
        }

        if (data.costUsd) {
            metric.totalCostUsd += data.costUsd;
        }

        if (data.classification) {
            metric.classification = data.classification;
            this.classificationDistribution.set(
                data.classification,
                (this.classificationDistribution.get(data.classification) || 0) + 1
            );
        }

        if (data.responseTimeMs) {
            this.responseTimes.push(data.responseTimeMs);
            // Keep only last 1000 response times
            if (this.responseTimes.length > 1000) {
                this.responseTimes.shift();
            }
        }

        if (data.error) {
            metric.errors.push(data.error);
            this.totalErrors++;
        }
    }

    recordHandoff(conversationId: string) {
        const metric = this.conversations.get(conversationId);
        if (metric) {
            metric.handoffOccurred = true;
        }
    }

    getConversationMetrics(conversationId: string): ConversationMetric | null {
        return this.conversations.get(conversationId) || null;
    }

    getSystemMetrics() {
        const avgResponseTime = this.responseTimes.length > 0
            ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
            : 0;

        const totalCost = Array.from(this.conversations.values())
            .reduce((sum, m) => sum + m.totalCostUsd, 0);

        const handoffCount = Array.from(this.conversations.values())
            .filter(m => m.handoffOccurred).length;

        return {
            totalConversations: this.conversations.size,
            totalRequests: this.totalRequests,
            totalErrors: this.totalErrors,
            errorRate: this.totalRequests > 0
                ? Math.round((this.totalErrors / this.totalRequests) * 100) / 100
                : 0,
            totalCostUsd: Math.round(totalCost * 100) / 100,
            averageResponseTimeMs: Math.round(avgResponseTime),
            handoffCount,
            handoffRate: this.conversations.size > 0
                ? Math.round((handoffCount / this.conversations.size) * 100)
                : 0,
            classificationDistribution: Object.fromEntries(this.classificationDistribution),
            toolUsage: Object.fromEntries(this.toolUsage)
        };
    }

    getHealthStatus(): {
        status: "healthy" | "degraded" | "unhealthy";
        checks: Record<string, boolean>;
    } {
        const errorRate = this.totalRequests > 0
            ? (this.totalErrors / this.totalRequests)
            : 0;

        const avgResponseTime = this.responseTimes.length > 0
            ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
            : 0;

        const checks = {
            errorRateAcceptable: errorRate < 0.1, // Less than 10% errors
            responseTimeAcceptable: this.responseTimes.length === 0 || avgResponseTime < 10000 // Less than 10s avg
        };

        const allHealthy = Object.values(checks).every(v => v);
        const anyHealthy = Object.values(checks).some(v => v);

        return {
            status: allHealthy ? "healthy" : anyHealthy ? "degraded" : "unhealthy",
            checks
        };
    }

    /**
     * Get Prometheus-format metrics
     */
    getPrometheusMetrics(): string {
        const systemMetrics = this.getSystemMetrics();
        const lines: string[] = [];

        lines.push(`# HELP maria_conversations_total Total number of conversations`);
        lines.push(`# TYPE maria_conversations_total counter`);
        lines.push(`maria_conversations_total ${systemMetrics.totalConversations}`);

        lines.push(`# HELP maria_requests_total Total number of requests`);
        lines.push(`# TYPE maria_requests_total counter`);
        lines.push(`maria_requests_total ${systemMetrics.totalRequests}`);

        lines.push(`# HELP maria_errors_total Total number of errors`);
        lines.push(`# TYPE maria_errors_total counter`);
        lines.push(`maria_errors_total ${systemMetrics.totalErrors}`);

        lines.push(`# HELP maria_error_rate Current error rate`);
        lines.push(`# TYPE maria_error_rate gauge`);
        lines.push(`maria_error_rate ${systemMetrics.errorRate}`);

        lines.push(`# HELP maria_cost_usd_total Total cost in USD`);
        lines.push(`# TYPE maria_cost_usd_total counter`);
        lines.push(`maria_cost_usd_total ${systemMetrics.totalCostUsd}`);

        lines.push(`# HELP maria_average_response_time_ms Average response time in milliseconds`);
        lines.push(`# TYPE maria_average_response_time_ms gauge`);
        lines.push(`maria_average_response_time_ms ${systemMetrics.averageResponseTimeMs}`);

        lines.push(`# HELP maria_handoff_total Total handoffs to human`);
        lines.push(`# TYPE maria_handoff_total counter`);
        lines.push(`maria_handoff_total ${systemMetrics.handoffCount}`);

        // Classification distribution
        lines.push(`# HELP maria_classification_total Total classifications by category`);
        lines.push(`# TYPE maria_classification_total counter`);
        for (const [category, count] of Object.entries(systemMetrics.classificationDistribution)) {
            lines.push(`maria_classification_total{category="${category}"} ${count}`);
        }

        // Tool usage
        lines.push(`# HELP maria_tool_usage_total Total tool usage by tool name`);
        lines.push(`# TYPE maria_tool_usage_total counter`);
        for (const [tool, count] of Object.entries(systemMetrics.toolUsage)) {
            lines.push(`maria_tool_usage_total{tool="${tool}"} ${count}`);
        }

        return lines.join("\n");
    }

    reset() {
        this.conversations.clear();
        this.totalRequests = 0;
        this.totalErrors = 0;
        this.classificationDistribution.clear();
        this.toolUsage.clear();
        this.responseTimes = [];
        logger.info("Metrics reset");
    }
}

// Singleton instance
export const metrics = new MetricsCollector();

/**
 * Performance measurement helper
 */
export async function measurePerformance<T>(
    operation: string,
    fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
    const start = performance.now();
    try {
        const result = await fn();
        const durationMs = Math.round(performance.now() - start);
        logger.debug({ operation, durationMs }, "Operation completed");
        return { result, durationMs };
    } catch (error) {
        const durationMs = Math.round(performance.now() - start);
        logger.error({ operation, durationMs, error }, "Operation failed");
        throw error;
    }
}
