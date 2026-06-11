# Reporte de Cambios — María CEA (versión 1.1.0)

**Fecha de despliegue:** 16 de mayo de 2026
**Versión anterior:** 1.0.0 (en producción desde el 14 de mayo de 2026)
**Versión actual:** 1.1.0

Este reporte resume los cambios funcionales aplicados al asistente María. Todos los cambios están activos en producción y aplican a las conversaciones entrantes por WhatsApp a partir de la fecha de despliegue.

---

## Resumen ejecutivo

| # | Cambio | Impacto principal |
|---|--------|-------------------|
| 1 | Evidencia fotográfica obligatoria para reportes de fuga | Mejor calidad de información para cuadrillas; menos despachos fallidos |
| 2 | Nuevo extractor de datos de recibos con validación antifraude | Datos más completos y evita procesar documentos ajenos a la CEA |
| 3 | Eliminación de la promesa de "ajuste" | Alinea con la política interna; ningún ajuste se promete sin asesor humano |
| 4 | Misma regla aplicada a disputas sobre convenios | Convenios siempre los maneja personal autorizado |
| 5 | Envío de recibos múltiples por bloques de 6 | Resuelve el problema de mensajes truncados en WhatsApp |
| 6 | Aceptación de "número de referencia" como identificador | Evita bloquear a usuarios que no usan la palabra "contrato" |

---

## 1. Evidencia fotográfica obligatoria para reportes de fuga

**Subcategorías afectadas:** REP-FVP (fuga en vía pública), REP-FTD (fuga en toma domiciliaria), REP-FRD (fuga en ramal domiciliario), REP-FDR (fuga en drenaje).

**Comportamiento anterior (v1.0.0):**
La fotografía era opcional. Si el usuario no enviaba foto, María podía crear el reporte de todas formas, lo que dejaba a la cuadrilla sin evidencia visual para evaluar la gravedad o ubicar la fuga.

**Comportamiento nuevo (v1.1.0):**
Para cualquier reporte de fuga, María ahora **requiere una foto o video de la fuga antes de crear el ticket**. El flujo es el siguiente:

1. María solicita: "¿Me puedes mandar una foto o video de la fuga para tu reporte?"
2. Si el usuario se rehúsa la primera vez, María explica el motivo: "Necesito la foto o video para evaluar la gravedad, ubicar la fuga correctamente y enviar al cuadrillero adecuado", y vuelve a pedirla.
3. Si el usuario se rehúsa una segunda vez, María **transfiere a un asesor humano y NO crea el ticket**.

Para los demás tipos de reporte (drenaje obstruido, tapa, hundimiento, falta de agua, calidad del agua, medidor), la evidencia sigue siendo deseable pero **no bloquea** la creación del ticket.

**Beneficio operativo:**
- Las cuadrillas reciben evidencia visual desde el primer momento.
- Permite priorizar fugas mayores sobre menores con base en la imagen.
- Reduce despachos sin información útil.

---

## 2. Nuevo extractor de datos de recibos con validación antifraude

**Comportamiento anterior (v1.0.0):**
Cuando un usuario enviaba la foto de un recibo, María hacía una lectura libre del documento y extraía los campos visibles en lenguaje natural. Esto funcionaba para recibos CEA pero también intentaba procesar cualquier imagen que el usuario mandara, aunque no fuera un recibo de agua.

**Comportamiento nuevo (v1.1.0):**

**Validación de origen (antifraude):**
Antes de extraer cualquier dato, María verifica que la imagen sea efectivamente un recibo de la Comisión Estatal de Aguas de Querétaro. Si no lo es (por ejemplo, una factura de luz, un ticket de supermercado, una foto cualquiera), María responde: *"Este no es un recibo de agua de la CEA"* y solicita la imagen correcta. No intenta extraer datos de documentos ajenos.

**Extracción estructurada:**
Para recibos CEA válidos, María ahora extrae datos de manera estructurada y completa, separados en cinco bloques:

- **Datos fiscales:** serie y folio del CFDI, fecha de factura, código postal de expedición, tipo de comprobante, uso del CFDI, método y forma de pago, folio fiscal (UUID), fecha de certificación.
- **Datos del cliente:** nombre, dirección, RFC, número de contrato, tipo y grupo de tarifa, fecha de contratación.
- **Datos del medidor:** número de medidor, lectura actual y anterior con sus fechas, periodo de consumo, consumo en m³.
- **Datos de facturación:** fecha de vencimiento, número de factura, subtotal, IVA, monto de facturas pendientes, total a pagar, meses de adeudo, referencia electrónica.
- **Conceptos:** desglose completo de cada concepto facturado con descripción, valor unitario e importe.

**Filtrado de ruido:**
María ignora completamente notas manuscritas, firmas, sellos de cajero y marcas de "PAGADO". Solo extrae el texto impreso original del sistema de facturación de la CEA, lo que evita confundir cobros con marcas hechas a mano por usuarios o bancos.

**Beneficio operativo:**
- El equipo de facturación recibe información más completa y precisa cuando un usuario consulta sobre un recibo.
- Se evita que María procese documentos ajenos al servicio de agua.
- La extracción del UUID fiscal y la referencia electrónica facilita búsquedas en sistemas internos.

---

## 3. Eliminación de la promesa de "ajuste"

**Subcategoría eliminada:** FAC-AJU (Solicitud de ajuste).

**Comportamiento anterior (v1.0.0):**
Cuando un usuario solicitaba un ajuste a su facturación, María podía generar un ticket con subcategoría FAC-AJU, lo que implícitamente comprometía a la CEA a evaluar un ajuste. Esto podía generar expectativas sobre acciones que aún no habían sido autorizadas por un asesor.

**Comportamiento nuevo (v1.1.0):**
La subcategoría FAC-AJU **ya no se utiliza**. María tiene una regla estricta:

- **María nunca usa la palabra "ajuste" con el usuario.**
- Cuando un usuario pide explícitamente un ajuste, María canaliza la solicitud como una **aclaración (FAC-ACL)** y transfiere a un asesor humano.
- La decisión de aplicar o no un ajuste corresponde exclusivamente al asesor humano, internamente.

Ejemplo de la nueva respuesta:
> Usuario: *"Me cobraron de más, quiero un ajuste."*
> María: *"Voy a canalizar tu aclaración con un asesor para que revise el cobro."*

**Beneficio operativo:**
- María no genera expectativas no autorizadas.
- Cada caso es revisado por personal capacitado antes de cualquier acción correctiva.
- Se mantiene la trazabilidad de las aclaraciones bajo una sola subcategoría (FAC-ACL).

---

## 4. Misma regla aplicada a disputas sobre convenios

**Comportamiento nuevo (v1.1.0):**
La regla anterior se extiende a cualquier disputa sobre convenios de pago. María:

- **No promete ajustes** sobre el saldo o las condiciones de un convenio.
- **No menciona montos, porcentajes ni condiciones** de programas de apoyo.
- **No describe requisitos** de convenios disponibles.
- Si el usuario cuestiona su convenio, canaliza la inconformidad como aclaración y transfiere al área especializada.

**Beneficio operativo:**
- Los convenios siempre los maneja personal autorizado.
- Se evita información incorrecta o expectativas erróneas sobre términos de pago.

---

## 5. Envío de recibos múltiples por bloques de 6

**Comportamiento anterior (v1.0.0):**
Cuando un usuario solicitaba muchos recibos en una sola petición (por ejemplo, "mándame todos mis recibos del 2024"), María enviaba todos los enlaces de descarga en un solo mensaje. WhatsApp tiene un límite de caracteres por mensaje, por lo que mensajes con 10+ enlaces se truncaban y los usuarios no recibían información completa.

**Comportamiento nuevo (v1.1.0):**
Cuando la solicitud excede 6 recibos, María:

1. Envía los **primeros 6 enlaces** en un mensaje.
2. Termina con: *"Te envié 6 recibos. ¿Quieres que te mande los siguientes?"*
3. Espera la confirmación del usuario antes de enviar el siguiente bloque de hasta 6 recibos.

**Beneficio operativo:**
- Ningún enlace queda truncado por límites de la plataforma.
- El usuario controla el ritmo de la conversación.
- Se reduce el riesgo de errores por mensajes incompletos.

---

## 6. Aceptación de "número de referencia" como identificador

**Comportamiento anterior (v1.0.0):**
María solo reconocía el término "número de contrato" como identificador del servicio. Usuarios que decían "mi referencia es..." podían quedar bloqueados en el flujo.

**Comportamiento nuevo (v1.1.0):**
En todos los flujos que requieren identificar el servicio (consulta de saldo, falta de agua, verificación de identidad), María acepta indistintamente:

- *"Mi número de contrato es..."*
- *"Mi número de referencia es..."*

También las respuestas de María que solicitan el identificador ahora dicen "**contrato o referencia**" en lugar de solo "contrato". Por ejemplo:

> "Para revisar tu servicio necesito un número de contrato o referencia. Te comunico con un asesor que te pueda ayudar."

**Beneficio operativo:**
- Usuarios que no conocen el término "contrato" no se quedan bloqueados.
- Refleja el lenguaje que aparece en el propio recibo de la CEA.

---

## Lo que NO cambió

- El comportamiento general de saludo, presentación y tono de María.
- Los flujos de consulta de saldo, historial de consumo, detalles de contrato y reimpresión de recibo digital.
- La verificación de identidad por nombre del titular antes de mostrar datos sensibles.
- La verificación de adeudos pendientes en reportes de falta de agua (cortes y suspensiones siguen siendo transferidos al asesor sin crear ticket).
- La protección contra "alucinación de folios" (María nunca inventa números de reporte).
- La integración con el sistema de tickets y el catálogo de subcategorías (excepto la eliminación de FAC-AJU descrita en la sección 3).
- Los horarios, ubicaciones de oficinas, formas de pago y canales de atención.

---

## Versión y trazabilidad

- **Etiqueta de versión:** v1.1.0
- **Versión anterior preservada:** v1.0.0 (disponible para rollback en cualquier momento)
- **Despliegue:** 16 de mayo de 2026
- **Canal:** WhatsApp CEA (todas las conversaciones entrantes a partir de la fecha de despliegue)
