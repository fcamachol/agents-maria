import axios, { AxiosError } from "axios";

const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL || "";
const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN || "";
const AGENT_ACCOUNT_ID = process.env.AGENT_ACCOUNT_ID || "";

export function getBaseUrl(): string {
  return `${CHATWOOT_BASE_URL}/api/v1/accounts/${AGENT_ACCOUNT_ID}/agent`;
}

export async function makeApiRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  data?: Record<string, unknown>,
  params?: Record<string, unknown>
): Promise<T> {
  const response = await axios({
    method,
    url: `${getBaseUrl()}/${endpoint}`,
    data,
    params,
    timeout: 30000,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${AGENT_API_TOKEN}`
    }
  });
  return response.data as T;
}

export function handleApiError(error: unknown): string {
  if (error instanceof AxiosError) {
    if (error.response) {
      const data = error.response.data as Record<string, unknown> | undefined;
      const apiMessage = data?.message ?? data?.error;
      if (apiMessage) {
        return `Error (${error.response.status}): ${String(apiMessage)}`;
      }
      switch (error.response.status) {
        case 401:
          return "Error: Autenticación fallida. Verifica AGENT_API_TOKEN.";
        case 404:
          return "Error: Recurso no encontrado. Verifica el ID proporcionado.";
        case 422:
          return `Error de validación: ${JSON.stringify(data)}`;
        case 429:
          return "Error: Demasiadas solicitudes. Espera antes de intentar de nuevo.";
        default:
          return `Error: La solicitud falló con estado ${error.response.status}`;
      }
    } else if (error.code === "ECONNABORTED") {
      return "Error: Tiempo de espera agotado. Intenta de nuevo.";
    } else if (error.code === "ECONNREFUSED") {
      return "Error: No se pudo conectar al servidor. Verifica CHATWOOT_BASE_URL.";
    }
  }
  return `Error inesperado: ${error instanceof Error ? error.message : String(error)}`;
}

export function validateConfig(): void {
  const missing: string[] = [];
  if (!CHATWOOT_BASE_URL) missing.push("CHATWOOT_BASE_URL");
  if (!AGENT_API_TOKEN) missing.push("AGENT_API_TOKEN");
  if (!AGENT_ACCOUNT_ID) missing.push("AGENT_ACCOUNT_ID");

  if (missing.length > 0) {
    console.error(`ERROR: Variables de entorno requeridas: ${missing.join(", ")}`);
    process.exit(1);
  }
}
