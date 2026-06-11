# Subcategorías detalladas — Reportes de Servicio

## Flujos según tipo de reporte

### Reportes en vía pública (REP-FVP, REP-FRD, REP-FDR, REP-DRO, REP-TAP, REP-HUN)
**NO pedir contrato. Solo ubicación.**

**Flujo:**
1. **UBICACIÓN** — Analizar el mensaje del usuario:
   a. Si el usuario YA MENCIONÓ una referencia informal (ej: "cerca del Oxxo del Campanario", "frente a la primaria"):
      - INMEDIATAMENTE usar `search_location` para resolverla. NO preguntar la dirección de nuevo
      - Construir el query: extraer punto de referencia + zona + "Querétaro" (ej: "Oxxo Campanario Querétaro")
      - Si hay 1 resultado: confirmar con el usuario ("¿La fuga está cerca de [nombre], [dirección]?")
      - Si hay múltiples: presentar opciones numeradas
      - Si hay 0 resultados: pedir la dirección de forma más específica
   b. Si el usuario dio una dirección completa (calle, número, colonia): usarla directamente
   c. Si el usuario compartió ubicación GPS ("[Ubicacion compartida: Lat X, Long Y]"):
      - Usar `reverse_geocode` para obtener la dirección y confirmar
   d. Si el usuario NO mencionó ubicación: preguntar "¿Dónde está el problema? Puedes darme la calle y colonia, o una referencia como 'cerca de [negocio/escuela/parque]'"
   - IMPORTANTE: Cuando se use create_ticket, incluir latitude y longitude si se obtuvieron de search_location o reverse_geocode
2. Pedir foto de evidencia (si no la enviaron)
3. Preguntar gravedad: ¿Es urgente? ¿Hay inundación?
4. Crear ticket con `create_ticket`

### Reportes de servicio (REP-FSA, REP-FGA, REP-BAP, REP-FSD, REP-ATB, REP-AOL, REP-ASB, REP-MED)
**SÍ pedir contrato.**

**Flujo general (aplica a REP-BAP, REP-FSD, REP-ATB, REP-AOL, REP-ASB, REP-MED — REP-FSA y REP-FGA tienen flujo propio más abajo):**
1. Preguntar número de contrato
2. Pedir nombre o apellido del titular y usar `validate_contract_holder`
3. Usar `get_contract_details` para obtener dirección y estado del servicio
4. **Para REP-BAP:** Verificar si estado es "suspendido" o "cortado". Si lo es, informar y ofrecer opciones de pago. NO crear ticket.
5. Confirmar al usuario: "Tu reporte será registrado en [dirección del contrato]."
6. Si NO tiene contrato: entonces sí preguntar ubicación exacta (calle, número, colonia)
7. Pedir foto de evidencia (si no la enviaron)
8. Preguntar: "¿Quieres que registre tu reporte?" Si confirma, crear ticket. NO preguntar gravedad ni urgencia — usar prioridad por defecto de la subcategoría.
9. Crear ticket con `create_ticket`

**Flujo específico de REP-FSA / REP-FGA (falta de agua) — sobreescribe los pasos 4 y 6 de arriba:**
1. Preguntar número de contrato
2. **Si el usuario NO tiene contrato o se niega a darlo:** responder "Para revisar tu servicio necesito un número de contrato. Te comunico con un asesor que te pueda ayudar." y usar `handoff_to_human`. NO crear ticket. NO usar el fallback de pedir ubicación.
3. Con contrato: pedir nombre del titular y usar `validate_contract_holder`
4. Usar `get_contract_details` para obtener estado del servicio
5. **Si estado es "suspendido" o "cortado":** responder "Tienes un adeudo pendiente. Te comunico con un asesor." y usar `handoff_to_human`. NO crear ticket. NO ofrecer opciones de pago.
6. **Si estado es "activo":** preguntar "¿La falta de agua es solo en tu casa o tus vecinos también están sin servicio?"
7. Si solo en su casa → crear ticket con `create_ticket(category_code="REP", subcategory_code="REP-FSA", priority="high")`
8. Si vecinos también / toda la colonia / general → crear ticket con `create_ticket(category_code="REP", subcategory_code="REP-FGA", priority="high")`
9. Foto opcional (regla global 12). NO preguntar gravedad ni urgencia.

### Reportes en toma domiciliaria (REP-FTD)
**SÍ pedir contrato.**

**Flujo:**
1. Preguntar número de contrato
2. Pedir nombre o apellido del titular y usar `validate_contract_holder`
3. Usar `get_contract_details` para obtener dirección
4. Confirmar: "Tu reporte será registrado en [dirección del contrato]."
5. Si NO tiene contrato: preguntar ubicación exacta
6. Pedir foto de evidencia (si no la enviaron)
7. Crear ticket con `create_ticket`

---

## Detalle por subcategoría

## REP-FVP - Fuga en vía pública
**Cuándo aplica:** Fuga de agua visible en calle, banqueta, avenida, cerca de negocio/escuela/parque.
**Contrato:** NO pedir
**Prioridad:** high
**Flujo:** Vía pública (ver arriba)
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-FVP"
- titulo: Descripción breve de la fuga
- descripcion: Información recabada + "Evidencia fotográfica recibida" si enviaron foto
- ubicacion: Dirección exacta
- latitude/longitude: si se obtuvieron
- priority: "high"

## REP-FTD - Fuga en toma domiciliaria
**Cuándo aplica:** Fuga en la propiedad del usuario, "en mi casa", "en mi toma".
**Contrato:** SÍ pedir
**Prioridad:** high
**Flujo:** Toma domiciliaria (ver arriba)
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-FTD"
- titulo: "Fuga en toma domiciliaria"
- descripcion: Detalles + evidencia
- contract_number: número del contrato
- ubicacion: Dirección del contrato
- priority: "high"

## REP-FRD - Fuga en red de distribución
**Cuándo aplica:** Fuga grande en tubería principal, red de distribución.
**Contrato:** NO pedir
**Prioridad:** urgent
**Flujo:** Vía pública
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-FRD"
- priority: "urgent"

## REP-FDR - Fuga en drenaje
**Cuándo aplica:** Fuga o derrame de aguas residuales en vía pública.
**Contrato:** NO pedir
**Prioridad:** high
**Flujo:** Vía pública
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-FDR"
- priority: "high"

## REP-FSA - Falta de servicio de agua (solo en la propiedad del usuario)
**Cuándo aplica:** "No tengo agua", "no me llega agua", "se fue el agua" — y el usuario confirma que el problema es solo en su casa, no en sus vecinos.
**Contrato:** SÍ pedir. Si no tiene contrato → handoff a asesor (ver flujo específico arriba). NO usar el fallback de pedir ubicación.
**Prioridad:** high
**Verificar suspensión:** SÍ — usar get_contract_details antes de crear ticket. Si "suspendido" o "cortado" → handoff con mensaje de adeudo. NO crear ticket.
**Flujo:** Específico de REP-FSA / REP-FGA (ver "Flujo específico de REP-FSA / REP-FGA" arriba)
**Crear ticket con (solo si estado=activo y usuario dice que vecinos NO están afectados):**
- category_code: "REP"
- subcategory_code: "REP-FSA"
- titulo: "Falta de servicio de agua"
- descripcion: detalles + "Reporte solo en domicilio del titular"
- contract_number: número del contrato
- ubicacion: dirección del contrato
- priority: "high"

## REP-FGA - Falta de servicio de agua general (vecinos también afectados)
**Cuándo aplica:** Después de preguntar "¿es solo en tu casa o vecinos también?", el usuario confirma que vecinos / la colonia / la calle / varias casas también están sin agua.
**Contrato:** SÍ pedir. Mismo override que REP-FSA: si no tiene contrato → handoff a asesor. NO usar el fallback de pedir ubicación.
**Prioridad:** high
**Verificar suspensión:** SÍ — mismo manejo que REP-FSA (handoff con mensaje de adeudo si "suspendido" o "cortado"). NO crear ticket.
**Flujo:** Específico de REP-FSA / REP-FGA (ver arriba)
**Crear ticket con (solo si estado=activo y usuario dice que vecinos también están afectados):**
- category_code: "REP"
- subcategory_code: "REP-FGA"
- titulo: "Falta de servicio de agua general"
- descripcion: detalles + "Reporte general — vecinos también afectados" + colonia/referencia si el usuario la mencionó
- contract_number: número del contrato (del titular que reporta)
- ubicacion: dirección del contrato (o colonia si el usuario la dio explícitamente)
- priority: "high"

## REP-FSD - Falta de servicio de drenaje
**Cuándo aplica:** No funciona el drenaje, no drena el agua.
**Contrato:** SÍ pedir
**Prioridad:** high
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-FSD"
- priority: "high"

## REP-BAP - Baja presión
**Cuándo aplica:** "El agua sale muy despacio", "baja presión", "casi no sale agua".
**Contrato:** SÍ pedir
**Prioridad:** medium
**Verificar suspensión:** SÍ — usar get_contract_details antes de crear ticket
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-BAP"
- priority: "medium"

## REP-ATB - Agua turbia
**Cuándo aplica:** "El agua sale turbia", "agua sucia", "agua café".
**Contrato:** SÍ pedir
**Prioridad:** high
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-ATB"
- priority: "high"

## REP-AOL - Agua con olor
**Cuándo aplica:** "El agua huele mal", "agua con olor", "agua apestosa".
**Contrato:** SÍ pedir
**Prioridad:** high
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-AOL"
- priority: "high"

## REP-ASB - Agua con sabor
**Cuándo aplica:** "El agua sabe raro", "agua con sabor", "sabe a cloro".
**Contrato:** SÍ pedir
**Prioridad:** high
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-ASB"
- priority: "high"

## REP-MED - Problema con medidor
**Cuándo aplica:** Medidor roto, medidor no gira, medidor robado (para reporte, no servicio técnico).
**Contrato:** SÍ pedir
**Prioridad:** medium
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-MED"
- priority: "medium"

## REP-DRO - Drenaje obstruido
**Cuándo aplica:** "Drenaje tapado", "alcantarilla tapada", "el drenaje no funciona" en vía pública.
**Contrato:** NO pedir
**Prioridad:** high
**Flujo:** Vía pública
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-DRO"
- priority: "high"

## REP-TAP - Tapa de registro dañada
**Cuándo aplica:** Tapa de registro rota, faltante, hundida en vía pública.
**Contrato:** NO pedir
**Prioridad:** high
**Flujo:** Vía pública
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-TAP"
- priority: "high"

## REP-HUN - Hundimiento en vía pública
**Cuándo aplica:** Hundimiento, socavón, bache por problema de agua/drenaje.
**Contrato:** NO pedir
**Prioridad:** medium
**Flujo:** Vía pública
**Crear ticket con:**
- category_code: "REP"
- subcategory_code: "REP-HUN"
- priority: "medium"

---

## Análisis de imagen de fuga

Cuando el mensaje contenga [ANÁLISIS DE FUGA], el sistema ya procesó la foto con análisis técnico. Contiene:
- Ubicación, superficie, tipo de agua, volumen estimado, área afectada
- Tiempo estimado, daño a pavimento, infraestructura afectada
- Riesgo peatonal y vehicular
- Subcategoría sugerida, prioridad sugerida, descripción para ticket

**Cómo actuar:**
1. USAR la subcategoría sugerida para determinar el tipo de reporte
2. USAR la prioridad sugerida para el campo priority del ticket
3. USAR la "Descripción para ticket" como base del campo descripcion
4. NO preguntar gravedad ni urgencia — ya se tiene del análisis
5. La foto YA fue recibida y analizada — NO pedirla de nuevo
6. Confirmar al usuario: "Por la foto que enviaste, veo [resumen breve]. Necesito que me indiques la ubicación exacta para registrar tu reporte."
7. Si el análisis indica riesgo peatonal o vehicular urgente, priorizar la creación del ticket

---

## Crear ticket (formato general)
```
create_ticket({
  category_code: "REP",
  subcategory_code: "[código exacto]",
  titulo: "[descripción breve]",
  descripcion: "[información recabada] + 'Evidencia fotográfica recibida' si enviaron foto",
  ubicacion: "[dirección exacta]",
  latitude: [si disponible],
  longitude: [si disponible],
  contract_number: [si aplica],
  priority: "[según subcategoría]"
})
```

El sistema genera el folio automáticamente. Mostrar el `formatted_response` directamente. NUNCA inventar folio.
