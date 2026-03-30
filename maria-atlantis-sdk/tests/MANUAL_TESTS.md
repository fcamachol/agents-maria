# Maria Atlantis SDK - Manual Test Plan

Contract: 523160 (Titular: Luna)
Conversation: Agora (via Chatwoot webhook)

## Test 1: Greeting
**Send:** `Hola buenas tardes`
**Expected:** Natural greeting, presents as María de Hydropolis (NOT "asistente virtual")
**Tools:** None
**Result:** PASS
**Notes:** OK

---

## Test 2: Payment Info (no contract needed)
**Send:** `¿Cómo puedo pagar mi recibo de agua?`
**Expected:** Shows payment options (banco, Oxxo, en línea, sucursal). Should NOT ask for contract number. Payment URL: https://appcea.ceaqueretaro.gob.mx/PagoEnLinea/
**Tools:** None
**Result:** PASS (after fix: added correct payment URL to system prompt)
**Notes:** Was showing wrong URL, fixed by adding correct URL to system prompt rule 11

---

## Test 3: Office Hours
**Send:** `¿Cuál es el horario de atención?`
**Expected:** First asks for location: "Si quieres dime dónde estás y te doy los horarios de la oficina más cercana a ti." Then after user gives location, shows nearest office with hours. Ends with "¿Te puedo ayudar con algo más?"
**Tools:** find_nearest_locations (after user gives location)
**Result:** PASS (after fixes: added location-first rule, fixed DB column names lat→latitude/lng→longitude in colonias_zones and cea_locations)
**Notes:** OK

---

## Test 4: Balance Inquiry + Identity Verification
**Send:** `Quiero saber cuánto debo, mi contrato es 523160`
**Expected:** Asks for name of titular
**Then send:** `Luna`
**Expected:** Validates identity, shows balance/debt info
**Tools:** validate_contract_holder, get_deuda
**Result:** PASS
**Notes:** Tools confirmed: validate_contract_holder + get_deuda called on "Luna" message. Response: "Tu contrato 523160 no tiene adeudos pendientes."

---

## Test 5: Consumption History
**Send:** `Quiero ver mi historial de consumo del contrato 523160`
**Expected:** If already verified, shows consumption. If not, asks for name first.
**Tools:** get_consumo (after verification)
**Result:** PASS
**Notes:** get_consumo called correctly, no re-verification needed (session carried from Test 4)

---

## Test 6: Contract Details
**Send:** `Dame los detalles de mi contrato 523160`
**Expected:** Shows contract info (address, meter, status)
**Tools:** get_contract_details
**Result:** PASS
**Notes:** get_contract_details called correctly

---

## Test 7: Recibo/Invoice Link
**Send:** `Necesito mi recibo de agua del contrato 523160`
**Expected:** Returns download link for PDF recibo
**Tools:** get_recibo_link
**Result:** PASS
**Notes:** get_recibo_link called correctly

---

## Test 8: Leak Report
**Send:** `Quiero reportar una fuga de agua en la calle Hidalgo 123, colonia Centro`
**Expected:** Creates ticket, returns folio (CEA-XXXXXXXX-XXXXX)
**Tools:** create_ticket
**Result:** PASS (after fixes: photo optional, ask severity if no photo, never ask for client name)
**Notes:** Fixed 3 issues: (1) photo request wording changed to optional, (2) ask "¿Qué tan grave es la fuga?" when no photo, (3) never ask for full name — use WhatsApp profile

---

## Test 9: No Water Report
**Send:** `No tengo agua desde ayer, calle Juárez 456, colonia La Loma`
**Expected:** Creates ticket, returns folio
**Tools:** create_ticket
**Result:** PASS
**Notes:** validate_contract_holder + create_ticket called correctly (asked for contract since "no water" is property-specific)

---

## Test 10: Check My Tickets
**Send:** `Quiero ver mis reportes del contrato 523160`
**Expected:** Lists open tickets for that contract
**Tools:** get_client_tickets
**Result:** PASS (after fixes: hallucination guard, build step, conversation-level query)
**Notes:** Fixed 3 issues: (1) hallucination guard now allows folios from get_client_tickets/update_ticket, (2) pm2 runs dist/ so must `npm run build` after src changes, (3) get_client_tickets now queries by conversation_id when no contract given — shows tickets from this chat without identity verification

---

## Test 11: Handoff to Human
**Send:** `Quiero hablar con una persona`
**Expected:** Transfers to human, conversation status changes to "open"
**Tools:** handoff_to_human
**Result:** PASS
**Notes:** handoff_to_human called correctly

---

## Test 12: Aclaración → Handoff
**Send:** `Quiero hacer una aclaración de mi recibo, me cobraron de más`
**Expected:** Transfers to human (aclaraciones always go to human)
**Tools:** create_ticket, handoff_to_human
**Result:** PASS (after fix: aclaraciones now create ticket before handoff)
**Notes:** create_ticket (FAC) + handoff_to_human called correctly. User gets folio before transfer.

---

## Test 13: Nearest Payment Locations
**Send:** `¿Dónde puedo pagar cerca de la colonia Centro en Querétaro?`
**Expected:** Shows nearby offices/ATMs/payment points
**Tools:** find_nearest_locations
**Result:** PASS
**Notes:** find_nearest_locations called correctly

---

## Test 14: Hallucination Guard
**Send:** `Ya hice mi reporte de fuga, me das el folio?`
**Expected:** Should NOT invent a fake folio. Asks for details or says can't find it.
**Tools:** None (or get_client_tickets)
**Result:** PASS
**Notes:** No hallucinated folio. Used get_client_tickets to look up real tickets.

---

## Test 15: User Tries to Close Ticket
**Send:** `Quiero cerrar mi ticket`
**Expected:** Says they need a human agent, triggers handoff
**Tools:** handoff_to_human
**Result:** PASS
**Notes:** handoff_to_human called correctly

---

## Fixes Applied During Testing

1. **Session UUID**: Changed `maria-{id}-{timestamp}` → `crypto.randomUUID()` with `persistSession: true` + `resume` for multi-turn
2. **Cloudflare Worker**: Updated proxy port 3004 → 3006 for recibo PDFs
3. **GCP Firewall**: Opened port 3006 externally
4. **Handoff token**: Swapped priority to use bot token (`CHATWOOT_API_TOKEN`) over user token for toggle_status
5. **System prompt**: Present as human "María de Hydropolis", not "asistente virtual"
6. **Payment URL**: Added exact template with https://appcea.ceaqueretaro.gob.mx/PagoEnLinea/
7. **Office hours**: Ask for location first before calling tools
8. **DB columns**: Fixed `lat`/`lng` → `latitude`/`longitude` in colonias_zones and cea_locations queries
9. **Photo optional**: Changed photo request to optional ("¿Me puedes mandar una foto?"), ask severity if no photo for fugas
10. **No name for reports**: Never ask user's full name for create_ticket, use WhatsApp profile
11. **Hallucination guard**: Allow folio mentions when get_client_tickets or update_ticket called (not just create_ticket)
12. **Build step**: pm2 runs dist/ — must run `npm run build` after src/ changes
13. **get_client_tickets**: Converted to context tool, queries by conversation_id when no contract given
14. **Aclaraciones flow**: Now creates ticket (FAC) before handoff_to_human, user gets folio
15. **Identity verification wording**: Changed "tu nombre completo" → "el nombre del titular registrado en el contrato"
