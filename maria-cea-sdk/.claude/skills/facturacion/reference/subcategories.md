# Subcategorías detalladas — Facturación

## FAC-DIG - Recibo digital / enviar por correo
**Cuándo aplica:** El usuario pide su recibo, quiere descargar recibo, recibo por correo, recibo digital.
**Flujo:**
1. Preguntar número de contrato (si no lo tiene)
2. PREGUNTAR al usuario el nombre o apellido del titular
3. ESPERAR respuesta y usar `validate_contract_holder` con el nombre que el usuario escribió
4. Usar `get_recibo_link` para generar el enlace de descarga del recibo
5. Si el usuario pide un mes específico, pasar el periodo como parámetro
6. Siempre ofrecer: "Si necesitas de otro mes avísame y te ayudo"
**No requiere ticket.**

## FAC-REC - Recibo a domicilio
**Cuándo aplica:** El usuario quiere recibir su recibo físico en su domicilio.
**Flujo:**
1. Confirmar contrato y dirección
2. Verificar identidad con `validate_contract_holder`
**Crear ticket con:**
- category_code: "FAC"
- subcategory_code: "FAC-REC"
- titulo: "Solicitud de recibo a domicilio"
- descripcion: Incluir contrato y dirección confirmada
- contract_number: número del contrato

## FAC-ACL - Aclaración de cobro
**Cuándo aplica:** El usuario tiene dudas o inconformidad con un cobro, no entiende su recibo, quiere aclarar un monto.
**Flujo:**
1. Preguntar: "¿Tienes tu número de contrato a la mano?"
2. Si lo tiene: tomarlo. Si NO lo tiene: NO insistir, avanzar de todas formas
3. El contrato es OPCIONAL, no obligatorio
4. NO intentar resolver la aclaración
5. Decir: "Te comunico con un asesor para revisar tu aclaración"
6. Usar `handoff_to_human` para transferir

**Si el usuario envió foto de recibo con [ANÁLISIS DE RECIBO]:**
- Usar los datos extraídos como contexto al transferir
- Incluir los datos del recibo en el motivo del handoff

**No crear ticket — solo handoff_to_human.**

## FAC-AJU - Solicitud de ajuste
**Cuándo aplica:** El usuario solicita un ajuste en su facturación.
**Flujo:**
1. Preguntar número de contrato
2. Usar `handoff_to_human` — los ajustes requieren revisión de un asesor
3. NO intentar resolver
**No crear ticket — solo handoff_to_human.**

## FAC-EST - Consulta de saldo
**Cuándo aplica:** "Cuánto debo", "cuál es mi saldo", consulta de adeudo.
**Flujo:**
1. Preguntar: "¿Me proporcionas tu número de contrato?"
2. Verificar identidad con `validate_contract_holder`
3. Usar `get_deuda` para obtener el saldo
4. Presentar claramente: total, vencido, por vencer
**No requiere ticket.**

## FAC-PAG - Formas/historial de pago
**Cuándo aplica:** "Dónde pago", "formas de pago", historial de pagos, carta de no adeudo.
**Flujo para formas de pago:**
1. NO pedir número de contrato
2. Mostrar opciones:
   - En línea: https://appcea.ceaqueretaro.gob.mx/PagoEnLinea/
   - Sucursales CEA
   - Oxxo (con recibo)
   - Bancos autorizados
   - Domiciliación bancaria
3. Si pregunta dónde pagar en persona:
   - Ofrecer: "Si prefieres pagar en persona, ¿me compartes tu ubicación para encontrar la sucursal más cercana?"
   - Usar `find_nearest_locations` con tipo="all" cuando tenga ubicación

**Flujo para carta de no adeudo:**
1. Preguntar número de contrato
2. Verificar identidad
**Crear ticket con:**
- category_code: "FAC"
- subcategory_code: "FAC-PAG"
- titulo: "Solicitud de carta de no adeudo"
- contract_number: número del contrato

## FAC-SAF - Saldo a favor
**Cuándo aplica:** El usuario menciona "saldo a favor", "crédito a favor", dinero que la CEA le debe, devolución de pago.
**Flujo:**
1. Responder: "Eso lo ve el área de finanzas, ¿quieres que te comunique con ellos para revisarlo?"
2. Si el usuario dice SÍ:
   a. Preguntar número de contrato si no lo tiene
   b. Crear ticket con category_code: "FAC", subcategory_code: "FAC-SAF"
   c. Usar `handoff_to_human` con motivo "Usuario consulta saldo a favor - transferir a finanzas"
3. Si el usuario dice NO: responder "Está bien, ¿te puedo ayudar con algo más?"
4. NO consultar get_deuda ni intentar resolver — finanzas maneja esto

## FAC-CON - Convenio de pago
**Cuándo aplica:** El usuario pide convenio de pago, plan de pagos, "no puedo pagar todo", prórroga.
**Flujo:**
1. Si no tiene número de contrato → solicitarlo
2. Usar `search_customer_by_contract` para obtener datos del contrato
3. Verificar identidad del titular con `validate_contract_holder`
4. NO explicar tipos de convenio, plazos, requisitos ni enganches
5. NO ofrecer ni negociar planes de pago
6. NO mencionar montos, porcentajes ni condiciones
7. Responder: "Un agente especializado le brindará toda la información sobre su convenio. Permítame transferirlo."
**Crear ticket con:**
- category_code: "FAC"
- subcategory_code: "FAC-CON"
- titulo: "Solicitud de convenio de pago"
- descripcion: Lo que el usuario solicita
- contract_number: número del contrato
8. Llamar `handoff_to_human` con el motivo describiendo la solicitud de convenio
9. Confirmar al usuario que será atendido por un agente especializado

**Incluye prórrogas (FAC-CON):** mismo flujo.

## FAC-CNL - Cancelación de convenio
**Cuándo aplica:** El usuario quiere cancelar un convenio de pago existente.
**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. NO intentar cancelar directamente
**Crear ticket con:**
- category_code: "FAC"
- subcategory_code: "FAC-CNL"
- titulo: "Cancelación de convenio de pago"
- contract_number: número del contrato
4. Usar `handoff_to_human` para transferir a asesor especializado

## FAC-TAR - Tarifas y multas
**Cuándo aplica:** El usuario pregunta sobre tarifas de agua, multas en su recibo.
**Flujo:**
1. Para multas: preguntar número de contrato
2. Verificar identidad
3. Usar `handoff_to_human` — multas requieren revisión de asesor
**No crear ticket — solo handoff_to_human.**

## FAC-LEC - Reporte de lectura de medidor
**Cuándo aplica:** El usuario dice "reportar lectura", "reporte de lectura", "registrar lectura".
**Flujo:**
1. **PASO 1 — CONTRATO (SIEMPRE PRIMERO):**
   - Responder: "Para registrar tu lectura, ¿me puedes dar tu número de contrato?"
   - La verificación de identidad se maneja por reglas globales
   - NO pedir foto, NO mencionar foto, NO avanzar sin contrato verificado
2. **PASO 2 — FOTO DEL MEDIDOR (solo después de contrato verificado):**
   - Pedir foto: "Ahora envíame una foto de tu medidor para registrar la lectura"
   - Si la imagen dice "CLASIFICACIÓN: MEDIDOR" → foto válida, continuar
   - Si dice "CLASIFICACIÓN: NO_RELACIONADO" → pedir foto correcta
   - IGNORAR lectura, análisis, números — el técnico lo hará en campo
3. **PASO 3 — CREAR TICKET (OBLIGATORIO):**
**Crear ticket con:**
- category_code: "FAC"
- subcategory_code: "FAC-LEC"
- titulo: "Reporte de lectura de medidor"
- descripcion: "Reporte de lectura de medidor. Evidencia fotográfica recibida."
- contract_number: número de contrato verificado
- priority: "low"
4. ESPERAR el resultado de create_ticket para obtener el folio real
5. Confirmar: "Tu reporte de lectura ha sido registrado con folio [folio del resultado]"

**Reglas estrictas FAC-LEC:**
- NO crear ticket sin foto de evidencia
- NO crear ticket sin contrato verificado
- NO intentar leer ni mencionar la lectura del medidor
- NUNCA inventar un folio — SIEMPRE usar el que devuelve create_ticket
