// ============================================
// Maria Atlantis SDK - SUPRA REST Client
// Thin typed wrapper around all SUPRA API calls.
// Replaces: soap-client.ts, name-matching.ts,
//           contract-resolver.ts, recibo-token.ts
// ============================================

// ============================================
// Configuration
// ============================================

export const SUPRA_API_BASE =
    process.env.SUPRA_API_BASE ?? "https://supra-back.whoopflow.com";

// ============================================
// Generic Envelope
// ============================================

export interface SupraResponse<T> {
    success: boolean;
    data: T;
    error?: string;
}

// ============================================
// Response Shape Interfaces
// ============================================

export interface ContratoData {
    contrato: string;
    nombreTitular: string;
    direccion: string;
    calle: string;
    numero: string;
    colonia: string;
    municipio: string;
    cp: string;
    tarifa: string;
    estado: string;
    fechaAlta: string;
    numeroMedidor: string;
    ultimaLectura: string;
}

export interface FacturaDeuda {
    numFactura: string;
    ciclo: string;
    fechaVencimiento: string;
    importeTotal: number;
    estadoTexto: string;
}

export interface DeudaData {
    contrato: string;
    nombreCliente: string;
    direccion: string;
    totalDeuda: number;
    vencido: number;
    porVencer: number;
    cantidadFacturas: number;
    facturas: FacturaDeuda[];
}

export interface ConsumoEntry {
    periodo: string;
    consumoM3: number;
    tipoLectura: string;
    fechaLectura: string;
    lecturaActual: number;
    lecturaAnterior: number;
}

export interface ConsumosData {
    contrato: string;
    promedioMensual: number;
    tendencia: string;
    consumos: ConsumoEntry[];
}

export interface ReciboEntry {
    numFactura: string;
    periodo: string;
    importeTotal: number;
    estadoTexto: string;
    fechaVencimiento: string;
    downloadUrl: string;
}

export interface RecibosData {
    contrato: string;
    recibos: ReciboEntry[];
}

export interface ValidarContratoData {
    contrato: string;
    validated: boolean;
    confidence: number;
    method: string;
    titularEncontrado: string;
}

export interface ClienteData {
    id: string;
    nombre: string;
    contrato: string;
    email: string;
    telefono: string;
    whatsapp: string;
    reciboDigital: boolean;
    identifier: string;
}

export interface Horario {
    dom: string;
    sab: string;
    lun_vie: string;
}

export interface UbicacionEntry {
    id: string;
    nombre: string;
    tipo: string;
    tipoLabel: string;
    direccion: string;
    direccionCalle: string;
    colonia: string;
    municipio: string;
    latitud: number;
    longitud: number;
    distancia: number;
    distanciaMetros: number;
    horario: Horario;
    telefono: string;
    servicios: string[];
    notas: string;
    mapsUrl: string;
}

export interface GeocodeData {
    formatted_address: string;
    street: string;
    street_number: string;
    colonia: string;
    city: string;
    state: string;
    postal_code: string;
    latitude: number;
    longitude: number;
    maps_link: string;
}

// ============================================
// Shared Fetch Helper
// ============================================

async function supraFetch<T>(
    path: string,
    init?: RequestInit
): Promise<SupraResponse<T>> {
    const url = `${SUPRA_API_BASE}${path}`;

    const response = await fetch(url, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
        },
        signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
            `SUPRA ${init?.method ?? "GET"} ${path} → HTTP ${response.status}: ${text}`
        );
    }

    const envelope = (await response.json()) as SupraResponse<T>;

    if (!envelope.success) {
        throw new Error(
            `SUPRA error from ${path}: ${envelope.error ?? "unknown error"}`
        );
    }

    return envelope;
}

// ============================================
// Exported API Functions
// ============================================

/** GET /api/contrato/:id */
export async function getContrato(contrato: string): Promise<ContratoData> {
    const res = await supraFetch<ContratoData>(
        `/api/contrato/${encodeURIComponent(contrato)}`
    );
    return res.data;
}

/** GET /api/contrato/:id/deuda */
export async function getDeuda(contrato: string): Promise<DeudaData> {
    const res = await supraFetch<DeudaData>(
        `/api/contrato/${encodeURIComponent(contrato)}/deuda`
    );
    return res.data;
}

/** GET /api/contrato/:id/consumos */
export async function getConsumos(contrato: string): Promise<ConsumosData> {
    const res = await supraFetch<ConsumosData>(
        `/api/contrato/${encodeURIComponent(contrato)}/consumos`
    );
    return res.data;
}

/** GET /api/contrato/:id/recibos */
export async function getRecibos(contrato: string): Promise<RecibosData> {
    const res = await supraFetch<RecibosData>(
        `/api/contrato/${encodeURIComponent(contrato)}/recibos`
    );
    return res.data;
}

/** POST /api/contrato/validar */
export async function validarContrato(
    contrato: string,
    nombre: string
): Promise<ValidarContratoData> {
    const res = await supraFetch<ValidarContratoData>("/api/contrato/validar", {
        method: "POST",
        body: JSON.stringify({ contrato, nombre }),
    });
    return res.data;
}

/** GET /api/cliente?contrato=X */
export async function getCliente(contrato: string): Promise<ClienteData> {
    const params = new URLSearchParams({ contrato });
    const res = await supraFetch<ClienteData>(`/api/cliente?${params}`);
    return res.data;
}

/** GET /api/ubicaciones/cercanas */
export async function getUbicaciones(opts: {
    lat: number;
    lng: number;
    tipo?: string;
    limite?: number;
}): Promise<UbicacionEntry[]> {
    const params = new URLSearchParams({
        lat: String(opts.lat),
        lng: String(opts.lng),
        ...(opts.tipo != null ? { tipo: opts.tipo } : {}),
        ...(opts.limite != null ? { limite: String(opts.limite) } : {}),
    });
    const res = await supraFetch<UbicacionEntry[]>(
        `/api/ubicaciones/cercanas?${params}`
    );
    return res.data;
}

/** POST /api/ubicaciones/buscar */
export async function buscarUbicacion(
    textQuery: string
): Promise<UbicacionEntry[]> {
    const res = await supraFetch<UbicacionEntry[]>("/api/ubicaciones/buscar", {
        method: "POST",
        body: JSON.stringify({ textQuery }),
    });
    return res.data;
}

/** GET /api/geocode/reverso */
export async function reverseGeocode(
    lat: number,
    lng: number
): Promise<GeocodeData> {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    const res = await supraFetch<GeocodeData>(
        `/api/geocode/reverso?${params}`
    );
    return res.data;
}
