"""
Sync script: Fix all SKILL.md ↔ DB discrepancies for maria-claude agent.

Fixes:
  1. Upserts 7 core skills from SKILL.md files into skills table
  2. Creates 3 missing tools (validate_contract_holder, get_recibo_pdf,
     find_nearest_locations) linked to cea-tools MCP server
  3. Fixes handoff_to_human tool → links to agora-tools MCP server
  4. Creates all 12 agent_tools associations for maria-claude
  5. Creates all 7 agent_skills associations for maria-claude
  6. Re-syncs ALL SKILL.md files found on filesystem

Idempotent: safe to run multiple times.

Usage:
    cd paco/backend && python scripts/sync_skills_with_md.py
"""

import asyncio
import json
import os
import re
from pathlib import Path

import asyncpg
import yaml

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MARIA_CLAUDE_AGENT_NAME = "maria-claude"

# The 7 core Maria CEA skills (directory name = code)
CORE_SKILLS = [
    "consultas",
    "facturacion",
    "contratos",
    "convenios",
    "reportes",
    "servicios",
    "consumos",
]

# Tools that must exist for maria-claude
REQUIRED_TOOLS = {
    # cea-tools server
    "cea-tools": [
        {
            "name": "get_deuda",
            "description": "Obtiene el saldo y adeudo de un contrato CEA",
            "input_schema": {
                "type": "object",
                "properties": {
                    "contrato": {"type": "string", "description": "Numero de contrato CEA"},
                },
                "required": ["contrato"],
            },
        },
        {
            "name": "get_consumo",
            "description": "Obtiene historial de consumo de agua de un contrato",
            "input_schema": {
                "type": "object",
                "properties": {
                    "contrato": {"type": "string", "description": "Numero de contrato CEA"},
                    "year": {"type": "number", "description": "Ano para filtrar consumos"},
                },
                "required": ["contrato"],
            },
        },
        {
            "name": "get_contract_details",
            "description": "Obtiene detalles de un contrato CEA (titular, direccion, tarifa, estado)",
            "input_schema": {
                "type": "object",
                "properties": {
                    "contrato": {"type": "string", "description": "Numero de contrato CEA"},
                },
                "required": ["contrato"],
            },
        },
        {
            "name": "get_recibo_link",
            "description": "Genera enlace para descargar recibo digital de un contrato CEA",
            "input_schema": {
                "type": "object",
                "properties": {
                    "contract_number": {"type": "string", "description": "Numero de contrato CEA"},
                },
                "required": ["contract_number"],
            },
        },
        {
            "name": "get_recibo_pdf",
            "description": "Genera enlace seguro para descargar recibo digital PDF",
            "input_schema": {
                "type": "object",
                "properties": {
                    "contrato": {"type": "string", "description": "Numero de contrato CEA"},
                    "periodo": {"type": "string", "description": "Periodo especifico (ej: enero, febrero 2025)"},
                },
                "required": ["contrato"],
            },
        },
        {
            "name": "validate_contract_holder",
            "description": "Valida identidad del usuario vs titular del contrato CEA",
            "input_schema": {
                "type": "object",
                "properties": {
                    "contrato": {"type": "string", "description": "Numero de contrato CEA"},
                    "nombre_proporcionado": {"type": "string", "description": "Nombre o apellido proporcionado por el usuario"},
                },
                "required": ["contrato", "nombre_proporcionado"],
            },
        },
        {
            "name": "find_nearest_locations",
            "description": "Encuentra oficinas, cajeros y puntos de pago CEA cercanos",
            "input_schema": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number", "description": "Latitud GPS"},
                    "lng": {"type": "number", "description": "Longitud GPS"},
                    "colonia": {"type": "string", "description": "Nombre de la colonia del usuario"},
                    "tipo": {"type": "string", "enum": ["oficina", "cajero", "all"], "description": "Tipo de ubicacion"},
                    "limit": {"type": "number", "description": "Maximo de resultados"},
                },
                "required": [],
            },
        },
    ],
    # agora-tools server
    "agora-tools": [
        {
            "name": "create_ticket",
            "description": "Crea un ticket en AGORA CEA. Categorias: CON, FAC, CTR, CVN, REP, SRV, CNS",
            "input_schema": {
                "type": "object",
                "properties": {
                    "category_code": {"type": "string", "enum": ["CON", "FAC", "CTR", "CVN", "REP", "SRV", "CNS"], "description": "Codigo de categoria AGORA"},
                    "subcategory_code": {"type": "string", "description": "Codigo de subcategoria"},
                    "titulo": {"type": "string", "description": "Titulo breve del ticket"},
                    "descripcion": {"type": "string", "description": "Descripcion detallada"},
                    "contract_number": {"type": "string", "description": "Numero de contrato"},
                    "email": {"type": "string", "description": "Email del cliente"},
                    "ubicacion": {"type": "string", "description": "Ubicacion (requerido para REP en via publica)"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high", "urgent"], "description": "Prioridad"},
                },
                "required": ["category_code", "titulo", "descripcion"],
            },
        },
        {
            "name": "get_client_tickets",
            "description": "Obtiene tickets de un cliente por numero de contrato",
            "input_schema": {
                "type": "object",
                "properties": {
                    "contract_number": {"type": "string", "description": "Numero de contrato CEA"},
                },
                "required": ["contract_number"],
            },
        },
        {
            "name": "search_customer_by_contract",
            "description": "Busca un cliente por su numero de contrato en AGORA contacts",
            "input_schema": {
                "type": "object",
                "properties": {
                    "contract_number": {"type": "string", "description": "Numero de contrato CEA"},
                },
                "required": ["contract_number"],
            },
        },
        {
            "name": "update_ticket",
            "description": "Actualiza estado u otros campos de un ticket existente",
            "input_schema": {
                "type": "object",
                "properties": {
                    "folio": {"type": "string", "description": "Folio del ticket"},
                    "status": {"type": "string", "description": "Nuevo estado"},
                    "priority": {"type": "string", "description": "Nueva prioridad"},
                    "notes": {"type": "string", "description": "Notas adicionales"},
                },
                "required": ["folio"],
            },
        },
        {
            "name": "handoff_to_human",
            "description": "Transfiere conversacion a agente humano de CEA",
            "input_schema": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string", "description": "Motivo de la transferencia"},
                },
                "required": ["reason"],
            },
        },
    ],
}

# All tool names maria-claude uses (for agent_tools linking)
MARIA_TOOLS = [
    ("get_deuda", "cea-tools"),
    ("get_consumo", "cea-tools"),
    ("get_contract_details", "cea-tools"),
    ("get_recibo_link", "cea-tools"),
    ("get_recibo_pdf", "cea-tools"),
    ("validate_contract_holder", "cea-tools"),
    ("find_nearest_locations", "cea-tools"),
    ("create_ticket", "agora-tools"),
    ("get_client_tickets", "agora-tools"),
    ("search_customer_by_contract", "agora-tools"),
    ("update_ticket", "agora-tools"),
    ("handoff_to_human", "agora-tools"),
]

# ---------------------------------------------------------------------------
# SKILL.md parsing
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def parse_skill_md(path: Path) -> dict:
    """Parse a SKILL.md file into {name, description, allowed_tools, body}."""
    content = path.read_text(encoding="utf-8")
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return {"name": path.parent.name, "description": "", "allowed_tools": [], "body": content.strip()}
    fm = yaml.safe_load(match.group(1)) or {}
    body = content[match.end():].strip()
    allowed_raw = fm.get("allowed-tools", "")
    if isinstance(allowed_raw, str):
        allowed_tools = allowed_raw.split() if allowed_raw else []
    else:
        allowed_tools = list(allowed_raw)
    return {
        "name": fm.get("name", path.parent.name),
        "description": fm.get("description", ""),
        "allowed_tools": allowed_tools,
        "body": body,
    }


# ---------------------------------------------------------------------------
# Database operations
# ---------------------------------------------------------------------------


async def sync():
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://paco:paco_secret@localhost:5432/paco",
    )
    skills_base = Path(os.environ.get("SKILLS_BASE_PATH", "./skills"))

    print(f"Connecting to: {db_url}")
    print(f"Skills base path: {skills_base.resolve()}")
    conn = await asyncpg.connect(db_url)

    try:
        # ── 1. Look up MCP server UUIDs ──────────────────────────────────
        print("\n" + "=" * 60)
        print("STEP 1: Verify MCP Servers")
        print("=" * 60)
        server_ids = {}
        for server_name in ("cea-tools", "agora-tools"):
            row = await conn.fetchrow(
                "SELECT id FROM mcp_servers WHERE name = $1", server_name
            )
            if not row:
                print(f"  ERROR: MCP server '{server_name}' not found!")
                return
            server_ids[server_name] = row["id"]
            print(f"  Found '{server_name}': {row['id']}")

        # ── 2. Upsert all required tools ─────────────────────────────────
        print("\n" + "=" * 60)
        print("STEP 2: Upsert Tools")
        print("=" * 60)
        tools_inserted = 0
        tools_updated = 0

        for server_name, tool_defs in REQUIRED_TOOLS.items():
            server_id = server_ids[server_name]
            for tool_def in tool_defs:
                name = tool_def["name"]
                description = tool_def["description"]
                input_schema = json.dumps(tool_def["input_schema"])

                # Check for existing tool WITH correct server
                existing = await conn.fetchrow(
                    "SELECT id FROM tools WHERE name = $1 AND mcp_server_id = $2",
                    name, server_id,
                )

                if existing:
                    await conn.execute(
                        "UPDATE tools SET description=$1, input_schema=$2, is_enabled=true WHERE id=$3",
                        description, input_schema, existing["id"],
                    )
                    print(f"  [UPDATE] {server_name}/{name}")
                    tools_updated += 1
                else:
                    # Check if tool exists without server (orphan from gobierno seed)
                    orphan = await conn.fetchrow(
                        "SELECT id FROM tools WHERE name = $1 AND mcp_server_id IS NULL",
                        name,
                    )
                    if orphan:
                        # Fix the orphan by linking it to the correct server
                        await conn.execute(
                            "UPDATE tools SET mcp_server_id=$1, description=$2, input_schema=$3, is_enabled=true WHERE id=$4",
                            server_id, description, input_schema, orphan["id"],
                        )
                        print(f"  [FIX] {name} → linked to {server_name}")
                        tools_updated += 1
                    else:
                        await conn.execute(
                            "INSERT INTO tools (name, description, mcp_server_id, input_schema, is_enabled) VALUES ($1,$2,$3,$4,true)",
                            name, description, server_id, input_schema,
                        )
                        print(f"  [INSERT] {server_name}/{name}")
                        tools_inserted += 1

        print(f"  Summary: {tools_inserted} inserted, {tools_updated} updated")

        # ── 3. Sync SKILL.md files → skills table ────────────────────────
        print("\n" + "=" * 60)
        print("STEP 3: Sync SKILL.md Files → Skills Table")
        print("=" * 60)
        skills_inserted = 0
        skills_updated = 0

        if not skills_base.exists():
            print(f"  WARNING: Skills base path not found: {skills_base}")
        else:
            for skill_dir in sorted(skills_base.iterdir()):
                if not skill_dir.is_dir():
                    continue
                md_path = skill_dir / "SKILL.md"
                if not md_path.exists():
                    continue

                code = skill_dir.name
                try:
                    data = parse_skill_md(md_path)
                except Exception as e:
                    print(f"  [SKIP] {code}: parse error: {e}")
                    continue

                skill_path = f"skills/{code}/SKILL.md"
                existing = await conn.fetchrow(
                    "SELECT id FROM skills WHERE code = $1", code
                )

                if existing:
                    await conn.execute(
                        "UPDATE skills SET name=$1, description=$2, skill_path=$3, is_active=true WHERE id=$4",
                        data["name"], data["description"], skill_path, existing["id"],
                    )
                    skills_updated += 1
                else:
                    await conn.execute(
                        "INSERT INTO skills (code, name, description, skill_path, is_active) VALUES ($1,$2,$3,$4,true)",
                        code, data["name"], data["description"], skill_path,
                    )
                    skills_inserted += 1
                    print(f"  [INSERT] {code} - {data['name']}")

            print(f"  Summary: {skills_inserted} inserted, {skills_updated} updated")

        # ── 4. Find/create maria-claude agent ─────────────────────────────
        print("\n" + "=" * 60)
        print("STEP 4: Find maria-claude Agent")
        print("=" * 60)
        agent_row = await conn.fetchrow(
            "SELECT id, name, display_name FROM agents WHERE name = $1",
            MARIA_CLAUDE_AGENT_NAME,
        )
        if not agent_row:
            print(f"  ERROR: Agent '{MARIA_CLAUDE_AGENT_NAME}' not found in agents table!")
            return
        agent_id = agent_row["id"]
        print(f"  Found: {agent_row['name']} ({agent_row['display_name']}) → {agent_id}")

        # ── 5. Create agent_tools associations ───────────────────────────
        print("\n" + "=" * 60)
        print("STEP 5: Link Tools → maria-claude (agent_tools)")
        print("=" * 60)
        at_created = 0
        at_skipped = 0

        for tool_name, server_name in MARIA_TOOLS:
            server_id = server_ids[server_name]
            tool_row = await conn.fetchrow(
                "SELECT id FROM tools WHERE name = $1 AND mcp_server_id = $2",
                tool_name, server_id,
            )
            if not tool_row:
                print(f"  [WARN] Tool not found: {server_name}/{tool_name}")
                continue

            result = await conn.execute(
                "INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1, $2) ON CONFLICT ON CONSTRAINT uq_agent_tool DO NOTHING",
                agent_id, tool_row["id"],
            )
            if result == "INSERT 0 1":
                print(f"  [LINK] {server_name}/{tool_name}")
                at_created += 1
            else:
                at_skipped += 1

        print(f"  Summary: {at_created} created, {at_skipped} already linked")

        # ── 6. Create agent_skills associations ──────────────────────────
        print("\n" + "=" * 60)
        print("STEP 6: Link Skills → maria-claude (agent_skills)")
        print("=" * 60)
        as_created = 0
        as_skipped = 0

        for skill_code in CORE_SKILLS:
            skill_row = await conn.fetchrow(
                "SELECT id FROM skills WHERE code = $1", skill_code
            )
            if not skill_row:
                print(f"  [WARN] Skill not found: {skill_code}")
                continue

            result = await conn.execute(
                "INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2) ON CONFLICT ON CONSTRAINT uq_agent_skill DO NOTHING",
                agent_id, skill_row["id"],
            )
            if result == "INSERT 0 1":
                print(f"  [LINK] {skill_code}")
                as_created += 1
            else:
                as_skipped += 1

        print(f"  Summary: {as_created} created, {as_skipped} already linked")

        # ── 7. Verification ──────────────────────────────────────────────
        print("\n" + "=" * 60)
        print("VERIFICATION")
        print("=" * 60)

        # Agent info
        agent_info = await conn.fetchrow(
            "SELECT name, display_name, model, runtime FROM agents WHERE id = $1",
            agent_id,
        )
        print(f"\nAgent: {agent_info['name']} ({agent_info['display_name']})")
        print(f"  Model: {agent_info['model']}  Runtime: {agent_info['runtime']}")

        # Tools linked
        tool_rows = await conn.fetch("""
            SELECT t.name, s.name as server FROM agent_tools at
            JOIN tools t ON at.tool_id = t.id
            LEFT JOIN mcp_servers s ON t.mcp_server_id = s.id
            WHERE at.agent_id = $1
            ORDER BY s.name, t.name
        """, agent_id)
        print(f"\nTools linked: {len(tool_rows)}")
        for r in tool_rows:
            print(f"  {r['server'] or '(no server)'}/{r['name']}")

        # Skills linked
        skill_rows = await conn.fetch("""
            SELECT sk.code, sk.name, sk.skill_path FROM agent_skills ags
            JOIN skills sk ON ags.skill_id = sk.id
            WHERE ags.agent_id = $1
            ORDER BY sk.code
        """, agent_id)
        print(f"\nSkills linked: {len(skill_rows)}")
        for r in skill_rows:
            print(f"  {r['code']} - {r['name']} ({r['skill_path']})")

        # Core skills with body content check
        print(f"\nSKILL.md body content check:")
        for skill_code in CORE_SKILLS:
            md_path = skills_base / skill_code / "SKILL.md"
            if md_path.exists():
                data = parse_skill_md(md_path)
                body_len = len(data["body"])
                tools_count = len(data["allowed_tools"])
                status = "OK" if body_len > 100 else "EMPTY/SHORT"
                print(f"  {skill_code}: body={body_len} chars, tools={tools_count} → {status}")
            else:
                print(f"  {skill_code}: MISSING SKILL.md")

        print(f"\n{'=' * 60}")
        print("Sync complete!")
        print(f"{'=' * 60}")

    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(sync())
