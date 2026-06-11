# MCP Proxy/Gateway Patterns for Isolated Contexts

**Research Date:** 2026-02-19  
**Purpose:** Architectural patterns to enable PACO to use 1 MCP server container that proxies/routes to 100+ isolated contexts

---

## Executive Summary

This research analyzes 5 architectural patterns for MCP (Model Context Protocol) proxy/gateway that provide isolation between contexts while maintaining a unified entry point. The goal is to allow PACO to scale from managing individual MCP servers per context to a centralized gateway pattern that routes to 100+ isolated backend contexts securely.

---

## Pattern 1: Single MCP Gateway with Context-Aware Routing

### Overview
A single MCP gateway container acts as the entry point, routing requests to isolated backend contexts based on session headers, JWT claims, or URL paths.

### Architecture
```
┌─────────────────────────────────────────────────────────────────────┐
│                      MCP Gateway Container                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │  Router      │  │  Session     │  │  Context Resolver        │   │
│  │  (Path/Tool) │──│  Manager     │──│  (JWT/Header → Context)  │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
│         │                                                            │
│         ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              Backend Connection Pool                         │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐        ┌────────┐          │    │
│  │  │Context │ │Context │ │Context │  ...   │Context │          │    │
│  │  │   1    │ │   2    │ │   3    │        │  100+  │          │    │
│  │  └────────┘ └────────┘ └────────┘        └────────┘          │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Responsibility | Technology Options |
|-----------|---------------|-------------------|
| Router | Parses incoming MCP requests, extracts routing key | Custom middleware, Envoy, Nginx |
| Session Manager | Maintains session-to-context mappings | Redis, in-memory, distributed cache |
| Context Resolver | Maps auth claims to backend context | JWT parser, custom auth service |
| Connection Pool | Manages connections to backend MCP servers | HTTP/2 multiplexing, connection reuse |

### Isolation Mechanisms
- **Session ID-based routing:** Each session is bound to a specific context
- **JWT claim extraction:** `x-paco-context-id` header or JWT claim determines backend
- **Tool name prefixing:** `context1__tool_name`, `context2__tool_name` for disambiguation

### Implementation Example (Envoy AI Gateway)
```yaml
apiVersion: aigateway.envoyproxy.io/v1alpha1
kind: MCPRoute
metadata:
  name: paco-context-router
spec:
  parentRefs:
    - name: paco-gateway
      kind: Gateway
  path: "/mcp"
  backendRefs:
    - name: context-pool
      kind: Backend
      group: gateway.envoyproxy.io
      # Routing based on header
      headerSelectors:
        - name: x-paco-context-id
          valueRegex: "ctx-[a-z0-9-]+"
```

### Pros & Cons
| Pros | Cons |
|------|------|
| Single entry point simplifies client config | Gateway becomes a single point of failure |
| Centralized auth, logging, rate limiting | Requires careful session affinity |
| Can aggregate tools from multiple contexts | Increased latency (extra hop) |
| Scales horizontally with proper design | Complex debugging for routing issues |

---

## Pattern 2: Reverse Proxy with Per-Tool Routing Rules

### Overview
Layer 7 reverse proxy (Nginx, Envoy, Traefik) routes MCP requests based on the tool being invoked, maintaining separate backend pools per context.

### Architecture
```
                    ┌─────────────────────┐
                    │   Client Request    │
                    │  (JSON-RPC POST)    │
                    └──────────┬──────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Layer 7 Reverse Proxy                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  JSON-RPC Inspector                                  │   │
│  │  • Parse method (tools/call)                         │   │
│  │  • Extract tool name from params                     │   │
│  │  • Apply routing rules                               │   │
│  └─────────────────────────────────────────────────────┘   │
└────────┬────────────────────────┬─────────────────┬─────────┘
         │                        │                 │
         ▼                        ▼                 ▼
┌──────────────┐         ┌──────────────┐   ┌──────────────┐
│ Context A    │         │ Context B    │   │ Context C    │
│ Backend      │         │ Backend      │   │ Backend      │
│ (ports 8001) │         │ (port 8002)  │   │ (port 8003)  │
└──────────────┘         └──────────────┘   └──────────────┘
```

### Routing Rule Examples

**Nginx with Lua (JSON-RPC inspection):**
```nginx
location /mcp {
    access_by_lua_block {
        local cjson = require "cjson"
        ngx.req.read_body()
        local body = ngx.req.get_body_data()
        local req = cjson.decode(body)
        
        -- Extract tool name
        local tool_name = req.params and req.params.name
        
        -- Route based on tool prefix
        if tool_name and tool_name:match("^cea_") then
            ngx.var.backend = "cea_backend"
        elseif tool_name and tool_name:match("^water_") then
            ngx.var.backend = "water_backend"
        end
    }
    
    proxy_pass http://$backend;
}
```

**Envoy with WASM/ext_proc:**
```yaml
http_filters:
  - name: ext_proc
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_proc.v3.ExternalProcessor
      grpc_service:
        envoy_grpc:
          cluster_name: mcp_router
      processing_mode:
        request_body_mode: STREAMED
```

### Isolation Mechanisms
- **Tool prefix routing:** `cea_*` → CEA backend, `vehicles_*` → Vehicles backend
- **Request body inspection:** Parse JSON-RPC to determine routing target
- **Header injection:** Add `X-Context-ID` before forwarding

### Pros & Cons
| Pros | Cons |
|------|------|
| Fine-grained control at tool level | Requires parsing JSON-RPC body |
| Works with existing proxy infrastructure | Higher latency due to body inspection |
| Can implement complex routing logic | Stateful connections (SSE) are harder |
| Good observability at proxy layer | Need to handle MCP protocol specifics |

---

## Pattern 3: Envoy/Traefik with MCP-Aware Routing

### Overview
Purpose-built MCP gateway using Envoy AI Gateway or Traefik Hub MCP middleware that natively understands MCP protocol semantics.

### Envoy AI Gateway Architecture
```
┌────────────────────────────────────────────────────────────────────┐
│                    Envoy AI Gateway (MCP Mode)                      │
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │ MCP Protocol │───▶│  Tool Router │───▶│ Backend Clusters     │  │
│  │ Handler      │    │  (Prefix)    │    │ ┌────┐┌────┐┌────┐  │  │
│  └──────────────┘    └──────────────┘    │ │ C1 ││ C2 ││ C3 │  │  │
│         │                                 │ └────┘└────┘└────┘  │  │
│         ▼                                 └──────────────────────┘  │
│  ┌──────────────┐                                                   │
│  │ Session Mgmt │◄─── Session affinity via Mcp-Session-Id          │
│  │ (SSE Stream) │                                                   │
│  └──────────────┘                                                   │
└────────────────────────────────────────────────────────────────────┘
```

### Traefik Hub MCP Configuration
```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: paco-mcp-gateway
spec:
  plugin:
    mcp:
      resourceMetadata:
        resource: https://api.paco.local/mcp
        authorizationServers:
          - https://auth.paco.local
        scopesSupported:
          - mcp:tools
          - mcp:resources
      policies:
        # Route CEA tools to CEA backend
        - match: |
            Equals(`mcp.method`, `tools/call`) && 
            Prefix(`mcp.params.name`, `cea_`)
          action: allow
          backend: cea-backend
        
        # Route vehicle tools to vehicles backend  
        - match: |
            Equals(`mcp.method`, `tools/call`) && 
            Prefix(`mcp.params.name`, `vehicles_`)
          action: allow
          backend: vehicles-backend
      defaultAction: deny
```

### Key Capabilities

| Feature | Envoy AI Gateway | Traefik Hub |
|---------|-----------------|-------------|
| Transport Support | Streamable HTTP, SSE | Streamable HTTP |
| Session Affinity | Native (Mcp-Session-Id) | Via HRW algorithm |
| Tool Filtering | Regex + Exact match | Policy expressions |
| OAuth/OIDC | Full support | JWT middleware |
| Multiplexing | Built-in | Via middleware |
| Observability | OpenTelemetry, Prometheus | Traefik metrics |

### Isolation Mechanisms
- **MCPRoute resource:** Declarative routing rules per tool/namespace
- **Automatic tool prefixing:** `backend__tool_name` prevents collisions
- **Session encoding:** Multiple backend sessions merged into unified client session

### Pros & Cons
| Pros | Cons |
|------|------|
| Native MCP protocol understanding | Vendor lock-in to specific gateway |
| Production-ready features built-in | Commercial solutions (Traefik Hub) |
| Handles SSE/streaming correctly | Complex configuration |
| Enterprise security features | May be overkill for simple use cases |

---

## Pattern 4: Custom MCP Multiplexer with Session Isolation

### Overview
Custom-built Go/Rust/Node.js service that multiplexes multiple backend MCP servers into a unified interface with strict session isolation.

### Architecture
```
┌────────────────────────────────────────────────────────────────────────┐
│                    PACO MCP Multiplexer                                 │
│                                                                          │
│   ┌────────────────────────────────────────────────────────────────┐    │
│   │                    Session Manager                              │    │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │    │
│   │  │ Session A   │  │ Session B   │  │ Session C   │  ...         │    │
│   │  │ • Context   │  │ • Context   │  │ • Context   │              │    │
│   │  │ • JWT       │  │ • JWT       │  │ • JWT       │              │    │
│   │  │ • Backends  │  │ • Backends  │  │ • Backends  │              │    │
│   │  └─────────────┘  └─────────────┘  └─────────────┘              │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│   ┌──────────────────────────▼────────────────────────────────────┐     │
│   │                    Backend Connection Pool                      │     │
│   │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │     │
│   │  │ CEA Backend │ │Water Backend│ │Vehicles Bknd│              │     │
│   │  │ (shared)    │ │(shared)     │ │(shared)     │              │     │
│   │  └─────────────┘ └─────────────┘ └─────────────┘              │     │
│   └────────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────┘
```

### Session Isolation Implementation (Go pseudocode)
```go
type Session struct {
    ID          string
    ContextID   string
    UserClaims  jwt.MapClaims
    Backends    map[string]*BackendConnection  // backend name -> conn
    Tools       map[string]string              // tool name -> backend
    Mutex       sync.RWMutex
}

type Multiplexer struct {
    sessions   map[string]*Session
    backends   map[string]*BackendPool
    toolRouter map[string]string  // tool prefix -> backend
}

func (m *Multiplexer) HandleRequest(w http.ResponseWriter, r *http.Request) {
    // Extract session from header or create new
    sessionID := r.Header.Get("Mcp-Session-Id")
    session := m.getOrCreateSession(sessionID)
    
    // Parse JSON-RPC
    var req JSONRPCRequest
    json.NewDecoder(r.Body).Decode(&req)
    
    // Route to appropriate backend based on tool
    if req.Method == "tools/call" {
        toolName := req.Params["name"].(string)
        backend := m.resolveBackend(toolName, session.ContextID)
        
        // Rewrite tool name (remove prefix)
        req.Params["name"] = stripPrefix(toolName)
        
        // Forward to backend
        backend.Forward(session.ID, req, w)
    }
}
```

### Connection Pooling Strategy
```
Per-Backend Connection Pool:
├── Shared connections to each backend service
├── Session affinity via session ID hashing
├── Health checking and circuit breaking
└── Automatic reconnection with backoff
```

### Isolation Mechanisms
- **Session-scoped tool registry:** Each session only sees tools for its context
- **JWT claim validation:** Verify user has access to requested context
- **Request rewriting:** Remove prefixes before forwarding to backends
- **Response tagging:** Add context metadata to responses

### Pros & Cons
| Pros | Cons |
|------|------|
| Full control over behavior | Development and maintenance burden |
| Optimized for PACO's specific needs | Need to handle all edge cases |
| Can implement custom auth logic | Must implement MCP protocol correctly |
| No external dependencies | Testing and validation required |

---

## Pattern 5: HTTP Middleware for Tool-Level Isolation

### Overview
Lightweight middleware layer that intercepts MCP HTTP requests, applies isolation policies, and forwards to appropriate backends.

### Architecture
```
┌─────────────────────────────────────────────────────────────────────┐
│                        Express/FastAPI Server                        │
│                                                                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐   │
│  │ Auth       │──│ Tenant     │──│ Tool       │──│ Proxy        │   │
│  │ Middleware │  │ Resolver   │  │ Router     │  │ Handler      │   │
│  └────────────┘  └────────────┘  └────────────┘  └──────────────┘   │
│        │              │               │                  │          │
│        ▼              ▼               ▼                  ▼          │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     Backend Map                                 │ │
│  │  context-id-1  →  http://localhost:8001/mcp                    │ │
│  │  context-id-2  →  http://localhost:8002/mcp                    │ │
│  │  ...                                                           │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### FastAPI Implementation Example
```python
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.security import HTTPBearer
import httpx
import json

app = FastAPI()
security = HTTPBearer()

# Context-to-backend mapping
BACKEND_MAP = {
    "cea": "http://localhost:8001/mcp",
    "vehicles": "http://localhost:8002/mcp",
    "water": "http://localhost:8003/mcp",
    # ... 100+ contexts
}

# Tool-to-context mapping
TOOL_ROUTING = {
    "get_deuda": "cea",
    "create_ticket": "cea", 
    "get_vehicles": "vehicles",
    "get_consumo": "water",
    # ...
}

async def resolve_context(request: Request) -> str:
    """Extract context ID from JWT or header."""
    token = await security(request)
    payload = decode_jwt(token.credentials)
    
    context_id = payload.get("paco_context_id")
    if not context_id:
        raise HTTPException(403, "No context ID in token")
    
    return context_id

@app.post("/mcp")
async def mcp_proxy(
    request: Request,
    context_id: str = Depends(resolve_context)
):
    # Read and parse JSON-RPC body
    body = await request.body()
    rpc_req = json.loads(body)
    
    # Determine target backend
    method = rpc_req.get("method", "")
    
    if method == "tools/call":
        tool_name = rpc_req.get("params", {}).get("name", "")
        target_context = TOOL_ROUTING.get(tool_name)
        
        # Security: verify context can access this tool
        if target_context and target_context != context_id:
            raise HTTPException(403, "Tool not available in this context")
    
    # Forward to backend
    backend_url = BACKEND_MAP.get(context_id)
    if not backend_url:
        raise HTTPException(404, "Context backend not found")
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            backend_url,
            json=rpc_req,
            headers={"Content-Type": "application/json"}
        )
        return response.json()
```

### Middleware Chain Design
```python
# Middleware execution order
MIDDLEWARE_CHAIN = [
    cors_middleware,          # CORS headers
    logging_middleware,       # Request logging
    auth_middleware,          # JWT validation
    rate_limit_middleware,    # Rate limiting per context
    tenant_resolution,        # Extract context ID
    tool_policy_middleware,   # Verify tool access
    proxy_middleware,         # Forward to backend
]
```

### Isolation Mechanisms
- **JWT-based tenancy:** `sub` claim identifies user, `paco_context_id` identifies context
- **Tool whitelist per context:** Each context can only access approved tools
- **Request transformation:** Strip/add prefixes, inject headers
- **Response filtering:** Remove sensitive data before returning to client

### Pros & Cons
| Pros | Cons |
|------|------|
| Simple to implement and understand | Single point of failure |
| Language/framework flexibility | Performance overhead vs native |
| Easy to add custom business logic | Scaling requires horizontal deployment |
| Can leverage existing web middleware | SSE/streaming needs special handling |

---

## Comparison Matrix

| Criteria | Pattern 1: Single Gateway | Pattern 2: Reverse Proxy | Pattern 3: Envoy/Traefik | Pattern 4: Custom Multiplexer | Pattern 5: HTTP Middleware |
|----------|---------------------------|--------------------------|--------------------------|-------------------------------|---------------------------|
| **Complexity** | Medium | Medium | High | High | Low |
| **Performance** | Good | Good | Excellent | Excellent | Good |
| **Isolation Level** | Session | Tool | Session + Tool | Session + Tool | Session + Tool |
| **Scalability** | High | High | Very High | High | Medium |
| **MCP Native** | Yes | No | Yes | Yes | Via implementation |
| **SSE Support** | Yes | Requires config | Native | Requires implementation | Requires implementation |
| **Auth Integration** | Flexible | Basic | OAuth/OIDC | Custom | Flexible |
| **Observability** | Good | Good | Excellent | Custom | Good |
| **100+ Contexts** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Maintenance** | Low | Low | Low | High | Medium |

---

## Recommendation for PACO

### Recommended Approach: **Hybrid Pattern (Pattern 3 + Pattern 5)**

Given PACO's requirements:
- 100+ isolated contexts (government agencies/departments)
- Need for tool-level access control
- Mix of shared and isolated tools
- Existing FastAPI backend

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────────┐
│                         Tier 1: Edge                                │
│              (Traefik/Envoy for SSL, basic routing)                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Tier 2: PACO MCP Gateway                          │
│              (FastAPI middleware - Pattern 5)                        │
│   • JWT validation                                                   │
│   • Context resolution (agency/department)                          │
│   • Tool-level policy enforcement                                    │
│   • Request routing                                                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Shared MCP    │   │ Context-Aware │   │ Specialized   │
│ Services      │   │ Router        │   │ Backends      │
│ (Pattern 3)   │   │ (Pattern 1)   │   │               │
└───────────────┘   └───────────────┘   └───────────────┘
```

### Implementation Phases

**Phase 1: HTTP Middleware Router (Pattern 5)**
- Extend existing PACO backend with `/mcp/gateway` endpoint
- Implement context resolution from JWT claims
- Create tool-to-backend mapping
- Deploy behind existing API structure

**Phase 2: Shared MCP Services (Pattern 3 with Envoy)**
- Deploy Envoy AI Gateway for shared MCP servers
- Configure tool filtering and prefixing
- Route shared tools (weather, maps, etc.) through gateway

**Phase 3: Custom Multiplexer (Pattern 4)**
- If needed, build custom multiplexer for complex routing
- Implement session affinity for long-running conversations
- Add advanced features like tool search/discovery

### Key Configuration Files

**paco-gateway-config.yaml:**
```yaml
contexts:
  cea:
    backend: http://cea-mcp:8001/mcp
    allowed_tools:
      - cea_get_deuda
      - cea_create_ticket
      - shared_weather
    
  vehicles:
    backend: http://vehicles-mcp:8002/mcp
    allowed_tools:
      - vehicles_get_plates
      - vehicles_renewal
      - shared_weather

shared_backends:
  weather:
    url: http://weather-mcp:9000/mcp
    prefix: shared_weather_
```

---

## Security Considerations

### Multi-Tenant Isolation Checklist
- [ ] **Session Isolation:** Each context has isolated session storage
- [ ] **Tool Namespacing:** Prefix tools with context ID (`cea_get_deuda`)
- [ ] **JWT Validation:** Verify `aud` claim matches expected gateway
- [ ] **Request Sanitization:** Strip sensitive headers before forwarding
- [ ] **Response Filtering:** Remove context-specific data from responses
- [ ] **Rate Limiting:** Per-context limits to prevent resource exhaustion
- [ ] **Audit Logging:** Log all tool calls with context ID
- [ ] **Circuit Breaking:** Prevent cascade failures between contexts

### OAuth 2.1 Compliance
Per MCP authorization spec:
- Gateway acts as OAuth Resource Server
- Validate tokens with issuer
- Check `scope` claim for MCP permissions
- Implement PKCE for public clients
- Token passthrough to backends is forbidden (use separate service tokens)

---

## References

1. [MCP Specification - Architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture)
2. [Envoy AI Gateway - MCP](https://aigateway.envoyproxy.io/docs/0.5/capabilities/mcp/)
3. [Traefik Hub MCP Gateway](https://doc.traefik.io/traefik-hub/mcp-gateway/mcp)
4. [AWS Multi-Tenant MCP Server Sample](https://github.com/aws-samples/sample-multi-tenant-saas-mcp-server)
5. [MCP Gateway Pattern - Arcade](https://www.arcade.dev/blog/mcp-gateway-pattern)
6. [MCP Concurrent Connections Guide](https://mcpcat.io/guides/configuring-mcp-servers-multiple-simultaneous-connections/)
7. [MCP Proxy Tool (Rust)](https://github.com/awakecoding/mcp-proxy-tool)
8. [MCPProxy (Go)](https://dev.to/algis/mcp-proxy-pattern-secure-retrieval-first-tool-routing-for-agents-247c)
