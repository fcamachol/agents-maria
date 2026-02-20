/**
 * PACO API Client
 *
 * Handles all API requests to the PACO backend.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export interface ApiError {
  detail: string;
  status: number;
}

class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    if (this.token) {
      (headers as Record<string, string>)["Authorization"] =
        `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: "An error occurred",
      }));
      throw {
        detail: error.detail || "An error occurred",
        status: response.status,
      } as ApiError;
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  // Auth endpoints
  async login(email: string, password: string) {
    return this.request<{
      token: { access_token: string; expires_at: string };
      user: User;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async register(email: string, password: string, name: string) {
    return this.request<{
      token: { access_token: string; expires_at: string };
      user: User;
    }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
  }

  async getCurrentUser() {
    return this.request<User>("/api/auth/me");
  }

  // Agent endpoints
  async getAgents() {
    return this.request<Agent[]>("/api/agents");
  }

  async getAgent(id: string) {
    return this.request<AgentDetail>(`/api/agents/${id}`);
  }

  async createAgent(data: CreateAgentRequest) {
    return this.request<Agent>("/api/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateAgent(id: string, data: UpdateAgentRequest) {
    return this.request<Agent>(`/api/agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteAgent(id: string) {
    return this.request<void>(`/api/agents/${id}`, {
      method: "DELETE",
    });
  }

  async startAgent(id: string) {
    return this.request<AgentStatus>(`/api/agents/${id}/start`, {
      method: "POST",
    });
  }

  async stopAgent(id: string) {
    return this.request<AgentStatus>(`/api/agents/${id}/stop`, {
      method: "POST",
    });
  }

  async restartAgent(id: string) {
    return this.request<AgentStatus>(`/api/agents/${id}/restart`, {
      method: "POST",
    });
  }

  async getAgentStatus(id: string) {
    return this.request<AgentStatus>(`/api/agents/${id}/status`);
  }

  async syncAgentsFromYaml() {
    return this.request<Agent[]>("/api/agents/sync/yaml");
  }

  // Agent tool assignment
  async assignToolToAgent(agentId: string, toolId: string, isRequired = true) {
    return this.request<AgentToolAssignment>(`/api/agents/${agentId}/tools`, {
      method: "POST",
      body: JSON.stringify({ tool_id: toolId, is_required: isRequired }),
    });
  }

  async removeToolFromAgent(agentId: string, toolId: string) {
    return this.request<void>(`/api/agents/${agentId}/tools/${toolId}`, {
      method: "DELETE",
    });
  }

  async getAgentTools(agentId: string) {
    return this.request<AgentToolAssignment[]>(`/api/agents/${agentId}/tools`);
  }

  // Agent skill assignment
  async attachSkillToAgent(agentId: string, skillCode: string) {
    return this.request<AgentSkillAssignment>(`/api/agents/${agentId}/skills`, {
      method: "POST",
      body: JSON.stringify({ skill_code: skillCode }),
    });
  }

  async detachSkillFromAgent(agentId: string, skillCode: string) {
    return this.request<void>(`/api/agents/${agentId}/skills/${skillCode}`, {
      method: "DELETE",
    });
  }

  async toggleAgentSkill(agentId: string, skillCode: string, isEnabled: boolean) {
    return this.request<AgentSkillAssignment>(
      `/api/agents/${agentId}/skills/${skillCode}?is_enabled=${isEnabled}`,
      { method: "PUT" }
    );
  }

  // Agent apply (regen + compile + restart)
  async applyAgentConfig(agentId: string) {
    return this.request<ApplyResponse>(`/api/agents/${agentId}/apply`, {
      method: "POST",
    });
  }

  // Tool endpoints
  async getMcpServers() {
    return this.request<McpServer[]>("/api/tools/servers");
  }

  async createMcpServer(data: CreateMcpServerRequest) {
    return this.request<McpServer>("/api/tools/servers", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async deleteMcpServer(id: string) {
    return this.request<void>(`/api/tools/servers/${id}`, {
      method: "DELETE",
    });
  }

  async checkMcpServerHealth(id: string) {
    return this.request<McpServer>(`/api/tools/servers/${id}/health`, {
      method: "POST",
    });
  }

  async syncToolsFromServer(serverId: string) {
    return this.request<Tool[]>(`/api/tools/servers/${serverId}/sync`, {
      method: "POST",
    });
  }

  async getTools(serverId?: string) {
    const params = serverId ? `?server_id=${serverId}` : "";
    return this.request<Tool[]>(`/api/tools${params}`);
  }

  async getTool(id: string) {
    return this.request<Tool>(`/api/tools/${id}`);
  }

  async createTool(data: CreateToolRequest) {
    return this.request<Tool>("/api/tools", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateTool(id: string, data: UpdateToolRequest) {
    return this.request<Tool>(`/api/tools/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteTool(id: string) {
    return this.request<void>(`/api/tools/${id}`, {
      method: "DELETE",
    });
  }

  async updateMcpServer(id: string, data: UpdateMcpServerRequest) {
    return this.request<McpServer>(`/api/tools/servers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getServerProxyConfig(serverId: string) {
    return this.request<ServerProxyResponse>(
      `/api/tools/servers/${serverId}/proxy`
    );
  }

  async updateServerProxyConfig(serverId: string, proxyConfig: ProxyConfig | null) {
    return this.request<McpServer>(`/api/tools/servers/${serverId}/proxy`, {
      method: "PUT",
      body: JSON.stringify({ proxy_config: proxyConfig }),
    });
  }

  async testServerProxy(serverId: string) {
    return this.request<ProxyTestResponse>(
      `/api/tools/servers/${serverId}/proxy/test`,
      { method: "POST" }
    );
  }

  async updateToolProxyOverride(toolId: string, proxyConfig: Record<string, any> | null) {
    return this.request<Tool>(`/api/tools/${toolId}/proxy`, {
      method: "PUT",
      body: JSON.stringify({ proxy_config: proxyConfig }),
    });
  }

  // Managed MCP server operations
  async deployMcpServer(id: string) {
    return this.request<McpServer>(`/api/tools/servers/${id}/deploy`, {
      method: "POST",
    });
  }

  async stopMcpServer(id: string) {
    return this.request<McpServer>(`/api/tools/servers/${id}/stop`, {
      method: "POST",
    });
  }

  async redeployMcpServer(id: string) {
    return this.request<McpServer>(`/api/tools/servers/${id}/redeploy`, {
      method: "POST",
    });
  }

  async reloadMcpServerTools(id: string) {
    return this.request<Record<string, any>>(`/api/tools/servers/${id}/reload-tools`, {
      method: "POST",
    });
  }

  async getMcpServerLogs(id: string, tail = 100) {
    return this.request<ContainerLogsResponse>(
      `/api/tools/servers/${id}/logs?tail=${tail}`
    );
  }

  async buildBaseImage(tag = "latest") {
    return this.request<BuildImageResponse>(
      `/api/tools/build-base-image?tag=${tag}`,
      { method: "POST" }
    );
  }

  // Execution endpoints
  async getExecutions(params?: {
    agent_id?: string;
    conversation_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return this.request<Execution[]>(`/api/executions${query ? `?${query}` : ""}`);
  }

  async getExecution(id: string) {
    return this.request<ExecutionDetail>(`/api/executions/${id}`);
  }

  async getMetricsSummary(days: number = 30, agentId?: string) {
    const params = new URLSearchParams({ days: String(days) });
    if (agentId) params.append("agent_id", agentId);
    return this.request<MetricsSummary>(`/api/executions/metrics/summary?${params}`);
  }

  async getRealtimeMetrics(hours: number = 1) {
    return this.request<RealtimeMetrics>(
      `/api/executions/metrics/realtime?hours=${hours}`
    );
  }

  // User endpoints
  async getUsers() {
    return this.request<User[]>("/api/users");
  }

  async getUser(id: string) {
    return this.request<User>(`/api/users/${id}`);
  }

  async createUser(data: CreateUserRequest) {
    return this.request<User>("/api/users", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateUser(id: string, data: UpdateUserRequest) {
    return this.request<User>(`/api/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteUser(id: string) {
    return this.request<void>(`/api/users/${id}`, {
      method: "DELETE",
    });
  }

  // Langfuse proxy endpoints
  async getLangfuseTraces(params?: { page?: number; limit?: number; name?: string }) {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value));
        }
      });
    }
    const query = searchParams.toString();
    return this.request<any>(`/api/proxy/langfuse/traces${query ? `?${query}` : ""}`);
  }

  async getLangfuseTrace(traceId: string) {
    return this.request<any>(`/api/proxy/langfuse/traces/${traceId}`);
  }

  async getLangfuseEmbedUrl(traceId: string) {
    return this.request<{ embed_url: string; full_url: string }>(
      `/api/proxy/langfuse/embed-url/${traceId}`
    );
  }

  // Settings endpoints
  async getGlobalApiKeys() {
    return this.request<{
      keys: Array<{ provider: string; configured: boolean; env_var: string }>;
    }>("/api/settings/api-keys");
  }

  // Health check
  async healthCheck() {
    return this.request<{ status: string; app: string; version: string }>(
      "/health"
    );
  }

  // Workflow endpoints
  async getWorkflows() {
    return this.request<Workflow[]>("/api/workflows");
  }

  async getWorkflow(id: string) {
    return this.request<Workflow>(`/api/workflows/${id}`);
  }

  async createWorkflow(data: CreateWorkflowRequest) {
    return this.request<Workflow>("/api/workflows", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateWorkflow(id: string, data: UpdateWorkflowRequest) {
    return this.request<Workflow>(`/api/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteWorkflow(id: string) {
    return this.request<void>(`/api/workflows/${id}`, {
      method: "DELETE",
    });
  }

  // Agent SDK export
  async exportAgentSdkCode(agentId: string) {
    return this.request<{ code: string; filename: string }>(`/api/agents/${agentId}/export/sdk-code`);
  }

  // Skill sync from filesystem
  async syncSkillsFromFilesystem() {
    return this.request<{ scanned: number; created: number; updated: number }>("/api/skills/sync", {
      method: "POST",
    });
  }

  // Code generation endpoints
  async generatePythonCode(ir: {
    name: string;
    description?: string;
    agent: {
      name: string;
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      topK?: number;
      stopSequences?: string[];
    };
    mcpServers?: Array<{
      name: string;
      type: 'stdio' | 'sse' | 'http';
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      enabledTools?: string[];
    }>;
    allowedTools?: string[];
    permissionMode?: string;
    knowledgeSources?: Array<{
      name: string;
      type: 'document' | 'url';
      sources: string[];
    }>;
  }) {
    return this.request<{ code: string; filename: string }>("/api/codegen/python", {
      method: "POST",
      body: JSON.stringify(ir),
    });
  }

  async getPythonRequirements(ir: { name: string }) {
    return this.request<{ code: string; filename: string }>("/api/codegen/python/requirements", {
      method: "POST",
      body: JSON.stringify(ir),
    });
  }

  // Infrastructure endpoints
  async getInfrastructures() {
    return this.request<any[]>("/api/infrastructures");
  }

  async getInfrastructure(id: string) {
    return this.request<any>(`/api/infrastructures/${id}`);
  }

  async createInfrastructure(data: any) {
    return this.request<any>("/api/infrastructures", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateInfrastructure(id: string, data: any) {
    return this.request<any>(`/api/infrastructures/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteInfrastructure(id: string) {
    return this.request<void>(`/api/infrastructures/${id}`, { method: "DELETE" });
  }

  // Infrastructure orchestrator
  async createOrchestrator(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/orchestrator`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getOrchestrator(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/orchestrator`);
  }

  async updateOrchestrator(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/orchestrator`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // Hive coordinator endpoints
  async createCoordinator(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/coordinator`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getCoordinator(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/coordinator`);
  }

  async updateCoordinator(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/coordinator`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  // Hive task endpoints
  async getHiveTasks(infraId: string, executionId?: string) {
    const params = executionId ? `?execution_id=${executionId}` : "";
    return this.request<any[]>(`/api/infrastructures/${infraId}/hive/tasks${params}`);
  }

  async createHiveTask(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/hive/tasks`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async claimHiveTask(infraId: string, taskId: string, agentSlug: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/hive/tasks/${taskId}/claim`, {
      method: "POST",
      body: JSON.stringify({ agent_slug: agentSlug }),
    });
  }

  // Hive messaging
  async sendHiveMessage(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/hive/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getHiveMessages(infraId: string, executionId?: string) {
    const params = executionId ? `?execution_id=${executionId}` : "";
    return this.request<any[]>(`/api/infrastructures/${infraId}/hive/messages${params}`);
  }

  // Hive execution
  async runHive(infraId: string, data: { message: string }) {
    return this.request<any>(`/api/infrastructures/${infraId}/hive/run`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getHiveStatus(infraId: string, executionId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/hive/status/${executionId}`);
  }

  // Infrastructure agents
  async getInfraAgents(infraId: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/agents`);
  }

  async getInfraAgent(infraId: string, slug: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/agents/${slug}`);
  }

  async createInfraAgent(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/agents`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateInfraAgent(infraId: string, slug: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/agents/${slug}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteInfraAgent(infraId: string, slug: string) {
    return this.request<void>(`/api/infrastructures/${infraId}/agents/${slug}`, {
      method: "DELETE",
    });
  }

  // Infrastructure code generation
  async generateInfrastructure(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/generate`, {
      method: "POST",
    });
  }

  async previewInfrastructure(infraId: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/generate/preview`, {
      method: "POST",
    });
  }

  async getInfraFiles(infraId: string) {
    return this.request<string[]>(`/api/infrastructures/${infraId}/files`);
  }

  async getInfraFile(infraId: string, path: string) {
    return this.request<{ path: string; content: string }>(
      `/api/infrastructures/${infraId}/files/${encodeURIComponent(path)}`
    );
  }

  // Infrastructure deployment
  async deployInfrastructure(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/deploy`, {
      method: "POST",
    });
  }

  async deployInfraAgent(infraId: string, slug: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/deploy/agent/${slug}`, {
      method: "POST",
    });
  }

  async stopInfrastructure(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/stop`, {
      method: "POST",
    });
  }

  async restartInfrastructure(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/restart`, {
      method: "POST",
    });
  }

  async getInfraDeployments(infraId: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/deployments`);
  }

  async rollbackDeployment(infraId: string, deploymentId: string) {
    return this.request<any>(
      `/api/infrastructures/${infraId}/rollback/${deploymentId}`,
      { method: "POST" }
    );
  }

  // Infrastructure monitoring
  async getInfraHealth(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/health`);
  }

  async getInfraMetrics(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/metrics`);
  }

  async getInfraAgentMetrics(infraId: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/metrics/agents`);
  }

  async getInfraCircuits(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/circuits`);
  }

  async getInfraLogs(infraId: string, service?: string, tail?: number) {
    const params = new URLSearchParams();
    if (service) params.append("service", service);
    if (tail) params.append("tail", String(tail));
    const query = params.toString();
    return this.request<any>(
      `/api/infrastructures/${infraId}/logs${query ? `?${query}` : ""}`
    );
  }

  // Infrastructure upgrade operations
  async upgradeAddAgent(infraId: string, slug: string) {
    return this.request<any>(
      `/api/infrastructures/${infraId}/upgrade/add-agent/${slug}`,
      { method: "POST" }
    );
  }

  async upgradePrompts(infraId: string, slug: string) {
    return this.request<any>(
      `/api/infrastructures/${infraId}/upgrade/prompts/${slug}`,
      { method: "POST" }
    );
  }

  async upgradeOrchestrator(infraId: string) {
    return this.request<any>(
      `/api/infrastructures/${infraId}/upgrade/orchestrator`,
      { method: "POST" }
    );
  }

  async upgradeBumpVersion(infraId: string, bumpType: string = "patch") {
    return this.request<any>(
      `/api/infrastructures/${infraId}/upgrade/version`,
      { method: "POST", body: JSON.stringify({ bump_type: bumpType }) }
    );
  }

  async upgradeRegenerateAll(infraId: string) {
    return this.request<any>(
      `/api/infrastructures/${infraId}/upgrade/regenerate-all`,
      { method: "POST" }
    );
  }

  // Skill endpoints
  async getSkills() {
    return this.request<Skill[]>("/api/skills");
  }

  async getSkill(code: string) {
    return this.request<Skill>(`/api/skills/${code}`);
  }

  async createSkill(data: CreateSkillRequest) {
    return this.request<Skill>("/api/skills", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateSkill(code: string, data: UpdateSkillRequest) {
    return this.request<Skill>(`/api/skills/${code}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteSkill(code: string) {
    return this.request<void>(`/api/skills/${code}`, {
      method: "DELETE",
    });
  }

  async getSkillAgents(code: string) {
    return this.request<SkillAgentResponse[]>(`/api/skills/${code}/agents`);
  }

  async importSkillMd(file: File): Promise<Skill> {
    const url = `${this.baseUrl}/api/skills/import/skill-md`;
    const formData = new FormData();
    formData.append("file", file);
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Import failed" }));
      throw { detail: error.detail || "Import failed", status: response.status } as ApiError;
    }
    return response.json();
  }

  async exportSkillMd(code: string, includeResources?: boolean): Promise<globalThis.Response> {
    const params = includeResources ? "?include_resources=true" : "";
    const url = `${this.baseUrl}/api/skills/${code}/export/skill-md${params}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return fetch(url, { headers });
  }

  async listResourceFiles(code: string) {
    return this.request<string[]>(`/api/skills/${code}/resources`);
  }

  async getResourceFile(code: string, path: string): Promise<globalThis.Response> {
    const url = `${this.baseUrl}/api/skills/${encodeURIComponent(code)}/resources/${path}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return fetch(url, { headers });
  }

  async uploadResourceFile(code: string, path: string, content: string): Promise<Skill> {
    const url = `${this.baseUrl}/api/skills/${encodeURIComponent(code)}/resources/${path}`;
    const formData = new FormData();
    formData.append("file", new Blob([content], { type: "text/plain" }), path.split("/").pop() || "file");
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    const response = await fetch(url, {
      method: "PUT",
      headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Upload failed" }));
      throw { detail: error.detail || "Upload failed", status: response.status } as ApiError;
    }
    return response.json();
  }

  async deleteResourceFile(code: string, path: string) {
    return this.request<Skill>(`/api/skills/${encodeURIComponent(code)}/resources/${path}`, {
      method: "DELETE",
    });
  }

  // Skill content helpers (convenience wrappers)
  async getSkillContent(code: string) {
    return this.request<Skill>(`/api/skills/${code}`);
  }

  async updateSkillContent(code: string, data: UpdateSkillRequest) {
    return this.request<Skill>(`/api/skills/${code}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async getSkillResources(code: string) {
    return this.request<string[]>(`/api/skills/${code}/resources`);
  }

  // Playground endpoints (return ReadableStream for SSE)
  async runPlaygroundAgent(data: {
    message: string;
    agent_config: any;
    tools_config: any[];
    conversation_history?: Array<{ role: string; content: string }>;
  }): Promise<Response> {
    const url = `${this.baseUrl}/api/playground/agent/run`;
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(data),
    });
  }

  // ==========================================================================
  // Agent Builder endpoints
  // ==========================================================================

  async createBuilderSession(data: { prompt: string; template_id?: string }) {
    return this.request<BuilderSession>("/api/agent-builder/sessions", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getBuilderSessions() {
    return this.request<BuilderSession[]>("/api/agent-builder/sessions");
  }

  async getBuilderSession(id: string) {
    return this.request<BuilderSessionDetail>(`/api/agent-builder/sessions/${id}`);
  }

  async deleteBuilderSession(id: string) {
    return this.request<void>(`/api/agent-builder/sessions/${id}`, {
      method: "DELETE",
    });
  }

  async sendBuilderMessage(sessionId: string, message: string): Promise<Response> {
    const url = `${this.baseUrl}/api/agent-builder/sessions/${sessionId}/message`;
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ message }),
    });
  }

  async getBuilderArtifacts(sessionId: string) {
    return this.request<BuilderArtifacts>(`/api/agent-builder/sessions/${sessionId}/artifacts`);
  }

  async runPlaygroundInfra(data: {
    message: string;
    infrastructure_id: string;
    conversation_history?: Array<{ role: string; content: string }>;
  }): Promise<Response> {
    const url = `${this.baseUrl}/api/playground/infra/run`;
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(data),
    });
  }

  // ==========================================================================
  // Company endpoints
  // ==========================================================================

  // Company config
  async getCompanyConfig(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/config`);
  }

  async createCompanyConfig(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/config`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCompanyConfig(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/config`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async startCompany(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/config/start`, {
      method: "POST",
    });
  }

  async stopCompany(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/config/stop`, {
      method: "POST",
    });
  }

  // Company departments
  async getCompanyDepartments(infraId: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/departments`);
  }

  async createCompanyDepartment(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/departments`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCompanyDepartment(infraId: string, deptId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/departments/${deptId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteCompanyDepartment(infraId: string, deptId: string) {
    return this.request<void>(`/api/infrastructures/${infraId}/company/departments/${deptId}`, {
      method: "DELETE",
    });
  }

  async getCompanyOrgChart(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/org-chart`);
  }

  // Company roles
  async getCompanyRoles(infraId: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/roles`);
  }

  async getCompanyRole(infraId: string, slug: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/roles/${slug}`);
  }

  async createCompanyRole(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/roles`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCompanyRole(infraId: string, slug: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/roles/${slug}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteCompanyRole(infraId: string, slug: string) {
    return this.request<void>(`/api/infrastructures/${infraId}/company/roles/${slug}`, {
      method: "DELETE",
    });
  }

  // Company schedules
  async getCompanySchedules(infraId: string, agentSlug?: string) {
    const params = agentSlug ? `?agent_slug=${agentSlug}` : "";
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/schedules${params}`);
  }

  async getCompanyScheduleTemplates(infraId: string) {
    return this.request<Record<string, any>>(`/api/infrastructures/${infraId}/company/schedules/templates`);
  }

  async createCompanySchedule(infraId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/schedules`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateCompanySchedule(infraId: string, scheduleId: string, data: any) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/schedules/${scheduleId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteCompanySchedule(infraId: string, scheduleId: string) {
    return this.request<void>(`/api/infrastructures/${infraId}/company/schedules/${scheduleId}`, {
      method: "DELETE",
    });
  }

  async triggerCompanySchedule(infraId: string, scheduleId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/schedules/${scheduleId}/trigger`, {
      method: "POST",
    });
  }

  // Company tasks
  async getCompanyTasks(infraId: string, params?: { agent_slug?: string; status?: string; limit?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.agent_slug) searchParams.set("agent_slug", params.agent_slug);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit) searchParams.set("limit", String(params.limit));
    const query = searchParams.toString();
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/tasks${query ? `?${query}` : ""}`);
  }

  async getCompanyActiveTasks(infraId: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/tasks/active`);
  }

  async getCompanyTask(infraId: string, taskId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/tasks/${taskId}`);
  }

  // Company work logs
  async getCompanyWorkLogs(infraId: string, params?: { agent_slug?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.agent_slug) searchParams.set("agent_slug", params.agent_slug);
    const query = searchParams.toString();
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/work-logs${query ? `?${query}` : ""}`);
  }

  async getCompanyWorkLogsToday(infraId: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/work-logs/today`);
  }

  // Company overview + timeline
  async getCompanyOverview(infraId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/overview`);
  }

  async getCompanyTimeline(infraId: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/timeline`);
  }

  // Company messages
  async getCompanyMessages(infraId: string, params?: { sender?: string; recipient?: string; message_type?: string; status?: string }) {
    const searchParams = new URLSearchParams();
    if (params?.sender) searchParams.set("sender", params.sender);
    if (params?.recipient) searchParams.set("recipient", params.recipient);
    if (params?.message_type) searchParams.set("message_type", params.message_type);
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/messages${query ? `?${query}` : ""}`);
  }

  async getCompanyInbox(infraId: string, slug: string) {
    return this.request<any[]>(`/api/infrastructures/${infraId}/company/messages/inbox/${slug}`);
  }

  async sendCompanyMessage(infraId: string, data: { sender_slug: string; recipient_slug?: string; message_type: string; subject?: string; content: string }) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/messages`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async markCompanyMessageRead(infraId: string, messageId: string) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/messages/${messageId}/read`, {
      method: "PUT",
    });
  }

  async broadcastCompanyMessage(infraId: string, data: { sender_slug: string; content: string; subject?: string; department_id?: string }) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/messages/broadcast`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Company task delegation
  async delegateCompanyTask(infraId: string, data: { agent_slug: string; requested_by_slug: string; title: string; description?: string; input_data?: Record<string, any> }) {
    return this.request<any>(`/api/infrastructures/${infraId}/company/tasks/delegate`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Process endpoints
  async getProcesses(params?: { search?: string; tag?: string; status?: string }): Promise<Process[]> {
    const searchParams = new URLSearchParams();
    if (params?.search) searchParams.set("search", params.search);
    if (params?.tag) searchParams.set("tag", params.tag);
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    return this.request<Process[]>(`/api/processes${query ? `?${query}` : ""}`);
  }

  async getProcess(id: string): Promise<Process> {
    return this.request<Process>(`/api/processes/${id}`);
  }

  async createProcess(data: CreateProcessRequest): Promise<Process> {
    return this.request<Process>("/api/processes", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateProcess(id: string, data: UpdateProcessRequest): Promise<Process> {
    return this.request<Process>(`/api/processes/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteProcess(id: string): Promise<void> {
    return this.request<void>(`/api/processes/${id}`, {
      method: "DELETE",
    });
  }

  async getProcessTags(): Promise<string[]> {
    return this.request<string[]>("/api/processes/tags");
  }
}

// Types
export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  is_active: boolean;
  created_at: string;
  last_login: string | null;
}

export interface Agent {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  status: "running" | "stopped" | "error" | "starting" | "stopping";
  port: number | null;
  pm2_name: string | null;
  last_health_check: string | null;
  // ClaudeAgentOptions fields
  model: string;
  system_prompt: string | null;
  permission_mode: string;
  max_turns: number | null;
  max_budget_usd: number | null;
  max_thinking_tokens: number | null;
  sdk_config: Record<string, any>;
  env_vars: Record<string, string>;
  type?: string;
  version?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentSkillSummary {
  code: string;
  name: string;
  is_enabled: boolean;
  allowed_tools: string[];
}

export interface AgentMcpServer {
  name: string;
  transport: string;
  url: string | null;
  command: string | null;
  args: string[];
  env: Record<string, string>;
}

export interface AgentToolInfo {
  id: string;
  name: string;
  description: string | null;
  mcp_server_name: string | null;
  is_required: boolean;
}

export interface AgentDetail extends Agent {
  allowed_tools: string[];
  skills: AgentSkillSummary[];
  mcp_servers: AgentMcpServer[];
  tools: AgentToolInfo[];
  config?: Record<string, any>;
}

export interface AgentToolAssignment {
  id: string;
  tool_id: string;
  tool_name: string;
  tool_description: string | null;
  mcp_server_name: string | null;
  is_required: boolean;
  config_overrides: Record<string, any>;
  created_at: string;
}

export interface AgentSkillAssignment {
  id: string;
  skill_code: string;
  skill_name: string;
  is_enabled: boolean;
  created_at: string;
}

export interface ApplyResponse {
  success: boolean;
  message: string;
  files_generated: string[];
}

export interface AgentStatus {
  agent: Agent;
  pm2_status: Record<string, any> | null;
  health: Record<string, any> | null;
}

export interface CreateAgentRequest {
  name: string;
  display_name?: string;
  description?: string;
  model?: string;
  system_prompt?: string;
  permission_mode?: string;
  max_turns?: number;
  max_budget_usd?: number;
  max_thinking_tokens?: number;
  env_vars?: Record<string, string>;
  type?: string;
  config_yaml?: string;
}

export interface UpdateAgentRequest {
  display_name?: string;
  description?: string;
  model?: string;
  system_prompt?: string;
  permission_mode?: string;
  max_turns?: number | null;
  max_budget_usd?: number | null;
  max_thinking_tokens?: number | null;
  env_vars?: Record<string, string>;
  config_yaml?: string;
}

export interface ProxyConfig {
  enabled: boolean;
  protocol: string;
  url: string;
  auth?: { username: string; password: string };
  bypass_patterns?: string[];
}

export interface ServerProxyResponse {
  server: ProxyConfig | null;
  tools: Record<string, ProxyConfig | null>;
}

export interface ProxyTestResponse {
  success: boolean;
  latency_ms: number | null;
  error: string | null;
  proxy_ip: string | null;
}

export interface McpServer {
  id: string;
  name: string;
  description: string | null;
  transport: string;
  url: string | null;
  proxy_url: string | null;
  proxy_config: ProxyConfig | null;
  command: string | null;
  status: string;
  last_health_check: string | null;
  // Managed deployment fields
  deployment_mode: string;
  deploy_status: string;
  deploy_error: string | null;
  container_name: string | null;
  host_port: number | null;
  image_tag: string;
  last_deployed_at: string | null;
  created_at: string;
}

export interface CreateMcpServerRequest {
  name: string;
  description?: string;
  transport?: string;
  url?: string;
  proxy_url?: string;
  proxy_config?: ProxyConfig | null;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  deployment_mode?: string;
}

export interface Tool {
  id: string;
  name: string;
  description: string | null;
  mcp_server_id: string | null;
  mcp_server_name: string | null;
  input_schema: Record<string, any>;
  is_enabled: boolean;
  proxy_config: Record<string, any> | null;
  // Handler fields
  handler_type: string | null;
  handler_config: Record<string, any> | null;
  output_transform: string | null;
  retry_config: Record<string, any> | null;
  timeout_ms: number | null;
  created_at: string;
}

export interface CreateToolRequest {
  name: string;
  description?: string;
  mcp_server_id?: string;
  input_schema?: Record<string, any>;
  output_schema?: Record<string, any>;
  handler_type?: string;
  handler_config?: Record<string, any>;
  output_transform?: string;
  retry_config?: Record<string, any>;
  timeout_ms?: number;
}

export interface UpdateToolRequest {
  description?: string;
  input_schema?: Record<string, any>;
  is_enabled?: boolean;
  handler_type?: string;
  handler_config?: Record<string, any>;
  output_transform?: string;
  retry_config?: Record<string, any>;
  timeout_ms?: number;
}

export interface ContainerLogsResponse {
  logs: string;
  container_name: string | null;
}

export interface BuildImageResponse {
  image_id: string;
  tag: string;
  logs: string[];
}

export interface UpdateMcpServerRequest {
  name?: string;
  description?: string;
  transport?: string;
  url?: string;
  proxy_url?: string;
  proxy_config?: ProxyConfig | null;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth_config?: Record<string, any>;
}

export interface Execution {
  id: string;
  agent_id: string | null;
  agent_name: string | null;
  conversation_id: string | null;
  trace_id: string | null;
  langfuse_trace_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  total_cost: number;
  model: string | null;
  status: "running" | "success" | "error" | "timeout";
  error_message: string | null;
}

export interface ExecutionDetail extends Execution {
  tool_calls: ToolCall[];
  metadata: Record<string, any>;
}

export interface ToolCall {
  id: string;
  tool_name: string;
  input: Record<string, any>;
  output: Record<string, any> | null;
  latency_ms: number | null;
  success: boolean;
  error_message: string | null;
  called_at: string;
}

export interface TokenMetrics {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number;
  execution_count: number;
}

export interface DailyTokenMetrics extends TokenMetrics {
  date: string;
}

export interface AgentTokenMetrics extends TokenMetrics {
  agent_name: string;
}

export interface MetricsSummary {
  period: string;
  total: TokenMetrics;
  by_day: DailyTokenMetrics[];
  by_agent: AgentTokenMetrics[];
}

export interface RealtimeMetrics {
  period_hours: number;
  running_executions: number;
  recent_executions: {
    count: number;
    input_tokens: number;
    output_tokens: number;
    total_cost: number;
    avg_duration_ms: number;
    error_count: number;
    error_rate: number;
  };
  tool_calls: {
    count: number;
    avg_latency_ms: number;
    failure_count: number;
  };
}

export interface CreateUserRequest {
  email: string;
  password: string;
  name: string;
  role?: string;
}

export interface UpdateUserRequest {
  name?: string;
  role?: string;
  is_active?: boolean;
}

// Skill types (simplified — filesystem is source of truth for content)
export interface Skill {
  id: string;
  code: string;
  name: string;
  description: string | null;
  allowed_tools: string[];
  body: string;
  is_active: boolean;
  resource_files: string[];
  agent_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSkillRequest {
  code: string;
  name: string;
  description?: string;
  allowed_tools?: string[];
  body?: string;
}

export interface UpdateSkillRequest {
  name?: string;
  description?: string;
  allowed_tools?: string[];
  body?: string;
  is_active?: boolean;
}

export interface SkillAgentResponse {
  agent_id: string;
  agent_name: string;
  agent_display_name: string | null;
  is_enabled: boolean;
}

// Workflow types
export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  config: Record<string, any>;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  config: Record<string, any>;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  config?: Record<string, any>;
}

// Agent Builder types
export interface BuilderSession {
  id: string;
  title: string;
  status: "active" | "completed" | "abandoned";
  phase: "understand" | "design" | "build" | "test" | "deploy";
  agent_id: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface BuilderSessionDetail extends BuilderSession {
  conversation_history: Array<Record<string, any>>;
  draft_config: Record<string, any>;
  artifacts: BuilderArtifact[];
}

export interface BuilderArtifact {
  type: string;
  id?: string;
  name?: string;
  code?: string;
  created_at?: string;
  [key: string]: any;
}

export interface BuilderArtifacts {
  agent: {
    id: string;
    name: string;
    display_name: string | null;
    description: string | null;
    model: string;
    status: string;
    system_prompt: string | null;
  } | null;
  tools: Array<{
    id: string;
    name: string;
    description: string | null;
    input_schema: Record<string, any>;
  }>;
  skills: Array<{
    id: string;
    code: string;
    name: string;
    description: string | null;
  }>;
  mcp_servers: Array<{
    id: string;
    name: string;
  }>;
  process_flow: Array<{
    step: number;
    title: string;
    description: string;
    action?: string;
  }> | null;
  knowledge_base: {
    faqs?: Array<{ question: string; answer: string }>;
    requirements?: string[];
    costs?: Array<{ concept: string; amount: string }>;
    links?: string[];
  } | null;
}

// Process types
export interface Process {
  id: string;
  name: string;
  department: string;
  description: string | null;
  status: "analyzing" | "completed" | "error";
  extraction_md: string | null;
  as_is_analysis_md: string | null;
  compliance_audit_md: string | null;
  to_be_optimization_md: string | null;
  implementation_plan_md: string | null;
  executive_summary_md: string | null;
  diagram_as_is: string | null;
  diagram_to_be_digital: string | null;
  diagram_to_be_hybrid: string | null;
  run_metadata: Record<string, any> | null;
  model_used: string | null;
  source_files: string[] | null;
  tags: string[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProcessRequest {
  name: string;
  department: string;
  description?: string;
  status?: string;
  extraction_md?: string;
  as_is_analysis_md?: string;
  compliance_audit_md?: string;
  to_be_optimization_md?: string;
  implementation_plan_md?: string;
  executive_summary_md?: string;
  diagram_as_is?: string;
  diagram_to_be_digital?: string;
  diagram_to_be_hybrid?: string;
  run_metadata?: Record<string, any>;
  model_used?: string;
  source_files?: string[];
  tags?: string[];
}

export interface UpdateProcessRequest {
  name?: string;
  department?: string;
  description?: string;
  status?: string;
  tags?: string[];
}

// Export singleton instance
export const api = new ApiClient(API_URL);
