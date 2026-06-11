# Maria Redesign: Disciplined Architecture Refinement

**Date:** 2026-03-05
**Status:** Approved
**Scope:** maria-ultimate (new production agent, replaces maria-cea-aws)

---

## 1. Problem Statement

Maria is a customer service agent for CEA Queretaro (government water utility) that handles citizen inquiries via WhatsApp/Chatwoot. The current production system (maria-cea-aws) works — people like how Maria replies. But the architecture has specific engineering problems:

1. **Prompt bloat**: 450+ line system prompts where ~15 lines are personality and ~435 lines are flow control and rules. The LLM spends cognitive budget parsing procedures instead of being Maria.
2. **Tool gating absent**: All 15 tools are exposed regardless of active skill. The `skill.tools` array is decorative metadata — never enforced. The LLM can and does call unintended tools.
3. **Classification bugs**: Keyword ordering causes "no puedo pagar" to route to FAC (billing) instead of CVN (payment plans) because "pagar" matches FAC first.
4. **Identity verification leakage**: WhatsApp profile name is in the same prompt section as verification rules. Despite 15+ lines of "NEVER use profile name," Claude sometimes does under the weight of a 450-line prompt.
5. **Volatile state**: All conversation state is in-memory Maps. Server restart = all conversations lost. No horizontal scaling.
6. **Single guard**: Only one post-hoc guard (hallucinated folio). Missing ticket hallucination and identity bypass detection.
7. **No eval framework**: No way to measure prompt effectiveness or catch regressions.

## 2. Design Principle

> **Keep the soul. Fix the skeleton.**

Maria's personality — warm, direct, WhatsApp-native, one question at a time — is what makes her work. Users should notice zero change in how Maria responds. The redesign targets the engineering layers underneath.

The core architectural insight:

> **The code is the brain. The prompt is the voice.**

Everything enforceable moves from prompts to code. What stays in prompts is what only prompts can do: personality, emotional tone, domain knowledge the LLM can't infer.

## 3. Architecture: 5-Layer Prompt Stack

The current system uses a 2-layer prompt (GLOBAL_RULES + skill.systemPrompt). The redesign uses a 5-layer constraint sandwich that exploits LLM primacy/recency bias:

```
+-------------------------------------------+
|  Layer 1: CHARACTER (immutable)            |  ~20 lines
|  WHO Maria is. Personality. Tone.          |
+-------------------------------------------+
|  Layer 2: HARD RULES (global)              |  ~40 lines
|  Constraints that apply to ALL skills.     |
+-------------------------------------------+
|  Layer 3: SKILL KNOWLEDGE (per-skill)      |  ~40-80 lines
|  Domain expertise. What Maria knows.       |
+-------------------------------------------+
|  Layer 4: CONTEXT (per-request, injected)  |  ~10-20 lines
|  Verified contracts, user info, history.   |
+-------------------------------------------+
|  Layer 5: CONSTRAINT ECHO (bottom)         |  ~5 lines
|  Repeat the 2-3 most-violated rules.       |
+-------------------------------------------+

Total: ~120-160 lines (down from 450+)
```

### 3.1 Layer 1: Maria's Character (~20 lines)

A single, immutable character prompt that captures who Maria is. Currently scattered across 7 skill files ("Eres Maria, asistente virtual...", "Eres Maria, especialista en reportes..."). Written once, used everywhere.

File: `src/prompts/character.md`

Content defines:
- Personality: warm but direct, WhatsApp-native, "tu" not "usted"
- Message style: 2-3 sentences max, one question per message, no emojis at end
- Data handling: show complete data immediately, never ask "what do you want to know?"
- Output style: no preamble ("Claro...", "Listo...", "Dejame..."), go direct
- Failure behavior: honest about errors, transfers to human when needed, never invents data

This layer does NOT contain procedures, tool instructions, or flow control.

### 3.2 Layer 2: Hard Rules (~40 lines)

Global constraints that apply regardless of skill. Reduced from 222 lines to ~40 by:
- Removing rules now enforced by code (tool gating, tool restrictions)
- Removing rules already expressed in Layer 1 (response length, question count)
- Removing rules duplicated in skill prompts
- Keeping only rules that MUST be prompt-based (identity verification flow, formatted_response handling, human handoff triggers)

File: `src/prompts/rules.md`

Sections:
- IDENTIDAD: Identity verification flow (the most critical prompt-based rule)
- DATOS: How to handle formatted_response, no internal codes to users
- SEGUIMIENTO: Follow-up questions after key actions
- LIMITES: What Maria cannot do (documents, close tickets, resolve aclaraciones)

### 3.3 Layer 3: Skill Knowledge (~40-80 lines per skill)

Each skill file contains ONLY domain knowledge the LLM cannot infer. Current skill prompts are procedure manuals ("step 1, step 2, step 3"). The LLM doesn't need step-by-step instructions — it reads conversation history and figures out the sequence. What it DOES need:

- Which subcategories exist and their codes
- Which reports require contracts and which don't
- The suspension check for FSA/BAP (domain-specific gate)
- How to interpret image analysis sections
- How to use create_ticket correctly

Files: `src/skills/{skill}/skill.md` (same structure as current maria-ultimate)

Example reduction: REP skill goes from 226 lines to ~60 lines. The removed 166 lines were either:
- Procedures the LLM infers from context ("step 1: ask contract, step 2: verify")
- Tool restrictions now handled by tool gating
- Rules already in Layer 2

### 3.4 Layer 4: Context (per-request, injected)

Same as current production. Assembled by `agent.ts` at runtime:
- Current date/time
- Verified contracts list
- Contract number (if known)
- User metadata (phone, email)
- Conversation history (last 10 messages)
- Current user message

One key change: WhatsApp profile name is ISOLATED from the main prompt body. It appears ONLY as a greeting hint, physically separated from verification context:

```
[SALUDO: Si es primer mensaje, saluda como "Hola {name}!"]
```

This prevents the name from bleeding into identity verification decisions.

### 3.5 Layer 5: Constraint Echo (~5 lines)

At the very bottom of the assembled prompt, repeat the 2-3 rules Claude violates most often. Exploits LLM recency bias — the last thing the model reads before generating.

Contents (based on observed production failures):
- Never use WhatsApp profile name for verification
- If a tool returns formatted_response, show it directly
- Maximum 2-3 sentences, one question per message

## 4. Code Changes

### 4.1 Tool Gating (highest impact, smallest change)

**Current** (`agent.ts:247`):
```typescript
const allTools = [...staticTools, ...createContextTools(reqCtx)];
```

All 15 tools exposed regardless of active skill.

**New:**
```typescript
const skillToolNames = skill.tools; // e.g., ["create_ticket", "validate_contract_holder", ...]
const gatedStaticTools = staticTools.filter(t => skillToolNames.includes(t.name));
const gatedContextTools = createContextTools(reqCtx).filter(t => skillToolNames.includes(t.name));
const allTools = [...gatedStaticTools, ...gatedContextTools];
```

3 lines of code that eliminate entire categories of prompt instructions. When REP doesn't include `get_consumo`, the LLM literally cannot call it — no prompt rule needed.

**Always-available tools** (added to every skill regardless):
- `validate_contract_holder` — needed for identity verification in any skill
- `handoff_to_human` — users can always request human transfer

Implementation:
```typescript
const UNIVERSAL_TOOLS = ["validate_contract_holder", "handoff_to_human"];
const skillToolNames = [...new Set([...skill.tools, ...UNIVERSAL_TOOLS])];
```

### 4.2 Classification Fix

**Current bug**: CVN is checked after FAC. "No puedo pagar todo" contains "pagar" and matches FAC first.

**Fix**: Reorder checks. CVN before FAC. More specific matches before general ones:

```typescript
// Priority order (most specific first):
// 1. REP — emergencies first
// 2. CON (location-specific) — oficina, cajero, sucursal, horario
// 3. CVN — "no puedo pagar", "convenio", "plan de pago" (BEFORE FAC)
// 4. FAC — "pagar", "recibo", "factura"
// 5. CTR — contract changes
// 6. SRV — medidor, lectura
// 7. CNS — consumo, historial
// 8. CON (saldo) — saldo, deuda, adeudo (catch-all for queries)
```

### 4.3 Guard System (expand from 1 to 3)

Keep existing hallucination guard. Add two more:

**Guard 1: Folio Hallucination (existing)**
- Trigger: output contains folio pattern AND `create_ticket` was not called
- Action: replace output with retry message
- Severity: block

**Guard 2: Ticket Claim Hallucination (new)**
- Trigger: output claims ticket was created (regex: `registre|tu ticket|tu reporte|queda registrado`) AND `create_ticket` was not called
- Action: replace output with retry message
- Severity: block

**Guard 3: Identity Bypass Warning (new)**
- Trigger: output contains sensitive data patterns (`titular|saldo|adeudo|\$\d+`) AND data tools were called (`get_deuda`, `get_contract_details`, `get_consumo`) AND `validate_contract_holder` was NOT called AND contract is not in verified set
- Action: log warning (do not block — data came from a tool, not hallucinated)
- Severity: warn

Implementation: `GuardSystem` class with typed results:

```typescript
interface GuardResult {
    passed: boolean;
    guardName: string;
    message?: string;
    severity: "block" | "warn";
}

class GuardSystem {
    constructor(private verifiedContracts: Set<string>) {}

    runAll(output: string, toolsUsed: string[]): GuardResult {
        const results = [
            this.checkFolioHallucination(output, toolsUsed),
            this.checkTicketHallucination(output, toolsUsed),
            this.checkIdentityBypass(output, toolsUsed),
        ];
        const block = results.find(r => !r.passed && r.severity === "block");
        if (block) return block;
        const warn = results.find(r => !r.passed && r.severity === "warn");
        if (warn) return warn;
        return { passed: true, guardName: "all", severity: "block" };
    }
}
```

### 4.4 WhatsApp Name Isolation

**Current** (`agent.ts:347`):
```typescript
if (input.metadata?.name)
    userContext += `Nombre de perfil WhatsApp (NO es el titular...): ${input.metadata.name}\n`;
```

The name is in the same `userContext` string as contract numbers and verification state.

**New:**
```typescript
// Name goes ONLY in greeting context, physically separated from verification data
const greetingHint = input.metadata?.name
    ? `[SALUDO: Si es primer mensaje, saluda como "Hola ${input.metadata.name}!"]`
    : '';

// User context has NO name field
let userContext = '';
if (input.metadata?.phone) userContext += `Telefono: ${input.metadata.phone}\n`;
if (input.metadata?.email) userContext += `Email: ${input.metadata.email}\n`;
```

The greeting hint is injected at the TOP of the prompt (Layer 1), far from the verification rules and user data section.

### 4.5 Redis for Conversation State

Replace in-memory `Map<string, ConversationEntry>` with Redis. Same interface:

```typescript
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

async function getConversation(id: string): Promise<ConversationEntry> {
    const raw = await redis.get(`conv:${id}`);
    if (raw) {
        const entry = JSON.parse(raw) as SerializedConversationEntry;
        return {
            ...entry,
            lastAccess: new Date(),
            verifiedContracts: new Set(entry.verifiedContracts),
        };
    }
    return {
        history: [],
        lastAccess: new Date(),
        verifiedContracts: new Set(),
    };
}

async function saveConversation(id: string, entry: ConversationEntry): Promise<void> {
    const serialized = {
        ...entry,
        verifiedContracts: [...entry.verifiedContracts],
    };
    await redis.setex(`conv:${id}`, 3600, JSON.stringify(serialized));
}
```

Benefits:
- Survives server restarts and deploys
- Enables horizontal scaling (multiple instances share state)
- Same 1-hour TTL semantics via `setex`
- Verified contracts persist across restarts

Also migrate `verifiedContractsMap` (tools.ts) and `processedMessages` (chatwoot.ts) to Redis.

### 4.6 Circuit Breaker for SOAP API

Wrap `fetchWithRetry` in a circuit breaker to prevent 90-second blocks:

```typescript
class CircuitBreaker {
    private failures = 0;
    private lastFailure = 0;
    private state: "closed" | "open" | "half-open" = "closed";

    constructor(
        private failureThreshold = 3,
        private resetTimeout = 30000,
        private callTimeout = 15000
    ) {}

    async call<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === "open") {
            if (Date.now() - this.lastFailure > this.resetTimeout) {
                this.state = "half-open";
            } else {
                throw new Error("Circuit breaker is open — SOAP API temporarily unavailable");
            }
        }
        try {
            const result = await Promise.race([
                fn(),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("Timeout")), this.callTimeout)
                ),
            ]);
            this.failures = 0;
            this.state = "closed";
            return result;
        } catch (error) {
            this.failures++;
            this.lastFailure = Date.now();
            if (this.failures >= this.failureThreshold) this.state = "open";
            throw error;
        }
    }
}

const soapBreaker = new CircuitBreaker(3, 30000, 15000);
```

Worst case drops from 90s (3 retries x 30s) to 15s (single attempt with timeout) when the circuit is open.

## 5. File Structure

```
maria-ultimate/
  src/
    prompts/
      character.md          # Layer 1: Maria's personality (NEW)
      rules.md              # Layer 2: Global hard rules (replaces inline GLOBAL_CONVERSATION_RULES)
    skills/
      _global/
        rules.md            # REMOVED (replaced by src/prompts/rules.md)
        classification.md   # Keep for future LLM-based classification
      consultas/
        skill.md            # Layer 3: Rewritten, ~50 lines (down from ~110)
        examples/            # Keep — few-shot examples auto-loaded
      facturacion/
        skill.md            # Rewritten, ~70 lines (down from ~260)
        examples/
      reportes/
        skill.md            # Rewritten, ~60 lines (down from ~226)
        examples/
      contratos/
        skill.md            # Rewritten, ~50 lines
        examples/
      convenios/
        skill.md            # Rewritten, ~30 lines (rigid skill, minimal)
        examples/
      servicios/
        skill.md            # Rewritten, ~60 lines
        examples/
      consumos/
        skill.md            # Rewritten, ~30 lines (simple skill)
        examples/
    agent.ts                # Modified: tool gating, classification fix, prompt assembly
    guards.ts               # NEW: GuardSystem class with 3 guards
    tools.ts                # Modified: circuit breaker wrapper
    chatwoot.ts             # Minor: Redis for processedMessages
    media.ts                # Unchanged
    server.ts               # Minor: Redis health check
    types.ts                # Minor: add GuardResult type
    config/
      response-templates.ts # Unchanged
    skills/
      base.ts               # Unchanged
      loader.ts             # Modified: load character.md and rules.md from prompts/
      index.ts              # Unchanged
```

## 6. Prompt Assembly

The `SkillLoader.buildSystemPrompt()` method assembles the 5 layers:

```typescript
buildSystemPrompt(code: CategoryCode, greetingHint?: string): string {
    const character = this.characterPrompt;    // Layer 1
    const rules = this.globalRules;            // Layer 2
    const skill = this.skills.get(code);       // Layer 3
    const examples = skill.examples.join("\n\n");

    return [
        greetingHint || "",                    // Greeting (isolated from main body)
        character,                             // Layer 1: Character
        rules,                                 // Layer 2: Hard rules
        skill.systemPrompt,                    // Layer 3: Skill knowledge
        examples ? `## Ejemplos\n${examples}` : "",
        CONSTRAINT_ECHO,                       // Layer 5: Recency reinforcement
    ].filter(Boolean).join("\n\n---\n\n");
}
```

Layer 4 (context) is assembled in `agent.ts` as it is today, appended after the system prompt.

## 7. What Does NOT Change

These components are production-proven and stay as-is:

- **Claude Agent SDK `query()` pattern** — the agent loop works
- **Keyword classification + sticky routing** — fast, deterministic, correct 90% of cases
- **Per-request context tool factories** — clean concurrency model
- **Media 2-pass pipeline** (media.ts) — classify cheap, analyze expensive
- **SOAP API integration** (tools.ts) — retry, proxy, dual-endpoint fallback
- **Chatwoot integration** (chatwoot.ts) — webhook validation, serial queue, handoff
- **Response templates** (response-templates.ts) — formatted_response rendering
- **Conversation history** — 20 messages stored, last 10 sent to LLM
- **$0.50 budget cap** — cost control per query
- **Markdown skill files with YAML frontmatter** — hot-reload capability
- **Few-shot examples** — auto-loaded from examples/ directories

## 8. What Users Experience

Nothing changes in how Maria responds. Same warmth, same WhatsApp style, same "una pregunta a la vez." But:

- Slightly faster responses (shorter prompts = fewer input tokens = lower latency)
- Never accidentally calls the wrong tool (tool gating)
- Correct routing for "no puedo pagar" to payment plans (classification fix)
- Never uses WhatsApp profile name for verification (name isolation)
- Doesn't lose conversation context on server restart (Redis)
- Faster recovery from SOAP API outages (circuit breaker, 15s vs 90s)
- Catches more hallucination types (3 guards vs 1)

## 9. Eval Framework (Phase 2)

After the redesign is deployed, build an eval suite:

- **Test dataset**: 200+ conversations covering all 7 skills, 63 subcategories
- **Categories**: happy path, edge cases, adversarial (prompt injection, social engineering, topic switching)
- **Metrics**: classification accuracy, identity verification compliance, hallucination rate, token usage per conversation, response latency
- **Automation**: run evals on every prompt change, fail CI if metrics regress
- **Cost tracking**: measure actual $/conversation by skill

This is Phase 2 because it requires production conversation data to build realistic test cases.

## 10. Migration Path

1. **Build in maria-ultimate** — new codebase, new infra, new port
2. **Rewrite prompts** — Layer 1-5 structure, skill-by-skill
3. **Add code changes** — tool gating, classification fix, guards, name isolation
4. **Add Redis** — conversation state persistence
5. **Add circuit breaker** — SOAP API resilience
6. **Side-by-side testing** — run both agents on test conversations, compare outputs
7. **Gradual rollout** — route % of Chatwoot conversations to maria-ultimate
8. **Retire maria-cea-aws** — once maria-ultimate handles 100% of traffic

## 11. Success Criteria

The redesign succeeds if:
- Maria's response quality is equal or better (measured by side-by-side comparison)
- Prompt token count per request drops by 50%+
- Zero tool-gating violations (LLM never calls tools outside skill scope)
- "No puedo pagar" correctly routes to CVN
- Identity verification bypass rate drops (measured by Guard 3 warnings)
- Conversation state survives server restarts
- SOAP timeout worst case drops from 90s to 15s

## 12. Risks

| Risk | Mitigation |
|------|------------|
| Shorter prompts cause LLM to miss edge cases | Few-shot examples cover edge cases; eval suite catches regressions |
| Tool gating is too restrictive | Universal tools (validate, handoff) always available; monitor for "tool not found" errors |
| Redis adds infrastructure dependency | Redis is mature, well-understood; fallback to in-memory on connection failure |
| Prompt personality changes subtly | Side-by-side testing before rollout; same character.md across all skills |
| Classification fix introduces new routing bugs | Comprehensive keyword collision testing; eval suite covers all categories |
