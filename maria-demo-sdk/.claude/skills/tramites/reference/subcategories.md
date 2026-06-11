# Subcategorías detalladas — Trámites

## TRA-NUE - Toma nueva
**Cuándo aplica:** El usuario quiere un contrato nuevo, servicio nuevo, toma nueva doméstica o comercial.

### Toma nueva doméstica
**Flujo:**
1. Proporcionar requisitos:
   - Identificación Oficial del propietario — Copia
   - Documento que acredite la propiedad o posesión del predio — Copia
   - Croquis de localización del predio
2. Preguntar: "¿Quieres que te conecte con un asesor para continuar tu trámite?"
3. Solo si el usuario confirma:
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-NUE"
- titulo: "Solicitud de toma nueva doméstica"
- descripcion: Detalles proporcionados por el usuario
4. Usar `handoff_to_human`
5. Usar `get_main_office` para indicar dónde acudir con los documentos

### Toma nueva comercial
**Flujo:**
1. Proporcionar requisitos:
   - Identificación Oficial del representante legal — Copia
   - Acta Constitutiva (persona moral) — Copia
   - Documento que acredite la propiedad o posesión del predio — Copia
   - Croquis de localización del predio
2. Preguntar: "¿Quieres que te conecte con un asesor para continuar tu trámite?"
3. Solo si el usuario confirma:
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-NUE"
- titulo: "Solicitud de toma nueva comercial"
- descripcion: Detalles proporcionados por el usuario
4. Usar `handoff_to_human`

## TRA-FRC - Fraccionamiento
**Cuándo aplica:** Fraccionamiento doméstico con más de 6 unidades.
**Flujo:**
1. Preguntar número de contrato si aplica
2. Proporcionar información relevante sobre el trámite
3. Preguntar si quiere continuar con un asesor
4. Solo si confirma:
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-FRC"
- titulo: "Solicitud de fraccionamiento doméstico"
- descripcion: Número de unidades y detalles
- contract_number: si aplica
5. Usar `handoff_to_human`

## TRA-CTI - Cambio de titular
**Cuándo aplica:** "Cambio de titular", "cambio de nombre" en un contrato existente. NO es nuevo servicio.

### Persona física
**Flujo:**
1. Preguntar número de contrato
2. Proporcionar requisitos INMEDIATAMENTE:
   - Identificación Oficial del propietario del predio — Copia
   - Documento que acredite la propiedad o posesión del predio — Copia
   - Carta Poder Simple (en caso de tramitarse por un tercero) — Original
3. Preguntar: "¿Quieres que te conecte con un asesor para continuar tu trámite?"
4. Solo si confirma:
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-CTI"
- titulo: "Cambio de titular"
- descripcion: Detalles del cambio solicitado
- contract_number: número del contrato
5. Usar `handoff_to_human`

### Persona moral
**Flujo:**
1. Preguntar número de contrato
2. Proporcionar requisitos INMEDIATAMENTE:
   - Acta Constitutiva — Copia
   - Poder Notarial del Representante Legal — Copia
   - Documento que acredite la propiedad o posesión del predio — Copia
3. Preguntar: "¿Quieres que te conecte con un asesor para continuar tu trámite?"
4. Solo si confirma → crear ticket TRA-CTI → handoff_to_human

## TRA-ADD - Modificaciones contractuales
**Cuándo aplica:** Cambio de tarifa, datos fiscales, incremento de unidades, domiciliación, condominios, grandes consumidores.

### Cambio de tarifa
**Flujo:**
1. Preguntar número de contrato
2. Usar `get_contract_details` para ver tarifa actual
3. Preguntar si quiere continuar con un asesor
4. Solo si confirma:
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-ADD"
- titulo: "Cambio de tarifa"
- descripcion: Tarifa actual y cambio solicitado
- contract_number: número del contrato
5. Usar `handoff_to_human`

### Alta o cambio de datos fiscales
**Flujo:**
1. Preguntar número de contrato
2. Proporcionar información
3. Preguntar si quiere continuar con un asesor
4. Solo si confirma:
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-ADD"
- titulo: "Alta/cambio de datos fiscales"
- contract_number: número del contrato
5. Usar `handoff_to_human`

### Incremento de unidades
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-ADD"
- titulo: "Incremento de unidades"

### Domiciliación de pago
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-ADD"
- titulo: "Domiciliación de pago"

### Atención a condominios individualizados
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-ADD"
- titulo: "Atención a condominios individualizados"

### Individualización de tomas en condominio
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-ADD"
- titulo: "Individualización de tomas en condominio"

### Atención a grandes consumidores
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-ADD"
- titulo: "Atención a grandes consumidores"
- priority: "high"


## TRA-SUS - Baja temporal
**Cuándo aplica:** El usuario quiere suspender temporalmente su servicio.
**Flujo:**
1. Preguntar número de contrato
2. Informar que no debe haber adeudo
3. Preguntar si quiere continuar con un asesor
4. Solo si confirma:
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-SUS"
- titulo: "Solicitud de baja temporal"
- descripcion: Motivo de la baja temporal
- contract_number: número del contrato
5. Usar `handoff_to_human`

## TRA-CAN - Baja definitiva
**Cuándo aplica:** El usuario quiere cancelar definitivamente su contrato.
**Flujo:**
1. Preguntar número de contrato
2. Informar que no debe haber adeudo
3. Preguntar si quiere continuar con un asesor
4. Solo si confirma:
**Crear ticket con:**
- category_code: "TRA"
- subcategory_code: "TRA-CAN"
- titulo: "Solicitud de baja definitiva"
- descripcion: Motivo de la cancelación
- contract_number: número del contrato
5. Usar `handoff_to_human`

## Nota sobre oficinas
Para TODOS los trámites:
- NUNCA dar horarios, direcciones o teléfonos de memoria
- Después de dar requisitos, usar `get_main_office` para indicar dónde acudir
- Ejemplo: "Puedes realizar este trámite en nuestra oficina principal:" + resultado de get_main_office
- Preguntar: "¿Quieres que busque la sucursal más cercana a ti?"
- Si dice sí → usar `find_nearest_locations`
