# María - Claude Code Edition

Migración de María de OpenAI Agents SDK a Claude Code con arquitectura basada en Skills.

## Cambio de Arquitectura

### Antes (OpenAI)
```
Classification Agent → Router → Sub-Agents (6)
                                ├── informacionAgent
                                ├── pagosAgent
                                ├── consumosAgent
                                ├── fugasAgent
                                ├── contratosAgent
                                └── ticketsAgent
```

### Ahora (Claude Code)
```
Single Claude Agent + Skills (Markdown Knowledge)
                      ├── SKILL.md (main)
                      ├── pagos.md
                      ├── consumos.md
                      ├── fugas.md
                      ├── contratos.md
                      ├── tickets.md
                      └── info.md
```

## Patrones Aplicados

| Patrón | Implementación |
|--------|----------------|
| **Routing** | Clasificación de intención en system prompt |
| **Memory** | MemoryStore para persistencia de conversaciones |
| **Skills** | Conocimiento de dominio en archivos markdown |
| **Chain-of-Thought** | Instrucciones de pensamiento en prompt |
| **Guardrails** | Reglas de comportamiento en skills |

## Estructura de Archivos

```
src/
├── claude-agent.ts    # Agente principal Claude
├── tools-direct.ts    # Funciones de tools para Claude
├── memory.ts          # Store de memoria persistente
├── skills/            # Conocimiento como markdown
│   ├── SKILL.md       # Skill principal
│   ├── pagos.md       # Skill de pagos
│   ├── consumos.md    # Skill de consumos
│   ├── fugas.md       # Skill de fugas
│   ├── contratos.md   # Skill de contratos
│   ├── tickets.md     # Skill de tickets
│   └── info.md        # Skill de información
└── types.ts           # Tipos compartidos
```

## Uso

```typescript
import { runMariaAgent } from './claude-agent'

const result = await runMariaAgent({
  input_as_text: 'Quiero saber cuánto debo',
  conversationId: 'conv-123'
})

console.log(result.output_text)
// "¿Me proporcionas tu número de contrato? 💧"
```

## Ventajas del Nuevo Enfoque

1. **Simplicidad**: Un solo agente en lugar de 7
2. **Mantenibilidad**: Skills son markdown editables
3. **Consistencia**: Mismo modelo, misma personalidad
4. **Memoria**: Conversaciones persisten entre sesiones
5. **Debugging**: Logs claros de tools usados

## Migración desde OpenAI

El código original (`agent.ts`, `tools.ts`) se mantiene para referencia.
El nuevo código está en:
- `claude-agent.ts`
- `tools-direct.ts`
- `memory.ts`
- `src/skills/*.md`

## Configuración

```bash
# Variables de entorno necesarias
ANTHROPIC_API_KEY=sk-ant-...

# PostgreSQL (para tickets)
PGHOST=localhost
PGPORT=5432
PGUSER=postgres
PGPASSWORD=...
PGDATABASE=agora_production

# Opcional: Proxy para CEA API
CEA_PROXY_URL=http://10.128.0.7:3128
```

## Branch

Esta implementación está en el branch `claude-code-skills`.

```bash
git checkout claude-code-skills
npm install @anthropic-ai/sdk
npm run build
```
