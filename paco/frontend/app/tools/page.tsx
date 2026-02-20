"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw,
  Search,
  Server,
  Wrench,
  CheckCircle,
  XCircle,
  Plus,
  Pencil,
  Trash2,
  X,
  Play,
  Square,
  RotateCw,
  Terminal,
  Loader2,
} from "lucide-react";
import { Header } from "@/components/ui/Header";
import {
  api,
  McpServer,
  Tool,
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  CreateToolRequest,
  UpdateToolRequest,
} from "@/lib/api";
import { cn, formatRelativeTime, getStatusColor } from "@/lib/utils";
import { useIsAdmin } from "@/lib/auth";

// ---------------------------------------------------------------------------
// MCP Server Modal
// ---------------------------------------------------------------------------

function McpServerModal({
  server,
  onClose,
  onSaved,
}: {
  server: McpServer | null; // null = create mode
  onClose: () => void;
  onSaved: (newServer: McpServer | null) => void;
}) {
  const isEdit = server !== null;
  const queryClient = useQueryClient();

  const [name, setName] = useState(server?.name ?? "");
  const [description, setDescription] = useState(server?.description ?? "");
  const [deploymentMode, setDeploymentMode] = useState(server?.deployment_mode ?? "external");
  const [transport, setTransport] = useState(server?.transport ?? "http");
  const [url, setUrl] = useState(server?.url ?? "");
  const [command, setCommand] = useState(server?.command ?? "");
  const [args, setArgs] = useState("");
  const [envJson, setEnvJson] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  // Proxy config state
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyProtocol, setProxyProtocol] = useState<"http" | "socks5">("http");
  const [proxyServerUrl, setProxyServerUrl] = useState("");
  const [proxyUsername, setProxyUsername] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");
  const [bypassPatterns, setBypassPatterns] = useState("");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latency_ms?: number | null;
    error?: string | null;
    proxy_ip?: string | null;
  } | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Initialize proxy state from server data
  useState(() => {
    if (server?.proxy_config) {
      setProxyEnabled(server.proxy_config.enabled ?? false);
      setProxyProtocol(server.proxy_config.protocol === "socks5" ? "socks5" : "http");
      setProxyServerUrl(server.proxy_config.url ?? "");
      setProxyUsername(server.proxy_config.auth?.username ?? "");
      setProxyPassword(server.proxy_config.auth?.password ?? "");
      setBypassPatterns((server.proxy_config.bypass_patterns ?? []).join(", "));
    }
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateMcpServerRequest) => api.createMcpServer(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      onSaved(created);
      onClose();
    },
    onError: (err: any) => setError(err.detail || "Failed to create server"),
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateMcpServerRequest) =>
      api.updateMcpServer(server!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      onSaved(null);
      onClose();
    },
    onError: (err: any) => setError(err.detail || "Failed to update server"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    // Skip transport/URL/command validation for managed servers (auto-configured)
    if (deploymentMode !== "managed") {
      if ((transport === "http" || transport === "websocket") && !url.trim()) {
        setError("URL is required for this transport");
        return;
      }

      if (transport === "stdio" && !command.trim()) {
        setError("Command is required for stdio transport");
        return;
      }
    }

    let parsedEnv: Record<string, string> | undefined;
    try {
      const parsed = JSON.parse(envJson);
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedEnv =
          Object.keys(parsed).length > 0 ? parsed : undefined;
      } else {
        setError("Env must be a JSON object");
        return;
      }
    } catch {
      setError("Invalid JSON in env vars");
      return;
    }

    const parsedArgs = args
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    // Build proxy config
    const proxyConfig = proxyEnabled
      ? {
          enabled: true,
          protocol: proxyProtocol,
          url: proxyServerUrl.trim(),
          ...(proxyUsername.trim()
            ? { auth: { username: proxyUsername.trim(), password: proxyPassword } }
            : {}),
          bypass_patterns: bypassPatterns
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
        }
      : null;

    if (isEdit) {
      updateMutation.mutate({
        name: name.trim(),
        description: description || undefined,
        transport: deploymentMode === "managed" ? undefined : transport,
        url: deploymentMode === "managed" ? undefined : (url.trim() || undefined),
        proxy_config: proxyConfig,
        command: deploymentMode === "managed" ? undefined : (command.trim() || undefined),
        args: deploymentMode === "managed" ? undefined : (parsedArgs.length > 0 ? parsedArgs : undefined),
        env: parsedEnv,
      });
    } else {
      createMutation.mutate({
        name: name.trim(),
        description: description || undefined,
        deployment_mode: deploymentMode,
        transport: deploymentMode === "managed" ? undefined : transport,
        url: deploymentMode === "managed" ? undefined : (url.trim() || undefined),
        proxy_config: proxyConfig,
        command: deploymentMode === "managed" ? undefined : (command.trim() || undefined),
        args: deploymentMode === "managed" ? undefined : (parsedArgs.length > 0 ? parsedArgs : undefined),
        env: parsedEnv,
      });
    }
  }

  async function handleTestProxy() {
    if (!server?.id) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await api.testServerProxy(server.id);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ success: false, error: err.detail || "Test failed" });
    } finally {
      setTestLoading(false);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background-secondary border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {isEdit ? "Edit MCP Server" : "Create MCP Server"}
          </h2>
          <button
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 rounded bg-error/10 text-error text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. my-mcp-server"
              className="input w-full"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What does this server provide?"
              className="input w-full"
            />
          </div>

          {/* Deployment Mode */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Deployment Mode
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="deployment_mode"
                  value="external"
                  checked={deploymentMode === "external"}
                  onChange={() => setDeploymentMode("external")}
                  className="accent-coral-500"
                />
                <span className="text-sm text-foreground">External</span>
                <span className="text-xs text-foreground-muted">(existing server)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="deployment_mode"
                  value="managed"
                  checked={deploymentMode === "managed"}
                  onChange={() => setDeploymentMode("managed")}
                  className="accent-coral-500"
                />
                <span className="text-sm text-foreground">Managed</span>
                <span className="text-xs text-foreground-muted">(Paco deploys)</span>
              </label>
            </div>
          </div>

          {/* Transport (hidden for managed) */}
          {deploymentMode !== "managed" && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Transport
              </label>
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                className="input w-full"
              >
                <option value="http">HTTP</option>
                <option value="stdio">Stdio</option>
                <option value="websocket">WebSocket</option>
              </select>
            </div>
          )}

          {/* URL (http / websocket) - hidden for managed */}
          {deploymentMode !== "managed" && (transport === "http" || transport === "websocket") && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                URL <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="input w-full"
              />
            </div>
          )}

          {/* Proxy Configuration Section */}
          {deploymentMode !== "managed" && transport === "http" && (
            <div className="border border-border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  Proxy Configuration
                </h3>
                <button
                  type="button"
                  onClick={() => setProxyEnabled(!proxyEnabled)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    proxyEnabled ? "bg-coral-500" : "bg-foreground-muted/30"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      proxyEnabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              {proxyEnabled && (
                <>
                  {/* Protocol */}
                  <div className="flex items-center gap-4">
                    <label className="text-sm text-foreground-muted">Protocol:</label>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name="proxyProtocol"
                        value="http"
                        checked={proxyProtocol === "http"}
                        onChange={() => setProxyProtocol("http")}
                        className="accent-coral-500"
                      />
                      HTTP/HTTPS
                    </label>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name="proxyProtocol"
                        value="socks5"
                        checked={proxyProtocol === "socks5"}
                        onChange={() => setProxyProtocol("socks5")}
                        className="accent-coral-500"
                      />
                      SOCKS5
                    </label>
                  </div>

                  {/* Proxy URL */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      Proxy URL <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={proxyServerUrl}
                      onChange={(e) => setProxyServerUrl(e.target.value)}
                      placeholder={
                        proxyProtocol === "socks5"
                          ? "socks5://proxy:1080"
                          : "http://proxy:3128"
                      }
                      className="input w-full"
                    />
                  </div>

                  {/* Auth */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-foreground-muted mb-1">
                        Username
                      </label>
                      <input
                        type="text"
                        value={proxyUsername}
                        onChange={(e) => setProxyUsername(e.target.value)}
                        placeholder="Optional"
                        className="input w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-foreground-muted mb-1">
                        Password
                      </label>
                      <input
                        type="password"
                        value={proxyPassword}
                        onChange={(e) => setProxyPassword(e.target.value)}
                        placeholder="Optional"
                        className="input w-full"
                      />
                    </div>
                  </div>

                  {/* Bypass */}
                  <div>
                    <label className="block text-sm text-foreground-muted mb-1">
                      Bypass Patterns (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={bypassPatterns}
                      onChange={(e) => setBypassPatterns(e.target.value)}
                      placeholder="*.internal.local, 10.0.0.*"
                      className="input w-full"
                    />
                  </div>

                  {/* Test Connection */}
                  {isEdit && (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleTestProxy}
                        disabled={testLoading || !proxyServerUrl.trim()}
                        className="btn-ghost px-3 py-1.5 text-sm flex items-center gap-1.5"
                      >
                        {testLoading ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Search className="w-3.5 h-3.5" />
                        )}
                        Test Connection
                      </button>
                      {testResult && (
                        <span
                          className={cn(
                            "text-sm",
                            testResult.success ? "text-success" : "text-error"
                          )}
                        >
                          {testResult.success
                            ? `Connected (${testResult.latency_ms}ms) - IP: ${testResult.proxy_ip}`
                            : testResult.error}
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Command (stdio) - hidden for managed */}
          {deploymentMode !== "managed" && transport === "stdio" && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Command <span className="text-error">*</span>
                </label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g. npx"
                  className="input w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Args (comma-separated)
                </label>
                <input
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="e.g. -y, @modelcontextprotocol/server-filesystem"
                  className="input w-full"
                />
              </div>
            </>
          )}

          {/* Managed mode info */}
          {deploymentMode === "managed" && (
            <div className="p-3 rounded bg-coral-500/10 text-sm text-foreground-muted">
              <strong className="text-foreground">Managed mode:</strong> Transport, URL, and command will be auto-configured when deployed. Set environment variables below to pass to the container.
            </div>
          )}

          {/* Env vars */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {deploymentMode === "managed" ? "Container Env Variables (JSON)" : "Env Variables (JSON)"}
            </label>
            <textarea
              value={envJson}
              onChange={(e) => setEnvJson(e.target.value)}
              rows={3}
              placeholder='{"API_KEY": "..."}'
              className="input w-full font-mono text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="btn-primary px-4 py-2"
            >
              {isPending ? "Saving..." : isEdit ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool Modal
// ---------------------------------------------------------------------------

function ToolModal({
  tool,
  servers,
  onClose,
  onSaved,
}: {
  tool: Tool | null; // null = create mode
  servers: McpServer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = tool !== null;
  const queryClient = useQueryClient();

  const [name, setName] = useState(tool?.name ?? "");
  const [description, setDescription] = useState(tool?.description ?? "");
  const [mcpServerId, setMcpServerId] = useState(tool?.mcp_server_id ?? "");
  const [inputSchemaJson, setInputSchemaJson] = useState(
    tool?.input_schema ? JSON.stringify(tool.input_schema, null, 2) : "{}"
  );
  const [isEnabled, setIsEnabled] = useState(tool?.is_enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  // Handler fields
  const [handlerType, setHandlerType] = useState<string | null>(tool?.handler_type ?? null);
  const [handlerConfig, setHandlerConfig] = useState<Record<string, any> | null>(
    tool?.handler_config ?? null
  );
  const [timeoutMs, setTimeoutMs] = useState<number | null>(tool?.timeout_ms ?? null);
  const [outputTransform, setOutputTransform] = useState(tool?.output_transform ?? "");
  const [retryMaxRetries, setRetryMaxRetries] = useState<number>(
    tool?.retry_config?.max_retries ?? 0
  );
  const [retryDelay, setRetryDelay] = useState<number>(
    tool?.retry_config?.delay_ms ?? 1000
  );
  const [retryBackoff, setRetryBackoff] = useState<number>(
    tool?.retry_config?.backoff_factor ?? 2.0
  );

  // Proxy override state
  const [proxyOverride, setProxyOverride] = useState<"inherit" | "none" | "custom">(
    tool?.proxy_config === null || tool?.proxy_config === undefined
      ? "inherit"
      : tool?.proxy_config?.enabled === false
      ? "none"
      : "custom"
  );
  const [toolProxyUrl, setToolProxyUrl] = useState(
    tool?.proxy_config?.url ?? ""
  );
  const [toolProxyProtocol, setToolProxyProtocol] = useState(
    tool?.proxy_config?.protocol ?? "http"
  );

  // State for inline MCP server creation
  const [showServerModal, setShowServerModal] = useState(false);

  const createMutation = useMutation({
    mutationFn: (data: CreateToolRequest) => api.createTool(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      onSaved();
      onClose();
    },
    onError: (err: any) => setError(err.detail || "Failed to create tool"),
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateToolRequest) => api.updateTool(tool!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      onSaved();
      onClose();
    },
    onError: (err: any) => setError(err.detail || "Failed to update tool"),
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let parsedInputSchema: Record<string, any>;
    try {
      parsedInputSchema = JSON.parse(inputSchemaJson);
      if (
        typeof parsedInputSchema !== "object" ||
        Array.isArray(parsedInputSchema)
      ) {
        setError("Input schema must be a JSON object");
        return;
      }
    } catch {
      setError("Invalid JSON in input schema");
      return;
    }

    // Save proxy override if changed
    if (isEdit && tool) {
      let proxyConfig: Record<string, any> | null = null;
      if (proxyOverride === "none") {
        proxyConfig = { enabled: false };
      } else if (proxyOverride === "custom" && toolProxyUrl.trim()) {
        proxyConfig = {
          enabled: true,
          protocol: toolProxyProtocol,
          url: toolProxyUrl.trim(),
        };
      }
      // null = inherit (default)
      try {
        await api.updateToolProxyOverride(tool.id, proxyConfig);
      } catch (err: any) {
        setError(err.detail || "Failed to update proxy override");
        return;
      }
    }

    // Build retry config
    const retryConfig =
      retryMaxRetries > 0
        ? {
            max_retries: retryMaxRetries,
            delay_ms: retryDelay,
            backoff_factor: retryBackoff,
          }
        : undefined;

    if (isEdit) {
      updateMutation.mutate({
        description: description || undefined,
        input_schema: parsedInputSchema,
        is_enabled: isEnabled,
        handler_type: handlerType || undefined,
        handler_config: handlerConfig || undefined,
        output_transform: outputTransform || undefined,
        retry_config: retryConfig,
        timeout_ms: timeoutMs || undefined,
      });
    } else {
      if (!name.trim()) {
        setError("Name is required");
        return;
      }
      createMutation.mutate({
        name: name.trim(),
        description: description || undefined,
        mcp_server_id: mcpServerId || undefined,
        input_schema: parsedInputSchema,
        handler_type: handlerType || undefined,
        handler_config: handlerConfig || undefined,
        output_transform: outputTransform || undefined,
        retry_config: retryConfig,
        timeout_ms: timeoutMs || undefined,
      });
    }
  }

  function handleServerSelect(value: string) {
    if (value === "__new__") {
      setShowServerModal(true);
    } else {
      setMcpServerId(value);
    }
  }

  function handleServerCreated(newServer: McpServer | null) {
    if (newServer) {
      setMcpServerId(newServer.id);
    }
    setShowServerModal(false);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className="relative bg-background-secondary border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">
              {isEdit ? "Edit Tool" : "Create Tool"}
            </h2>
            <button
              onClick={onClose}
              className="text-foreground-muted hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            {error && (
              <div className="p-3 rounded bg-error/10 text-error text-sm">
                {error}
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isEdit}
                placeholder="e.g. search_documents"
                className={cn(
                  "input w-full",
                  isEdit && "opacity-50 cursor-not-allowed"
                )}
              />
              {isEdit && (
                <p className="text-xs text-foreground-muted mt-1">
                  Name cannot be changed
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="What does this tool do?"
                className="input w-full"
              />
            </div>

            {/* MCP Server */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                MCP Server
              </label>
              <select
                value={mcpServerId}
                onChange={(e) => handleServerSelect(e.target.value)}
                disabled={isEdit}
                className={cn(
                  "input w-full",
                  isEdit && "opacity-50 cursor-not-allowed"
                )}
              >
                <option value="">None</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                {!isEdit && (
                  <option value="__new__">+ Create new server...</option>
                )}
              </select>
            </div>

            {/* Handler Type */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Handler Type
              </label>
              <select
                value={handlerType || ""}
                onChange={(e) => {
                  const val = e.target.value || null;
                  setHandlerType(val);
                  setHandlerConfig(null);
                }}
                className="input w-full"
              >
                <option value="">None (legacy/synced)</option>
                <option value="http_rest">HTTP REST</option>
                <option value="http_soap">HTTP SOAP</option>
                <option value="sql">SQL Query</option>
                <option value="graphql">GraphQL</option>
                <option value="code">JavaScript Code</option>
              </select>
            </div>

            {/* Dynamic Handler Config */}
            {handlerType === "http_rest" && (
              <div className="border border-border rounded-lg p-3 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">HTTP REST Config</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-foreground-muted mb-1">Method</label>
                    <select
                      value={handlerConfig?.method || "GET"}
                      onChange={(e) =>
                        setHandlerConfig({ ...handlerConfig, method: e.target.value })
                      }
                      className="input w-full"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-foreground-muted mb-1">URL</label>
                    <input
                      type="text"
                      value={handlerConfig?.url || ""}
                      onChange={(e) =>
                        setHandlerConfig({ ...handlerConfig, url: e.target.value })
                      }
                      placeholder="https://api.example.com/{{args.path}}"
                      className="input w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">
                    Headers (JSON)
                  </label>
                  <textarea
                    value={
                      handlerConfig?.headers
                        ? JSON.stringify(handlerConfig.headers, null, 2)
                        : "{}"
                    }
                    onChange={(e) => {
                      try {
                        const parsed = JSON.parse(e.target.value);
                        setHandlerConfig({ ...handlerConfig, headers: parsed });
                      } catch {
                        // Allow invalid JSON while typing
                      }
                    }}
                    rows={2}
                    className="input w-full font-mono text-xs"
                    placeholder='{"Authorization": "Bearer {{env.API_KEY}}"}'
                  />
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">
                    Body Template (JSON)
                  </label>
                  <textarea
                    value={handlerConfig?.body_template || ""}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, body_template: e.target.value })
                    }
                    rows={3}
                    className="input w-full font-mono text-xs"
                    placeholder='{"query": "{{args.query}}", "limit": {{args.limit}}}'
                  />
                </div>
              </div>
            )}

            {handlerType === "http_soap" && (
              <div className="border border-border rounded-lg p-3 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">HTTP SOAP Config</h4>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">Endpoint URL</label>
                  <input
                    type="text"
                    value={handlerConfig?.url || ""}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, url: e.target.value })
                    }
                    placeholder="https://service.example.com/soap"
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">
                    SOAP Envelope Template
                  </label>
                  <textarea
                    value={handlerConfig?.envelope_template || ""}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, envelope_template: e.target.value })
                    }
                    rows={6}
                    className="input w-full font-mono text-xs"
                    placeholder="<soapenv:Envelope>...</soapenv:Envelope>"
                  />
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">
                    XPath for Result Extraction
                  </label>
                  <input
                    type="text"
                    value={handlerConfig?.xpath || ""}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, xpath: e.target.value })
                    }
                    placeholder="//GetResultResponse/Result"
                    className="input w-full font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {handlerType === "sql" && (
              <div className="border border-border rounded-lg p-3 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">SQL Query Config</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-foreground-muted mb-1">
                      Connection Env Var
                    </label>
                    <input
                      type="text"
                      value={handlerConfig?.connection_env || ""}
                      onChange={(e) =>
                        setHandlerConfig({ ...handlerConfig, connection_env: e.target.value })
                      }
                      placeholder="DATABASE_URL"
                      className="input w-full font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-foreground-muted mb-1">Query Type</label>
                    <select
                      value={handlerConfig?.query_type || "select"}
                      onChange={(e) =>
                        setHandlerConfig({ ...handlerConfig, query_type: e.target.value })
                      }
                      className="input w-full"
                    >
                      <option value="select">SELECT</option>
                      <option value="insert">INSERT</option>
                      <option value="update">UPDATE</option>
                      <option value="delete">DELETE</option>
                      <option value="procedure">Stored Procedure</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">SQL Query</label>
                  <textarea
                    value={handlerConfig?.query || ""}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, query: e.target.value })
                    }
                    rows={4}
                    className="input w-full font-mono text-xs"
                    placeholder="SELECT * FROM users WHERE name = {{args.name}}"
                  />
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">
                    Params (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={handlerConfig?.params || ""}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, params: e.target.value })
                    }
                    placeholder="args.name, args.email"
                    className="input w-full font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {handlerType === "graphql" && (
              <div className="border border-border rounded-lg p-3 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">GraphQL Config</h4>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">Endpoint URL</label>
                  <input
                    type="text"
                    value={handlerConfig?.url || ""}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, url: e.target.value })
                    }
                    placeholder="https://api.example.com/graphql"
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">Query</label>
                  <textarea
                    value={handlerConfig?.query || ""}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, query: e.target.value })
                    }
                    rows={5}
                    className="input w-full font-mono text-xs"
                    placeholder="query GetUser($id: ID!) { user(id: $id) { name email } }"
                  />
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">
                    Variables (JSON)
                  </label>
                  <textarea
                    value={handlerConfig?.variables || "{}"}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, variables: e.target.value })
                    }
                    rows={3}
                    className="input w-full font-mono text-xs"
                    placeholder='{"id": "{{args.user_id}}"}'
                  />
                </div>
              </div>
            )}

            {handlerType === "code" && (
              <div className="border border-border rounded-lg p-3 space-y-3">
                <h4 className="text-sm font-semibold text-foreground">JavaScript Code Config</h4>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">Source Code</label>
                  <textarea
                    value={handlerConfig?.source || ""}
                    onChange={(e) =>
                      setHandlerConfig({ ...handlerConfig, source: e.target.value })
                    }
                    rows={8}
                    className="input w-full font-mono text-xs"
                    placeholder="// args available as `args` object&#10;// Return result as JSON&#10;const result = await fetch(...);"
                  />
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">
                    Timeout (ms)
                  </label>
                  <input
                    type="number"
                    value={handlerConfig?.timeout_ms || ""}
                    onChange={(e) =>
                      setHandlerConfig({
                        ...handlerConfig,
                        timeout_ms: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    placeholder="5000"
                    className="input w-full"
                  />
                </div>
              </div>
            )}

            {/* Template variable reference */}
            {handlerType && (
              <div className="p-2 bg-background-tertiary rounded text-xs text-foreground-muted">
                <strong>Template variables:</strong> Use{" "}
                <code className="bg-background px-1 py-0.5 rounded">{"{{args.fieldName}}"}</code>{" "}
                for tool arguments,{" "}
                <code className="bg-background px-1 py-0.5 rounded">{"{{env.VAR_NAME}}"}</code>{" "}
                for environment variables.
              </div>
            )}

            {/* Input Schema */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Input Schema (JSON)
              </label>
              <textarea
                value={inputSchemaJson}
                onChange={(e) => setInputSchemaJson(e.target.value)}
                rows={6}
                className="input w-full font-mono text-sm"
              />
            </div>

            {/* Is Enabled (edit only) */}
            {isEdit && (
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-foreground">
                  Enabled
                </label>
                <button
                  type="button"
                  onClick={() => setIsEnabled(!isEnabled)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    isEnabled ? "bg-coral-500" : "bg-foreground-muted/30"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      isEnabled ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>
            )}

            {/* Proxy Override */}
            {isEdit && (
              <div className="border border-border rounded-lg p-3 space-y-3">
                <label className="block text-sm font-semibold text-foreground">
                  Proxy Override
                </label>
                <select
                  value={proxyOverride}
                  onChange={(e) =>
                    setProxyOverride(e.target.value as "inherit" | "none" | "custom")
                  }
                  className="input w-full"
                >
                  <option value="inherit">Inherit from MCP Server</option>
                  <option value="none">No Proxy (direct connection)</option>
                  <option value="custom">Custom Proxy</option>
                </select>

                {proxyOverride === "custom" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-sm">
                        <input
                          type="radio"
                          value="http"
                          checked={toolProxyProtocol === "http"}
                          onChange={() => setToolProxyProtocol("http")}
                          className="accent-coral-500"
                        />
                        HTTP
                      </label>
                      <label className="flex items-center gap-1.5 text-sm">
                        <input
                          type="radio"
                          value="socks5"
                          checked={toolProxyProtocol === "socks5"}
                          onChange={() => setToolProxyProtocol("socks5")}
                          className="accent-coral-500"
                        />
                        SOCKS5
                      </label>
                    </div>
                    <input
                      type="text"
                      value={toolProxyUrl}
                      onChange={(e) => setToolProxyUrl(e.target.value)}
                      placeholder="http://proxy:3128"
                      className="input w-full"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Advanced Settings */}
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-foreground-muted">
                Advanced Settings
              </summary>
              <div className="mt-2 space-y-3">
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">
                    Timeout (ms)
                  </label>
                  <input
                    type="number"
                    value={timeoutMs ?? ""}
                    onChange={(e) =>
                      setTimeoutMs(e.target.value ? Number(e.target.value) : null)
                    }
                    className="input w-full"
                    placeholder="30000"
                  />
                </div>
                <div>
                  <label className="block text-xs text-foreground-muted mb-1">
                    Output Transform
                  </label>
                  <input
                    type="text"
                    value={outputTransform}
                    onChange={(e) => setOutputTransform(e.target.value)}
                    className="input w-full font-mono text-xs"
                    placeholder="$.data.result or //tagName"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-foreground-muted mb-1">
                      Max Retries
                    </label>
                    <input
                      type="number"
                      value={retryMaxRetries}
                      onChange={(e) => setRetryMaxRetries(Number(e.target.value) || 0)}
                      className="input w-full"
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-foreground-muted mb-1">
                      Delay (ms)
                    </label>
                    <input
                      type="number"
                      value={retryDelay}
                      onChange={(e) => setRetryDelay(Number(e.target.value) || 1000)}
                      className="input w-full"
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-foreground-muted mb-1">
                      Backoff Factor
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={retryBackoff}
                      onChange={(e) => setRetryBackoff(Number(e.target.value) || 2.0)}
                      className="input w-full"
                      min={1}
                    />
                  </div>
                </div>
              </div>
            </details>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost px-4 py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="btn-primary px-4 py-2"
              >
                {isPending ? "Saving..." : isEdit ? "Update" : "Create"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Inline server creation modal (stacks above) */}
      {showServerModal && (
        <McpServerModal
          server={null}
          onClose={() => setShowServerModal(false)}
          onSaved={handleServerCreated}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Delete Tool Confirmation
// ---------------------------------------------------------------------------

function DeleteToolConfirmation({
  tool,
  onClose,
  onConfirm,
  isPending,
}: {
  tool: Tool;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background-secondary border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Delete Tool
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          Are you sure you want to delete{" "}
          <span className="font-medium text-foreground">{tool.name}</span>?
          This action cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-ghost px-4 py-2">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 rounded-md bg-error text-white hover:bg-error/90 transition-colors disabled:opacity-50"
          >
            {isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete Server Confirmation
// ---------------------------------------------------------------------------

function DeleteServerConfirmation({
  server,
  onClose,
  onConfirm,
  isPending,
}: {
  server: McpServer;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background-secondary border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          Delete MCP Server
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          Are you sure you want to delete{" "}
          <span className="font-medium text-foreground">{server.name}</span>?
          This will also delete all tools associated with this server. This
          action cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-ghost px-4 py-2">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 rounded-md bg-error text-white hover:bg-error/90 transition-colors disabled:opacity-50"
          >
            {isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ToolsPage() {
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Modal state: undefined = closed, null = create, object = edit
  const [toolModalTarget, setToolModalTarget] = useState<
    Tool | null | undefined
  >(undefined);
  const [serverModalTarget, setServerModalTarget] = useState<
    McpServer | null | undefined
  >(undefined);
  const [deleteToolTarget, setDeleteToolTarget] = useState<Tool | null>(null);
  const [deleteServerTarget, setDeleteServerTarget] =
    useState<McpServer | null>(null);

  // Fetch MCP servers
  const { data: servers = [], isLoading: serversLoading } = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => api.getMcpServers(),
  });

  // Fetch tools
  const { data: tools = [], isLoading: toolsLoading } = useQuery({
    queryKey: ["tools", selectedServer],
    queryFn: () => api.getTools(selectedServer || undefined),
  });

  // Health check mutation
  const healthCheckMutation = useMutation({
    mutationFn: (serverId: string) => api.checkMcpServerHealth(serverId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] }),
  });

  // Sync tools mutation
  const syncToolsMutation = useMutation({
    mutationFn: (serverId: string) => api.syncToolsFromServer(serverId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
    },
  });

  // Delete tool mutation
  const deleteToolMutation = useMutation({
    mutationFn: (id: string) => api.deleteTool(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      setDeleteToolTarget(null);
    },
  });

  // Delete server mutation
  const deleteServerMutation = useMutation({
    mutationFn: (id: string) => api.deleteMcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-servers"] });
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      setDeleteServerTarget(null);
      if (deleteServerTarget && selectedServer === deleteServerTarget.id) {
        setSelectedServer(null);
      }
    },
  });

  // Deploy / stop / redeploy mutations for managed servers
  const deployMutation = useMutation({
    mutationFn: (id: string) => api.deployMcpServer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcp-servers"] }),
  });
  const stopServerMutation = useMutation({
    mutationFn: (id: string) => api.stopMcpServer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcp-servers"] }),
  });
  const redeployMutation = useMutation({
    mutationFn: (id: string) => api.redeployMcpServer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcp-servers"] }),
  });
  const buildImageMutation = useMutation({
    mutationFn: () => api.buildBaseImage(),
    onSuccess: () => alert("Base image built successfully"),
  });

  // Logs panel state
  const [logsServerId, setLogsServerId] = useState<string | null>(null);
  const { data: serverLogs, isLoading: logsLoading, refetch: refetchLogs } = useQuery({
    queryKey: ["mcp-server-logs", logsServerId],
    queryFn: () => api.getMcpServerLogs(logsServerId!),
    enabled: !!logsServerId,
  });

  // Filter tools
  const filteredTools = tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(search.toLowerCase()) ||
      tool.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <Header title="Tools" description="MCP servers and tool registry" />

      <div className="p-6">
        <div className="grid grid-cols-4 gap-6">
          {/* MCP Servers Sidebar */}
          <div className="col-span-1">
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="font-semibold text-foreground">MCP Servers</h2>
                {isAdmin && (
                  <button
                    onClick={() => setServerModalTarget(null)}
                    className="text-foreground-muted hover:text-coral-500 transition-colors"
                    title="Add MCP Server"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="p-2">
                {serversLoading ? (
                  <div className="h-32 flex items-center justify-center">
                    <div className="animate-spin w-6 h-6 border-2 border-coral-500 border-t-transparent rounded-full" />
                  </div>
                ) : servers.length === 0 ? (
                  <p className="text-center text-foreground-muted py-4 text-sm">
                    No MCP servers configured
                  </p>
                ) : (
                  <div className="space-y-1">
                    {/* All tools option */}
                    <button
                      onClick={() => setSelectedServer(null)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors",
                        selectedServer === null
                          ? "bg-coral-500/10 text-coral-500"
                          : "hover:bg-background-tertiary text-foreground-muted hover:text-foreground"
                      )}
                    >
                      <Wrench className="w-4 h-4" />
                      <span className="flex-1">All Tools</span>
                      <span className="text-xs">{tools.length}</span>
                    </button>

                    {/* Server list */}
                    {servers.map((server) => (
                      <div key={server.id} className="group">
                        <button
                          onClick={() => setSelectedServer(server.id)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors",
                            selectedServer === server.id
                              ? "bg-coral-500/10 text-coral-500"
                              : "hover:bg-background-tertiary text-foreground-muted hover:text-foreground"
                          )}
                        >
                          <Server className="w-4 h-4" />
                          <span className="flex-1 truncate">{server.name}</span>

                          {/* Deploy status badge for managed servers */}
                          {server.deployment_mode === "managed" && server.deploy_status && server.deploy_status !== "undeployed" && (
                            <span
                              className={cn(
                                "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                server.deploy_status === "running" && "bg-success/20 text-success",
                                server.deploy_status === "stopped" && "bg-foreground-muted/20 text-foreground-muted",
                                server.deploy_status === "error" && "bg-error/20 text-error",
                                server.deploy_status === "deploying" && "bg-amber-500/20 text-amber-500 animate-pulse"
                              )}
                            >
                              {server.deploy_status}
                            </span>
                          )}

                          <span
                            className={cn(
                              "w-2 h-2 rounded-full",
                              server.status === "online"
                                ? "bg-success"
                                : server.status === "offline"
                                ? "bg-error"
                                : "bg-foreground-muted"
                            )}
                          />
                        </button>

                        {/* Server actions */}
                        <div className="flex items-center gap-1 px-3 pb-1">
                          <button
                            onClick={() =>
                              healthCheckMutation.mutate(server.id)
                            }
                            disabled={healthCheckMutation.isPending}
                            className="text-xs text-foreground-muted hover:text-foreground"
                            title="Check health"
                          >
                            <RefreshCw
                              className={cn(
                                "w-3 h-3",
                                healthCheckMutation.isPending && "animate-spin"
                              )}
                            />
                          </button>
                          {isAdmin && server.transport === "http" && (
                            <button
                              onClick={() =>
                                syncToolsMutation.mutate(server.id)
                              }
                              disabled={syncToolsMutation.isPending}
                              className="text-xs text-coral-500 hover:text-coral-400 ml-2"
                            >
                              Sync
                            </button>
                          )}
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => setServerModalTarget(server)}
                                className="text-xs text-foreground-muted hover:text-foreground ml-2"
                                title="Edit server"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setDeleteServerTarget(server)}
                                className="text-xs text-foreground-muted hover:text-error ml-1"
                                title="Delete server"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>

                        {/* Deploy actions for managed servers */}
                        {isAdmin && server.deployment_mode === "managed" && (
                          <div className="flex items-center gap-1 px-3 pb-2">
                            {(server.deploy_status === "undeployed" ||
                              server.deploy_status === "stopped" ||
                              server.deploy_status === "error") && (
                              <button
                                onClick={() => deployMutation.mutate(server.id)}
                                disabled={deployMutation.isPending}
                                className="text-xs px-2 py-0.5 rounded bg-success/20 text-success hover:bg-success/30 transition-colors flex items-center gap-1"
                                title="Deploy container"
                              >
                                {deployMutation.isPending ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Play className="w-3 h-3" />
                                )}
                                Deploy
                              </button>
                            )}
                            {server.deploy_status === "running" && (
                              <>
                                <button
                                  onClick={() => stopServerMutation.mutate(server.id)}
                                  disabled={stopServerMutation.isPending}
                                  className="text-xs px-2 py-0.5 rounded bg-foreground-muted/20 text-foreground-muted hover:bg-foreground-muted/30 transition-colors flex items-center gap-1"
                                  title="Stop container"
                                >
                                  {stopServerMutation.isPending ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Square className="w-3 h-3" />
                                  )}
                                  Stop
                                </button>
                                <button
                                  onClick={() => redeployMutation.mutate(server.id)}
                                  disabled={redeployMutation.isPending}
                                  className="text-xs px-2 py-0.5 rounded bg-coral-500/20 text-coral-500 hover:bg-coral-500/30 transition-colors flex items-center gap-1"
                                  title="Redeploy container"
                                >
                                  {redeployMutation.isPending ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <RotateCw className="w-3 h-3" />
                                  )}
                                  Redeploy
                                </button>
                              </>
                            )}
                            {server.deploy_status === "deploying" && (
                              <span className="text-xs text-amber-500 flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Deploying...
                              </span>
                            )}
                            <button
                              onClick={() =>
                                setLogsServerId(
                                  logsServerId === server.id ? null : server.id
                                )
                              }
                              className={cn(
                                "text-xs px-2 py-0.5 rounded transition-colors flex items-center gap-1 ml-auto",
                                logsServerId === server.id
                                  ? "bg-coral-500/20 text-coral-500"
                                  : "text-foreground-muted hover:text-foreground"
                              )}
                              title="View container logs"
                            >
                              <Terminal className="w-3 h-3" />
                              Logs
                            </button>
                          </div>
                        )}

                        {/* Deploy error display */}
                        {server.deployment_mode === "managed" && server.deploy_error && (
                          <div className="px-3 pb-2">
                            <p className="text-[10px] text-error truncate" title={server.deploy_error}>
                              {server.deploy_error}
                            </p>
                          </div>
                        )}

                        {/* Inline logs panel */}
                        {logsServerId === server.id && (
                          <div className="px-3 pb-2">
                            <div className="bg-background rounded border border-border max-h-48 overflow-y-auto">
                              <div className="flex items-center justify-between px-2 py-1 border-b border-border">
                                <span className="text-[10px] text-foreground-muted font-medium">
                                  Container Logs {server.container_name ? `(${server.container_name})` : ""}
                                </span>
                                <button
                                  onClick={() => refetchLogs()}
                                  className="text-foreground-muted hover:text-foreground"
                                  title="Refresh logs"
                                >
                                  <RefreshCw className={cn("w-3 h-3", logsLoading && "animate-spin")} />
                                </button>
                              </div>
                              <pre className="p-2 text-[10px] text-foreground-muted font-mono whitespace-pre-wrap break-all">
                                {logsLoading
                                  ? "Loading logs..."
                                  : serverLogs?.logs || "No logs available"}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tools List */}
          <div className="col-span-3">
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <h2 className="font-semibold text-foreground">
                  Tools{" "}
                  {selectedServer &&
                    servers.find((s) => s.id === selectedServer) && (
                      <span className="text-foreground-muted font-normal">
                        from{" "}
                        {
                          servers.find((s) => s.id === selectedServer)
                            ?.name
                        }
                      </span>
                    )}
                </h2>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-muted" />
                    <input
                      type="text"
                      placeholder="Search tools..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="input pl-9 w-64"
                    />
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => setToolModalTarget(null)}
                      className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      New Tool
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4">
                {toolsLoading ? (
                  <div className="h-64 flex items-center justify-center">
                    <div className="animate-spin w-8 h-8 border-2 border-coral-500 border-t-transparent rounded-full" />
                  </div>
                ) : filteredTools.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-foreground-muted">
                    {search
                      ? "No tools match your search"
                      : "No tools registered"}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredTools.map((tool) => (
                      <div
                        key={tool.id}
                        onClick={() => isAdmin && setToolModalTarget(tool)}
                        className={cn(
                          "flex items-start gap-4 p-4 rounded-lg bg-background-tertiary hover:bg-border/50 transition-colors",
                          isAdmin && "cursor-pointer"
                        )}
                      >
                        <div
                          className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
                            tool.is_enabled
                              ? "bg-success/20"
                              : "bg-foreground-muted/20"
                          )}
                        >
                          <Wrench
                            className={cn(
                              "w-5 h-5",
                              tool.is_enabled
                                ? "text-success"
                                : "text-foreground-muted"
                            )}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-foreground">
                              {tool.name}
                            </h3>
                            {tool.mcp_server_name && (
                              <span className="text-xs text-foreground-muted bg-background-secondary px-2 py-0.5 rounded">
                                {tool.mcp_server_name}
                              </span>
                            )}
                            {tool.handler_type && (
                              <span className="text-xs text-coral-500 bg-coral-500/10 px-2 py-0.5 rounded">
                                {tool.handler_type.replace("_", " ")}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-foreground-muted mt-1">
                            {tool.description || "No description"}
                          </p>

                          {/* Input Schema Preview */}
                          {Object.keys(tool.input_schema).length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-coral-500 cursor-pointer hover:text-coral-400">
                                View schema
                              </summary>
                              <pre className="mt-2 p-2 rounded bg-background text-xs text-foreground-muted overflow-x-auto">
                                {JSON.stringify(tool.input_schema, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>

                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => setToolModalTarget(tool)}
                                className="text-foreground-muted hover:text-foreground transition-colors"
                                title="Edit tool"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteToolTarget(tool)}
                                className="text-foreground-muted hover:text-error transition-colors"
                                title="Delete tool"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {tool.is_enabled ? (
                            <CheckCircle className="w-5 h-5 text-success" />
                          ) : (
                            <XCircle className="w-5 h-5 text-foreground-muted" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {toolModalTarget !== undefined && (
        <ToolModal
          tool={toolModalTarget}
          servers={servers}
          onClose={() => setToolModalTarget(undefined)}
          onSaved={() => {}}
        />
      )}

      {serverModalTarget !== undefined && (
        <McpServerModal
          server={serverModalTarget}
          onClose={() => setServerModalTarget(undefined)}
          onSaved={() => {}}
        />
      )}

      {deleteToolTarget && (
        <DeleteToolConfirmation
          tool={deleteToolTarget}
          onClose={() => setDeleteToolTarget(null)}
          onConfirm={() => deleteToolMutation.mutate(deleteToolTarget.id)}
          isPending={deleteToolMutation.isPending}
        />
      )}

      {deleteServerTarget && (
        <DeleteServerConfirmation
          server={deleteServerTarget}
          onClose={() => setDeleteServerTarget(null)}
          onConfirm={() =>
            deleteServerMutation.mutate(deleteServerTarget.id)
          }
          isPending={deleteServerMutation.isPending}
        />
      )}
    </div>
  );
}
