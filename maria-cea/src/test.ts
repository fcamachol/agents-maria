// ============================================
// Maria Claude - Test Suite
// ============================================

import { runWorkflow } from "./agent.js";
import { SKILL_REGISTRY, getSkillDescriptions } from "./skills/index.js";

async function runTests() {
    console.log("🧪 Maria Claude - Test Suite\n");
    console.log("=" .repeat(50));

    // Test 1: Skills loaded correctly
    console.log("\n📋 Test 1: Skills Registry");
    console.log("-".repeat(30));
    for (const [code, skill] of Object.entries(SKILL_REGISTRY)) {
        console.log(`✓ ${code}: ${skill.name} (${skill.subcategories.length} subcategories)`);
    }

    // Test 2: Skill descriptions
    console.log("\n📋 Test 2: Skill Descriptions");
    console.log("-".repeat(30));
    console.log(getSkillDescriptions());

    // Test 3: Workflow tests
    console.log("\n📋 Test 3: Workflow Classification");
    console.log("-".repeat(30));

    const testCases = [
        { input: "Hola, buenos días", expectedCategory: "CON" },
        { input: "¿Cuánto debo en mi contrato 123456?", expectedCategory: "CON" },
        { input: "Quiero mi recibo por correo", expectedCategory: "FAC" },
        { input: "Hay una fuga en la calle Juárez", expectedCategory: "REP" },
        { input: "Quiero cambiar de titular", expectedCategory: "CTR" },
        { input: "Necesito un convenio de pago", expectedCategory: "CVN" },
        { input: "Mi medidor no funciona", expectedCategory: "SRV" },
    ];

    for (const testCase of testCases) {
        try {
            console.log(`\nInput: "${testCase.input}"`);
            const result = await runWorkflow({
                input_as_text: testCase.input,
                conversationId: `test-${Date.now()}`
            });
            const passed = result.category === testCase.expectedCategory;
            console.log(`  Category: ${result.category} (expected: ${testCase.expectedCategory}) ${passed ? '✓' : '✗'}`);
            console.log(`  Response: ${result.output_text.substring(0, 80)}...`);
        } catch (error) {
            console.log(`  ✗ Error: ${error}`);
        }
    }

    console.log("\n" + "=".repeat(50));
    console.log("🏁 Tests complete\n");
}

// Run if called directly
runTests().catch(console.error);
