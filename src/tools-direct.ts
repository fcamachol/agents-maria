/**
 * Direct Tool Functions for Claude Agent
 * 
 * These are the same functions from tools.ts but exported directly
 * for use with the Claude agent (not wrapped in OpenAI tool format).
 */

import { config } from 'dotenv'
config()

import { ProxyAgent, fetch as undiciFetch } from 'undici'
import pg from 'pg'

// ============================================
// Configuration
// ============================================

const CEA_API_BASE = 'https://aquacis-cf-int.ceaqueretaro.gob.mx/Comercial/services'
const PROXY_URL = process.env.CEA_PROXY_URL || null

const PG_CONFIG = {
  host: process.env.PGHOST || 'whisper-api_agora_postgres',
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'agora_production',
  max: parseInt(process.env.PGPOOL_MAX || '10'),
}

const pgPool = new pg.Pool(PG_CONFIG)

const TICKET_CODES: Record<string, string> = {
  fuga: 'FUG',
  aclaraciones: 'ACL',
  pagos: 'PAG',
  lecturas: 'LEC',
  revision_recibo: 'REV',
  recibo_digital: 'DIG',
  urgente: 'URG'
}

const SERVICE_TYPE_MAP: Record<string, string> = {
  fuga: 'leak_report',
  aclaraciones: 'clarifications',
  pagos: 'payment',
  lecturas: 'report_reading',
  revision_recibo: 'receipt_review',
  recibo_digital: 'digital_receipt',
  urgente: 'human_agent'
}

const PRIORITY_MAP: Record<string, string> = {
  baja: 'low',
  media: 'medium',
  alta: 'high',
  urgente: 'urgent'
}

const STATUS_MAP: Record<string, string> = {
  abierto: 'open',
  en_proceso: 'in_progress',
  escalado: 'escalated',
  esperando_cliente: 'waiting_client',
  resuelto: 'resolved',
  cerrado: 'closed'
}

// ============================================
// Utilities
// ============================================

export function getMexicoDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }))
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let response: Response

      if (PROXY_URL && url.includes('ceaqueretaro.gob.mx')) {
        const proxyAgent = new ProxyAgent(PROXY_URL)
        // @ts-ignore
        response = await undiciFetch(url, {
          method: options.method || 'GET',
          headers: options.headers,
          body: options.body as any,
          dispatcher: proxyAgent,
          signal: AbortSignal.timeout(30000)
        })
      } else {
        response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(30000)
        })
      }

      if (!response.ok && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
        continue
      }

      return response
    } catch (error) {
      lastError = error as Error
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * attempt))
      }
    }
  }

  throw lastError || new Error('Request failed')
}

function parseXMLValue(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i')
  const match = xml.match(regex)
  return match ? match[1].trim() : null
}

async function pgQuery<T = any>(query: string, params?: any[]): Promise<T[]> {
  const client = await pgPool.connect()
  try {
    const result = await client.query(query, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

// ============================================
// SOAP Builders
// ============================================

function buildDeudaSOAP(contrato: string): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:int="http://interfazgenericagestiondeuda.occamcxf.occam.agbar.com/" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
    <soapenv:Header>
        <wsse:Security mustUnderstand="1">
            <wsse:UsernameToken>
                <wsse:Username>WSGESTIONDEUDA</wsse:Username>
                <wsse:Password>WSGESTIONDEUDA</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soapenv:Header>
    <soapenv:Body>
        <int:getDeuda>
            <tipoIdentificador>CONTRATO</tipoIdentificador>
            <valor>${contrato}</valor>
            <explotacion>12</explotacion>
            <idioma>es</idioma>
        </int:getDeuda>
    </soapenv:Body>
</soapenv:Envelope>`
}

function buildConsumoSOAP(contrato: string): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com">
    <soapenv:Header>
        <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" mustUnderstand="1">
            <wsse:UsernameToken>
                <wsse:Username>WSGESTIONDEUDA</wsse:Username>
                <wsse:Password>WSGESTIONDEUDA</wsse:Password>
            </wsse:UsernameToken>
        </wsse:Security>
    </soapenv:Header>
    <soapenv:Body>
        <occ:getConsumos>
            <explotacion>12</explotacion>
            <contrato>${contrato}</contrato>
            <idioma>es</idioma>
        </occ:getConsumos>
    </soapenv:Body>
</soapenv:Envelope>`
}

function buildContratoSOAP(contrato: string): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:occ="http://occamWS.ejb.negocio.occam.agbar.com">
    <soapenv:Header/>
    <soapenv:Body>
        <occ:consultaDetalleContrato>
            <numeroContrato>${contrato}</numeroContrato>
            <idioma>es</idioma>
        </occ:consultaDetalleContrato>
    </soapenv:Body>
</soapenv:Envelope>`
}

// ============================================
// Direct Tool Functions
// ============================================

export async function getDeudaDirect(contrato: string) {
  console.log(`[get_deuda] Fetching for: ${contrato}`)
  
  try {
    const response = await fetchWithRetry(
      `${CEA_API_BASE}/InterfazGenericaGestionDeudaWS`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
        body: buildDeudaSOAP(contrato)
      }
    )

    const xml = await response.text()
    
    const codigoError = parseXMLValue(xml, 'codigoError')
    if (codigoError && codigoError !== '0') {
      return { success: false, error: parseXMLValue(xml, 'descripcionError') || 'Error desconocido' }
    }

    const totalDeuda = parseFloat(parseXMLValue(xml, 'deudaTotal') || parseXMLValue(xml, 'deuda') || '0')
    const vencido = parseFloat(parseXMLValue(xml, 'saldoAnteriorTotal') || '0')
    const porVencer = parseFloat(parseXMLValue(xml, 'deuda') || '0')

    return {
      success: true,
      contrato,
      totalDeuda,
      vencido,
      porVencer,
      resumen: `Saldo total: $${totalDeuda.toFixed(2)} MXN${vencido > 0 ? ` (Vencido: $${vencido.toFixed(2)})` : ''}`
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' }
  }
}

export async function getConsumoDirect(contrato: string) {
  console.log(`[get_consumo] Fetching for: ${contrato}`)
  
  try {
    const response = await fetchWithRetry(
      `${CEA_API_BASE}/InterfazOficinaVirtualClientesWS`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
        body: buildConsumoSOAP(contrato)
      }
    )

    const xml = await response.text()
    const consumos: any[] = []
    const consumoMatches = xml.match(/<Consumo>[\s\S]*?<\/Consumo>/g) || []

    for (const consumoXml of consumoMatches.slice(0, 12)) {
      let periodo = parseXMLValue(consumoXml, 'periodo') || ''
      periodo = periodo.replace(/&lt;/g, '').replace(/&gt;/g, '').replace(/ - .*/, '').trim()
      const año = parseXMLValue(consumoXml, 'año') || ''
      if (año && periodo) periodo = `${periodo} ${año}`
      
      const metrosCubicos = parseFloat(parseXMLValue(consumoXml, 'metrosCubicos') || '0')
      consumos.push({ periodo, consumoM3: metrosCubicos })
    }

    const promedioMensual = consumos.length > 0
      ? consumos.reduce((sum, c) => sum + c.consumoM3, 0) / consumos.length
      : 0

    let tendencia: 'aumentando' | 'estable' | 'disminuyendo' = 'estable'
    if (consumos.length >= 6) {
      const recent = consumos.slice(0, 3).reduce((s, c) => s + c.consumoM3, 0) / 3
      const older = consumos.slice(3, 6).reduce((s, c) => s + c.consumoM3, 0) / 3
      if (recent > older * 1.2) tendencia = 'aumentando'
      else if (recent < older * 0.8) tendencia = 'disminuyendo'
    }

    return {
      success: true,
      contrato,
      consumos,
      promedioMensual: Math.round(promedioMensual),
      tendencia,
      resumen: `Promedio mensual: ${Math.round(promedioMensual)} m³ (Tendencia: ${tendencia})`
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' }
  }
}

export async function getContratoDirect(contrato: string) {
  console.log(`[get_contrato] Fetching for: ${contrato}`)
  
  try {
    const response = await fetchWithRetry(
      `${CEA_API_BASE}/InterfazGenericaContratacionWS`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml;charset=UTF-8' },
        body: buildContratoSOAP(contrato)
      }
    )

    const xml = await response.text()
    
    const calle = parseXMLValue(xml, 'calle') || ''
    const numero = parseXMLValue(xml, 'numero') || ''
    const municipio = parseXMLValue(xml, 'municipio') || ''
    const dirCorrespondencia = parseXMLValue(xml, 'dirCorrespondencia') || ''
    
    let direccion = dirCorrespondencia || `${calle} ${numero}`.trim()
    if (municipio && !direccion.includes(municipio)) direccion += `, ${municipio}`

    const fechaBaja = parseXMLValue(xml, 'fechaBaja')
    const estado = fechaBaja && !xml.includes('fechaBaja xmlns:xsi') ? 'suspendido' : 'activo'

    return {
      success: true,
      numeroContrato: parseXMLValue(xml, 'numeroContrato') || contrato,
      titular: parseXMLValue(xml, 'titular') || '',
      direccion,
      colonia: municipio,
      tarifa: parseXMLValue(xml, 'descUso') || parseXMLValue(xml, 'tipoUso') || '',
      estado
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' }
  }
}

export async function createTicketDirect(input: {
  service_type: string
  titulo: string
  descripcion: string
  contract_number?: string | null
  email?: string | null
  ubicacion?: string | null
  priority?: string
}) {
  console.log(`[create_ticket] Creating:`, input)
  
  try {
    const typeCode = TICKET_CODES[input.service_type] || 'GEN'
    const now = getMexicoDate()
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    
    // Get next sequence number
    const prefix = `${typeCode}-${dateStr}`
    let nextNumber = 1
    
    try {
      const result = await pgQuery<{ folio: string }>(
        `SELECT folio FROM tickets WHERE folio LIKE $1 ORDER BY folio DESC LIMIT 1`,
        [`${prefix}-%`]
      )
      if (result.length > 0) {
        const match = result[0].folio.match(/-(\d{4})$/)
        if (match) nextNumber = parseInt(match[1]) + 1
      }
    } catch { /* use default */ }
    
    const folio = `${prefix}-${String(nextNumber).padStart(4, '0')}`
    const serviceType = SERVICE_TYPE_MAP[input.service_type] || 'general'
    const priority = PRIORITY_MAP[input.priority || 'media'] || 'medium'
    
    await pgQuery(`
      INSERT INTO tickets (
        account_id, folio, title, description, status, priority,
        ticket_type, service_type, channel, contract_number,
        client_name, metadata, created_at, updated_at
      ) VALUES (
        2, $1, $2, $3, 'open', $4,
        $5, $6, 'whatsapp', $7,
        'Cliente WhatsApp', $8, NOW(), NOW()
      )
    `, [
      folio,
      input.titulo,
      input.descripcion,
      priority,
      typeCode,
      serviceType,
      input.contract_number || null,
      JSON.stringify({ email: input.email, ubicacion: input.ubicacion })
    ])
    
    return { success: true, folio, message: `Ticket creado con folio ${folio}` }
  } catch (error) {
    // Fallback folio
    const fallbackFolio = `${TICKET_CODES[input.service_type] || 'GEN'}-${Date.now().toString().slice(-8)}`
    return { success: true, folio: fallbackFolio, warning: 'Creado localmente' }
  }
}

export async function getClientTicketsDirect(contract_number: string) {
  console.log(`[get_client_tickets] Fetching for: ${contract_number}`)
  
  try {
    const tickets = await pgQuery<{
      folio: string
      status: string
      title: string
      service_type: string
      created_at: Date
      description: string
    }>(`
      SELECT folio, status, title, service_type, created_at, description
      FROM tickets
      WHERE contract_number = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [contract_number])

    return {
      success: true,
      tickets: tickets.map(t => ({
        folio: t.folio,
        status: t.status,
        titulo: t.title,
        tipo: t.service_type,
        fecha: t.created_at,
        descripcion: t.description?.substring(0, 100)
      })),
      count: tickets.length,
      message: tickets.length > 0 ? `Encontré ${tickets.length} ticket(s)` : 'No se encontraron tickets'
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' }
  }
}

export async function searchCustomerByContractDirect(contract_number: string) {
  console.log(`[search_customer] Searching for: ${contract_number}`)
  
  try {
    const contacts = await pgQuery<{
      id: number
      name: string
      email: string | null
      phone_number: string | null
      identifier: string | null
      custom_attributes: Record<string, any> | null
    }>(`
      SELECT id, name, email, phone_number, identifier, custom_attributes
      FROM contacts
      WHERE identifier = $1 OR custom_attributes->>'contract_number' = $1
      LIMIT 1
    `, [contract_number])

    if (contacts.length === 0) {
      return { success: false, found: false, message: 'Cliente no encontrado' }
    }

    const contact = contacts[0]
    return {
      success: true,
      found: true,
      customer: {
        id: contact.id,
        nombre: contact.name || 'Sin nombre',
        contrato: contact.identifier || contract_number,
        email: contact.email,
        whatsapp: contact.phone_number
      }
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' }
  }
}

export async function updateTicketDirect(input: {
  folio: string
  status?: string | null
  priority?: string | null
  notes?: string | null
}) {
  console.log(`[update_ticket] Updating: ${input.folio}`)
  
  try {
    const setClauses: string[] = ['updated_at = NOW()']
    const params: any[] = []
    let paramIndex = 1

    if (input.status) {
      setClauses.push(`status = $${paramIndex++}`)
      params.push(STATUS_MAP[input.status] || input.status)
    }
    if (input.priority) {
      setClauses.push(`priority = $${paramIndex++}`)
      params.push(PRIORITY_MAP[input.priority] || input.priority)
    }
    if (input.notes) {
      setClauses.push(`resolution_notes = $${paramIndex++}`)
      params.push(input.notes)
    }
    if (input.status === 'resuelto') {
      setClauses.push('resolved_at = NOW()')
    }

    params.push(input.folio)

    await pgQuery(
      `UPDATE tickets SET ${setClauses.join(', ')} WHERE folio = $${paramIndex}`,
      params
    )

    return { success: true, folio: input.folio, message: `Ticket ${input.folio} actualizado` }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' }
  }
}
