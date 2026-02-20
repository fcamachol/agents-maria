"""add managed MCP server and handler columns

Adds columns to mcp_servers for container management (deployment_mode,
container_id, container_name, host_port, image_tag, deploy_status,
deploy_error, last_deployed_at) and to tools for handler configuration
(handler_type, handler_config, output_transform, retry_config, timeout_ms).

Revision ID: 008_add_managed_mcp_columns
Revises: 007_add_proxy_config
Create Date: 2026-02-19
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "008_add_managed_mcp_columns"
down_revision = "007_add_proxy_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # McpServer — managed deployment columns
    op.add_column(
        "mcp_servers",
        sa.Column("deployment_mode", sa.String(50), server_default="external", nullable=False),
    )
    op.add_column(
        "mcp_servers",
        sa.Column("container_id", sa.String(100), nullable=True),
    )
    op.add_column(
        "mcp_servers",
        sa.Column("container_name", sa.String(255), nullable=True),
    )
    op.add_column(
        "mcp_servers",
        sa.Column("host_port", sa.Integer, nullable=True),
    )
    op.add_column(
        "mcp_servers",
        sa.Column("image_tag", sa.String(255), server_default="latest", nullable=False),
    )
    op.add_column(
        "mcp_servers",
        sa.Column("deploy_status", sa.String(50), server_default="undeployed", nullable=False),
    )
    op.add_column(
        "mcp_servers",
        sa.Column("deploy_error", sa.Text, nullable=True),
    )
    op.add_column(
        "mcp_servers",
        sa.Column("last_deployed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Tool — handler configuration columns
    op.add_column(
        "tools",
        sa.Column("handler_type", sa.String(50), nullable=True),
    )
    op.add_column(
        "tools",
        sa.Column("handler_config", JSONB, nullable=True),
    )
    op.add_column(
        "tools",
        sa.Column("output_transform", sa.Text, nullable=True),
    )
    op.add_column(
        "tools",
        sa.Column("retry_config", JSONB, nullable=True),
    )
    op.add_column(
        "tools",
        sa.Column("timeout_ms", sa.Integer, nullable=True),
    )


def downgrade() -> None:
    # Tool columns
    op.drop_column("tools", "timeout_ms")
    op.drop_column("tools", "retry_config")
    op.drop_column("tools", "output_transform")
    op.drop_column("tools", "handler_config")
    op.drop_column("tools", "handler_type")

    # McpServer columns
    op.drop_column("mcp_servers", "last_deployed_at")
    op.drop_column("mcp_servers", "deploy_error")
    op.drop_column("mcp_servers", "deploy_status")
    op.drop_column("mcp_servers", "image_tag")
    op.drop_column("mcp_servers", "host_port")
    op.drop_column("mcp_servers", "container_name")
    op.drop_column("mcp_servers", "container_id")
    op.drop_column("mcp_servers", "deployment_mode")
