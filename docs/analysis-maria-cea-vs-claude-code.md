# Maria-CEA-SDK Agent Analysis & Claude Code Comparison

## 1. Maria-CEA-SDK Architecture Overview

The maria-CEA-sdk is a production multi-agent system for CEA Querétaro (water utility) built on the **OpenAI Agents SDK** with Express.js. It uses a **classification-first routing** pattern across 7 specialized agents.

### Core Architecture

```
┌─────────────────────────────────────────────────┐
│                  Express Server                  │
│           POST /api/chat  ·  /webhook            │
└─────────────────┬───────────────────────────────┘
                  │
     ┌────────────▼────────────────┐
     │   Classification Agent       │
     │   (gpt-4.1-mini, temp=0.3)  │
     │   → Zod schema output        │
     └────────────┬────────────────┘
                  │ routes by intent
     ┌────────────┼──────────────────────────────┐
     │            │            │          │       │
  ┌──▼──┐  ┌─────▼──┐  ┌─────▼──┐  ┌────▼─┐  ┌─▼──────┐
  │Fugas│  │ Pagos  │  │Consumos│  │Ticket│  │Info    │
  │Agent│  │ Agent  │  │ Agent  │  │Agent │  │Agent   │
  └──┬──┘  └────┬───┘  └────┬───┘  └──┬───┘  └────────┘
     │          │           │         │
     └──────────┴───────────┴─────────┘
                │
     ┌──────────▼─────────────────────┐
     │     Native Tools Layer          │
     │  get_deuda · get_consumo        │
     │  create_ticket · search_customer│
     │  (SOAP→JSON, Supabase, PG)      │
     └────────────────────────────────┘
```

### Key Design Decisions

| Decision | Implementation | Rationale |
|----------|---------------|-----------|
| Native tools over MCP | Direct SOAP/REST calls with retry | Production reliability |
| In-memory conversation store | Map with 1h TTL, 20-msg limit | Speed; Redis for production |
| Classification-first | Dedicated agent routes before exec | Lower latency, targeted prompts |
| Zod schema validation | Structured output enforcement | Type safety for routing |
| Selective tool assignment | Each agent only sees relevant tools | Reduces hallucination |

### File Structure

```
src/
├── server.ts        # Express HTTP server, middleware, endpoints
├── agent.ts         # 7 agents + classification + workflow orchestration
├── tools.ts         # Native tool implementations (SOAP, Supabase, PG)
├── types.ts         # TypeScript interfaces (ChatRequest, Classification, etc.)
└── context.ts       # Chatwoot AsyncLocalStorage context propagation
```

---

## 2. Claude Code Architecture (Reference: yasasbanukaofficial/claude-code)

Claude Code is a **TypeScript CLI agent** that provides an interactive terminal experience for software engineering tasks. Based on the public skeleton:

### Core Architecture

```
┌─────────────────────────────────────────────────┐
│              Terminal UI (Ink/React)              │
│         Interactive REPL + Streaming             │
└─────────────────┬───────────────────────────────┘
                  │
     ┌────────────▼────────────────┐
     │      Main Agent Loop         │
     │  (Claude API + tool calling) │
     │  • System prompt injection   │
     │  • Context management        │
     │  • Permission model          │
     └────────────┬────────────────┘
                  │ tool calls
     ┌────────────┼─────────────────────┐
     │            │           │         │
  ┌──▼──┐  ┌─────▼──┐  ┌────▼───┐  ┌──▼────┐
  │Read │  │ Edit   │  │ Bash   │  │Search │
  │File │  │ File   │  │Execute │  │Grep   │
  └─────┘  └────────┘  └────────┘  └───────┘
     │            │           │         │
     └────────────┴───────────┴─────────┘
                  │
     ┌────────────▼───────────────────┐
     │   Sub-Agent System              │
     │  • Explore agent (codebase)     │
     │  • Plan agent (architecture)    │
     │  • General-purpose agent        │
     │  • Parallel agent execution     │
     └────────────────────────────────┘
```

### Key Patterns

| Pattern | Claude Code | Maria-CEA-SDK |
|---------|-------------|---------------|
| Agent model | Single main agent + sub-agents | Classifier → specialist agents |
| Tool system | Built-in tools (Read, Edit, Bash, Grep, Glob) | Native SOAP/REST tools |
| Context | Conversation compression + system reminders | In-memory Map with TTL |
| Permissions | User-approval model per tool | No permission layer (server-to-server) |
| Sub-agents | Dynamic spawning via Agent tool | Static agent map from classification |
| Streaming | Token-by-token streaming to terminal | Request/response HTTP |

---

## 3. Structural Comparison

### 3.1 Agent Orchestration

**Claude Code**: Single-loop agent with dynamic sub-agent spawning. The main agent decides when to delegate. Sub-agents run in isolated contexts with their own tool access.

```
Main Agent → decides to spawn → Sub-Agent (Explore)
                               → Sub-Agent (Plan)
                               → Sub-Agent (General)
           → all run in parallel when independent
```

**Maria-CEA-SDK**: Classification-first deterministic routing. A lightweight classifier agent runs first, then routes to a pre-defined specialist.

```
Classifier → deterministic route → Specialist Agent (1 of 7)
```

**Comparison**: Claude Code is more flexible (dynamic delegation), Maria is more predictable (static routing). For customer service with well-defined intents, Maria's approach is better — lower cost, faster, more controllable.

### 3.2 Tool Architecture

**Claude Code**: Built-in tools are first-class citizens with permission models:
- File I/O: Read, Write, Edit, Glob, Grep
- Execution: Bash (sandboxed)
- Meta: Agent (sub-agent spawning), TodoWrite, WebFetch
- MCP: External tool servers via MCP protocol

**Maria-CEA-SDK**: Domain-specific native tools with enterprise patterns:
- SOAP clients with WS-Security (get_deuda, get_consumo)
- Database operations (create_ticket via Supabase/PG)
- Retry logic (3 attempts, exponential backoff)
- Response parsing (XML→JSON before agent sees it)

**Comparison**: Claude Code tools are general-purpose; Maria's are domain-optimized. Maria made the right call avoiding MCP for production-critical SOAP calls — native tools give retry control, response shaping, and timeout management.

### 3.3 Context Management

| Aspect | Claude Code | Maria-CEA-SDK |
|--------|-------------|---------------|
| Storage | In-memory with compression | In-memory Map with TTL |
| History | Auto-compressed at context limits | 20-message cap per conversation |
| Metadata | System reminders injected | Contract + classification cached |
| Persistence | Session-scoped | Chatwoot linking + Supabase |
| Multi-turn | Context window management | Explicit history management |

### 3.4 Deployment Model

**Claude Code**: Single-process CLI application. Runs on user's machine. No containerization needed.

**Maria-CEA-SDK**: Multi-container Docker deployment with orchestration:
- CEA Agent v2.0: Single Docker container (512MB limit)
- PACO Stack: 10 containers (backend, frontend, MCP servers, DBs)
- Gobierno Stack: 18 containers (orchestrator + 13 agents + voice + observability)
- Traefik reverse proxy for routing
- Health checks, rollback, GCP secrets sync

### 3.5 Sub-Agent / Parallel Execution

**Claude Code**:
- Sub-agents spawned dynamically via `Agent` tool
- Can run in foreground (blocking) or background
- Isolated contexts with optional worktree isolation
- Types: Explore, Plan, General-purpose, specialized

**Maria-CEA-SDK**:
- Agents are pre-instantiated, not spawned dynamically
- Classification happens once, single agent handles the conversation
- Gobierno Queretaro: 13 agents as separate Docker containers on separate ports
- LangGraph orchestrator routes between containers via HTTP

---

## 4. What Maria Can Learn from Claude Code

### 4.1 Dynamic Sub-Agent Spawning
Currently Maria routes to one specialist per message. Claude Code can spawn multiple sub-agents in parallel. Maria could benefit from:
- Running get_deuda and get_consumo in parallel when context suggests both are needed
- Spawning a "verification agent" alongside the main specialist for complex cases

### 4.2 Context Compression
Claude Code auto-compresses conversation history when approaching limits. Maria's hard 20-message cap is blunt. A compression strategy would maintain context quality while supporting longer conversations.

### 4.3 Permission Model for Sensitive Operations
Claude Code asks for user approval before risky tool calls. Maria could add confirmation steps before:
- Creating tickets (avoiding duplicates)
- Modifying ticket status
- Accessing sensitive contract data

### 4.4 Background Agent Execution
Claude Code's background agents pattern could be useful for:
- Async ticket status monitoring
- Background data prefetching when a contract is mentioned
- Parallel health checks across multiple backend services

---

## 5. What Claude Code Can Learn from Maria

### 5.1 Native Tool Reliability
Maria's native SOAP tools with retry logic, timeouts, and response parsing are more production-resilient than MCP-based tools. The pattern of parsing tool responses before the agent sees them prevents hallucination from raw XML/JSON.

### 5.2 Classification-First Routing
For well-defined domains, a lightweight classifier (gpt-4.1-mini at temp=0.3) routing to specialized agents is cheaper and faster than having the main agent decide dynamically.

### 5.3 Enterprise Integration Patterns
- Chatwoot context propagation via AsyncLocalStorage
- SOAP→JSON abstraction hiding legacy API complexity
- Folio generation with DB-backed sequential numbering
- Supabase as a production-grade ticket store

---

## 6. Parallel Agent Deployment Strategy

See `deploy/deploy-parallel-agents.sh` for the implementation that deploys all three stacks (CEA v2.0, PACO, Gobierno) in parallel with health verification and automatic rollback.

### Deployment Topology

```
                    ┌─────────────┐
                    │   Traefik    │
                    │ (SSL + LB)  │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │  CEA Agent   │ │    PACO     │ │  Gobierno   │
    │   v2.0       │ │   Stack     │ │  Queretaro  │
    │  :3000       │ │  10 svcs    │ │  18 svcs    │
    │  1 container │ │  :8000-3011 │ │  :9100-9190 │
    └─────────────┘ └─────────────┘ └─────────────┘
```

### Parallel Execution Flow

```
preflight checks (sequential)
    │
    ├── deploy_cea_agent &     ─┐
    ├── deploy_paco &           ├── parallel
    └── deploy_gobierno &      ─┘
    │
    wait (all complete)
    │
    verify_health (all stacks)
    │
    rollback if any failed
```
