"""
Seed script: register maria-cea-sdk's 5 skills in PACO's DB and link them to the agent.

PACO's skill model:
  - SKILL.md files in paco/backend/skills/{code}/SKILL.md are the source of truth.
  - The `skills` table is an index over those files.
  - The `agent_skills` table links an agent to the skills it uses.

This script is idempotent — runs at deploy time after agent_manager.sync_from_yaml
has created the maria-cea-sdk agent record from paco/agents/maria-cea-sdk.yaml.

Usage:
    cd paco/backend && python scripts/seed_maria_cea_sdk.py
"""

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

# Allow imports from the parent backend dir so we can use the same SkillFilesystemService
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.skill_filesystem import SkillFilesystemService

AGENT_NAME = "maria-cea-sdk"

SKILL_CODES = [
    "cea-sdk-informacion",
    "cea-sdk-facturacion",
    "cea-sdk-reportes",
    "cea-sdk-servicios",
    "cea-sdk-tramites",
]


async def seed() -> None:
    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://paco:paco_secret@localhost:5432/paco",
    )
    print(f"Connecting to: {db_url}")

    fs = SkillFilesystemService()

    # Verify all 5 SKILL.md files are on disk before touching the DB.
    missing = [c for c in SKILL_CODES if not fs.skill_exists(c)]
    if missing:
        print(f"ERROR: missing SKILL.md files for codes: {missing}")
        print(f"  Expected at: {fs.base_path}/<code>/SKILL.md")
        sys.exit(1)

    conn = await asyncpg.connect(db_url)

    try:
        # 1. Upsert each skill row from its SKILL.md frontmatter.
        print("\n── Skills (DB index ← filesystem) ──")
        skill_ids: dict[str, str] = {}
        for code in SKILL_CODES:
            data = fs.read_skill_md(code)
            name = data.get("name", code)
            description = data.get("description", "")
            skill_path = str(fs._skill_md_path(code))

            existing = await conn.fetchrow("SELECT id FROM skills WHERE code = $1", code)
            if existing:
                await conn.execute(
                    """
                    UPDATE skills
                    SET name = $1, description = $2, skill_path = $3, is_active = true
                    WHERE id = $4
                    """,
                    name, description, skill_path, existing["id"],
                )
                print(f"  [UPDATE] {code} ({name})")
                skill_ids[code] = existing["id"]
            else:
                row = await conn.fetchrow(
                    """
                    INSERT INTO skills (code, name, description, skill_path, is_active)
                    VALUES ($1, $2, $3, $4, true)
                    RETURNING id
                    """,
                    code, name, description, skill_path,
                )
                print(f"  [INSERT] {code} ({name})")
                skill_ids[code] = row["id"]

        # 2. Look up agent (created earlier by agent_manager.sync_from_yaml).
        print(f"\n── Agent ──")
        agent_row = await conn.fetchrow(
            "SELECT id FROM agents WHERE name = $1", AGENT_NAME
        )
        if not agent_row:
            print(f"ERROR: agent '{AGENT_NAME}' not found.")
            print("  Run agent_manager.sync_from_yaml first (or restart paco-backend) so")
            print(f"  paco/agents/{AGENT_NAME}.yaml is parsed and the agent row is created.")
            sys.exit(1)
        agent_id = agent_row["id"]
        print(f"  Found agent {AGENT_NAME} ({agent_id})")

        # 3. Attach each skill to the agent (idempotent).
        print("\n── Agent-Skill Associations ──")
        created = 0
        skipped = 0
        for code, skill_id in skill_ids.items():
            result = await conn.execute(
                """
                INSERT INTO agent_skills (agent_id, skill_id)
                VALUES ($1, $2)
                ON CONFLICT ON CONSTRAINT uq_agent_skill DO NOTHING
                """,
                agent_id, skill_id,
            )
            if result == "INSERT 0 1":
                print(f"  [LINK] {code}")
                created += 1
            else:
                print(f"  [SKIP] {code} (already linked)")
                skipped += 1
        print(f"  Agent-Skills: {created} created, {skipped} skipped")

        # 4. Verification dump.
        print(f"\n{'=' * 60}\nVERIFICATION\n{'=' * 60}")
        rows = await conn.fetch(
            """
            SELECT s.code, s.name, s.skill_path
            FROM agent_skills a
            JOIN skills s ON a.skill_id = s.id
            JOIN agents g ON a.agent_id = g.id
            WHERE g.name = $1
            ORDER BY s.code
            """,
            AGENT_NAME,
        )
        print(f"\nSkills linked to {AGENT_NAME}: {len(rows)}")
        for r in rows:
            print(f"  {r['code']:<28} → {r['skill_path']}")
        print(f"\n{'=' * 60}\nSeed complete.\n{'=' * 60}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())
