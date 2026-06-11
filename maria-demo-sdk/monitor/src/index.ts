// ============================================
// Maria Monitor - Express Server
// Tails maria-cea-sdk logs and serves real-time dashboard
// ============================================

import express from 'express';
import { createReadStream, statSync, watchFile, unwatchFile } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { MonitorStepEvent } from './types.js';
import { LogParser } from './log-parser.js';
import { SessionStore } from './session-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3100');
const LOG_FILE = process.env.LOG_FILE || '../logs/output.log';
const MONITOR_TOKEN = process.env.MONITOR_TOKEN || '';

// Resolve log file path relative to project root (one level up from dist/)
const logFilePath = path.resolve(__dirname, '..', LOG_FILE);

// ============================================
// Session Store
// ============================================

const store = new SessionStore();

// ============================================
// Log Parser
// ============================================

const parser = new LogParser((event: MonitorStepEvent) => {
  store.addEvent(event);
});

// ============================================
// Log File Tailing
// ============================================

let fileOffset = 0;

function readNewLines(): void {
  try {
    const stats = statSync(logFilePath);

    // Handle log rotation (file got smaller)
    if (stats.size < fileOffset) {
      console.log('[Monitor] Log file rotated, resetting offset');
      fileOffset = 0;
    }

    if (stats.size === fileOffset) return;

    const stream = createReadStream(logFilePath, {
      start: fileOffset,
      encoding: 'utf-8',
    });

    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      parser.parseLine(line);
    });

    rl.on('close', () => {
      fileOffset = stats.size;
    });

    rl.on('error', (err) => {
      console.error('[Monitor] Error reading log file:', err.message);
    });
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist yet, wait for it
      return;
    }
    console.error('[Monitor] Error tailing log:', err);
  }
}

function startTailing(): void {
  console.log(`[Monitor] Tailing log file: ${logFilePath}`);

  // Backfill: read last ~100KB of existing log for recent sessions
  try {
    const stats = statSync(logFilePath);
    const backfillSize = Math.min(stats.size, 100 * 1024);
    fileOffset = Math.max(0, stats.size - backfillSize);

    if (backfillSize > 0) {
      console.log(`[Monitor] Backfilling last ${(backfillSize / 1024).toFixed(0)}KB of logs`);
      readNewLines();
    }
  } catch {
    console.log('[Monitor] Log file not found yet, will watch for creation');
    fileOffset = 0;
  }

  // Watch for file changes (poll every 1 second)
  watchFile(logFilePath, { interval: 1000 }, () => {
    readNewLines();
  });
}

// ============================================
// Auth Middleware
// ============================================

function authCheck(req: Request, res: Response): boolean {
  if (!MONITOR_TOKEN) return true;
  const token = req.query.token as string;
  if (token === MONITOR_TOKEN) return true;
  res.status(403).json({ error: 'Invalid or missing token' });
  return false;
}

// ============================================
// Express App
// ============================================

const app = express();

// Request logging
app.use((req, _res, next) => {
  if (req.path !== '/health') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ============================================
// Health Check
// ============================================

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    sessions: store.getSessions().length,
    activeSessions: store.getActiveSessions().length,
  });
});

// ============================================
// SSE Stream
// ============================================

app.get('/api/stream', (req: Request, res: Response) => {
  if (!authCheck(req, res)) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const conversationFilter = req.query.conversation_id as string | undefined;

  // Send initial snapshot
  const activeSessions = store.getActiveSessions();
  if (activeSessions.length > 0) {
    res.write(`data: ${JSON.stringify({
      step: 'snapshot',
      conversation_id: '_system',
      agent_id: 'monitor',
      data: { sessions: activeSessions },
      timestamp: new Date().toISOString(),
    })}\n\n`);
  }

  // Subscribe to new events
  const onStep = (event: MonitorStepEvent) => {
    if (conversationFilter && event.conversation_id !== conversationFilter) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      // Client disconnected
    }
  };

  store.on('step', onStep);

  // Keepalive every 30s
  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepalive);
    }
  }, 30000);

  // Cleanup on disconnect
  req.on('close', () => {
    store.off('step', onStep);
    clearInterval(keepalive);
  });
});

// ============================================
// REST Endpoints
// ============================================

app.get('/api/sessions', (req: Request, res: Response) => {
  if (!authCheck(req, res)) return;
  const sessions = store.getSessions();
  // Return lightweight list (without full step arrays)
  res.json(sessions.map(s => ({
    conversationId: s.conversationId,
    chatwootConversationId: s.chatwootConversationId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    status: s.status,
    toolsUsed: s.toolsUsed,
    totalCostUsd: s.totalCostUsd,
    durationMs: s.durationMs,
    userMessage: s.userMessage,
    stepCount: s.steps.length,
  })));
});

app.get('/api/sessions/:id', (req: Request, res: Response) => {
  if (!authCheck(req, res)) return;
  const session = store.getSession(req.params.id as string);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json(session);
});

// ============================================
// Static Dashboard
// ============================================

const publicDir = path.resolve(__dirname, '../public');
app.use('/monitor', express.static(publicDir));
app.get('/', (_req, res) => res.redirect('/monitor/monitor.html'));

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`
+--------------------------------------------------+
|  Maria Monitor - Real-Time Session Dashboard      |
|                                                    |
|  Server:    http://localhost:${PORT}                  |
|  Dashboard: http://localhost:${PORT}/monitor          |
|  SSE:       http://localhost:${PORT}/api/stream       |
|  Sessions:  http://localhost:${PORT}/api/sessions     |
|                                                    |
|  Tailing:   ${logFilePath}  |
|  Auth:      ${MONITOR_TOKEN ? 'Enabled' : 'Disabled'}                               |
+--------------------------------------------------+
`);

  startTailing();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Monitor] Shutting down...');
  unwatchFile(logFilePath);
  process.exit(0);
});

process.on('SIGTERM', () => {
  unwatchFile(logFilePath);
  process.exit(0);
});
