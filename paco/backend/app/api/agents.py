"""
PACO Agents API

SDK-aligned agent management. Fields map to ClaudeAgentOptions.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

import httpx

from app.core.config import settings
from app.core.deps import AdminUser, DbSession, OperatorUser
from app.core.secrets import mask_env_vars
from app.db.models import Agent, AgentSkill, AgentTool, Skill, Tool
from app.services.pm2_client import PM2Client
from app.services.sdk_options_builder import SDKOptionsBuilder

router = APIRouter(prefix="/agents", tags=["Agents"])


# =============================================================================
# Schemas
# =============================================================================


class AgentResponse(BaseModel):
    """Agent list response."""
    id: str
    name: str
    display_name: Optional[str]
    description: Optional[str]
    model: str
    status: str
    port: Optional[int]
    pm2_name: Optional[str]
    last_health_check: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AgentSkillInfo(BaseModel):
    code: str
    name: str
    is_enabled: bool
    allowed_tools: List[str] = []


class AgentMcpServerInfo(BaseModel):
    name: str
    transport: str
    url: Optional[str]


class AgentDetailResponse(AgentResponse):
    """Detailed agent response with SDK options."""
    system_prompt: Optional[str] = None
    permission_mode: str = "default"
    max_turns: Optional[int] = None
    max_budget_usd: Optional[float] = None
    max_thinking_tokens: Optional[int] = None
    sdk_config: Dict[str, Any] = {}
    env_vars: Dict[str, Any] = {}
    lightning_config: Dict[str, Any] = {}
    project_path: Optional[str] = None
    allowed_tools: List[str] = []
    skills: List[AgentSkillInfo] = []
    mcp_servers: List[AgentMcpServerInfo] = []
    tools: List[Dict[str, Any]] = []
    config: Dict[str, Any] = {}


class AgentCreateRequest(BaseModel):
    """Agent creation — maps to ClaudeAgentOptions."""
    name: str
    display_name: Optional[str] = None
    description: Optional[str] = None
    model: str = "claude-sonnet-4-5-20250929"
    system_prompt: Optional[str] = None
    permission_mode: str = "default"
    max_turns: Optional[int] = None
    max_budget_usd: Optional[float] = None
    max_thinking_tokens: Optional[int] = None
    env_vars: Dict[str, Any] = {}
    lightning_config: Optional[Dict[str, Any]] = None


class AgentUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    permission_mode: Optional[str] = None
    max_turns: Optional[int] = None
    max_budget_usd: Optional[float] = None
    max_thinking_tokens: Optional[int] = None
    sdk_config: Optional[Dict[str, Any]] = None
    env_vars: Optional[Dict[str, Any]] = None
    lightning_config: Optional[Dict[str, Any]] = None


class AgentStatusResponse(BaseModel):
    agent: AgentResponse
    pm2_status: Optional[Dict[str, Any]] = None
    health: Optional[Dict[str, Any]] = None


class AgentSkillAttachRequest(BaseModel):
    skill_code: str


class AgentSkillResponse(BaseModel):
    id: str
    skill_code: str
    skill_name: str
    is_enabled: bool
    created_at: datetime


# --- Tool assignment schemas ---

class AgentToolAssignRequest(BaseModel):
    tool_id: str
    is_required: bool = True
    config_overrides: Dict[str, Any] = {}


class AgentToolResponse(BaseModel):
    id: str
    tool_id: str
    tool_name: str
    tool_description: Optional[str]
    mcp_server_name: Optional[str]
    is_required: bool
    config_overrides: Dict[str, Any]
    created_at: datetime


# =============================================================================
# Helpers
# =============================================================================


def _agent_to_response(agent: Agent) -> AgentResponse:
    return AgentResponse(
        id=str(agent.id),
        name=agent.name,
        display_name=agent.display_name,
        description=agent.description,
        model=agent.model,
        status=agent.status,
        port=agent.port,
        pm2_name=agent.pm2_name,
        last_health_check=agent.last_health_check,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
    )


async def _notify_agent_reload(agent: Agent) -> None:
    """Push config reload to a running agent.

    Tries the Redis queue first (retryable delivery). Falls back to
    direct HTTP if the queue is unavailable.
    """
    if agent.status != "running" or not agent.port:
        return

    # Try queue-based delivery
    try:
        from app.services.queue.redis_pool import get_queue_redis
        from app.services.queue.core import enqueue_task
        redis = await get_queue_redis()
        await enqueue_task(redis, "agent_config_reload", {
            "agent_port": agent.port,
            "agent_name": agent.name,
        })
        return
    except Exception:
        pass  # Queue unavailable, fall back to direct HTTP

    # Fallback: direct HTTP (best-effort)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(f"http://localhost:{agent.port}/admin/reload")
    except Exception:
        pass  # Best-effort; agent will get config on next startup


# =============================================================================
# Agent CRUD
# =============================================================================


@router.get("", response_model=List[AgentResponse])
async def list_agents(db: DbSession) -> List[AgentResponse]:
    """List all registered agents."""
    result = await db.execute(select(Agent).order_by(Agent.name))
    agents = result.scalars().all()
    return [_agent_to_response(agent) for agent in agents]


@router.get("/{agent_id}", response_model=AgentDetailResponse)
async def get_agent(agent_id: UUID, db: DbSession) -> AgentDetailResponse:
    """Get agent details with SDK options, skills, and tools."""
    result = await db.execute(
        select(Agent)
        .where(Agent.id == agent_id)
        .options(
            selectinload(Agent.agent_skills).selectinload(AgentSkill.skill),
            selectinload(Agent.agent_tools).selectinload(AgentTool.tool).selectinload(Tool.mcp_server),
        )
    )
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found")

    # Build tools list and compute allowed_tools + mcp_servers
    tools_list = []
    allowed_tools: List[str] = []
    mcp_servers_map: Dict[str, AgentMcpServerInfo] = {}

    for at in agent.agent_tools:
        tool = at.tool
        server_name = tool.mcp_server.name if tool.mcp_server else None
        tools_list.append({
            "id": str(tool.id),
            "name": tool.name,
            "description": tool.description,
            "mcp_server_name": server_name,
            "is_required": at.is_required,
        })
        if tool.mcp_server:
            allowed_tools.append(f"mcp__{tool.mcp_server.name}__{tool.name}")
            if tool.mcp_server.name not in mcp_servers_map:
                mcp_servers_map[tool.mcp_server.name] = AgentMcpServerInfo(
                    name=tool.mcp_server.name,
                    transport=tool.mcp_server.transport,
                    url=tool.mcp_server.url,
                )

    # Build skills list and add allowed_tools from skills (single loop)
    from app.services.skill_filesystem import SkillFilesystemService
    fs = SkillFilesystemService()
    skills_list = []
    for ask in agent.agent_skills:
        skill_allowed_tools: List[str] = []
        if ask.is_enabled:
            try:
                fs_data = fs.read_skill_md(ask.skill.code)
                skill_allowed_tools = fs_data.get("allowed_tools", [])
                allowed_tools.extend(skill_allowed_tools)
            except FileNotFoundError:
                pass
        skills_list.append(AgentSkillInfo(
            code=ask.skill.code,
            name=ask.skill.name,
            is_enabled=ask.is_enabled,
            allowed_tools=skill_allowed_tools,
        ))

    allowed_tools = list(dict.fromkeys(allowed_tools))

    # Build config dict for frontend display
    config: Dict[str, Any] = {
        "model": agent.model,
        "permission_mode": agent.permission_mode or "default",
    }
    if agent.system_prompt:
        # Truncate for display; full text is in system_prompt field
        config["system_prompt"] = (
            agent.system_prompt[:200] + "..."
            if len(agent.system_prompt) > 200
            else agent.system_prompt
        )
        config["system_prompt_length"] = len(agent.system_prompt)
    if agent.max_turns:
        config["max_turns"] = agent.max_turns
    if agent.max_budget_usd:
        config["max_budget_usd"] = float(agent.max_budget_usd)
    if agent.max_thinking_tokens:
        config["max_thinking_tokens"] = agent.max_thinking_tokens
    if agent.sdk_config:
        config["sdk_config"] = agent.sdk_config
    if agent.runtime:
        config["runtime"] = agent.runtime
    if agent.project_path:
        config["project_path"] = agent.project_path
    if agent.port:
        config["port"] = agent.port
    if agent.health_endpoint:
        config["health_endpoint"] = agent.health_endpoint

    return AgentDetailResponse(
        id=str(agent.id),
        name=agent.name,
        display_name=agent.display_name,
        description=agent.description,
        model=agent.model,
        status=agent.status,
        port=agent.port,
        pm2_name=agent.pm2_name,
        last_health_check=agent.last_health_check,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
        system_prompt=agent.system_prompt,
        permission_mode=agent.permission_mode,
        max_turns=agent.max_turns,
        max_budget_usd=float(agent.max_budget_usd) if agent.max_budget_usd else None,
        max_thinking_tokens=agent.max_thinking_tokens,
        sdk_config=agent.sdk_config or {},
        env_vars=mask_env_vars(agent.env_vars or {}),
        lightning_config=agent.lightning_config or {},
        project_path=agent.project_path,
        allowed_tools=allowed_tools,
        skills=skills_list,
        mcp_servers=list(mcp_servers_map.values()),
        tools=tools_list,
        config=config,
    )


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def create_agent(
    request: AgentCreateRequest,
    db: DbSession,
    _: AdminUser,
) -> AgentResponse:
    """Create a new agent (admin only)."""
    result = await db.execute(select(Agent).where(Agent.name == request.name))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Agent '{request.name}' already exists",
        )

    agent = Agent(
        name=request.name,
        display_name=request.display_name or request.name,
        description=request.description,
        model=request.model,
        system_prompt=request.system_prompt,
        permission_mode=request.permission_mode,
        max_turns=request.max_turns,
        max_budget_usd=request.max_budget_usd,
        max_thinking_tokens=request.max_thinking_tokens,
        env_vars=request.env_vars,
        lightning_config=request.lightning_config or {},
        pm2_name=request.name,
        status="stopped",
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return _agent_to_response(agent)


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(
    agent_id: UUID,
    request: AgentUpdateRequest,
    db: DbSession,
    _: AdminUser,
) -> AgentResponse:
    """Update agent configuration (admin only)."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found")

    for field in [
        "display_name", "description", "model", "system_prompt",
        "permission_mode", "max_turns", "max_budget_usd",
        "max_thinking_tokens", "sdk_config", "lightning_config",
    ]:
        value = getattr(request, field)
        if value is not None:
            setattr(agent, field, value)

    # Merge env_vars: preserve DB values when the incoming value is masked
    if request.env_vars is not None:
        existing = agent.env_vars or {}
        merged = {}
        for key, value in request.env_vars.items():
            if isinstance(value, str) and value.startswith("****"):
                # Preserve the original DB value instead of overwriting with mask
                if key in existing:
                    merged[key] = existing[key]
                # else: drop — was masked but no original exists
            else:
                merged[key] = value
        agent.env_vars = merged

    await db.commit()
    await db.refresh(agent)

    # Notify running agent to reload config
    await _notify_agent_reload(agent)

    return _agent_to_response(agent)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    agent_id: UUID,
    db: DbSession,
    _: AdminUser,
) -> None:
    """Delete an agent (admin only)."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found")

    if agent.status == "running" and agent.pm2_name:
        pm2 = PM2Client()
        await pm2.stop(agent.pm2_name)

    await db.delete(agent)
    await db.commit()


# =============================================================================
# Lifecycle Controls
# =============================================================================


@router.post("/{agent_id}/start", response_model=AgentStatusResponse)
async def start_agent(agent_id: UUID, db: DbSession, _: OperatorUser) -> AgentStatusResponse:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
    if agent.status == "running":
        raise HTTPException(status_code=409, detail=f"Agent '{agent.name}' is already running")

    pm2 = PM2Client()
    try:
        agent.status = "starting"
        await db.commit()
        # Inject PACO env vars so the agent can reach the PACO API
        env = dict(agent.env_vars or {})
        env["PACO_API_URL"] = settings.internal_api_url
        env["PACO_AGENT_ID"] = str(agent.id)
        pm2_status = await pm2.start(agent.pm2_name, env=env)
        agent.status = "running"
        agent.last_health_check = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(agent)
        return AgentStatusResponse(agent=_agent_to_response(agent), pm2_status=pm2_status)
    except Exception as e:
        agent.status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to start agent: {e}")


@router.post("/{agent_id}/stop", response_model=AgentStatusResponse)
async def stop_agent(agent_id: UUID, db: DbSession, _: OperatorUser) -> AgentStatusResponse:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")
    if agent.status == "stopped":
        raise HTTPException(status_code=409, detail=f"Agent '{agent.name}' is already stopped")

    pm2 = PM2Client()
    try:
        agent.status = "stopping"
        await db.commit()
        pm2_status = await pm2.stop(agent.pm2_name)
        agent.status = "stopped"
        await db.commit()
        await db.refresh(agent)
        return AgentStatusResponse(agent=_agent_to_response(agent), pm2_status=pm2_status)
    except Exception as e:
        agent.status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to stop agent: {e}")


@router.post("/{agent_id}/restart", response_model=AgentStatusResponse)
async def restart_agent(agent_id: UUID, db: DbSession, _: OperatorUser) -> AgentStatusResponse:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    pm2 = PM2Client()
    try:
        agent.status = "starting"
        await db.commit()
        pm2_status = await pm2.restart(agent.pm2_name)
        agent.status = "running"
        agent.last_health_check = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(agent)
        return AgentStatusResponse(agent=_agent_to_response(agent), pm2_status=pm2_status)
    except Exception as e:
        agent.status = "error"
        await db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to restart agent: {e}")


class ApplyResponse(BaseModel):
    success: bool
    message: str
    files_generated: List[str] = []


@router.post("/{agent_id}/apply", response_model=ApplyResponse)
async def apply_agent_config(
    agent_id: UUID,
    db: DbSession,
    _: AdminUser,
) -> ApplyResponse:
    """Regenerate code, compile TypeScript, and restart agent via PM2."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    # Step 1: Regenerate code
    from app.services.agent_generator import AgentGenerator
    generator = AgentGenerator()
    gen_result = await generator.generate(agent_id)
    if not gen_result.success:
        raise HTTPException(
            status_code=500,
            detail=f"Code generation failed: {gen_result.error}",
        )

    # Step 2: Compile TypeScript (npm run build)
    if agent.runtime == "typescript-claude-sdk" and gen_result.project_path:
        import asyncio
        proc = await asyncio.create_subprocess_exec(
            "npm", "run", "build",
            cwd=gen_result.project_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            error_msg = stderr.decode() if stderr else "Unknown build error"
            raise HTTPException(
                status_code=500,
                detail=f"TypeScript compilation failed: {error_msg}",
            )

    # Step 3: Restart via PM2 if running
    if agent.status == "running" and agent.pm2_name:
        pm2 = PM2Client()
        env = dict(agent.env_vars or {})
        env["PACO_API_URL"] = settings.internal_api_url
        env["PACO_AGENT_ID"] = str(agent.id)
        await pm2.restart(agent.pm2_name)

    return ApplyResponse(
        success=True,
        message="Code regenerated, compiled, and agent restarted",
        files_generated=gen_result.files_generated,
    )


@router.get("/{agent_id}/status", response_model=AgentStatusResponse)
async def get_agent_status(agent_id: UUID, db: DbSession) -> AgentStatusResponse:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    pm2 = PM2Client()
    pm2_status = await pm2.status(agent.pm2_name) if agent.pm2_name else None

    if pm2_status:
        pm2_state = pm2_status.get("pm2_env", {}).get("status", "").lower()
        if pm2_state == "online":
            agent.status = "running"
        elif pm2_state == "stopped":
            agent.status = "stopped"
        elif pm2_state in ("errored", "error"):
            agent.status = "error"
        await db.commit()

    return AgentStatusResponse(agent=_agent_to_response(agent), pm2_status=pm2_status)


# =============================================================================
# Skill Assignment (simplified — no overrides)
# =============================================================================


@router.post("/{agent_id}/skills", response_model=AgentSkillResponse, status_code=status.HTTP_201_CREATED)
async def attach_skill_to_agent(
    agent_id: UUID,
    request: AgentSkillAttachRequest,
    db: DbSession,
    _: AdminUser,
) -> AgentSkillResponse:
    """Attach a skill to an agent."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    result = await db.execute(select(Skill).where(Skill.code == request.skill_code))
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill '{request.skill_code}' not found")

    result = await db.execute(
        select(AgentSkill).where(AgentSkill.agent_id == agent_id, AgentSkill.skill_id == skill.id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Skill already attached to this agent")

    agent_skill = AgentSkill(agent_id=agent_id, skill_id=skill.id)
    db.add(agent_skill)
    await db.commit()
    await db.refresh(agent_skill)

    # Notify running agent to reload config
    await _notify_agent_reload(agent)

    return AgentSkillResponse(
        id=str(agent_skill.id),
        skill_code=skill.code,
        skill_name=skill.name,
        is_enabled=agent_skill.is_enabled,
        created_at=agent_skill.created_at,
    )


@router.get("/{agent_id}/skills", response_model=List[AgentSkillResponse])
async def list_agent_skills(agent_id: UUID, db: DbSession) -> List[AgentSkillResponse]:
    """List skills attached to an agent."""
    result = await db.execute(
        select(AgentSkill)
        .where(AgentSkill.agent_id == agent_id)
        .options(selectinload(AgentSkill.skill))
    )
    return [
        AgentSkillResponse(
            id=str(ask.id),
            skill_code=ask.skill.code,
            skill_name=ask.skill.name,
            is_enabled=ask.is_enabled,
            created_at=ask.created_at,
        )
        for ask in result.scalars().all()
    ]


@router.put("/{agent_id}/skills/{skill_code}", response_model=AgentSkillResponse)
async def toggle_agent_skill(
    agent_id: UUID,
    skill_code: str,
    db: DbSession,
    _: AdminUser,
    is_enabled: bool = True,
) -> AgentSkillResponse:
    """Enable/disable a skill for this agent."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    result = await db.execute(select(Skill).where(Skill.code == skill_code))
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_code}' not found")

    result = await db.execute(
        select(AgentSkill).where(AgentSkill.agent_id == agent_id, AgentSkill.skill_id == skill.id)
    )
    agent_skill = result.scalar_one_or_none()
    if not agent_skill:
        raise HTTPException(status_code=404, detail="Skill not attached to this agent")

    agent_skill.is_enabled = is_enabled
    await db.commit()
    await db.refresh(agent_skill)

    # Notify running agent to reload config
    await _notify_agent_reload(agent)

    return AgentSkillResponse(
        id=str(agent_skill.id),
        skill_code=skill.code,
        skill_name=skill.name,
        is_enabled=agent_skill.is_enabled,
        created_at=agent_skill.created_at,
    )


@router.delete("/{agent_id}/skills/{skill_code}", status_code=status.HTTP_204_NO_CONTENT)
async def detach_skill_from_agent(
    agent_id: UUID,
    skill_code: str,
    db: DbSession,
    _: AdminUser,
) -> None:
    """Detach a skill from an agent."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    result = await db.execute(select(Skill).where(Skill.code == skill_code))
    skill = result.scalar_one_or_none()
    if not skill:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_code}' not found")

    result = await db.execute(
        select(AgentSkill).where(AgentSkill.agent_id == agent_id, AgentSkill.skill_id == skill.id)
    )
    agent_skill = result.scalar_one_or_none()
    if not agent_skill:
        raise HTTPException(status_code=404, detail="Skill not attached to this agent")

    await db.delete(agent_skill)
    await db.commit()

    # Notify running agent to reload config
    await _notify_agent_reload(agent)


# =============================================================================
# Tool Assignment
# =============================================================================


@router.post("/{agent_id}/tools", response_model=AgentToolResponse, status_code=status.HTTP_201_CREATED)
async def assign_tool_to_agent(
    agent_id: UUID,
    request: AgentToolAssignRequest,
    db: DbSession,
    _: AdminUser,
) -> AgentToolResponse:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    tool_id = UUID(request.tool_id)
    result = await db.execute(
        select(Tool).where(Tool.id == tool_id).options(selectinload(Tool.mcp_server))
    )
    tool = result.scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=404, detail=f"Tool {request.tool_id} not found")

    result = await db.execute(
        select(AgentTool).where(AgentTool.agent_id == agent_id, AgentTool.tool_id == tool_id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Tool already assigned to this agent")

    agent_tool = AgentTool(
        agent_id=agent_id,
        tool_id=tool_id,
        is_required=request.is_required,
        config_overrides=request.config_overrides,
    )
    db.add(agent_tool)
    await db.commit()
    await db.refresh(agent_tool)

    # Notify running agent to reload config
    await _notify_agent_reload(agent)

    return AgentToolResponse(
        id=str(agent_tool.id),
        tool_id=str(tool.id),
        tool_name=tool.name,
        tool_description=tool.description,
        mcp_server_name=tool.mcp_server.name if tool.mcp_server else None,
        is_required=agent_tool.is_required,
        config_overrides=agent_tool.config_overrides or {},
        created_at=agent_tool.created_at,
    )


@router.get("/{agent_id}/tools", response_model=List[AgentToolResponse])
async def list_agent_tools(agent_id: UUID, db: DbSession) -> List[AgentToolResponse]:
    result = await db.execute(
        select(AgentTool)
        .where(AgentTool.agent_id == agent_id)
        .options(selectinload(AgentTool.tool).selectinload(Tool.mcp_server))
    )
    return [
        AgentToolResponse(
            id=str(at.id),
            tool_id=str(at.tool.id),
            tool_name=at.tool.name,
            tool_description=at.tool.description,
            mcp_server_name=at.tool.mcp_server.name if at.tool.mcp_server else None,
            is_required=at.is_required,
            config_overrides=at.config_overrides or {},
            created_at=at.created_at,
        )
        for at in result.scalars().all()
    ]


@router.delete("/{agent_id}/tools/{tool_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_tool_from_agent(
    agent_id: UUID,
    tool_id: UUID,
    db: DbSession,
    _: AdminUser,
) -> None:
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    result = await db.execute(
        select(AgentTool).where(AgentTool.agent_id == agent_id, AgentTool.tool_id == tool_id)
    )
    agent_tool = result.scalar_one_or_none()
    if not agent_tool:
        raise HTTPException(status_code=404, detail="Tool assignment not found")
    await db.delete(agent_tool)
    await db.commit()

    # Notify running agent to reload config
    await _notify_agent_reload(agent)


# =============================================================================
# Code Generation (delegates to agent_generator)
# =============================================================================


class GenerateResponse(BaseModel):
    success: bool
    project_path: str
    files_generated: List[str] = []
    error: Optional[str] = None


class FilePreviewResponse(BaseModel):
    path: str
    content: str
    language: str


class FileContentResponse(BaseModel):
    path: str
    content: str


@router.post("/{agent_id}/generate", response_model=GenerateResponse)
async def generate_agent_code(agent_id: UUID, _: AdminUser) -> GenerateResponse:
    from app.services.agent_generator import AgentGenerator
    generator = AgentGenerator()
    try:
        result = await generator.generate(agent_id)
        return GenerateResponse(
            success=result.success,
            project_path=result.project_path,
            files_generated=result.files_generated,
            error=result.error,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generation failed: {e}")


@router.post("/{agent_id}/preview", response_model=List[FilePreviewResponse])
async def preview_agent_code(agent_id: UUID) -> List[FilePreviewResponse]:
    from app.services.agent_generator import AgentGenerator
    generator = AgentGenerator()
    try:
        previews = await generator.preview(agent_id)
        return [FilePreviewResponse(path=p.path, content=p.content, language=p.language) for p in previews]
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{agent_id}/files", response_model=List[str])
async def list_agent_files(agent_id: UUID) -> List[str]:
    from app.services.agent_generator import AgentGenerator
    generator = AgentGenerator()
    try:
        return await generator.list_files(agent_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{agent_id}/files/{path:path}", response_model=FileContentResponse)
async def read_agent_file(agent_id: UUID, path: str) -> FileContentResponse:
    from app.services.agent_generator import AgentGenerator
    generator = AgentGenerator()
    try:
        content = await generator.read_file(agent_id, path)
        return FileContentResponse(path=path, content=content)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=404, detail=str(e))


# =============================================================================
# SDK Export
# =============================================================================


@router.get("/{agent_id}/export/sdk-code")
async def export_sdk_code(agent_id: UUID, db: DbSession) -> Dict[str, Any]:
    """Export agent as a runnable Python code snippet using ClaudeAgentOptions."""
    builder = SDKOptionsBuilder()
    try:
        data = await builder.build(agent_id, db)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    opts = data["options"]

    # Generate Python code
    lines = [
        '"""Auto-generated agent code from PACO."""',
        "",
        "import asyncio",
        "from claude_code_sdk import Claude, ClaudeAgentOptions, PermissionMode",
        "",
        "",
        "async def main():",
        f'    """Run the {data["agent"]["display_name"]} agent."""',
        "    options = ClaudeAgentOptions(",
        f'        model="{opts.get("model", "claude-sonnet-4-5-20250929")}",',
    ]

    if opts.get("system_prompt"):
        escaped = opts["system_prompt"].replace('"""', '\\"\\"\\"')
        lines.append(f'        system_prompt="""{escaped}""",')
    if opts.get("permission_mode") and opts["permission_mode"] != "default":
        lines.append(f'        permission_mode=PermissionMode.{opts["permission_mode"].upper()},')
    if opts.get("max_turns"):
        lines.append(f'        max_turns={opts["max_turns"]},')
    if opts.get("max_budget_usd"):
        lines.append(f'        max_budget_usd={opts["max_budget_usd"]},')
    if opts.get("allowed_tools"):
        tools_str = ", ".join(f'"{t}"' for t in opts["allowed_tools"])
        lines.append(f"        allowed_tools=[{tools_str}],")

    lines.extend([
        "    )",
        "",
        '    result = await Claude.query("Hello!", options=options)',
        "    for event in result:",
        "        print(event)",
        "",
        "",
        'if __name__ == "__main__":',
        "    asyncio.run(main())",
        "",
    ])

    return {
        "code": "\n".join(lines),
        "filename": f"{data['agent']['name'].replace('-', '_')}_agent.py",
        "options": opts,
    }
