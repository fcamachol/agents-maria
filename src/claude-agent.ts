/**
 * María - Claude Code Agent with Skills
 * 
 * Single Claude agent using skills (markdown knowledge) instead of sub-agents.
 * Applies patterns: Routing, Memory, Guardrails, Chain-of-Thought
 */

import Anthropic from '@anthropic-ai/sdk'
import * as fs from 'fs'
import * as path from 'path'
import { z } from 'zod'
import type { WorkflowInput, WorkflowOutput, Classification } from './types.js'
import {
  getDeudaDirect,
  getConsumoDirect,
  getContratoDirect,
  createTicketDirect,
  getClientTicketsDirect,
  searchCustomerByContractDirect,
  updateTicketDirect,
  getMexicoDate,
} from './tools-direct.js'
import { MemoryStore } from './memory.js'

// ============================================
// Configuration
// ============================================

const client = new Anthropic()

const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 1024
const SKILLS_PATH = path.join(import.meta.dirname || __dirname, 'skills')

// ============================================
// Load Skills
// ============================================

function loadSkill(name: string): string {
  try {
    const skillPath = path.join(SKILLS_PATH, `${name}.md`)
    return fs.readFileSync(skillPath, 'utf-8')
  } catch {
    return ''
  }
}

function loadAllSkills(): string {
  const skills = ['SKILL', 'pagos', 'consumos', 'fugas', 'contratos', 'tickets', 'info']
  return skills.map(s => loadSkill(s)).filter(Boolean).join('\n\n---\n\n')
}

// ============================================
// Tool Definitions for Claude
// ============================================

const tools: Anthropic.Tool[] = [
  {
    name: 'get_deuda',
    description: 'Obtiene el saldo y adeudo de un contrato CEA. Retorna totalDeuda, vencido, porVencer.',
    input_schema: {
      type: 'object',
      properties: {
        contrato: { type: 'string', description: 'Número de contrato CEA (ej: 123456)' }
      },
      required: ['contrato']
    }
  },
  {
    name: 'get_consumo',
    description: 'Obtiene el historial de consumo de agua. Retorna consumos por mes, promedio y tendencia.',
    input_schema: {
      type: 'object',
      properties: {
        contrato: { type: 'string', description: 'Número de contrato CEA' }
      },
      required: ['contrato']
    }
  },
  {
    name: 'get_contract_details',
    description: 'Obtiene detalles de un contrato: titular, dirección, tarifa, estado.',
    input_schema: {
      type: 'object',
      properties: {
        contrato: { type: 'string', description: 'Número de contrato CEA' }
      },
      required: ['contrato']
    }
  },
  {
    name: 'create_ticket',
    description: 'Crea un ticket de soporte. Tipos: fuga, aclaraciones, pagos, lecturas, revision_recibo, recibo_digital, urgente.',
    input_schema: {
      type: 'object',
      properties: {
        service_type: {
          type: 'string',
          enum: ['fuga', 'aclaraciones', 'pagos', 'lecturas', 'revision_recibo', 'recibo_digital', 'urgente'],
          description: 'Tipo de ticket'
        },
        titulo: { type: 'string', description: 'Título breve del ticket' },
        descripcion: { type: 'string', description: 'Descripción detallada' },
        contract_number: { type: 'string', description: 'Número de contrato (opcional)' },
        email: { type: 'string', description: 'Email del cliente (opcional)' },
        ubicacion: { type: 'string', description: 'Ubicación para fugas (opcional)' },
        priority: {
          type: 'string',
          enum: ['urgente', 'alta', 'media', 'baja'],
          description: 'Prioridad del ticket'
        }
      },
      required: ['service_type', 'titulo', 'descripcion']
    }
  },
  {
    name: 'get_client_tickets',
    description: 'Obtiene los tickets de un cliente por número de contrato.',
    input_schema: {
      type: 'object',
      properties: {
        contract_number: { type: 'string', description: 'Número de contrato CEA' }
      },
      required: ['contract_number']
    }
  },
  {
    name: 'search_customer_by_contract',
    description: 'Busca un cliente por número de contrato en la base de datos.',
    input_schema: {
      type: 'object',
      properties: {
        contract_number: { type: 'string', description: 'Número de contrato' }
      },
      required: ['contract_number']
    }
  },
  {
    name: 'update_ticket',
    description: 'Actualiza el estado o agrega notas a un ticket existente.',
    input_schema: {
      type: 'object',
      properties: {
        folio: { type: 'string', description: 'Folio del ticket' },
        status: {
          type: 'string',
          enum: ['abierto', 'en_proceso', 'esperando_cliente', 'resuelto', 'cerrado'],
          description: 'Nuevo estado (opcional)'
        },
        priority: {
          type: 'string',
          enum: ['urgente', 'alta', 'media', 'baja'],
          description: 'Nueva prioridad (opcional)'
        },
        notes: { type: 'string', description: 'Notas adicionales (opcional)' }
      },
      required: ['folio']
    }
  }
]

// ============================================
// Tool Execution
// ============================================

async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  console.log(`[Tool] Executing: ${name}`, input)
  
  try {
    let result: any
    
    switch (name) {
      case 'get_deuda':
        result = await getDeudaDirect(input.contrato)
        break
      case 'get_consumo':
        result = await getConsumoDirect(input.contrato)
        break
      case 'get_contract_details':
        result = await getContratoDirect(input.contrato)
        break
      case 'create_ticket':
        result = await createTicketDirect(input)
        break
      case 'get_client_tickets':
        result = await getClientTicketsDirect(input.contract_number)
        break
      case 'search_customer_by_contract':
        result = await searchCustomerByContractDirect(input.contract_number)
        break
      case 'update_ticket':
        result = await updateTicketDirect(input)
        break
      default:
        result = { error: `Unknown tool: ${name}` }
    }
    
    console.log(`[Tool] Result:`, result)
    return JSON.stringify(result, null, 2)
  } catch (error) {
    console.error(`[Tool] Error:`, error)
    return JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })
  }
}

// ============================================
// System Prompt Builder
// ============================================

function buildSystemPrompt(conversationContext?: string): string {
  const now = getMexicoDate()
  const dateStr = now.toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
  const timeStr = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  
  const skills = loadAllSkills()
  
  return `${skills}

---

## Contexto Actual
- Fecha: ${dateStr}
- Hora: ${timeStr} (hora de Querétaro)
${conversationContext ? `- Contexto de conversación: ${conversationContext}` : ''}

## Instrucciones de Pensamiento

Antes de responder, piensa brevemente:
1. ¿Cuál es la intención del usuario?
2. ¿Qué skill aplica?
3. ¿Necesito usar algún tool?
4. ¿Tengo toda la información necesaria?

No muestres tu pensamiento al usuario. Ve directo a la respuesta.

## Reglas Críticas
- Máximo 1 emoji por mensaje (💧)
- Una pregunta a la vez
- Siempre confirma folios de tickets
- Sé conciso y directo
- No narres tu proceso interno`
}

// ============================================
// Memory Store Instance
// ============================================

const memory = new MemoryStore('./memories')

// ============================================
// Main Agent Function
// ============================================

export async function runMariaAgent(input: WorkflowInput): Promise<WorkflowOutput> {
  const startTime = Date.now()
  const conversationId = input.conversationId || crypto.randomUUID()
  
  console.log(`\n========== MARÍA AGENT START ==========`)
  console.log(`ConversationId: ${conversationId}`)
  console.log(`Input: "${input.input_as_text}"`)
  
  // Load conversation history from memory
  const historyKey = `conversations/${conversationId}.json`
  let messages: Anthropic.MessageParam[] = []
  
  try {
    const savedHistory = await memory.view(historyKey)
    if (savedHistory && !savedHistory.startsWith('File not found')) {
      messages = JSON.parse(savedHistory)
    }
  } catch {
    // No history, start fresh
  }
  
  // Add user message
  messages.push({
    role: 'user',
    content: input.input_as_text
  })
  
  // Build context from recent history
  const contextSummary = messages.length > 2 
    ? `Conversación con ${messages.length} mensajes previos` 
    : undefined
  
  const toolsUsed: string[] = []
  let finalOutput = ''
  
  try {
    // Initial request
    let response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(contextSummary),
      tools,
      messages
    })
    
    // Agentic loop - handle tool calls
    while (response.stop_reason === 'tool_use') {
      const assistantMessage = response.content
      messages.push({ role: 'assistant', content: assistantMessage })
      
      // Process all tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      
      for (const block of assistantMessage) {
        if (block.type === 'tool_use') {
          toolsUsed.push(block.name)
          const result = await executeTool(block.name, block.input as Record<string, any>)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result
          })
        }
      }
      
      // Add tool results and continue
      messages.push({ role: 'user', content: toolResults })
      
      response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(contextSummary),
        tools,
        messages
      })
    }
    
    // Extract final text response
    for (const block of response.content) {
      if (block.type === 'text') {
        finalOutput += block.text
      }
    }
    
    // Add assistant response to history
    messages.push({ role: 'assistant', content: response.content })
    
    // Save conversation history (keep last 20 messages)
    if (messages.length > 20) {
      messages = messages.slice(-20)
    }
    await memory.create(historyKey, JSON.stringify(messages, null, 2))
    
  } catch (error) {
    console.error(`[María] Error:`, error)
    finalOutput = 'Lo siento, tuve un problema procesando tu mensaje. ¿Podrías intentar de nuevo? 💧'
  }
  
  const processingTime = Date.now() - startTime
  console.log(`[María] Complete in ${processingTime}ms`)
  console.log(`[María] Output: "${finalOutput.substring(0, 100)}..."`)
  console.log(`========== MARÍA AGENT END ==========\n`)
  
  // Classify intent from tools used (simplified)
  let classification: Classification = 'informacion'
  if (toolsUsed.includes('get_deuda')) classification = 'pagos'
  else if (toolsUsed.includes('get_consumo')) classification = 'consumos'
  else if (toolsUsed.includes('create_ticket') && finalOutput.toLowerCase().includes('fuga')) classification = 'fuga'
  else if (toolsUsed.includes('get_client_tickets')) classification = 'tickets'
  else if (toolsUsed.includes('get_contract_details')) classification = 'contrato'
  
  return {
    output_text: finalOutput,
    classification,
    toolsUsed
  }
}

// ============================================
// Health Check
// ============================================

export function getAgentHealth() {
  return {
    status: 'healthy',
    agent: 'María (Claude Code)',
    model: MODEL,
    skills: ['SKILL', 'pagos', 'consumos', 'fugas', 'contratos', 'tickets', 'info'],
    tools: tools.map(t => t.name)
  }
}
