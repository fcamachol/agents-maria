# MCP Gateway Implementation Guide for PACO

**Goal:** Implement a gateway that allows 1 MCP server to route to 100+ isolated contexts

---

## Quick Start: Recommended Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Client (IDE/Agent)                               │
│                         Connects to: https://paco.local/mcp                   │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                           PACO MCP Gateway                                    │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  1. Auth Middleware (JWT validation)                                    │  │
│  │  2. Context Resolver (JWT claim → context ID)                          │  │
│  │  3. Tool Router (Tool name → Backend URL)                              │  │
│  │  4. Proxy Handler (Forward request, stream response)                   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└─────────────────┬──────────────────────────┬─────────────────────────────────┘
                  │                          │
      ┌───────────▼──────────┐   ┌───────────▼──────────┐
      │  Shared Backends     │   │  Context Backends    │
      │  (10-20 services)    │   │  (100+ contexts)     │
      │                      │   │                      │
      │  • Weather           │   │  • CEA (water)       │
      │  • Maps              │   │  • Vehicles          │
      │  • Calendar          │   │  • Housing           │
      │  • etc.              │   │  • etc.              │
      └──────────────────────┘   └──────────────────────┘
```

---

## Implementation Option A: FastAPI Middleware (Immediate)

**Best for:** PACO's current architecture, quick deployment, full control

### Step 1: Create Gateway Module

```python
# paco/backend/app/mcp_gateway/__init__.py
"""MCP Gateway for routing to isolated contexts."""

from .router import MCPGatewayRouter
from .session import SessionManager
from .policies import ToolPolicyEngine

__all__ = ["MCPGatewayRouter", "SessionManager", "ToolPolicyEngine"]
```

### Step 2: Session Manager

```python
# paco/backend/app/mcp_gateway/session.py
import redis
import json
import hashlib
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

class Session:
    """An isolated MCP session bound to a context."""
    
    def __init__(self, session_id: str, context_id: str, user_id: str):
        self.id = session_id
        self.context_id = context_id
        self.user_id = user_id
        self.created_at = datetime.utcnow()
        self.last_accessed = datetime.utcnow()
        self.backend_sessions: Dict[str, str] = {}  # backend name -> backend session ID

class SessionManager:
    """Manages session isolation across contexts."""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.from_url(redis_url)
        self.ttl = 3600  # 1 hour
    
    def get_or_create(
        self, 
        session_id: Optional[str], 
        context_id: str, 
        user_id: str
    ) -> Session:
        """Get existing session or create new one."""
        if session_id:
            data = self.redis.get(f"mcp:session:{session_id}")
            if data:
                session_data = json.loads(data)
                # Verify context matches
                if session_data.get("context_id") == context_id:
                    return Session(**session_data)
        
        # Create new session
        new_session_id = self._generate_id(context_id, user_id)
        session = Session(new_session_id, context_id, user_id)
        self._save(session)
        return session
    
    def _save(self, session: Session):
        """Persist session to Redis."""
        self.redis.setex(
            f"mcp:session:{session.id}",
            self.ttl,
            json.dumps({
                "id": session.id,
                "context_id": session.context_id,
                "user_id": session.user_id,
                "backend_sessions": session.backend_sessions,
                "created_at": session.created_at.isoformat(),
            })
        )
    
    def _generate_id(self, context_id: str, user_id: str) -> str:
        """Generate deterministic session ID."""
        hash_input = f"{context_id}:{user_id}:{datetime.utcnow().timestamp()}"
        return hashlib.sha256(hash_input.encode()).hexdigest()[:32]
```

### Step 3: Tool Policy Engine

```python
# paco/backend/app/mcp_gateway/policies.py
from typing import List, Dict, Any, Optional
import fnmatch

class ToolPolicy:
    """Defines which tools a context can access."""
    
    def __init__(
        self, 
        context_id: str,
        allowed_tools: List[str],
        denied_tools: List[str] = None,
        shared_backends: List[str] = None
    ):
        self.context_id = context_id
        self.allowed_tools = set(allowed_tools)
        self.denied_tools = set(denied_tools or [])
        self.shared_backends = set(shared_backends or [])

class ToolPolicyEngine:
    """Enforces tool access policies per context."""
    
    # Tool routing configuration
    TOOL_ROUTING = {
        # CEA tools
        "cea_get_deuda": "cea-backend",
        "cea_get_consumo": "cea-backend", 
        "cea_create_ticket": "cea-backend",
        
        # Vehicle tools
        "vehicles_get_plates": "vehicles-backend",
        "vehicles_renewal": "vehicles-backend",
        
        # Shared tools (accessible by all)
        "shared_weather": "shared-weather",
        "shared_maps": "shared-maps",
    }
    
    # Backend URLs
    BACKENDS = {
        "cea-backend": "http://cea-mcp:8001/mcp",
        "vehicles-backend": "http://vehicles-mcp:8002/mcp",
        "shared-weather": "http://weather-mcp:9000/mcp",
        "shared-maps": "http://maps-mcp:9001/mcp",
    }
    
    def __init__(self):
        self.policies: Dict[str, ToolPolicy] = {}
    
    def register_policy(self, policy: ToolPolicy):
        """Register a policy for a context."""
        self.policies[policy.context_id] = policy
    
    def can_access(self, context_id: str, tool_name: str) -> bool:
        """Check if context can access a tool."""
        policy = self.policies.get(context_id)
        if not policy:
            return False
        
        # Check denied first
        for pattern in policy.denied_tools:
            if fnmatch.fnmatch(tool_name, pattern):
                return False
        
        # Check allowed
        for pattern in policy.allowed_tools:
            if fnmatch.fnmatch(tool_name, pattern):
                return True
        
        return False
    
    def resolve_backend(self, tool_name: str) -> Optional[str]:
        """Get backend URL for a tool."""
        backend_key = self.TOOL_ROUTING.get(tool_name)
        if backend_key:
            return self.BACKENDS.get(backend_key)
        return None
    
    def get_tools_for_context(self, context_id: str) -> List[Dict[str, Any]]:
        """Get list of tools accessible to a context."""
        policy = self.policies.get(context_id)
        if not policy:
            return []
        
        tools = []
        for tool_name, backend in self.TOOL_ROUTING.items():
            if self.can_access(context_id, tool_name):
                # Strip prefix for display
                display_name = tool_name
                if tool_name.startswith("shared_"):
                    display_name = tool_name[7:]  # Remove "shared_"
                tools.append({
                    "name": tool_name,
                    "display_name": display_name,
                    "backend": backend,
                })
        return tools
```

### Step 4: Gateway Router

```python
# paco/backend/app/mcp_gateway/router.py
import json
import httpx
from typing import Dict, Any, Optional
from fastapi import Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

from .session import SessionManager, Session
from .policies import ToolPolicyEngine

class MCPGatewayRouter:
    """Routes MCP requests to appropriate backends."""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.session_manager = SessionManager(redis_url)
        self.policies = ToolPolicyEngine()
        self.client = httpx.AsyncClient(timeout=60.0)
    
    async def handle_request(
        self, 
        request: Request,
        context_id: str,
        user_id: str,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Handle incoming MCP request."""
        
        # Get or create session
        session = self.session_manager.get_or_create(session_id, context_id, user_id)
        
        # Parse request body
        body = await request.body()
        try:
            rpc_req = json.loads(body)
        except json.JSONDecodeError:
            raise HTTPException(400, "Invalid JSON")
        
        method = rpc_req.get("method", "")
        
        # Handle initialization
        if method == "initialize":
            return await self._handle_initialize(session, rpc_req)
        
        # Handle tools/list
        if method == "tools/list":
            return self._handle_tools_list(session)
        
        # Handle tools/call
        if method == "tools/call":
            return await self._handle_tool_call(session, rpc_req)
        
        # Default: proxy to context's default backend
        return await self._proxy_request(session, rpc_req)
    
    async def _handle_initialize(
        self, 
        session: Session, 
        rpc_req: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle MCP initialization."""
        return {
            "jsonrpc": "2.0",
            "id": rpc_req.get("id"),
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                    "resources": {},
                },
                "serverInfo": {
                    "name": f"paco-gateway-{session.context_id}",
                    "version": "1.0.0",
                },
                "sessionId": session.id,
            }
        }
    
    def _handle_tools_list(self, session: Session) -> Dict[str, Any]:
        """Return tools available to this context."""
        tools = self.policies.get_tools_for_context(session.context_id)
        return {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "tools": [
                    {
                        "name": t["name"],
                        "description": f"Tool from {t['backend']}",
                        "inputSchema": {"type": "object"},
                    }
                    for t in tools
                ]
            }
        }
    
    async def _handle_tool_call(
        self, 
        session: Session, 
        rpc_req: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Route tool call to appropriate backend."""
        params = rpc_req.get("params", {})
        tool_name = params.get("name", "")
        
        # Check authorization
        if not self.policies.can_access(session.context_id, tool_name):
            raise HTTPException(403, f"Tool '{tool_name}' not accessible in this context")
        
        # Resolve backend
        backend_url = self.policies.resolve_backend(tool_name)
        if not backend_url:
            raise HTTPException(404, f"Backend for tool '{tool_name}' not found")
        
        # Rewrite tool name (strip context prefix if needed)
        original_tool_name = tool_name
        if "__" in tool_name:
            # Handle prefixed tools like "cea_get_deuda" -> "get_deuda"
            parts = tool_name.split("__")
            if len(parts) == 2:
                params["name"] = parts[1]
        
        # Forward request
        return await self._forward_to_backend(session, backend_url, rpc_req)
    
    async def _forward_to_backend(
        self, 
        session: Session, 
        backend_url: str, 
        rpc_req: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Forward request to backend and return response."""
        
        headers = {
            "Content-Type": "application/json",
            "X-Paco-Session-Id": session.id,
            "X-Paco-Context-Id": session.context_id,
            "X-Paco-User-Id": session.user_id,
        }
        
        # Add backend session ID if known
        backend_key = backend_url.split("/")[-2]  # Extract backend name
        if backend_key in session.backend_sessions:
            headers["Mcp-Session-Id"] = session.backend_sessions[backend_key]
        
        response = await self.client.post(
            backend_url,
            json=rpc_req,
            headers=headers
        )
        response.raise_for_status()
        
        result = response.json()
        
        # Capture backend session ID from response
        if "sessionId" in result.get("result", {}):
            session.backend_sessions[backend_key] = result["result"]["sessionId"]
            self.session_manager._save(session)
        
        return result
    
    async def _proxy_request(
        self, 
        session: Session, 
        rpc_req: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Default proxy to context's primary backend."""
        # Get primary backend for context
        backend_url = self._get_primary_backend(session.context_id)
        return await self._forward_to_backend(session, backend_url, rpc_req)
    
    def _get_primary_backend(self, context_id: str) -> str:
        """Get primary backend URL for a context."""
        # Map context IDs to their backends
        context_backends = {
            "cea": "http://cea-mcp:8001/mcp",
            "vehicles": "http://vehicles-mcp:8002/mcp",
            # ... more contexts
        }
        return context_backends.get(context_id, "http://default-mcp:8000/mcp")
```

### Step 5: FastAPI Routes

```python
# paco/backend/app/api/mcp_gateway.py
"""MCP Gateway API endpoints."""

from typing import Optional
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.security import HTTPBearer
from pydantic import BaseModel

from app.core.deps import CurrentUser
from app.mcp_gateway.router import MCPGatewayRouter

router = APIRouter(prefix="/mcp", tags=["MCP Gateway"])
security = HTTPBearer()

# Singleton router instance
gateway_router = MCPGatewayRouter()

class MCPRequest(BaseModel):
    jsonrpc: str = "2.0"
    method: str
    params: Optional[dict] = None
    id: Optional[int] = None

@router.post("/gateway")
async def mcp_gateway_endpoint(
    request: Request,
    current_user: CurrentUser,
):
    """
    Main MCP gateway endpoint.
    
    Routes MCP requests to appropriate backends based on:
    - User's context (from JWT)
    - Tool being invoked
    - Session affinity
    """
    # Extract context from user
    context_id = current_user.context_id  # Add to User model
    if not context_id:
        raise HTTPException(403, "User has no assigned context")
    
    # Get session ID from header if present
    session_id = request.headers.get("Mcp-Session-Id")
    
    # Route request
    response = await gateway_router.handle_request(
        request=request,
        context_id=context_id,
        user_id=str(current_user.id),
        session_id=session_id
    )
    
    return response

@router.get("/gateway/tools")
async def list_available_tools(
    current_user: CurrentUser,
):
    """List tools available to the current user's context."""
    context_id = current_user.context_id
    if not context_id:
        raise HTTPException(403, "User has no assigned context")
    
    tools = gateway_router.policies.get_tools_for_context(context_id)
    return {
        "context_id": context_id,
        "tools": tools,
    }
```

### Step 6: Database Migration

```python
# paco/backend/alembic/versions/008_add_user_context.py
"""Add context_id to users table."""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = '008_add_user_context'
down_revision = '007_add_proxy_config'

def upgrade():
    # Add context_id to users
    op.add_column('users', sa.Column('context_id', sa.String(100), nullable=True))
    op.create_index('ix_users_context_id', 'users', ['context_id'])
    
    # Create context definitions table
    op.create_table(
        'mcp_contexts',
        sa.Column('id', sa.String(100), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('backend_url', sa.String(500), nullable=False),
        sa.Column('allowed_tools', sa.JSON(), default=list),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

def downgrade():
    op.drop_table('mcp_contexts')
    op.drop_index('ix_users_context_id')
    op.drop_column('users', 'context_id')
```

---

## Implementation Option B: Envoy AI Gateway (Enterprise)

**Best for:** Large scale, multiple teams, enterprise requirements

### Docker Compose Setup

```yaml
# docker-compose.mcp-gateway.yml
version: '3.8'

services:
  envoy-gateway:
    image: envoyproxy/gateway:v1.2.0
    ports:
      - "8080:8080"
      - "8443:8443"
    volumes:
      - ./envoy-config:/config
    command: ["gateway", "run", "--config", "/config/gateway.yaml"]
    
  envoy-ai-gateway:
    image: envoyproxy/ai-gateway:v0.5.0
    environment:
      - EG_CONFIG=/config/ai-gateway.yaml
    volumes:
      - ./envoy-config:/config
    depends_on:
      - envoy-gateway
      
  # Context backends
  cea-mcp:
    build: ./contexts/cea
    environment:
      - PORT=8001
      - CONTEXT_ID=cea
      
  vehicles-mcp:
    build: ./contexts/vehicles
    environment:
      - PORT=8002
      - CONTEXT_ID=vehicles

# ... 100+ contexts
```

### MCPRoute Configuration

```yaml
# envoy-config/mcproute.yaml
apiVersion: aigateway.envoyproxy.io/v1alpha1
kind: MCPRoute
metadata:
  name: paco-multitenant-router
spec:
  parentRefs:
    - name: paco-gateway
      kind: Gateway
  path: "/mcp"
  
  # Backend routing based on tool prefix
  backendRefs:
    # CEA backend
    - name: cea-backend
      kind: Backend
      path: "/mcp"
      toolSelector:
        includeRegex:
          - "^cea_.*"  # All tools starting with cea_
      
    # Vehicles backend  
    - name: vehicles-backend
      kind: Backend
      path: "/mcp"
      toolSelector:
        includeRegex:
          - "^vehicles_.*"
          - "^placas_.*"
          - "^tenencia_.*"
    
    # Shared backends
    - name: shared-weather
      kind: Backend
      path: "/mcp"
      toolSelector:
        include:
          - shared_weather
          - shared_forecast

  # Security policy
  securityPolicy:
    oauth:
      issuer: "https://auth.paco.local"
      audiences:
        - "https://api.paco.local/mcp"
    
    authorization:
      rules:
        # Allow context-specific access
        - source:
            jwt:
              claims:
                paco_context: "cea"
          target:
            tools:
              - backend: "cea-backend"
          action: allow
          
      defaultAction: deny
```

---

## Scaling to 100+ Contexts

### Dynamic Context Registration

```python
# paco/backend/app/services/context_registry.py
"""Dynamic registration of contexts."""

from typing import Dict, List
from dataclasses import dataclass
import docker

@dataclass
class ContextDefinition:
    id: str
    name: str
    backend_url: str
    allowed_tools: List[str]
    container_image: str
    port: int

class ContextRegistry:
    """Manages dynamic registration of contexts."""
    
    def __init__(self):
        self.contexts: Dict[str, ContextDefinition] = {}
        self.docker_client = docker.from_env()
    
    def register(self, context: ContextDefinition):
        """Register a new context."""
        self.contexts[context.id] = context
        
        # Start container if not running
        self._ensure_container(context)
        
        # Update gateway policies
        self._update_policies(context)
    
    def _ensure_container(self, context: ContextDefinition):
        """Ensure context container is running."""
        container_name = f"paco-mcp-{context.id}"
        
        try:
            container = self.docker_client.containers.get(container_name)
            if container.status != "running":
                container.start()
        except docker.errors.NotFound:
            # Create and start
            self.docker_client.containers.run(
                image=context.container_image,
                name=container_name,
                ports={f"{context.port}/tcp": context.port},
                environment={
                    "CONTEXT_ID": context.id,
                    "PORT": str(context.port),
                },
                network="paco-mcp-network",
                detach=True,
            )
    
    def _update_policies(self, context: ContextDefinition):
        """Update gateway policies for new context."""
        # Add to policy engine
        from app.mcp_gateway.policies import ToolPolicy
        
        policy = ToolPolicy(
            context_id=context.id,
            allowed_tools=context.allowed_tools,
            shared_backends=["shared_weather", "shared_maps"]
        )
        
        # Register with gateway
        from app.api.mcp_gateway import gateway_router
        gateway_router.policies.register_policy(policy)
        
        # Add backend mapping
        gateway_router.policies.BACKENDS[f"{context.id}-backend"] = context.backend_url
        
        # Add tool routing for this context's tools
        for tool in context.allowed_tools:
            if not tool.startswith("shared_"):
                gateway_router.policies.TOOL_ROUTING[tool] = f"{context.id}-backend"
```

### Horizontal Scaling

```yaml
# docker-compose.scale.yml
version: '3.8'

services:
  gateway:
    image: paco/mcp-gateway:latest
    deploy:
      replicas: 3
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://... 
    
  context-worker:
    image: paco/mcp-context:latest
    deploy:
      replicas: 10  # Template for all contexts
    environment:
      - CONTEXT_TEMPLATE=true
```

---

## Monitoring & Observability

### Metrics

```python
# paco/backend/app/mcp_gateway/metrics.py
from prometheus_client import Counter, Histogram, Gauge

# Request metrics
mcp_requests_total = Counter(
    'mcp_requests_total',
    'Total MCP requests',
    ['context_id', 'tool_name', 'backend']
)

mcp_request_duration = Histogram(
    'mcp_request_duration_seconds',
    'Request duration',
    ['context_id', 'backend']
)

# Session metrics
active_sessions = Gauge(
    'mcp_active_sessions',
    'Number of active sessions',
    ['context_id']
)

# Error metrics
mcp_errors_total = Counter(
    'mcp_errors_total',
    'Total errors',
    ['context_id', 'error_type']
)
```

### Logging

```python
import structlog

logger = structlog.get_logger()

# In request handler:
logger.info(
    "mcp_request",
    context_id=session.context_id,
    session_id=session.id,
    tool_name=tool_name,
    backend=backend_url,
    duration_ms=latency,
)
```

---

## Migration Path

### Phase 1: Side-by-Side (Weeks 1-2)
```
Existing: client → agent → individual MCP servers
New:      client → agent → /mcp/gateway (optional)
```

### Phase 2: Gateway Default (Weeks 3-4)
```
client → agent → /mcp/gateway (default)
              → individual servers (fallback)
```

### Phase 3: Full Migration (Week 5+)
```
client → agent → /mcp/gateway (only)
```

---

## Testing Strategy

### Unit Tests

```python
# tests/test_mcp_gateway.py
import pytest
from app.mcp_gateway.policies import ToolPolicy, ToolPolicyEngine

class TestToolPolicyEngine:
    def test_can_access_allowed_tool(self):
        engine = ToolPolicyEngine()
        engine.register_policy(ToolPolicy(
            context_id="cea",
            allowed_tools=["cea_get_deuda", "cea_create_ticket"]
        ))
        
        assert engine.can_access("cea", "cea_get_deuda") is True
        assert engine.can_access("cea", "unauthorized_tool") is False
    
    def test_resolve_backend(self):
        engine = ToolPolicyEngine()
        url = engine.resolve_backend("cea_get_deuda")
        assert url == "http://cea-mcp:8001/mcp"
```

### Integration Tests

```python
@pytest.mark.asyncio
async def test_gateway_routing(client):
    # Create user with context
    response = await client.post("/mcp/gateway", json={
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "cea_get_deuda",
            "arguments": {"contrato": "12345"}
        },
        "id": 1
    }, headers={"Authorization": "Bearer cea-user-token"})
    
    assert response.status_code == 200
    data = response.json()
    assert "result" in data
```

---

## Security Checklist

- [ ] JWT validation with proper signature verification
- [ ] Context isolation enforced at all layers
- [ ] Tool authorization before forwarding
- [ ] Rate limiting per context
- [ ] Request/response sanitization
- [ ] Audit logging for all tool calls
- [ ] Circuit breakers for backend failures
- [ ] TLS between all services
- [ ] Secret management (not in code)
- [ ] Regular security scans
