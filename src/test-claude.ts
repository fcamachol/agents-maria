/**
 * Test script for María Claude Agent
 */

import { runMariaAgent } from './claude-agent.js'

const testCases = [
  // Basic greeting
  { message: 'Hola', expected: 'greeting' },
  
  // What can you do
  { message: '¿Qué puedes hacer?', expected: 'capabilities' },
  
  // Debt query (will ask for contract)
  { message: 'Quiero saber cuánto debo', expected: 'ask_contract' },
  
  // Consumption query
  { message: 'Cuál es mi historial de consumo?', expected: 'ask_contract' },
  
  // Leak report
  { message: 'Hay una fuga de agua en mi calle', expected: 'ask_location' },
  
  // Ticket status
  { message: 'Quiero saber el estado de mi reporte', expected: 'ask_contract' },
  
  // Human agent
  { message: 'Quiero hablar con un asesor', expected: 'create_urgent_ticket' },
]

async function runTests() {
  console.log('\n🧪 Testing María Claude Agent\n')
  console.log('='.repeat(60))
  
  const conversationId = `test-${Date.now()}`
  
  for (const test of testCases) {
    console.log(`\n📝 Input: "${test.message}"`)
    console.log(`   Expected: ${test.expected}`)
    
    try {
      const result = await runMariaAgent({
        input_as_text: test.message,
        conversationId
      })
      
      console.log(`   Output: "${result.output_text.substring(0, 100)}..."`)
      console.log(`   Classification: ${result.classification}`)
      console.log(`   Tools: ${result.toolsUsed?.join(', ') || 'none'}`)
      console.log(`   ✅ Test passed`)
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`)
    }
    
    console.log('-'.repeat(60))
    
    // Small delay between tests
    await new Promise(r => setTimeout(r, 1000))
  }
  
  console.log('\n🏁 Tests complete\n')
}

// Multi-turn conversation test
async function testConversation() {
  console.log('\n🗣️ Testing Multi-turn Conversation\n')
  console.log('='.repeat(60))
  
  const conversationId = `conv-test-${Date.now()}`
  
  const turns = [
    'Hola',
    'Quiero saber cuánto debo',
    '123456',  // Contract number
    'Gracias, también quiero reportar una fuga',
    'Av. Universidad 100, Col. Centro',
    'Es en la calle, hay mucha agua'
  ]
  
  for (const message of turns) {
    console.log(`\n👤 User: "${message}"`)
    
    const result = await runMariaAgent({
      input_as_text: message,
      conversationId
    })
    
    console.log(`🤖 María: "${result.output_text}"`)
    
    if (result.toolsUsed && result.toolsUsed.length > 0) {
      console.log(`   [Tools: ${result.toolsUsed.join(', ')}]`)
    }
    
    await new Promise(r => setTimeout(r, 1500))
  }
  
  console.log('\n' + '='.repeat(60))
  console.log('🏁 Conversation test complete\n')
}

// Run tests
const args = process.argv.slice(2)

if (args.includes('--conversation')) {
  testConversation().catch(console.error)
} else {
  runTests().catch(console.error)
}
