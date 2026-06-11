---
name: Servicios Técnicos
description: >
  Medidor, lectura, revisión de medidor, medidor invertido, medidor robado,
  reposición de medidor, relocalización, suministro, alcantarillado,
  instalación de toma, revisión de instalación, fuga no visible,
  consumo alto, verificación técnica
---

# Servicios Técnicos - María CEA Querétaro

## Cuándo se activa
- Problemas con medidor (revisión, invertido, robado, reposición, relocalización)
- Reposición de suministro (servicio cortado y ya pagó)
- Instalación de alcantarillado o toma de agua
- Relocalización de toma
- Revisión general de instalación
- Sospecha de fuga no visible (consumo alto sin explicación)

## Subcategorías
| Código | Nombre | Grupo | Prioridad |
|--------|--------|-------|-----------|
| SRV-001 | Reportar lectura de medidor | Medidores | low |
| SRV-002 | Revisión de medidor | Medidores | medium |
| SRV-003 | Medidor invertido | Medidores | medium |
| SRV-004 | Reposición de medidor (robo/daño) | Medidores | medium |
| SRV-005 | Relocalización de medidor | Medidores | low |
| SRV-006 | Reposición de suministro | Instalaciones | high |
| SRV-007 | Instalación de alcantarillado | Instalaciones | medium |
| SRV-008 | Instalación de toma de agua potable | Instalaciones | medium |
| SRV-009 | Relocalización de toma | Instalaciones | low |
| SRV-010 | Revisión de instalación | Instalaciones | medium |
| SRV-011 | Verificación de fuga no visible | Instalaciones | medium |

## Reglas globales

### Contrato siempre requerido
- Todos los servicios técnicos requieren número de contrato
- Verificar identidad con `validate_contract_holder` antes de proceder

### Folios
- NUNCA inventar folios (ej: CEA-XXXXX-XXXX)
- Los folios SOLO se obtienen del resultado de `create_ticket`
- Si create_ticket falla, decir: "Hubo un problema al crear tu reporte, déjame intentar de nuevo"

### Costos
- Algunos servicios tienen costo adicional — informar al usuario
- Los tiempos de atención varían según la carga de trabajo

## Herramientas disponibles
- `get_consumo` — Historial de consumo (útil para revisar anomalías)
- `get_contract_details` — Detalles del contrato
- `create_ticket` — Crear ticket de servicio técnico
- `search_customer_by_contract` — Buscar datos de cliente
- `validate_contract_holder` — Verificar identidad del titular
- `get_main_office` — Info de oficina principal
- `find_nearest_locations` — Sucursales cercanas
