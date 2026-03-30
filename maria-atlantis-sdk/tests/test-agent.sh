#!/bin/bash
# ============================================
# Maria CEA SDK - Agent Integration Tests
# Tests tools, skills, routing, and multi-turn conversations
# Usage: ./tests/test-agent.sh [base_url]
# ============================================

BASE_URL="${1:-http://localhost:3006}"
PASS=0
FAIL=0
TOTAL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

chat() {
    local conv_id="$1"
    local message="$2"
    local response
    response=$(curl -s -X POST "$BASE_URL/api/chat" \
        -H "Content-Type: application/json" \
        -d "{
            \"message\": \"$message\",
            \"conversationId\": \"$conv_id\",
            \"metadata\": {
                \"name\": \"Juan Prueba\",
                \"phone\": \"+524421234567\"
            }
        }" 2>&1)
    echo "$response"
}

assert_contains() {
    local test_name="$1"
    local response="$2"
    local expected="$3"
    TOTAL=$((TOTAL + 1))

    if echo "$response" | grep -qi "$expected"; then
        echo -e "  ${GREEN}PASS${NC} $test_name"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}FAIL${NC} $test_name (expected '$expected')"
        echo -e "  ${YELLOW}Response:${NC} $(echo "$response" | jq -r '.response // .error // .' 2>/dev/null | head -3)"
        FAIL=$((FAIL + 1))
    fi
}

assert_tool_used() {
    local test_name="$1"
    local response="$2"
    local tool_name="$3"
    TOTAL=$((TOTAL + 1))

    if echo "$response" | jq -r '.toolsUsed[]?' 2>/dev/null | grep -q "$tool_name"; then
        echo -e "  ${GREEN}PASS${NC} $test_name (tool: $tool_name)"
        PASS=$((PASS + 1))
    else
        local tools_used
        tools_used=$(echo "$response" | jq -r '.toolsUsed // []' 2>/dev/null)
        echo -e "  ${RED}FAIL${NC} $test_name (expected tool '$tool_name')"
        echo -e "  ${YELLOW}Tools used:${NC} $tools_used"
        FAIL=$((FAIL + 1))
    fi
}

assert_no_tools() {
    local test_name="$1"
    local response="$2"
    TOTAL=$((TOTAL + 1))

    local tool_count
    tool_count=$(echo "$response" | jq '.toolsUsed | length' 2>/dev/null)
    if [ "$tool_count" = "0" ] || [ "$tool_count" = "null" ]; then
        echo -e "  ${GREEN}PASS${NC} $test_name (no tools used)"
        PASS=$((PASS + 1))
    else
        local tools_used
        tools_used=$(echo "$response" | jq -r '.toolsUsed // []' 2>/dev/null)
        echo -e "  ${RED}FAIL${NC} $test_name (expected no tools, got: $tools_used)"
        FAIL=$((FAIL + 1))
    fi
}

assert_success() {
    local test_name="$1"
    local response="$2"
    TOTAL=$((TOTAL + 1))

    if echo "$response" | jq -e '.success == true' >/dev/null 2>&1; then
        echo -e "  ${GREEN}PASS${NC} $test_name"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}FAIL${NC} $test_name"
        echo -e "  ${YELLOW}Response:${NC} $(echo "$response" | head -2)"
        FAIL=$((FAIL + 1))
    fi
}

print_response() {
    local label="$1"
    local response="$2"
    local text
    text=$(echo "$response" | jq -r '.response // "(no response)"' 2>/dev/null | head -5)
    local tools
    tools=$(echo "$response" | jq -r '.toolsUsed // []' 2>/dev/null)
    echo -e "  ${CYAN}[$label]${NC} $text"
    echo -e "  ${CYAN}Tools:${NC} $tools"
}

# ============================================
echo ""
echo "============================================"
echo " Maria CEA SDK - Integration Tests"
echo " Target: $BASE_URL"
echo "============================================"
echo ""

# --- Health Check ---
echo -e "${CYAN}[0] Health Check${NC}"
HEALTH=$(curl -s "$BASE_URL/health" 2>&1)
assert_contains "Health endpoint responds" "$HEALTH" "ok"
echo ""

# ============================================
# TEST 1: Simple Greeting (no tools)
# ============================================
echo -e "${CYAN}[1] Simple Greeting - No Tools${NC}"
CONV1="test-greeting-$$"
R=$(chat "$CONV1" "Hola buenas tardes")
assert_success "Returns success" "$R"
assert_no_tools "No tools on greeting" "$R"
assert_contains "Greeting response" "$R" "hola\|buenos\|buen\|ayudar\|María"
print_response "Reply" "$R"
echo ""

# ============================================
# TEST 2: Payment Info (no contract needed - rule 11)
# ============================================
echo -e "${CYAN}[2] Payment Info - No Contract Required${NC}"
CONV2="test-pagos-$$"
R=$(chat "$CONV2" "Cómo puedo pagar mi recibo de agua?")
assert_success "Returns success" "$R"
assert_contains "Shows payment options" "$R" "pag\|banco\|oxxo\|línea\|sucursal\|opcion"
print_response "Reply" "$R"
echo ""

# ============================================
# TEST 3: Balance Inquiry (should ask for contract)
# ============================================
echo -e "${CYAN}[3] Balance Inquiry - Should Ask for Contract${NC}"
CONV3="test-saldo-$$"
R=$(chat "$CONV3" "Quiero saber cuánto debo")
assert_success "Returns success" "$R"
assert_contains "Asks for contract" "$R" "contrato\|número\|cuenta"
print_response "Reply" "$R"
echo ""

# ============================================
# TEST 4: Contract Lookup + Identity Verification Flow
# Multi-turn conversation
# ============================================
echo -e "${CYAN}[4] Multi-Turn: Contract + Identity Verification${NC}"
CONV4="test-identity-$$"

echo -e "  ${YELLOW}Turn 1: Provide contract number${NC}"
R1=$(chat "$CONV4" "Quiero consultar mi saldo, mi contrato es 0102030405")
assert_success "Turn 1 success" "$R1"
assert_contains "Asks for name verification" "$R1" "nombre\|titular\|identidad\|verificar\|quién"
print_response "Turn 1" "$R1"

echo -e "  ${YELLOW}Turn 2: Provide name for verification${NC}"
R2=$(chat "$CONV4" "Juan Pérez García")
assert_success "Turn 2 success" "$R2"
assert_tool_used "Uses validate_contract_holder" "$R2" "validate_contract_holder"
print_response "Turn 2" "$R2"
echo ""

# ============================================
# TEST 5: Water Leak Report (should create ticket)
# ============================================
echo -e "${CYAN}[5] Water Leak Report - Ticket Creation${NC}"
CONV5="test-fuga-$$"

echo -e "  ${YELLOW}Turn 1: Report a leak${NC}"
R1=$(chat "$CONV5" "Quiero reportar una fuga de agua en la calle")
assert_success "Turn 1 success" "$R1"
assert_contains "Asks for location/details" "$R1" "ubicación\|dirección\|dónde\|calle\|colonia\|detalles"
print_response "Turn 1" "$R1"

echo -e "  ${YELLOW}Turn 2: Provide location${NC}"
R2=$(chat "$CONV5" "En la calle Hidalgo 123, colonia Centro, Querétaro")
assert_success "Turn 2 success" "$R2"
assert_tool_used "Uses create_ticket" "$R2" "create_ticket"
assert_contains "Returns folio" "$R2" "folio\|CEA-\|registr\|reporte"
print_response "Turn 2" "$R2"
echo ""

# ============================================
# TEST 6: Consumption History (needs contract + verification)
# ============================================
echo -e "${CYAN}[6] Consumption History Query${NC}"
CONV6="test-consumo-$$"
R=$(chat "$CONV6" "Quiero ver mi historial de consumo, contrato 0102030405")
assert_success "Returns success" "$R"
assert_contains "Asks for identity or shows data" "$R" "nombre\|titular\|consumo\|m³\|litros\|verificar"
print_response "Reply" "$R"
echo ""

# ============================================
# TEST 7: Office Hours / General Info (no tools needed)
# ============================================
echo -e "${CYAN}[7] General Info - Office Hours${NC}"
CONV7="test-horario-$$"
R=$(chat "$CONV7" "Cuál es el horario de atención?")
assert_success "Returns success" "$R"
assert_contains "Shows schedule info" "$R" "horario\|lunes\|viernes\|8\|atención\|oficina"
print_response "Reply" "$R"
echo ""

# ============================================
# TEST 8: Handoff to Human
# ============================================
echo -e "${CYAN}[8] Handoff to Human Agent${NC}"
CONV8="test-handoff-$$"
R=$(chat "$CONV8" "Quiero hablar con una persona real")
assert_success "Returns success" "$R"
assert_tool_used "Uses handoff_to_human" "$R" "handoff_to_human"
print_response "Reply" "$R"
echo ""

# ============================================
# TEST 9: Recibo/Invoice Request (should ask for contract)
# ============================================
echo -e "${CYAN}[9] Invoice/Recibo Request${NC}"
CONV9="test-recibo-$$"
R=$(chat "$CONV9" "Necesito mi recibo de agua")
assert_success "Returns success" "$R"
assert_contains "Asks for contract" "$R" "contrato\|número\|cuenta"
print_response "Reply" "$R"
echo ""

# ============================================
# TEST 10: Hallucination Guard - Check no fake folios
# ============================================
echo -e "${CYAN}[10] Hallucination Guard - No Fake Folios${NC}"
CONV10="test-hallucination-$$"
R=$(chat "$CONV10" "Ya hice mi reporte de fuga, me puedes dar el folio?")
assert_success "Returns success" "$R"
# Should NOT contain a fake folio pattern without create_ticket being called
HAS_FOLIO=$(echo "$R" | jq -r '.response' 2>/dev/null | grep -oiE 'CEA-[0-9]{4,8}-[0-9]{3,6}' || true)
USED_CREATE=$(echo "$R" | jq -r '.toolsUsed[]?' 2>/dev/null | grep "create_ticket" || true)
TOTAL=$((TOTAL + 1))
if [ -n "$HAS_FOLIO" ] && [ -z "$USED_CREATE" ]; then
    echo -e "  ${RED}FAIL${NC} Hallucinated folio detected: $HAS_FOLIO"
    FAIL=$((FAIL + 1))
else
    echo -e "  ${GREEN}PASS${NC} No hallucinated folios"
    PASS=$((PASS + 1))
fi
print_response "Reply" "$R"
echo ""

# ============================================
# TEST 11: Session Persistence - Multi-turn memory
# ============================================
echo -e "${CYAN}[11] Session Persistence - Remembers Context${NC}"
CONV11="test-memory-$$"

echo -e "  ${YELLOW}Turn 1: Mention contract${NC}"
R1=$(chat "$CONV11" "Hola, mi contrato es 0102030405")
print_response "Turn 1" "$R1"

echo -e "  ${YELLOW}Turn 2: Ask about balance without repeating contract${NC}"
R2=$(chat "$CONV11" "Cuánto debo?")
assert_success "Turn 2 success" "$R2"
# With session persistence, it should remember the contract and attempt to look up balance
# (will ask for identity verification first)
assert_contains "References contract or asks verification" "$R2" "contrato\|0102030405\|nombre\|titular\|verificar\|saldo"
print_response "Turn 2" "$R2"
echo ""

# ============================================
# TEST 12: Aclaración → Handoff (rule 13)
# ============================================
echo -e "${CYAN}[12] Aclaración - Should Handoff${NC}"
CONV12="test-aclaracion-$$"
R=$(chat "$CONV12" "Quiero hacer una aclaración de mi recibo, me cobraron de más")
assert_success "Returns success" "$R"
assert_tool_used "Uses handoff_to_human for aclaración" "$R" "handoff_to_human"
print_response "Reply" "$R"
echo ""

# ============================================
# RESULTS
# ============================================
echo "============================================"
echo " RESULTS"
echo "============================================"
echo -e " Total:  $TOTAL"
echo -e " ${GREEN}Passed: $PASS${NC}"
echo -e " ${RED}Failed: $FAIL${NC}"
echo ""

if [ "$FAIL" -eq 0 ]; then
    echo -e " ${GREEN}ALL TESTS PASSED${NC}"
else
    echo -e " ${YELLOW}$FAIL test(s) need attention${NC}"
fi
echo "============================================"
echo ""

exit $FAIL
