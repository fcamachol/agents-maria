---
name: Reportes de Servicio
description: "Reportes de fugas, falta de agua, drenaje tapado, calidad del agua, infraestructura da\xF1ada"
allowed-tools: create_ticket get_contract_details validate_contract_holder handoff_to_human
default-priority: high
keywords: fuga drenaje agua turbia presion medidor hundimiento
---

# Reportes de Servicio (REP)

Skill para atender reportes de fugas, falta de agua, drenaje tapado, calidad del agua e infraestructura danada.

## Subcategorias

| Codigo  | Nombre                          | Grupo            | Prioridad | Requiere contrato |
|---------|---------------------------------|------------------|-----------|-------------------|
| REP-FVP | Fuga en via publica             | Fugas            | high      | NO                |
| REP-FTD | Fuga en toma domiciliaria       | Fugas            | high      | SI                |
| REP-FRD | Fuga en red de distribucion     | Fugas            | urgent    | NO                |
| REP-FDR | Fuga en drenaje                 | Fugas            | high      | NO                |
| REP-FSA | Falta de servicio de agua       | Agua Potable     | high      | SI                |
| REP-FSD | Falta de servicio de drenaje    | Drenaje          | high      | SI                |
| REP-BAP | Baja presion                    | Agua Potable     | medium    | SI                |
| REP-ATB | Agua turbia                     | Calidad del Agua | high      | SI                |
| REP-AOL | Agua con olor                   | Calidad del Agua | high      | SI                |
| REP-ASB | Agua con sabor                  | Calidad del Agua | high      | SI                |
| REP-MED | Problema con medidor            | Medidor          | medium    | SI                |
| REP-DRO | Drenaje obstruido               | Drenaje          | high      | NO                |
| REP-TAP | Tapa de registro danada         | Drenaje          | high      | NO                |
| REP-HUN | Hundimiento en via publica      | Infraestructura  | medium    | NO                |

## Herramientas permitidas

| Herramienta              | Uso                                                    |
|--------------------------|--------------------------------------------------------|
| create_ticket            | Crear ticket de reporte                                |
| get_contract_details     | Obtener detalles del contrato (direccion, estado)      |
| validate_contract_holder | Verificar identidad del usuario vs titular             |
| handoff_to_human         | Transferir conversacion a un asesor humano             |

## Reglas criticas

### Regla 1 — Foto de evidencia

ANTES de crear cualquier ticket, SIEMPRE pedir una foto de evidencia:
- "Puedes enviarme una foto del problema?"
- "Tienes foto de la fuga/drenaje?"

Si el usuario ya envio una foto, NO pedirla de nuevo.

**Validacion de foto:**
- Si la imagen tiene clasificacion `NO_RELACIONADO`: NO crear el ticket. Responder: "La imagen que enviaste no parece mostrar un problema de agua o drenaje. Podrias enviarme una foto donde se vea el problema?"
- Si la imagen SI es relevante (`FUGA_AGUA`, `DRENAJE`, `INFRAESTRUCTURA`, `MEDIDOR`): continuar con el flujo normal.

### Regla 2 — Numero de contrato

**CUANDO pedir contrato:**
- Reportes de servicio (FSA, BAP, FSD, ATB, AOL, ASB, MED): SI pedir contrato.
- Fuga en toma domiciliaria (FTD) o medidor (MED): SI pedir contrato.
- Fugas en via publica (FVP, FRD, FDR): NUNCA pedir contrato.
- Drenaje en calle (DRO, TAP, HUN): NO pedir contrato.

**Verificacion de identidad (cuando se pide contrato):**
1. Despues de recibir el contrato, PREGUNTAR al usuario: "Me puedes dar el nombre o apellido del titular?"
2. ESPERAR su respuesta. NUNCA usar el "Nombre de perfil WhatsApp" para verificacion.
3. Usar `validate_contract_holder` con el nombre que EL USUARIO ESCRIBIO.
4. Si NO se verifica despues de 3 intentos: usar `handoff_to_human`.

### Regla 3 — Verificar suspension en falta de agua

Cuando el usuario reporte FALTA DE AGUA (REP-FSA) o BAJA PRESION (REP-BAP) y proporcione su numero de contrato:

1. ANTES de continuar con el flujo de reporte, usar `get_contract_details` para verificar el estado del servicio.
2. Si el estado es "suspendido" o "cortado":
   - Informar: "Tu servicio se encuentra [suspendido/cortado]."
   - Ofrecer opciones de pago:
     - En linea: https://appcea.ceaqueretaro.gob.mx/PagoEnLinea/
     - Sucursales CEA
     - Oxxo (con tu recibo)
     - Bancos autorizados
   - NO crear ticket de falta de agua en este caso.
3. Si el estado es "activo": continuar con el flujo de reporte.
   - IMPORTANTE: Ya se tiene la direccion del contrato de `get_contract_details`. Usarla como ubicacion del reporte, NO pedirla de nuevo al usuario.

## Flujos por tipo de reporte

### Reportes de servicio (REP-FSA, REP-BAP, REP-FSD, REP-ATB, REP-AOL, REP-ASB, REP-MED)

1. Preguntar numero de contrato.
2. Pedir nombre o apellido del titular y usar `validate_contract_holder`.
3. Usar `get_contract_details` para obtener direccion y estado del servicio.
4. Confirmar al usuario: "Tu reporte sera registrado en [direccion del contrato]."
5. Si NO tiene contrato: entonces si preguntar ubicacion exacta (calle, numero, colonia).
6. Preguntar por foto de evidencia (si no la enviaron).
7. Preguntar al usuario: "Quieres que registre tu reporte?" Si confirma, crear el ticket. NO preguntar gravedad ni urgencia — usar la prioridad por defecto de la subcategoria.
8. Crear el ticket con `create_ticket`.

### Reportes en via publica (REP-FVP, REP-FRD, REP-FDR, REP-DRO, REP-TAP, REP-HUN)

1. Preguntar ubicacion exacta (calle, numero, colonia) — NO pedir contrato.
2. Preguntar por foto de evidencia (si no la enviaron).
3. Preguntar gravedad: Es urgente? Hay inundacion?
4. Crear el ticket con `create_ticket`.

### Reportes en toma domiciliaria (REP-FTD)

1. Preguntar numero de contrato.
2. Pedir nombre o apellido del titular y usar `validate_contract_holder`.
3. Usar `get_contract_details` para obtener direccion.
4. Confirmar: "Tu reporte sera registrado en [direccion del contrato]."
5. Si NO tiene contrato: preguntar ubicacion exacta.
6. Preguntar por foto de evidencia (si no la enviaron).
7. Crear el ticket con `create_ticket`.

**Preguntar UNA cosa a la vez.**

## Crear ticket

Usar `create_ticket` con:
- `category_code`: "REP"
- `subcategory_code`: Codigo exacto (ej: "REP-FVP")
- `titulo`: Descripcion breve
- `descripcion`: Informacion recabada + "Evidencia fotografica recibida" si enviaron foto
- `ubicacion`: Direccion exacta
- `priority`: high/urgent segun gravedad

El folio sera generado automaticamente por el sistema (formato CEA-XXXXX).

Respuesta: "Registre tu reporte con folio [FOLIO]. El equipo tecnico atendera la ubicacion."

## Restricciones

NUNCA pedir contrato para: REP-FVP, REP-FRD, REP-FDR, REP-DRO, REP-TAP, REP-HUN.
