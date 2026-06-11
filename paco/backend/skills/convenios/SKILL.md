---
name: Convenios
description: Convenios de pago, programas de apoyo, pensionados, tercera edad, personas con discapacidad
allowed-tools: get_deuda get_contract_details create_ticket search_customer_by_contract validate_contract_holder handoff_to_human
default-priority: medium
keywords: convenio pago apoyo pensionado tercera edad discapacidad prorroga
---

# Convenios (CVN)

Skill para atender solicitudes de convenios de pago y programas de apoyo social (pensionados, tercera edad, personas con discapacidad).

## Subcategorias

| Codigo  | Nombre                                    | Grupo              | Prioridad |
|---------|-------------------------------------------|--------------------|-----------|
| CVN-001 | Convenio corto plazo (0-6 meses)          | Convenios de Pago  | medium    |
| CVN-002 | Convenio mediano plazo (7-12 meses)       | Convenios de Pago  | medium    |
| CVN-003 | Convenio largo plazo (13+ meses)          | Convenios de Pago  | medium    |
| CVN-004 | Otorgamiento de prorroga                  | Convenios de Pago  | medium    |
| CVN-005 | Programa pensionados y jubilados          | Programas de Apoyo | low       |
| CVN-006 | Programa tercera edad                     | Programas de Apoyo | low       |
| CVN-007 | Programa personas con discapacidad        | Programas de Apoyo | low       |

## Herramientas permitidas

| Herramienta                 | Uso                                              |
|-----------------------------|--------------------------------------------------|
| get_deuda                   | Consultar saldo y adeudo de un contrato          |
| get_contract_details        | Obtener detalles del contrato                     |
| create_ticket               | Crear ticket de solicitud de convenio              |
| search_customer_by_contract | Buscar datos del cliente por contrato              |
| validate_contract_holder    | Verificar identidad del usuario vs titular         |
| handoff_to_human            | Transferir conversacion a un asesor humano         |

## Flujo para convenio de pago

1. Solicitar numero de contrato.
2. Usar `get_deuda` para verificar el adeudo total.
3. Determinar el tipo de convenio segun el monto y capacidad de pago:
   - CVN-001: 0-6 meses (adeudos menores)
   - CVN-002: 7-12 meses (adeudos medianos)
   - CVN-003: 13+ meses (adeudos mayores, requiere autorizacion)

## Requisitos para convenio

- Contrato activo o con posibilidad de reactivacion.
- Identificacion oficial del titular.
- Comprobante de domicilio reciente.
- Enganche minimo (varia segun el monto).

## Procedimientos por subcategoria

### CVN-001 — Convenio corto plazo (0-6 meses)

1. Verificar adeudo con `get_deuda`.
2. Calcular opciones de pago mensual.
3. Crear ticket con categoria CVN y subcategory_code "CVN-001".
4. Indicar que debe acudir a oficinas para formalizar.

### CVN-002 — Convenio mediano plazo (7-12 meses)

1. Verificar adeudo con `get_deuda`.
2. Calcular opciones de pago mensual.
3. Crear ticket con subcategory_code "CVN-002".
4. Indicar que debe acudir a oficinas para formalizar.

### CVN-003 — Convenio largo plazo (13+ meses)

1. Verificar adeudo con `get_deuda`.
2. Informar que requiere autorizacion especial.
3. Crear ticket con subcategory_code "CVN-003".
4. Indicar que debe acudir a oficinas para formalizar.

### CVN-004 — Otorgamiento de prorroga

- Para clientes con convenio vigente que necesitan extension.
- Requisito: estar al corriente con los pagos del convenio.
- Crear ticket CVN-004 con justificacion.

### CVN-005 — Programa pensionados y jubilados

- Tarifa preferencial para jubilados.
- Requisitos: credencial IMSS/ISSSTE, identificacion oficial.
- Flujo:
  1. Verificar contrato con `get_contract_details`.
  2. Confirmar que cumple requisitos.
  3. Crear ticket con subcategory_code "CVN-005".
  4. Indicar documentos necesarios y que debe acudir a oficinas.

### CVN-006 — Programa tercera edad

- Para personas de 60+ anos.
- Requisitos: identificacion con fecha de nacimiento.
- Flujo:
  1. Verificar contrato con `get_contract_details`.
  2. Confirmar que cumple requisitos.
  3. Crear ticket con subcategory_code "CVN-006".
  4. Indicar documentos necesarios y que debe acudir a oficinas.

### CVN-007 — Programa personas con discapacidad

- Tarifa preferencial.
- Requisitos: credencial de discapacidad vigente.
- Flujo:
  1. Verificar contrato con `get_contract_details`.
  2. Confirmar que cumple requisitos.
  3. Crear ticket con subcategory_code "CVN-007".
  4. Indicar documentos necesarios y que debe acudir a oficinas.

## Reglas importantes

- Los convenios se formalizan en oficinas CEA.
- Los programas de apoyo requieren renovacion anual.
- SIEMPRE mostrar el saldo actual antes de hablar de convenios.
