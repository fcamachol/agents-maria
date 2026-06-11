# Memory Implementation Reference

> **Status**: Not implemented (kept for future reference)
> **Decision**: For high-volume government services, simple context memory is sufficient. Complex AI memory adds overhead without proportional value.

## When to Consider Memory

Memory systems make sense when:
- VIP/premium customer tiers need personalized experience
- Complex multi-session workflows (e.g., loan applications)
- Escalation tracking across multiple agents
- Customer preference learning over time

For CEA's current use case (transactional queries), the existing infrastructure is sufficient:
- **Session context**: In-memory conversation store
- **Customer data**: CEA API (`get_contract_details`)
- **History**: Tickets table (`get_client_tickets`)
- **Contact info**: Agora `contacts` table with `custom_attributes`

---

## Future Implementation Reference

### Database Schema

```sql
CREATE TABLE contact_memories (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL DEFAULT 2,
    contact_id BIGINT REFERENCES contacts(id) ON DELETE CASCADE,
    contract_number VARCHAR(50),
    memory_type VARCHAR(50) NOT NULL,  -- 'profile', 'preferences', 'history', 'issues', 'summary'
    content JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_contact_memories_contract_number ON contact_memories(contract_number);
CREATE INDEX idx_contact_memories_contract_type ON contact_memories(contract_number, memory_type);
```

### Memory Types

| Type | Purpose | Example Content |
|------|---------|-----------------|
| `profile` | Customer personal data | `{"nombre": "Juan", "direccion_alternativa": "..."}` |
| `preferences` | Service preferences | `{"horario_contacto": "mañanas", "canal_preferido": "whatsapp"}` |
| `history` | Interaction summaries | `{"fecha": "2026-01-11", "tema": "Fuga reportada", "resolucion": "Ticket REP-001"}` |
| `issues` | Recurring problems | `{"problema": "Fugas frecuentes", "frecuencia": "3 en 6 meses"}` |
| `summary` | Overall customer context | `{"total_interacciones": 5, "ultimo_tema": "Consulta saldo"}` |

### Tool Implementations

```typescript
// VIEW MEMORIES - Load customer context
export const viewMemoriesTool = tool(
    "view_memories",
    "Consulta las memorias guardadas de un cliente por número de contrato.",
    {
        contract_number: z.string(),
        memory_type: z.enum(["profile", "preferences", "history", "issues", "summary", "all"]).optional()
    },
    async ({ contract_number, memory_type }) => {
        // Query contact_memories table
        // Return grouped by memory_type
    }
);

// SAVE MEMORY - Store new information
export const saveMemoryTool = tool(
    "save_memory",
    "Guarda una nueva memoria para un cliente.",
    {
        contract_number: z.string(),
        memory_type: z.enum(["profile", "preferences", "history", "issues", "summary"]),
        content: z.record(z.string(), z.unknown()),
        contact_id: z.number().optional()
    },
    async ({ contract_number, memory_type, content, contact_id }) => {
        // Insert into contact_memories
    }
);

// UPDATE MEMORY - Modify existing memory
export const updateMemoryTool = tool(
    "update_memory",
    "Actualiza una memoria existente.",
    {
        contract_number: z.string(),
        memory_id: z.number().optional(),
        memory_type: z.enum(["profile", "preferences", "history", "issues", "summary"]).optional(),
        content: z.record(z.string(), z.unknown()),
        merge: z.boolean().default(true)  // Merge with existing or replace
    },
    async ({ contract_number, memory_id, memory_type, content, merge }) => {
        // Update contact_memories
    }
);

// DELETE MEMORY - Remove obsolete data
export const deleteMemoryTool = tool(
    "delete_memory",
    "Elimina una memoria obsoleta.",
    {
        contract_number: z.string(),
        memory_id: z.number().optional(),
        memory_type: z.enum(["profile", "preferences", "history", "issues", "summary"]).optional(),
        delete_all: z.boolean().default(false)
    },
    async ({ contract_number, memory_id, memory_type, delete_all }) => {
        // Delete from contact_memories
    }
);
```

### Agent Integration

Add to agent prompt when memory is enabled:

```typescript
const MEMORY_INSTRUCTIONS = `
## SISTEMA DE MEMORIA

1. **AL INICIO** - Si tienes contrato, usa view_memories para cargar contexto.
2. **DURANTE** - Guarda información relevante (nombre, preferencias, problemas).
3. **AL FINALIZAR** - Guarda resumen si fue conversación significativa.

Tipos: profile, preferences, history, issues, summary
`;
```

---

## Anthropic Memory Tool Reference

Based on: https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool

Key patterns:
- File-based metaphor (view, create, str_replace, delete)
- Client-side storage (you control infrastructure)
- Structured content (JSON/XML recommended)
- Periodic cleanup of obsolete data

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-11 | Memory not implemented | High-volume government service; transactional queries don't benefit from AI memory. Existing context (session + tickets + CEA API) is sufficient. |
