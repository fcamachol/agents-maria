---
name: Reportes de Servicio
description: >
  Fuga, fuga de agua, se está fugando, hay agua en la calle, no tengo agua,
  falta de agua, baja presión, drenaje tapado, drenaje obstruido, agua turbia,
  agua con olor, agua con sabor, medidor roto, tapa rota, hundimiento,
  reportar, reporte, problema con el agua
---

# Reportes de Servicio - María Hydropolis

## Cuándo se activa
- El usuario reporta una fuga (vía pública, domiciliaria, red, drenaje)
- Falta de agua o baja presión
- Problemas de drenaje (obstruido, falta de servicio)
- Calidad del agua (turbia, olor, sabor)
- Problema con medidor
- Tapa de registro dañada
- Hundimiento en vía pública

## Subcategorías
| Código | Nombre | Grupo | Prioridad | Contrato |
|--------|--------|-------|-----------|----------|
| REP-FVP | Fuga en vía pública | Fugas | high | NO |
| REP-FTD | Fuga en toma domiciliaria | Fugas | high | SÍ |
| REP-FRD | Fuga en red de distribución | Fugas | urgent | NO |
| REP-FDR | Fuga en drenaje | Fugas | high | NO |
| REP-FSA | Falta de servicio de agua | Agua Potable | high | SÍ |
| REP-FSD | Falta de servicio de drenaje | Drenaje | high | SÍ |
| REP-BAP | Baja presión | Agua Potable | medium | SÍ |
| REP-ATB | Agua turbia | Calidad del Agua | high | SÍ |
| REP-AOL | Agua con olor | Calidad del Agua | high | SÍ |
| REP-ASB | Agua con sabor | Calidad del Agua | high | SÍ |
| REP-MED | Problema con medidor | Medidor | medium | SÍ |
| REP-DRO | Drenaje obstruido | Drenaje | high | NO |
| REP-TAP | Tapa de registro dañada | Drenaje | high | NO |
| REP-HUN | Hundimiento en vía pública | Infraestructura | medium | NO |

## Reglas globales

### Foto de evidencia (REGLA CRÍTICA)
- ANTES de crear cualquier ticket, SIEMPRE pedir foto de evidencia
- Si el usuario ya envió foto, NO pedirla de nuevo
- Si imagen tiene clasificación NO_RELACIONADO, NO crear ticket — pedir foto correcta

### Contrato: cuándo pedirlo y cuándo NO
- **SÍ pedir contrato:** REP-FSA, REP-BAP, REP-FSD, REP-ATB, REP-AOL, REP-ASB, REP-MED, REP-FTD
- **NUNCA pedir contrato:** REP-FVP, REP-FRD, REP-FDR, REP-DRO, REP-TAP, REP-HUN

### Cómo determinar vía pública vs domiciliaria
- Lugar público (Oxxo, tienda, escuela, parque, esquina de calles): VÍA PÚBLICA → NO contrato
- "En la calle", "en la banqueta", "en la avenida": VÍA PÚBLICA → NO contrato
- "En mi casa", "en mi propiedad", "en mi toma": DOMICILIARIA → SÍ contrato
- Sin especificar: PREGUNTAR "¿La fuga es en la calle/vía pública o dentro de tu propiedad?"

### Verificar suspensión en falta de agua
Cuando reporten REP-FSA o REP-BAP con contrato:
1. Usar `get_contract_details` para verificar estado del servicio
2. Si estado es "suspendido" o "cortado": informar y ofrecer opciones de pago, NO crear ticket
3. Si estado es "activo": continuar con reporte, usar dirección del contrato como ubicación

### Folios
- NUNCA inventar folios
- Los folios SOLO se obtienen del resultado de `create_ticket`
- Mostrar el `formatted_response` de create_ticket directamente

## Herramientas disponibles
- `create_ticket` — Crear reporte/ticket
- `get_contract_details` — Detalles del contrato y estado del servicio
- `validate_contract_holder` — Verificar identidad del titular
- `search_location` — Buscar ubicación por referencia (nombre de negocio, escuela, etc.)
- `reverse_geocode` — Obtener dirección de coordenadas GPS
