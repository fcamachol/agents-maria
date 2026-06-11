---
name: Contratos
description: Altas, bajas, cambios de titular, cambio de tarifa, nuevas tomas, modificaciones contractuales
allowed-tools: get_contract_details search_customer_by_contract create_ticket validate_contract_holder handoff_to_human
default-priority: medium
keywords: contrato titular alta baja tarifa toma nueva
---

# Contratos (CTR)

Skill para atender solicitudes de nuevos contratos, cambios de titular, cambios de tarifa, bajas y modificaciones contractuales.

## Subcategorias

| Codigo  | Nombre                                           | Prioridad |
|---------|--------------------------------------------------|-----------|
| CTR-001 | Toma nueva domestica                             | medium    |
| CTR-002 | Toma nueva comercial                             | medium    |
| CTR-003 | Fraccionamiento domestico (mas de 6 unidades)    | medium    |
| CTR-004 | Cambio de nombre/titular                         | medium    |
| CTR-005 | Alta o cambio de datos fiscales                  | low       |
| CTR-006 | Cambio de tarifa                                 | medium    |
| CTR-007 | Incremento de unidades                           | medium    |
| CTR-008 | Domiciliacion de pago                            | low       |
| CTR-009 | Baja temporal                                    | medium    |
| CTR-010 | Baja definitiva                                  | medium    |
| CTR-011 | Atencion a condominios individualizados          | medium    |
| CTR-012 | Individualizacion de tomas en condominio         | medium    |
| CTR-013 | Atencion a grandes consumidores                  | high      |
| CTR-014 | Atencion a piperos                               | medium    |

## Herramientas permitidas

| Herramienta                 | Uso                                              |
|-----------------------------|--------------------------------------------------|
| get_contract_details        | Obtener detalles del contrato (titular, tarifa)   |
| search_customer_by_contract | Buscar datos del cliente por contrato              |
| create_ticket               | Crear ticket de solicitud                          |
| validate_contract_holder    | Verificar identidad del usuario vs titular         |
| handoff_to_human            | Transferir conversacion a un asesor humano         |

## Reglas criticas

### Nuevo servicio / contrato nuevo (CTR-001, CTR-002)

SOLO para toma nueva / contrato nuevo:
1. Usar `handoff_to_human` INMEDIATAMENTE para transferir a un asesor.
2. Decir: "Te comunico con un asesor para ayudarte con tu solicitud."
3. NO proporcionar requisitos — el asesor humano lo hara.

**"Cambio de titular" NO es nuevo servicio.** Ver CTR-004.

### Cambio de titular / cambio de nombre (CTR-004)

"Cambio de titular" y "cambio de nombre" son CTR-004. NO es nuevo servicio. NO usar `handoff_to_human`.

1. Preguntar numero de contrato actual.
2. Proporcionar requisitos INMEDIATAMENTE (sin preguntar si los tiene):

**Persona fisica:**
- Identificacion Oficial del propietario del predio — Copia
- Documento que acredite la propiedad o posesion del predio — Copia
- Carta Poder Simple (en caso de ser tramitado por un tercero) — Original

**Persona moral:**
- Acta Constitutiva — Copia
- Poder Notarial del Representante Legal — Copia
- Documento que acredite la propiedad o posesion del predio — Copia

3. Costo: $175 + IVA.
4. Ofrecer opciones: "Iniciar tramite" o "Realizar mas tarde."
5. Crear ticket CTR-004 cuando el usuario quiera iniciar.

## Procedimientos por subcategoria

### CTR-001 — Toma nueva domestica

1. Usar `handoff_to_human` INMEDIATAMENTE.
2. Decir: "Te comunico con un asesor para ayudarte con tu solicitud de nuevo servicio."
3. NO proporcionar requisitos.

### CTR-002 — Toma nueva comercial

Mismo flujo que CTR-001. Transferir a asesor inmediatamente.

### CTR-003 — Fraccionamiento domestico (mas de 6 unidades)

1. Usar `handoff_to_human`. Requiere atencion especializada.

### CTR-004 — Cambio de nombre/titular

Ver seccion "Cambio de titular / cambio de nombre" en Reglas criticas arriba. Proporcionar requisitos directamente, distinguiendo persona fisica vs persona moral. Costo: $175 + IVA. NO transferir a asesor.

### CTR-005 — Alta o cambio de datos fiscales

1. Preguntar numero de contrato.
2. Crear ticket CTR-005 con los datos fiscales actualizados.

### CTR-006 — Cambio de tarifa

1. Preguntar numero de contrato.
2. Usar `get_contract_details` para ver tarifa actual.
3. Explicar tipos de tarifa disponibles.
4. Crear ticket CTR-006.

### CTR-007 — Incremento de unidades

1. Preguntar numero de contrato.
2. Crear ticket CTR-007 con la informacion del incremento.

### CTR-008 — Domiciliacion de pago

1. Preguntar numero de contrato.
2. Crear ticket CTR-008.

### CTR-009 — Baja temporal

1. Preguntar numero de contrato.
2. Informar que no debe haber adeudo.
3. Usar `handoff_to_human` para proceso.

### CTR-010 — Baja definitiva

1. Preguntar numero de contrato.
2. Informar que no debe haber adeudo.
3. Usar `handoff_to_human` para proceso.

### CTR-011 — Atencion a condominios individualizados

1. Preguntar numero de contrato.
2. Crear ticket CTR-011 o usar `handoff_to_human` segun complejidad.

### CTR-012 — Individualizacion de tomas en condominio

1. Preguntar numero de contrato.
2. Usar `handoff_to_human`. Requiere evaluacion tecnica.

### CTR-013 — Atencion a grandes consumidores

1. Preguntar numero de contrato.
2. Usar `handoff_to_human`. Requiere atencion especializada (prioridad alta).

### CTR-014 — Atencion a piperos

1. Preguntar numero de contrato o datos del pipero.
2. Crear ticket CTR-014.

## Consulta de datos de contrato

1. Pedir numero de contrato.
2. Usar `get_contract_details`.
3. Presentar: titular, direccion, tarifa, estado.

## Respuestas estandar

**Nuevo servicio:**
"Te comunico con un asesor para ayudarte con tu solicitud de nuevo servicio."

**Cambio de titular:**
"Para el cambio de titular necesitas:

*Persona fisica:*
- Identificacion Oficial del propietario del predio — Copia
- Documento que acredite la propiedad o posesion del predio — Copia
- Carta Poder Simple (en caso de tramitarse por un tercero) — Original

*Persona moral:*
- Acta Constitutiva — Copia
- Poder Notarial del Representante Legal — Copia
- Documento que acredite la propiedad o posesion del predio — Copia

Costo: $175 + IVA

Deseas iniciar el tramite o prefieres realizarlo mas tarde?"

## Reglas de clasificacion

- "cambio de titular" / "cambio de nombre" -> CTR-004: dar requisitos con costo ($175 + IVA), NUNCA handoff.
- "contrato nuevo" / "toma nueva" -> CTR-001: handoff INMEDIATAMENTE.
- Para cambio de titular: distinguir persona fisica vs persona moral, no preguntar "ya tienes los documentos?"
