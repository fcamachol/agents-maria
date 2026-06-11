"""
Seed script: Register maria-cea agent, tools, skills, and associations in PACO.

Inserts:
  - 1 agent record (maria-cea)
  - 3 new tools (get_recibo_pdf, validate_contract_holder, find_nearest_locations)
  - 7 skills (CON, FAC, CTR, CVN, REP, SRV, CNS)
  - 11 agent_tools associations
  - 7 agent_skills associations

Idempotent: safe to run multiple times (upserts / ON CONFLICT DO NOTHING).

Usage:
    cd paco/backend && python scripts/seed_maria_cea.py
"""

import asyncio
import json
import os

import asyncpg

# ---------------------------------------------------------------------------
# Tool definitions — only the 3 NEW tools not in seed_maria_v3_tools.py
# ---------------------------------------------------------------------------

NEW_TOOLS = [
    {
        "name": "get_recibo_pdf",
        "description": "Genera enlace seguro para descargar recibo digital PDF",
        "server_name": "cea-tools",
        "input_schema": {
            "type": "object",
            "properties": {
                "contrato": {
                    "type": "string",
                    "description": "Número de contrato CEA",
                },
                "periodo": {
                    "type": "string",
                    "description": "Periodo específico (ej: 'enero', 'febrero 2025')",
                },
            },
            "required": ["contrato"],
        },
    },
    {
        "name": "validate_contract_holder",
        "description": "Valida identidad del usuario vs titular del contrato",
        "server_name": "cea-tools",
        "input_schema": {
            "type": "object",
            "properties": {
                "contrato": {
                    "type": "string",
                    "description": "Número de contrato CEA",
                },
                "nombre_proporcionado": {
                    "type": "string",
                    "description": "Nombre o apellido proporcionado por el usuario",
                },
            },
            "required": ["contrato", "nombre_proporcionado"],
        },
    },
    {
        "name": "find_nearest_locations",
        "description": "Encuentra oficinas, cajeros y puntos de pago CEA cercanos",
        "server_name": "cea-tools",
        "input_schema": {
            "type": "object",
            "properties": {
                "lat": {
                    "type": "number",
                    "description": "Latitud GPS",
                },
                "lng": {
                    "type": "number",
                    "description": "Longitud GPS",
                },
                "colonia": {
                    "type": "string",
                    "description": "Nombre de la colonia del usuario",
                },
                "tipo": {
                    "type": "string",
                    "enum": ["oficina", "cajero", "all"],
                    "description": "Tipo de ubicación a buscar",
                },
                "limit": {
                    "type": "number",
                    "description": "Máximo de resultados a retornar",
                },
            },
            "required": [],
        },
    },
]

# ---------------------------------------------------------------------------
# All 11 tools maria-cea uses (name + server for lookups)
# ---------------------------------------------------------------------------

MARIA_CEA_TOOLS = [
    # cea-tools
    ("get_deuda", "cea-tools"),
    ("get_consumo", "cea-tools"),
    ("get_contract_details", "cea-tools"),
    ("get_recibo_pdf", "cea-tools"),
    ("validate_contract_holder", "cea-tools"),
    ("find_nearest_locations", "cea-tools"),
    # agora-tools
    ("create_ticket", "agora-tools"),
    ("get_client_tickets", "agora-tools"),
    ("search_customer_by_contract", "agora-tools"),
    ("update_ticket", "agora-tools"),
    ("handoff_to_human", "agora-tools"),
]

# ---------------------------------------------------------------------------
# Skills
# ---------------------------------------------------------------------------

SKILLS = [
    {
        "code": "CON",
        "name": "Consultas",
        "description": "Preguntas generales, información, consulta de saldo, horarios",
    },
    {
        "code": "FAC",
        "name": "Facturación",
        "description": "Recibos, aclaraciones de cobro, ajustes, pagos",
    },
    {
        "code": "CTR",
        "name": "Contratos",
        "description": "Altas, bajas, cambios de titular, tarifa",
    },
    {
        "code": "CVN",
        "name": "Convenios",
        "description": "Convenios de pago, programas de apoyo",
    },
    {
        "code": "REP",
        "name": "Reportes de Servicio",
        "description": "Fugas, falta de agua, drenaje, calidad del agua",
    },
    {
        "code": "SRV",
        "name": "Servicios Técnicos",
        "description": "Instalaciones, inspecciones, medidores",
    },
    {
        "code": "CNS",
        "name": "Consumos",
        "description": "Historial de consumo, lecturas, tendencias",
    },
]

# ---------------------------------------------------------------------------
# Agent definition
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
Eres María, asistente virtual de la CEA Querétaro (Comisión Estatal de Aguas).

⚠️ REGLAS OBLIGATORIAS DE CONVERSACIÓN - DEBES SEGUIR ESTAS REGLAS SIEMPRE:

1. RESPUESTAS CORTAS (OBLIGATORIO):
   - Máximo 2-3 oraciones por mensaje
   - Estilo WhatsApp, no corporativo
   - NO uses emojis al final de los mensajes

2. UNA PREGUNTA POR MENSAJE (OBLIGATORIO):
   - PROHIBIDO: "¿Tu saldo, consumo o algo más?" (son 3 opciones)
   - PROHIBIDO: "¿Qué necesitas revisar específicamente?"
   - CORRECTO: Pregunta UNA cosa específica
   - Si no sabes qué necesita, pregunta: "¿Qué necesitas saber de tu contrato?"

3. NO USES HERRAMIENTAS PREMATURAMENTE:
   - Si el usuario dice "quiero revisar mi contrato", pregunta QUÉ necesita revisar
   - NO llames a get_contract_details inmediatamente
   - Primero entiende qué información específica necesita

4. NUNCA MENCIONES CÓDIGOS:
   - PROHIBIDO: FAC-004, CON-002, CTR-001, REP-FG-001, etc.
   - El usuario NO entiende estos códigos
   - Solo menciona el FOLIO después de crear el ticket

5. CUANDO UNA HERRAMIENTA FALLA:
   - Si no puedes obtener los datos, dilo claramente
   - Ejemplo: "No pude consultar los detalles en este momento. ¿Qué información específica necesitas?"
   - NO inventes datos ni digas solo "activo" sin más información

6. SALUDO:
   - SOLO saluda cuando el mensaje es un saludo simple SIN petición concreta (ej: "Hola", "Buenos días")
   - Si el usuario ya incluye una petición (ej: "Hola, quiero consultar mi saldo del contrato 363769"), NO saludes por separado. Ve directo a resolver su petición.
   - Formato de saludo (solo cuando aplica): "¡Hola {NOMBRE}! Soy María de la CEA, ¿en qué te puedo ayudar?"

7. MOSTRAR DATOS COMPLETOS:
   - Si consultas datos exitosamente, muéstralos TODOS de una vez
   - NO preguntes "¿qué quieres saber?" después de consultar
   - Ejemplo: "Tu contrato 523160: Titular Juan Pérez, Calle Principal 123, Tarifa doméstica, Estado activo"

8. RESPUESTAS CON DATOS (CRÍTICO):
   - Cuando un tool retorna "formatted_response", muéstralo directamente
   - NO agregues texto ANTES ("Claro...", "Aquí está...", "Listo...", "Déjame...", "Un momento...")
   - NO agregues texto DESPUÉS (excepto la pregunta de seguimiento de la regla 14)
   - El formatted_response ES tu respuesta, no lo envuelvas en más texto

9. TRANSFERENCIA A HUMANO:
   - Si el usuario dice "quiero hablar con una persona", "agente humano", "hablar con alguien", etc.
   - Usa la herramienta handoff_to_human con el motivo de la transferencia

=====================================
⚠️ REGLAS CRÍTICAS ADICIONALES
=====================================

10. USUARIOS NO PUEDEN CERRAR TICKETS:
    - Si el usuario pide cerrar un ticket, NO uses update_ticket para cerrarlo
    - Responde: "Para cerrar tu ticket necesito comunicarte con un asesor 👤"
    - Usa handoff_to_human en su lugar

11. PAGOS - NO PIDAS CONTRATO:
    - Si el usuario pregunta "quiero pagar" o "cómo puedo pagar"
    - NO pidas número de contrato
    - Solo muestra las opciones de pago directamente

12. EVIDENCIA FOTOGRÁFICA:
    - Para REPORTES (fugas, drenaje, calidad): SIEMPRE pide foto de evidencia
    - Para LECTURAS de medidor: SIEMPRE pide foto del medidor
    - Para REVISAR RECIBO: pide imagen o PDF del recibo
    - Si ya enviaron una foto, NO la pidas de nuevo

13. ACLARACIONES Y AJUSTES:
    - Para aclaraciones: pregunta si tiene contrato, pero si dice que NO, avanza sin él
    - El contrato es ÚTIL pero NO obligatorio para aclaraciones
    - Usa handoff_to_human para transferir a asesor
    - NO intentes resolver aclaraciones, siempre transfiere a asesor

14. SEGUIMIENTO NATURAL (OBLIGATORIO):
    - Después de mostrar información de saldo/deuda, pregunta: "¿Quieres hacer un pago o tienes dudas sobre tu saldo?"
    - Después de mostrar datos de contrato, pregunta: "¿Necesitas realizar algún trámite o tienes alguna duda?"
    - Después de crear un ticket, pregunta: "¿Hay algo más en que pueda ayudarte?"
    - Incluye la pregunta en el MISMO mensaje, separada por una línea en blanco

15. VERIFICACION DE IDENTIDAD POR NOMBRE (OBLIGATORIO):
    - ANTES de mostrar datos de un contrato (saldo, detalles, consumo, tickets), DEBES verificar la identidad
    - PREREQUISITO: Para verificar identidad necesitas el número de contrato. Si NO tienes el contrato (no aparece en "Número de contrato" ni en el historial), PRIMERO pregunta: "¿Me puedes dar tu número de contrato?" NO pidas nombre sin tener contrato.
    - Si el contrato ya fue verificado en esta conversacion (aparece en "Contratos ya verificados"), NO pidas nombre de nuevo
    - Si el contrato NO ha sido verificado:
      a) PREGUNTA al usuario: "Para proteger tus datos, ¿me puedes dar el nombre o apellido del titular del contrato?"
      b) ESPERA a que el usuario RESPONDA con el nombre en un nuevo mensaje. NO continues hasta recibir su respuesta.
      c) Cuando el usuario responda, usa validate_contract_holder con el contrato y el nombre que EL USUARIO ESCRIBIO EN SU MENSAJE (NO el nombre de perfil WhatsApp).
      d) Si validated=true: procede normalmente con la consulta
      e) Si validated=false: responde "El nombre no coincide con el titular del contrato. ¿Puedes verificar e intentarlo de nuevo?"
      f) Despues de 3 intentos fallidos, usa handoff_to_human
    - PROHIBIDO: NUNCA valides nombres por tu cuenta. SIEMPRE usa validate_contract_holder. Tu NO tienes acceso a los datos del titular — solo la herramienta puede verificar.
    - EXCEPCIONES (NO pidas verificacion):
      * Reportes de servicio (REP) en via publica
      * Preguntas generales sin contrato (horarios, requisitos, formas de pago)
      * Cuando el usuario pregunta "quiero pagar" (regla 11)

    🛑 PROHIBICION ABSOLUTA - NOMBRE DE PERFIL WHATSAPP:
    - El campo "Nombre de perfil WhatsApp" en INFORMACION DEL USUARIO es SOLO para saludo.
    - NUNCA lo uses como parametro nombre_proporcionado de validate_contract_holder.
    - SIEMPRE espera a que el usuario ESCRIBA el nombre en un mensaje.
"""

AGENT = {
    "name": "maria-cea",
    "display_name": "Maria CEA",
    "description": "AI customer service assistant for CEA Querétaro water utility",
    "system_prompt": SYSTEM_PROMPT,
    "status": "stopped",
    "port": 3000,
    "project_path": "/maria-cea",
    "health_endpoint": "/health",
    "model": "claude-sonnet-4-5-20250929",
    "permission_mode": "bypassPermissions",
    "max_budget_usd": 0.50,
    "runtime": "typescript-claude-sdk",
    "sdk_config": {"temperature": 0.7, "max_tokens": 4096},
    "env_vars": {
        "PORT": "3000",
        "CLAUDE_MODEL": "claude-sonnet-4-5-20250929",
        "MAX_BUDGET_PER_MESSAGE": "0.50",
    },
}


# ---------------------------------------------------------------------------
# Database operations
# ---------------------------------------------------------------------------


async def seed():
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://paco:paco_secret@localhost:5432/paco",
    )

    print(f"Connecting to: {db_url}")
    conn = await asyncpg.connect(db_url)

    try:
        # ── 1. Look up MCP server UUIDs ──────────────────────────────────────
        print("\n── MCP Servers ──")
        server_ids = {}
        for server_name in ("cea-tools", "agora-tools"):
            row = await conn.fetchrow(
                "SELECT id FROM mcp_servers WHERE name = $1", server_name
            )
            if not row:
                print(
                    f"ERROR: MCP server '{server_name}' not found in mcp_servers table."
                )
                print("  Make sure the PACO database has been initialized.")
                return
            server_ids[server_name] = row["id"]
            print(f"  Found server '{server_name}': {row['id']}")

        # ── 2. Upsert 3 new tools ────────────────────────────────────────────
        print("\n── New Tools ──")
        tools_inserted = 0
        tools_updated = 0

        for tool_def in NEW_TOOLS:
            name = tool_def["name"]
            server_id = server_ids[tool_def["server_name"]]
            description = tool_def["description"]
            input_schema = json.dumps(tool_def["input_schema"])

            existing = await conn.fetchrow(
                "SELECT id FROM tools WHERE name = $1 AND mcp_server_id = $2",
                name,
                server_id,
            )

            if existing:
                await conn.execute(
                    """
                    UPDATE tools
                    SET description = $1, input_schema = $2, is_enabled = true
                    WHERE id = $3
                    """,
                    description,
                    input_schema,
                    existing["id"],
                )
                print(f"  [UPDATE] {tool_def['server_name']}/{name}")
                tools_updated += 1
            else:
                await conn.execute(
                    """
                    INSERT INTO tools (name, description, mcp_server_id, input_schema, is_enabled)
                    VALUES ($1, $2, $3, $4, true)
                    """,
                    name,
                    description,
                    server_id,
                    input_schema,
                )
                print(f"  [INSERT] {tool_def['server_name']}/{name}")
                tools_inserted += 1

        print(f"  Tools: {tools_inserted} inserted, {tools_updated} updated")

        # ── 3. Upsert 7 skills ───────────────────────────────────────────────
        print("\n── Skills ──")
        skills_inserted = 0
        skills_updated = 0

        for skill_def in SKILLS:
            existing = await conn.fetchrow(
                "SELECT id FROM skills WHERE code = $1", skill_def["code"]
            )

            if existing:
                await conn.execute(
                    """
                    UPDATE skills
                    SET name = $1, description = $2, is_active = true
                    WHERE id = $3
                    """,
                    skill_def["name"],
                    skill_def["description"],
                    existing["id"],
                )
                print(f"  [UPDATE] {skill_def['code']} - {skill_def['name']}")
                skills_updated += 1
            else:
                await conn.execute(
                    """
                    INSERT INTO skills (code, name, description, is_active)
                    VALUES ($1, $2, $3, true)
                    """,
                    skill_def["code"],
                    skill_def["name"],
                    skill_def["description"],
                )
                print(f"  [INSERT] {skill_def['code']} - {skill_def['name']}")
                skills_inserted += 1

        print(f"  Skills: {skills_inserted} inserted, {skills_updated} updated")

        # ── 4. Upsert the maria-cea agent ─────────────────────────────────────
        print("\n── Agent ──")
        a = AGENT
        existing_agent = await conn.fetchrow(
            "SELECT id FROM agents WHERE name = $1", a["name"]
        )

        if existing_agent:
            await conn.execute(
                """
                UPDATE agents
                SET display_name = $1, description = $2, status = $3, port = $4,
                    project_path = $5, health_endpoint = $6, model = $7,
                    permission_mode = $8, max_budget_usd = $9, runtime = $10,
                    sdk_config = $11, env_vars = $12, system_prompt = $13
                WHERE id = $14
                """,
                a["display_name"],
                a["description"],
                a["status"],
                a["port"],
                a["project_path"],
                a["health_endpoint"],
                a["model"],
                a["permission_mode"],
                a["max_budget_usd"],
                a["runtime"],
                json.dumps(a["sdk_config"]),
                json.dumps(a["env_vars"]),
                a["system_prompt"],
                existing_agent["id"],
            )
            agent_id = existing_agent["id"]
            print(f"  [UPDATE] {a['name']} ({agent_id})")
        else:
            row = await conn.fetchrow(
                """
                INSERT INTO agents (name, display_name, description, status, port,
                    project_path, health_endpoint, model, permission_mode,
                    max_budget_usd, runtime, sdk_config, env_vars, system_prompt)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING id
                """,
                a["name"],
                a["display_name"],
                a["description"],
                a["status"],
                a["port"],
                a["project_path"],
                a["health_endpoint"],
                a["model"],
                a["permission_mode"],
                a["max_budget_usd"],
                a["runtime"],
                json.dumps(a["sdk_config"]),
                json.dumps(a["env_vars"]),
                a["system_prompt"],
            )
            agent_id = row["id"]
            print(f"  [INSERT] {a['name']} ({agent_id})")

        # ── 5. Create 11 agent_tools associations ─────────────────────────────
        print("\n── Agent-Tool Associations ──")
        at_created = 0
        at_skipped = 0

        for tool_name, server_name in MARIA_CEA_TOOLS:
            tool_row = await conn.fetchrow(
                "SELECT id FROM tools WHERE name = $1 AND mcp_server_id = $2",
                tool_name,
                server_ids[server_name],
            )
            if not tool_row:
                print(f"  [WARN] Tool not found: {server_name}/{tool_name}")
                continue

            result = await conn.execute(
                """
                INSERT INTO agent_tools (agent_id, tool_id)
                VALUES ($1, $2)
                ON CONFLICT ON CONSTRAINT uq_agent_tool DO NOTHING
                """,
                agent_id,
                tool_row["id"],
            )
            if result == "INSERT 0 1":
                print(f"  [LINK] {server_name}/{tool_name}")
                at_created += 1
            else:
                print(f"  [SKIP] {server_name}/{tool_name} (already linked)")
                at_skipped += 1

        print(f"  Agent-Tools: {at_created} created, {at_skipped} skipped")

        # ── 6. Create 7 agent_skills associations ─────────────────────────────
        print("\n── Agent-Skill Associations ──")
        as_created = 0
        as_skipped = 0

        for skill_def in SKILLS:
            skill_row = await conn.fetchrow(
                "SELECT id FROM skills WHERE code = $1", skill_def["code"]
            )
            if not skill_row:
                print(f"  [WARN] Skill not found: {skill_def['code']}")
                continue

            result = await conn.execute(
                """
                INSERT INTO agent_skills (agent_id, skill_id)
                VALUES ($1, $2)
                ON CONFLICT ON CONSTRAINT uq_agent_skill DO NOTHING
                """,
                agent_id,
                skill_row["id"],
            )
            if result == "INSERT 0 1":
                print(f"  [LINK] {skill_def['code']} - {skill_def['name']}")
                as_created += 1
            else:
                print(f"  [SKIP] {skill_def['code']} (already linked)")
                as_skipped += 1

        print(f"  Agent-Skills: {as_created} created, {as_skipped} skipped")

        # ── 7. Verification summary ───────────────────────────────────────────
        print(f"\n{'='*60}")
        print("VERIFICATION")
        print(f"{'='*60}")

        # Agent
        agent_row = await conn.fetchrow(
            "SELECT name, display_name, status, port, model, runtime, length(system_prompt) as prompt_len FROM agents WHERE name = 'maria-cea'"
        )
        print(f"\nAgent: {agent_row['name']} ({agent_row['display_name']})")
        print(f"  status={agent_row['status']} port={agent_row['port']} model={agent_row['model']} runtime={agent_row['runtime']}")
        print(f"  system_prompt: {agent_row['prompt_len'] or 0} chars")

        # Tools
        tool_rows = await conn.fetch(
            """
            SELECT t.name, s.name as server FROM agent_tools at
            JOIN tools t ON at.tool_id = t.id
            JOIN mcp_servers s ON t.mcp_server_id = s.id
            JOIN agents a ON at.agent_id = a.id
            WHERE a.name = 'maria-cea'
            ORDER BY s.name, t.name
            """
        )
        print(f"\nTools linked: {len(tool_rows)}")
        for r in tool_rows:
            print(f"  {r['server']}/{r['name']}")

        # Skills
        skill_rows = await conn.fetch(
            """
            SELECT sk.code, sk.name FROM agent_skills ags
            JOIN skills sk ON ags.skill_id = sk.id
            JOIN agents a ON ags.agent_id = a.id
            WHERE a.name = 'maria-cea'
            ORDER BY sk.code
            """
        )
        print(f"\nSkills linked: {len(skill_rows)}")
        for r in skill_rows:
            print(f"  {r['code']} - {r['name']}")

        print(f"\n{'='*60}")
        print("Seed complete!")
        print(f"{'='*60}")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())
