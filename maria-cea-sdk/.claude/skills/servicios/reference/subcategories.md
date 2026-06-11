# Subcategorías detalladas — Servicios Técnicos

## Flujo general para todos los servicios técnicos
1. Solicitar número de contrato (siempre necesario)
2. Verificar identidad con `validate_contract_holder`
3. Verificar historial con `get_consumo` si es relevante
4. Recabar información específica del problema
5. Crear ticket con subcategoría apropiada

---

## SRV-001 - Reportar lectura de medidor
**Cuándo aplica:** "Reportar lectura", "reporte de lectura", "registrar lectura".
**Prioridad:** low

**NOTA:** Este servicio crea ticket con categoría FAC, subcategoría FAC-LEC. Ver skill de Facturación para flujo completo.

**Flujo:**
1. PASO 1 — CONTRATO (SIEMPRE PRIMERO):
   - "Para registrar tu lectura, ¿me puedes dar tu número de contrato?"
   - NO pedir foto primero. NO mencionar foto. NO avanzar sin contrato verificado.
2. PASO 2 — FOTO DEL MEDIDOR (solo después de contrato verificado):
   - "Ahora envíame una foto de tu medidor para registrar la lectura"
   - Si clasificación es MEDIDOR → válida
   - Si clasificación es NO_RELACIONADO → pedir foto correcta
   - IGNORAR lectura/números — el técnico lo hará
3. PASO 3 — CREAR TICKET:
**Crear ticket con:**
- category_code: "FAC"
- subcategory_code: "FAC-LEC"
- titulo: "Reporte de lectura de medidor"
- descripcion: "Reporte de lectura de medidor. Evidencia fotográfica recibida."
- contract_number: número de contrato verificado
- priority: "low"

**Reglas estrictas:**
- NO crear ticket sin foto de evidencia
- NO crear ticket sin contrato verificado
- NO intentar leer ni mencionar la lectura del medidor
- NUNCA inventar folio

## SRV-002 - Revisión de medidor
**Cuándo aplica:** Medidor no gira, lectura parece incorrecta, consumo anormalmente alto.
**Prioridad:** medium
**Código de reparación:** 23-Revisión de instalación

**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. Usar `get_consumo` para verificar historial de consumo
4. Si el consumo es anormal, explicar posibles causas
5. Preguntar si quiere que se programe revisión técnica
6. Solo si confirma:
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-002"
- titulo: "Revisión de medidor"
- descripcion: Detalles del problema reportado + historial de consumo relevante
- contract_number: número del contrato

## SRV-003 - Medidor invertido
**Cuándo aplica:** El medidor gira al revés.
**Prioridad:** medium
**Código de reparación:** 22-Medidor invertido

**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. Informar que requiere visita técnica
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-003"
- titulo: "Medidor invertido"
- descripcion: "Usuario reporta que el medidor gira al revés"
- contract_number: número del contrato

## SRV-004 - Reposición de medidor (robo/daño)
**Cuándo aplica:** Medidor robado, dañado (golpeado, quemado), ilegible.
**Prioridad:** medium
**Código de reparación:** 33-Reponer contador

**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. Confirmar el motivo de la reposición (robo, daño, ilegible)
4. Informar que tiene costo (varía según caso)
5. Preguntar si quiere continuar
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-004"
- titulo: "Reposición de medidor"
- descripcion: Motivo (robo/daño/ilegible) + detalles
- contract_number: número del contrato

## SRV-005 - Relocalización de medidor
**Cuándo aplica:** Mover medidor a otra ubicación dentro de la propiedad.
**Prioridad:** low
**Código de reparación:** 21-Trabajos genéricos

**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. Preguntar justificación de la relocalización
4. Informar que requiere evaluación técnica
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-005"
- titulo: "Relocalización de medidor"
- descripcion: Justificación proporcionada por el usuario
- contract_number: número del contrato

## SRV-006 - Reposición de suministro
**Cuándo aplica:** El servicio fue cortado y el usuario ya pagó, quiere que le restablezcan el agua.
**Prioridad:** high
**Código de reparación:** 6-Reposición de suministro

**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. Verificar que no hay adeudo pendiente (usar `get_contract_details`)
4. Si hay adeudo: informar al usuario que debe liquidar antes
5. Si no hay adeudo: crear ticket urgente
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-006"
- titulo: "Reposición de suministro"
- descripcion: "Usuario solicita reposición de suministro tras liquidar adeudo"
- contract_number: número del contrato
- priority: "high"

## SRV-007 - Instalación de alcantarillado
**Cuándo aplica:** Propiedad sin conexión a drenaje, requiere instalar alcantarillado.
**Prioridad:** medium
**Código de reparación:** 40-Instalar alcantarillado

**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. Informar que requiere evaluación de factibilidad
4. Indicar que debe acudir a oficinas con:
   - Documento de propiedad
   - Identificación oficial
5. Usar `get_main_office` para indicar dónde acudir
6. Preguntar: "¿Quieres que busque la sucursal más cercana a ti?"
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-007"
- titulo: "Instalación de alcantarillado"
- descripcion: Detalles de la solicitud
- contract_number: número del contrato

## SRV-008 - Instalación de toma de agua potable
**Cuándo aplica:** Nueva conexión de agua potable. Similar a contrato nuevo.
**Prioridad:** medium
**Código de reparación:** 21-Trabajos genéricos

**Flujo:**
1. Canalizar a skill de Trámites (TRA-NUE) si es contrato completamente nuevo
2. Si es una segunda toma o toma adicional:
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-008"
- titulo: "Instalación de toma de agua potable"
- descripcion: Detalles de la solicitud
- contract_number: número del contrato si existe

## SRV-009 - Relocalización de toma
**Cuándo aplica:** Mover la toma de agua a otra posición.
**Prioridad:** low
**Código de reparación:** 21-Trabajos genéricos

**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. Informar que requiere evaluación técnica
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-009"
- titulo: "Relocalización de toma"
- descripcion: Motivo y detalles
- contract_number: número del contrato

## SRV-010 - Revisión de instalación
**Cuándo aplica:** Inspección general del sistema, verificar fugas internas, presión, etc.
**Prioridad:** medium
**Código de reparación:** 23-Revisión de instalación

**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. Preguntar qué problema específico observa
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-010"
- titulo: "Revisión de instalación"
- descripcion: Problema reportado por el usuario
- contract_number: número del contrato

## SRV-011 - Verificación de fuga no visible
**Cuándo aplica:** El usuario sospecha una fuga pero no la ve, consumo alto sin explicación.
**Prioridad:** medium
**Código de reparación:** 07-Fuga de agua no visible

**Flujo:**
1. Solicitar número de contrato
2. Verificar identidad
3. Usar `get_consumo` para verificar si hay anomalía en consumo
4. Si el consumo muestra incremento inexplicable, confirmar sospecha
5. Informar que requiere equipo especializado de detección
**Crear ticket con:**
- category_code: "SRV"
- subcategory_code: "SRV-011"
- titulo: "Verificación de fuga no visible"
- descripcion: "Consumo alto sin explicación. Se requiere verificación con equipo especializado." + datos de consumo histórico
- contract_number: número del contrato

---

## Nota sobre oficinas
Para servicios que requieran visita presencial (SRV-007, SRV-008):
- NUNCA dar horarios, direcciones o teléfonos de memoria
- Usar `get_main_office` para indicar dónde acudir
- Preguntar: "¿Quieres que busque la sucursal más cercana a ti?"
- Si dice sí → usar `find_nearest_locations`

## Nota sobre costos
- Algunos servicios tienen costo adicional (SRV-004 reposición, SRV-005 relocalización)
- Informar al usuario que hay costo pero NO mencionar montos específicos
- Los tiempos de atención varían según la carga de trabajo
