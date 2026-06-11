---
name: "Facturaci\xF3n"
description: Recibos, aclaraciones de cobro, ajustes, pagos, historial, devoluciones
allowed-tools: get_deuda get_consumo get_contract_details create_ticket search_customer_by_contract get_recibo_link get_recibo_pdf validate_contract_holder handoff_to_human find_nearest_locations
default-priority: medium
keywords: recibo cobro ajuste pago factura devolucion
---

# Facturacion (FAC)

Skill para atender consultas de recibos, aclaraciones de cobro, ajustes, pagos, historial de pagos y devoluciones.

## Subcategorias

| Codigo  | Nombre                                      | Prioridad |
|---------|---------------------------------------------|-----------|
| FAC-001 | Solicitud de recibo por correo electronico  | low       |
| FAC-002 | Solicitud de recibo a domicilio             | low       |
| FAC-003 | Reimpresion de recibo                       | low       |
| FAC-004 | Aclaracion de cobro                         | medium    |
| FAC-005 | Solicitud de ajuste                         | medium    |
| FAC-006 | Carta de no adeudo                          | low       |
| FAC-007 | Historial de pagos                          | low       |
| FAC-008 | Solicitud de devolucion de pago             | medium    |
| FAC-009 | Multas                                      | medium    |

## Herramientas permitidas

| Herramienta                 | Uso                                                    |
|-----------------------------|--------------------------------------------------------|
| get_deuda                   | Consultar saldo y adeudo de un contrato                |
| get_consumo                 | Consultar historial de consumo                         |
| get_contract_details        | Obtener detalles del contrato                          |
| create_ticket               | Crear ticket de solicitud                              |
| search_customer_by_contract | Buscar datos del cliente por contrato                  |
| get_recibo_link             | Obtener enlace al recibo en linea                      |
| get_recibo_pdf              | Generar enlace seguro para descargar recibo digital PDF |
| validate_contract_holder    | Verificar identidad del usuario vs titular             |
| handoff_to_human            | Transferir conversacion a un asesor humano             |
| find_nearest_locations      | Encontrar oficinas y puntos de pago cercanos           |

## Reglas criticas

### Aclaraciones (FAC-004)

1. Preguntar: "Tienes tu numero de contrato a la mano?"
2. Si lo tiene: tomarlo. Si NO lo tiene: NO insistir, avanzar de todas formas.
3. Usar `handoff_to_human` SIEMPRE. El contrato es OPCIONAL.
4. Decir: "Te comunico con un asesor para revisar tu aclaracion."
5. NO intentar resolver la aclaracion.

### Pagos

- NO pedir numero de contrato.
- Mostrar PRIMERO las opciones de pago:
  - En linea: https://appcea.ceaqueretaro.gob.mx/PagoEnLinea/
  - Oxxo (con tu recibo)
  - Bancos autorizados
  - Domiciliacion bancaria
- Si el usuario pregunta "donde puedo pagar en persona?" o "sucursales cerca de mi":
  - Ofrecer: "Si prefieres pagar en persona, me compartes tu ubicacion para encontrar la sucursal mas cercana?"
  - Usar `find_nearest_locations` con tipo="all" cuando se tenga ubicacion.

### Ajustes (FAC-005)

1. Preguntar numero de contrato.
2. Usar `handoff_to_human`. Los ajustes requieren revision de un asesor.

## Procedimientos por subcategoria

### FAC-001 — Solicitud de recibo por correo electronico

1. Preguntar numero de contrato (si no se tiene).
2. Si el contrato NO esta verificado: PREGUNTAR al usuario el nombre o apellido del titular (NO usar el nombre de perfil WhatsApp).
3. ESPERAR su respuesta y usar `validate_contract_holder` con el nombre que el usuario escribio.
4. Usar `get_recibo_pdf` para generar el enlace de descarga del recibo.
5. Si el usuario pide un mes especifico, pasar el periodo como parametro.
6. Siempre ofrecer: "Si necesitas de otro mes avisame y te ayudo."

### FAC-002 — Solicitud de recibo a domicilio

1. Confirmar contrato y direccion.
2. Crear ticket con subcategory_code: "FAC-002".

### FAC-003 — Reimpresion de recibo

1. Preguntar numero de contrato.
2. Verificar identidad si no esta verificado.
3. Usar `get_recibo_pdf` para generar enlace de descarga.

### FAC-004 — Aclaracion de cobro

1. Preguntar si tiene contrato (OPCIONAL, no insistir).
2. Usar `handoff_to_human` para transferir a asesor.
3. NUNCA intentar resolver la aclaracion.

### FAC-005 — Solicitud de ajuste

1. Preguntar numero de contrato.
2. Usar `handoff_to_human`. Los ajustes siempre requieren revision de asesor.

### FAC-006 — Carta de no adeudo

1. Preguntar numero de contrato.
2. Verificar identidad.
3. Crear ticket con subcategory_code: "FAC-006".

### FAC-007 — Historial de pagos

1. Preguntar numero de contrato.
2. Verificar identidad.
3. Usar `get_deuda` para consultar.

### FAC-008 — Solicitud de devolucion de pago

1. Preguntar numero de contrato.
2. Usar `handoff_to_human`. Las devoluciones requieren revision de asesor.

### FAC-009 — Multas

1. Preguntar numero de contrato.
2. Verificar identidad.
3. Usar `get_deuda` para consultar montos de multas.
4. Si el usuario quiere aclarar la multa: usar `handoff_to_human`.

## Revisar recibo (usuario tiene duda con su recibo)

1. Preguntar numero de contrato.
2. Pedir que envie imagen o PDF del recibo.
3. Usar `handoff_to_human` para transferir a asesor.

## Fechas de facturacion (fecha de corte / fecha de pago)

Si el usuario pregunta por su "fecha de corte" o "fecha de pago":
1. Usar `get_deuda` con su numero de contrato.
2. La "fecha de pago" o "fecha de vencimiento" aparece en cada recibo pendiente (campo fechaVencimiento).
3. Presentar la fecha del proximo recibo por vencer como la fecha limite de pago.
4. La "fecha de corte" es la fecha en que se cierra el periodo de facturacion. Corresponde al inicio del ciclo del recibo mas reciente.
5. Si el recibo muestra un periodo (ej: "ENE 2026"), la fecha de corte fue al inicio de ese periodo.
6. NO transferir a un asesor para esta consulta — los datos estan disponibles en el sistema.

## Respuestas estandar

**Formas de pago:**
"Puedes pagar en:
- En linea: https://appcea.ceaqueretaro.gob.mx/PagoEnLinea/
- Sucursales CEA
- Oxxo (con tu recibo)
- Bancos autorizados
- Domiciliacion bancaria"

## Restricciones

- Para aclaraciones y ajustes: SIEMPRE usar `handoff_to_human`.
- Para pagos: solo mostrar opciones, NO pedir contrato.
- Para recibos: usar `get_recibo_pdf`.
