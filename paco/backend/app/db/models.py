"""
PACO Database Models

SQLAlchemy ORM models matching the database schema.
"""

from datetime import date, datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models."""

    pass


class User(Base):
    """User model for authentication and authorization."""

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Relationships
    api_keys: Mapped[List["ApiKey"]] = relationship(back_populates="user")


class McpServer(Base):
    """MCP Server registry."""

    __tablename__ = "mcp_servers"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    transport: Mapped[str] = mapped_column(String(50), default="stdio")
    url: Mapped[Optional[str]] = mapped_column(String(500))
    proxy_url: Mapped[Optional[str]] = mapped_column(String(500))
    command: Mapped[Optional[str]] = mapped_column(Text)
    args: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=list)
    env: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    auth_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    proxy_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="unknown")
    last_health_check: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Managed deployment columns
    deployment_mode: Mapped[str] = mapped_column(String(50), default="external")
    container_id: Mapped[Optional[str]] = mapped_column(String(100))
    container_name: Mapped[Optional[str]] = mapped_column(String(255))
    host_port: Mapped[Optional[int]] = mapped_column(Integer)
    image_tag: Mapped[str] = mapped_column(String(255), default="latest")
    deploy_status: Mapped[str] = mapped_column(String(50), default="undeployed")
    deploy_error: Mapped[Optional[str]] = mapped_column(Text)
    last_deployed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    tools: Mapped[List["Tool"]] = relationship(back_populates="mcp_server")


class Tool(Base):
    """Tool registry."""

    __tablename__ = "tools"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    mcp_server_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("mcp_servers.id", ondelete="CASCADE")
    )
    input_schema: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    output_schema: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    proxy_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)

    # Handler configuration columns
    handler_type: Mapped[Optional[str]] = mapped_column(String(50))
    handler_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)
    output_transform: Mapped[Optional[str]] = mapped_column(Text)
    retry_config: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)
    timeout_ms: Mapped[Optional[int]] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    mcp_server: Mapped[Optional["McpServer"]] = relationship(back_populates="tools")


class Skill(Base):
    """Reusable skill definitions — index-only DB record.

    Content lives on the filesystem as SKILL.md files.
    DB stores only the index for querying and agent associations.
    """

    __tablename__ = "skills"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    skill_path: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    agent_skills: Mapped[List["AgentSkill"]] = relationship(
        back_populates="skill", cascade="all, delete-orphan"
    )


class Agent(Base):
    """SDK-aligned agent definition.

    Fields map directly to ClaudeAgentOptions where applicable.
    """

    __tablename__ = "agents"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="stopped")
    pm2_name: Mapped[Optional[str]] = mapped_column(String(255))
    port: Mapped[Optional[int]] = mapped_column(Integer)
    project_path: Mapped[Optional[str]] = mapped_column(Text)
    health_endpoint: Mapped[str] = mapped_column(String(255), default="/health")
    last_health_check: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # ClaudeAgentOptions fields
    model: Mapped[str] = mapped_column(String(255), default="claude-sonnet-4-5-20250929")
    system_prompt: Mapped[Optional[str]] = mapped_column(Text)
    permission_mode: Mapped[str] = mapped_column(String(50), default="default")
    max_turns: Mapped[Optional[int]] = mapped_column(Integer)
    max_budget_usd: Mapped[Optional[float]] = mapped_column(Numeric(10, 2))
    max_thinking_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    sdk_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    env_vars: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    lightning_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    runtime: Mapped[str] = mapped_column(String(100), default="typescript-claude-sdk")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    executions: Mapped[List["Execution"]] = relationship(back_populates="agent")
    agent_tools: Mapped[List["AgentTool"]] = relationship(
        back_populates="agent", cascade="all, delete-orphan"
    )
    agent_skills: Mapped[List["AgentSkill"]] = relationship(
        back_populates="agent", cascade="all, delete-orphan"
    )


class AgentSkill(Base):
    """Links an agent to a skill (simple enable/disable)."""

    __tablename__ = "agent_skills"
    __table_args__ = (
        UniqueConstraint("agent_id", "skill_id", name="uq_agent_skill"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    agent_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
    )
    skill_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("skills.id", ondelete="CASCADE"),
        nullable=False,
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    agent: Mapped["Agent"] = relationship(back_populates="agent_skills")
    skill: Mapped["Skill"] = relationship(back_populates="agent_skills")


class AgentTool(Base):
    """Links agents to tools from the MCP registry."""

    __tablename__ = "agent_tools"
    __table_args__ = (
        UniqueConstraint("agent_id", "tool_id", name="uq_agent_tool"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    agent_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False,
    )
    tool_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("tools.id", ondelete="CASCADE"),
        nullable=False,
    )
    is_required: Mapped[bool] = mapped_column(Boolean, default=True)
    config_overrides: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    agent: Mapped["Agent"] = relationship(back_populates="agent_tools")
    tool: Mapped["Tool"] = relationship()


class Execution(Base):
    """Execution logs with token tracking."""

    __tablename__ = "executions"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    agent_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL")
    )
    conversation_id: Mapped[Optional[str]] = mapped_column(String(255))
    trace_id: Mapped[Optional[str]] = mapped_column(String(255))
    langfuse_trace_id: Mapped[Optional[str]] = mapped_column(String(255))
    user_id: Mapped[Optional[str]] = mapped_column(String(255))
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_cost: Mapped[float] = mapped_column(Numeric(10, 6), default=0)
    model: Mapped[Optional[str]] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(50), default="running")
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    extra_metadata: Mapped[Dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)

    # Relationships
    agent: Mapped[Optional["Agent"]] = relationship(back_populates="executions")
    tool_calls: Mapped[List["ToolCall"]] = relationship(back_populates="execution")


class ToolCall(Base):
    """Tool call logs."""

    __tablename__ = "tool_calls"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    execution_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("executions.id", ondelete="CASCADE")
    )
    tool_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("tools.id", ondelete="SET NULL")
    )
    tool_name: Mapped[str] = mapped_column(String(255), nullable=False)
    input: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    output: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    called_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    execution: Mapped[Optional["Execution"]] = relationship(back_populates="tool_calls")


class Flow(Base):
    """Flow definitions."""

    __tablename__ = "flows"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    config_yaml: Mapped[str] = mapped_column(Text, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    created_by: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )


class FlowExecution(Base):
    """Flow execution logs."""

    __tablename__ = "flow_executions"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    flow_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("flows.id", ondelete="SET NULL")
    )
    trigger_type: Mapped[Optional[str]] = mapped_column(String(100))
    trigger_data: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="running")
    current_step: Mapped[Optional[str]] = mapped_column(String(255))
    state: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[Optional[str]] = mapped_column(Text)


class ApiKey(Base):
    """API keys for programmatic access."""

    __tablename__ = "api_keys"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    prefix: Mapped[str] = mapped_column(String(10), nullable=False)
    permissions: Mapped[List[str]] = mapped_column(JSONB, default=["read"])
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    user: Mapped["User"] = relationship(back_populates="api_keys")


# =============================================================================
# Infrastructure Models (Multi-Agent Systems)
# =============================================================================


class Infrastructure(Base):
    """Multi-agent infrastructure project."""

    __tablename__ = "infrastructures"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="draft")
    type: Mapped[str] = mapped_column(String(50), default="orchestrator")
    project_path: Mapped[Optional[str]] = mapped_column(Text)
    port_range_start: Mapped[int] = mapped_column(Integer, default=8000)
    env_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    security_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    db_name: Mapped[Optional[str]] = mapped_column(String(255))
    redis_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    lightning_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    version: Mapped[str] = mapped_column(String(50), default="1.0.0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    orchestrator: Mapped[Optional["InfraOrchestrator"]] = relationship(
        back_populates="infrastructure", uselist=False, cascade="all, delete-orphan"
    )
    agents: Mapped[List["InfraAgent"]] = relationship(
        back_populates="infrastructure", cascade="all, delete-orphan"
    )
    deployments: Mapped[List["InfraDeployment"]] = relationship(
        back_populates="infrastructure", cascade="all, delete-orphan"
    )
    health_checks: Mapped[List["InfraHealthCheck"]] = relationship(
        back_populates="infrastructure", cascade="all, delete-orphan"
    )
    metrics: Mapped[List["InfraMetric"]] = relationship(
        back_populates="infrastructure", cascade="all, delete-orphan"
    )
    hive_coordinator: Mapped[Optional["HiveCoordinator"]] = relationship(
        back_populates="infrastructure", uselist=False, cascade="all, delete-orphan"
    )
    company_config: Mapped[Optional["CompanyConfig"]] = relationship(
        back_populates="infrastructure", uselist=False, cascade="all, delete-orphan"
    )


class HiveCoordinator(Base):
    """Coordinator configuration for a hive infrastructure."""

    __tablename__ = "hive_coordinators"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    coordinator_model: Mapped[str] = mapped_column(
        String(255), default="claude-sonnet-4-5-20250929"
    )
    coordinator_temperature: Mapped[float] = mapped_column(Numeric(3, 2), default=0.1)
    decomposition_prompt: Mapped[Optional[str]] = mapped_column(Text)
    max_concurrent_tasks: Mapped[int] = mapped_column(Integer, default=5)
    task_timeout: Mapped[int] = mapped_column(Integer, default=300)
    max_retries: Mapped[int] = mapped_column(Integer, default=2)
    aggregation_strategy: Mapped[str] = mapped_column(String(50), default="merge")
    aggregation_prompt: Mapped[Optional[str]] = mapped_column(Text)
    plan_mode_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(50), default="stopped")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    infrastructure: Mapped["Infrastructure"] = relationship(
        back_populates="hive_coordinator"
    )


class HiveTask(Base):
    """Task within a hive execution."""

    __tablename__ = "hive_tasks"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    execution_id: Mapped[Optional[str]] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    active_form: Mapped[Optional[str]] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(50), default="pending")
    assigned_agent_slug: Mapped[Optional[str]] = mapped_column(String(255))
    priority: Mapped[int] = mapped_column(Integer, default=0)
    result: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    blocked_by: Mapped[List[str]] = mapped_column(JSONB, default=list)
    blocks: Mapped[List[str]] = mapped_column(JSONB, default=list)
    extra_metadata: Mapped[Dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    infrastructure: Mapped["Infrastructure"] = relationship()


class HiveMessage(Base):
    """Message within a hive execution."""

    __tablename__ = "hive_messages"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    execution_id: Mapped[Optional[str]] = mapped_column(String(255))
    message_type: Mapped[str] = mapped_column(String(50), default="message")
    sender_slug: Mapped[Optional[str]] = mapped_column(String(255))
    recipient_slug: Mapped[Optional[str]] = mapped_column(String(255))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(String(500))
    extra_metadata: Mapped[Dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="sent")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    infrastructure: Mapped["Infrastructure"] = relationship()


class InfraOrchestrator(Base):
    """Orchestrator configuration for an infrastructure."""

    __tablename__ = "infra_orchestrators"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    classification_model: Mapped[str] = mapped_column(
        String(255), default="claude-sonnet-4-5-20250929"
    )
    classification_temperature: Mapped[float] = mapped_column(
        Numeric(3, 2), default=0.1
    )
    keyword_map: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    classification_prompt: Mapped[Optional[str]] = mapped_column(Text)
    fallback_agent: Mapped[Optional[str]] = mapped_column(String(255))
    agent_timeout: Mapped[float] = mapped_column(Numeric(5, 1), default=30.0)
    circuit_breaker_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="stopped")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    infrastructure: Mapped["Infrastructure"] = relationship(
        back_populates="orchestrator"
    )


class InfraAgent(Base):
    """References an agent within an infrastructure (composition, not definition).

    Keeps legacy fields (agent_id_slug, system_prompts, etc.) for backward
    compatibility with existing gobierno-queretaro infrastructure definitions.
    New agents should use agent_id to reference a standalone Agent record.
    """

    __tablename__ = "infra_agents"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    # NEW: optional reference to a standalone agent
    agent_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("agents.id", ondelete="SET NULL"),
    )
    role: Mapped[str] = mapped_column(String(50), default="primary")
    port_override: Mapped[Optional[int]] = mapped_column(Integer)
    env_overrides: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)

    # Legacy fields (kept for backward compat with existing infra definitions)
    agent_id_slug: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text)
    category_code: Mapped[str] = mapped_column(String(50), nullable=False)
    system_prompts: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    tools_config: Mapped[List[Any]] = mapped_column(JSONB, default=list)
    task_types: Mapped[List[str]] = mapped_column(JSONB, default=list)
    keywords: Mapped[List[str]] = mapped_column(JSONB, default=list)
    confidentiality_level: Mapped[str] = mapped_column(String(50), default="INTERNAL")
    capabilities: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    port: Mapped[Optional[int]] = mapped_column(Integer)
    version: Mapped[str] = mapped_column(String(50), default="1.0.0")
    status: Mapped[str] = mapped_column(String(50), default="stopped")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    infrastructure: Mapped["Infrastructure"] = relationship(back_populates="agents")
    agent: Mapped[Optional["Agent"]] = relationship()


class InfraDeployment(Base):
    """Deployment history for an infrastructure."""

    __tablename__ = "infra_deployments"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    version: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="pending")
    docker_compose_snapshot: Mapped[Optional[str]] = mapped_column(Text)
    changes_summary: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    infrastructure: Mapped["Infrastructure"] = relationship(
        back_populates="deployments"
    )


class InfraHealthCheck(Base):
    """Health check results for infrastructure services."""

    __tablename__ = "infra_health_checks"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    service_name: Mapped[str] = mapped_column(String(255), nullable=False)
    service_type: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    response_time_ms: Mapped[Optional[int]] = mapped_column(Integer)
    circuit_state: Mapped[Optional[str]] = mapped_column(String(50))
    details: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    infrastructure: Mapped["Infrastructure"] = relationship(
        back_populates="health_checks"
    )


class InfraMetric(Base):
    """Per-agent metrics for an infrastructure."""

    __tablename__ = "infra_metrics"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    agent_slug: Mapped[Optional[str]] = mapped_column(String(255))
    period_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    period_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    total_requests: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_errors: Mapped[int] = mapped_column(Integer, default=0)
    avg_latency_ms: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    classification_accuracy: Mapped[Optional[float]] = mapped_column(Numeric(5, 4))
    details: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationship
    infrastructure: Mapped["Infrastructure"] = relationship(
        back_populates="metrics"
    )


class BuilderSession(Base):
    """Agent Builder session — tracks conversational agent creation."""

    __tablename__ = "builder_sessions"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    user_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    agent_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("agents.id", ondelete="SET NULL")
    )
    title: Mapped[str] = mapped_column(String(255), default="New Agent")
    status: Mapped[str] = mapped_column(String(50), default="active")
    conversation_history: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, default=list)
    draft_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    artifacts: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, default=list)
    phase: Mapped[str] = mapped_column(String(50), default="understand")
    total_input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    agent: Mapped[Optional["Agent"]] = relationship()
    user: Mapped[Optional["User"]] = relationship()


# =============================================================================
# Company Infrastructure Models (Agent Employees with Heartbeat)
# =============================================================================


class CompanyConfig(Base):
    """Company configuration for an infrastructure (one per infrastructure)."""

    __tablename__ = "company_configs"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    heartbeat_interval_seconds: Mapped[int] = mapped_column(Integer, default=1800)
    default_model: Mapped[str] = mapped_column(String(255), default="claude-haiku-4-5-20251001")
    timezone: Mapped[str] = mapped_column(String(100), default="America/Mexico_City")
    active_hours_start: Mapped[str] = mapped_column(String(10), default="08:00")
    active_hours_end: Mapped[str] = mapped_column(String(10), default="20:00")
    working_days: Mapped[List[int]] = mapped_column(JSONB, default=[1, 2, 3, 4, 5])
    heartbeat_prompt: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="stopped")
    config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Supervisor mode settings
    supervisor_mode: Mapped[bool] = mapped_column(Boolean, default=True)
    missed_heartbeat_threshold: Mapped[int] = mapped_column(Integer, default=3)
    auto_recovery_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    morning_standup_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    standup_cron: Mapped[str] = mapped_column(String(255), default="0 9 * * 1-5")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    infrastructure: Mapped["Infrastructure"] = relationship(
        back_populates="company_config"
    )


class CompanyDepartment(Base):
    """Organizational department within a company infrastructure."""

    __tablename__ = "company_departments"
    __table_args__ = (
        UniqueConstraint("infrastructure_id", "name", name="uq_company_dept_name"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text)
    parent_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("company_departments.id", ondelete="SET NULL"),
    )
    manager_agent_slug: Mapped[Optional[str]] = mapped_column(String(255))
    config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    infrastructure: Mapped["Infrastructure"] = relationship()
    parent: Mapped[Optional["CompanyDepartment"]] = relationship(
        remote_side="CompanyDepartment.id"
    )


class CompanyRole(Base):
    """Agent-employee role assignment within a company infrastructure."""

    __tablename__ = "company_roles"
    __table_args__ = (
        UniqueConstraint("infrastructure_id", "agent_slug", name="uq_company_role_agent"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    agent_slug: Mapped[str] = mapped_column(String(255), nullable=False)
    department_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("company_departments.id", ondelete="SET NULL"),
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    role_type: Mapped[str] = mapped_column(String(50), default="employee")
    reports_to_slug: Mapped[Optional[str]] = mapped_column(String(255))
    goals: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    working_hours: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    checklist_md: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    hired_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    infrastructure: Mapped["Infrastructure"] = relationship()
    department: Mapped[Optional["CompanyDepartment"]] = relationship()


class CompanySchedule(Base):
    """Heartbeat + cron schedule definitions per agent."""

    __tablename__ = "company_schedules"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    agent_slug: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    schedule_type: Mapped[str] = mapped_column(String(50), nullable=False)  # heartbeat | cron | interval
    cron_expression: Mapped[Optional[str]] = mapped_column(String(255))
    interval_seconds: Mapped[Optional[int]] = mapped_column(Integer)
    checklist_md: Mapped[Optional[str]] = mapped_column(Text)
    prompt_template: Mapped[Optional[str]] = mapped_column(Text)
    active_hours_start: Mapped[Optional[str]] = mapped_column(String(10))
    active_hours_end: Mapped[Optional[str]] = mapped_column(String(10))
    timezone: Mapped[Optional[str]] = mapped_column(String(100))
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_triggered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    next_trigger_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    config: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    infrastructure: Mapped["Infrastructure"] = relationship()


class CompanyTask(Base):
    """Execution record for company heartbeats and scheduled jobs."""

    __tablename__ = "company_tasks"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    schedule_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("company_schedules.id", ondelete="SET NULL"),
    )
    agent_slug: Mapped[str] = mapped_column(String(255), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    task_type: Mapped[str] = mapped_column(String(50), nullable=False)  # heartbeat_check | scheduled_job | ad_hoc | delegated | collaboration | escalation
    status: Mapped[str] = mapped_column(String(50), default="pending")
    priority: Mapped[int] = mapped_column(Integer, default=5)
    input_data: Mapped[Dict[str, Any]] = mapped_column(JSONB, default=dict)
    result: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    cost_usd: Mapped[Optional[float]] = mapped_column(Numeric(10, 6))
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    langfuse_trace_id: Mapped[Optional[str]] = mapped_column(String(255))
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer)
    # Delegation fields
    requested_by_slug: Mapped[Optional[str]] = mapped_column(String(255))
    parent_task_id: Mapped[Optional[UUID]] = mapped_column(PG_UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    infrastructure: Mapped["Infrastructure"] = relationship()
    schedule: Mapped[Optional["CompanySchedule"]] = relationship()


class CompanyWorkLog(Base):
    """Daily work diary per agent."""

    __tablename__ = "company_work_logs"
    __table_args__ = (
        UniqueConstraint(
            "infrastructure_id", "agent_slug", "log_date",
            name="uq_company_worklog_agent_date",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    agent_slug: Mapped[str] = mapped_column(String(255), nullable=False)
    log_date: Mapped[date] = mapped_column(Date, nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(Text)
    entries: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, default=list)
    memory_notes: Mapped[Optional[str]] = mapped_column(Text)
    tasks_completed: Mapped[int] = mapped_column(Integer, default=0)
    tasks_failed: Mapped[int] = mapped_column(Integer, default=0)
    total_cost_usd: Mapped[Optional[float]] = mapped_column(Numeric(10, 6))
    total_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    infrastructure: Mapped["Infrastructure"] = relationship()


class CompanyMessage(Base):
    """Inter-agent messages within a company infrastructure."""

    __tablename__ = "company_messages"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    infrastructure_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("infrastructures.id", ondelete="CASCADE"),
        nullable=False,
    )
    sender_slug: Mapped[str] = mapped_column(String(255), nullable=False)
    recipient_slug: Mapped[Optional[str]] = mapped_column(String(255))  # null = broadcast
    department_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("company_departments.id", ondelete="SET NULL"),
    )
    message_type: Mapped[str] = mapped_column(String(50), nullable=False)  # direct | broadcast | task_request | task_result | escalation
    subject: Mapped[Optional[str]] = mapped_column(String(500))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    extra_metadata: Mapped[Dict[str, Any]] = mapped_column("metadata", JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(50), default="sent")  # sent | delivered | read | archived
    parent_message_id: Mapped[Optional[UUID]] = mapped_column(PG_UUID(as_uuid=True))  # threading
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    infrastructure: Mapped["Infrastructure"] = relationship()
    department: Mapped[Optional["CompanyDepartment"]] = relationship()


class Process(Base):
    """Process analysis record from the Process Builder pipeline."""

    __tablename__ = "processes"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    department: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="analyzing")
    extraction_md: Mapped[Optional[str]] = mapped_column(Text)
    as_is_analysis_md: Mapped[Optional[str]] = mapped_column(Text)
    compliance_audit_md: Mapped[Optional[str]] = mapped_column(Text)
    to_be_optimization_md: Mapped[Optional[str]] = mapped_column(Text)
    implementation_plan_md: Mapped[Optional[str]] = mapped_column(Text)
    executive_summary_md: Mapped[Optional[str]] = mapped_column(Text)
    diagram_as_is: Mapped[Optional[str]] = mapped_column(Text)
    diagram_to_be_digital: Mapped[Optional[str]] = mapped_column(Text)
    diagram_to_be_hybrid: Mapped[Optional[str]] = mapped_column(Text)
    run_metadata: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)
    model_used: Mapped[Optional[str]] = mapped_column(String(100))
    source_files: Mapped[Optional[List[str]]] = mapped_column(JSONB)
    tags: Mapped[Optional[List[str]]] = mapped_column(JSONB)
    created_by: Mapped[Optional[UUID]] = mapped_column(PG_UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
