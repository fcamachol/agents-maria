/**
 * María Server - Claude Code Edition
 * 
 * HTTP server for the Claude-based María agent.
 * Drop-in replacement for the OpenAI server.
 */

import express from 'express'
import cors from 'cors'
import { runMariaAgent, getAgentHealth } from './claude-agent.js'
import type { WorkflowInput } from './types.js'

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())

// ============================================
// Health Check
// ============================================

app.get('/health', (req, res) => {
  res.json(getAgentHealth())
})

app.get('/', (req, res) => {
  res.json({
    name: 'María - Claude Code Edition',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      health: 'GET /health',
      chat: 'POST /chat',
      webhook: 'POST /webhook/chatwoot'
    }
  })
})

// ============================================
// Main Chat Endpoint
// ============================================

app.post('/chat', async (req, res) => {
  const startTime = Date.now()
  
  try {
    const { message, conversationId, contactId } = req.body
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' })
    }
    
    const input: WorkflowInput = {
      input_as_text: message,
      conversationId: conversationId || `chat-${Date.now()}`,
      contactId
    }
    
    const result = await runMariaAgent(input)
    
    res.json({
      response: result.output_text,
      classification: result.classification,
      toolsUsed: result.toolsUsed,
      processingTime: Date.now() - startTime
    })
    
  } catch (error) {
    console.error('[Server] Error:', error)
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// ============================================
// Chatwoot Webhook Endpoint
// ============================================

app.post('/webhook/chatwoot', async (req, res) => {
  const startTime = Date.now()
  
  try {
    const payload = req.body
    
    // Only process incoming messages
    if (payload.event !== 'message_created') {
      return res.json({ status: 'ignored', reason: 'Not a message event' })
    }
    
    // Ignore outgoing messages (from agents)
    if (payload.message_type === 'outgoing') {
      return res.json({ status: 'ignored', reason: 'Outgoing message' })
    }
    
    const message = payload.content
    const conversationId = payload.conversation?.id?.toString()
    const contactId = payload.sender?.id
    
    if (!message) {
      return res.json({ status: 'ignored', reason: 'No message content' })
    }
    
    console.log(`[Chatwoot] Incoming: "${message.substring(0, 50)}..." conv=${conversationId}`)
    
    const input: WorkflowInput = {
      input_as_text: message,
      conversationId,
      contactId
    }
    
    const result = await runMariaAgent(input)
    
    // Send response back to Chatwoot
    if (process.env.CHATWOOT_API_URL && process.env.CHATWOOT_API_TOKEN) {
      await sendChatwootMessage(
        payload.conversation.id,
        payload.inbox.id,
        result.output_text
      )
    }
    
    res.json({
      status: 'processed',
      response: result.output_text,
      classification: result.classification,
      toolsUsed: result.toolsUsed,
      processingTime: Date.now() - startTime
    })
    
  } catch (error) {
    console.error('[Chatwoot Webhook] Error:', error)
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// ============================================
// Chatwoot API Helper
// ============================================

async function sendChatwootMessage(
  conversationId: number,
  inboxId: number,
  message: string
): Promise<void> {
  const apiUrl = process.env.CHATWOOT_API_URL
  const apiToken = process.env.CHATWOOT_API_TOKEN
  const accountId = process.env.CHATWOOT_ACCOUNT_ID || '2'
  
  if (!apiUrl || !apiToken) {
    console.warn('[Chatwoot] API URL or token not configured')
    return
  }
  
  try {
    const response = await fetch(
      `${apiUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api_access_token': apiToken
        },
        body: JSON.stringify({
          content: message,
          message_type: 'outgoing',
          private: false
        })
      }
    )
    
    if (!response.ok) {
      console.error(`[Chatwoot] Failed to send message: ${response.status}`)
    }
  } catch (error) {
    console.error('[Chatwoot] Error sending message:', error)
  }
}

// ============================================
// Start Server
// ============================================

app.listen(PORT, () => {
  console.log(`\n🤖 María (Claude Code) running on port ${PORT}`)
  console.log(`   Health: http://localhost:${PORT}/health`)
  console.log(`   Chat:   POST http://localhost:${PORT}/chat`)
  console.log(`   Webhook: POST http://localhost:${PORT}/webhook/chatwoot\n`)
})

export default app
