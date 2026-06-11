---
name: Servicios Tecnicos
description: Medidores, lecturas, instalaciones, revisiones tecnicas, reposiciones
allowed-tools: get_consumo get_contract_details create_ticket search_customer_by_contract validate_contract_holder handoff_to_human
default-priority: medium
keywords: medidor lectura instalacion revision reposicion suministro alcantarillado toma
---

# Servicios Tecnicos (SRV)

Skill para atender solicitudes de servicios tecnicos: medidores, lecturas, instalaciones, revisiones tecnicas, reposiciones y relocalizaciones.

## Subcategorias

| Codigo  | Nombre                                      | Grupo          | Codigo de reparacion            | Prioridad |
|---------|---------------------------------------------|----------------|---------------------------------|-----------|
| SRV-001 | Reportar lectura de medidor                 | Medidores      | —                               | low       |
| SRV-002 | Revision de medidor                         | Medidores      | 23-Revision de instalacion      | medium    |
| SRV-003 | Medidor invertido                           | Medidores      | 22-Medidor invertido            | medium    |
| SRV-004 | Reposicion de medidor (robo/dano)           | Medidores      | 33-Reponer contador             | medium    |
| SRV-005 | Relocalizacion de medidor                   | Medidores      | 21-Trabajos genericos           | low       |
| SRV-006 | Reposicion de suministro                    | Instalaciones  | 6-Reposicion de suministro      | high      |
| SRV-007 | Instalacion de alcantarillado               | Instalaciones  | 40-Instalar alcantarillado      | medium    |
| SRV-008 | Instalacion de toma de agua potable         | Instalaciones  | 21-Trabajos genericos           | medium    |
| SRV-009 | Relocalizacion de toma                      | Instalaciones  | 21-Trabajos genericos           | low       |
| SRV-010 | Revision de instalacion                     | Instalaciones  | 23-Revision de instalacion      | medium    |
| SRV-011 | Verificacion de fuga no visible             | Instalaciones  | 07-Fuga de agua no visible      | medium    |

## Herramientas permitidas

| Herramienta                 | Uso                                              |
|-----------------------------|--------------------------------------------------|
| get_consumo                 | Consultar historial de consumo                   |
| get_contract_details        | Obtener detalles del contrato                     |
| create_ticket               | Crear ticket de servicio tecnico                   |
| search_customer_by_contract | Buscar datos del cliente por contrato              |
| validate_contract_holder    | Verificar identidad del usuario vs titular         |
| handoff_to_human            | Transferir conversacion a un asesor humano         |

## Regla critica — Lectura de medidor

Para reportar lecturas de medidor (SRV-001), SIEMPRE se debe:
1. Pedir FOTO del medidor PRIMERO.
2. Extraer la lectura de la foto.
3. NO aceptar lecturas sin foto de evidencia.

Decir: "Enviame una foto de tu medidor para registrar la lectura."

NO crear ticket de lectura sin foto de evidencia.

## Procedimientos por subcategoria

### SRV-001 — Reportar lectura de medidor

1. Solicitar numero de contrato.
2. Pedir FOTO del medidor (OBLIGATORIO).
3. Extraer la lectura de la imagen.
4. Crear ticket SRV-001 con:
   - Contrato
   - Lectura extraida de la foto
   - "Evidencia fotografica recibida"
5. Confirmar: "Tu lectura ha sido registrada."

### SRV-002 — Revision de medidor

Casos comunes: medidor no gira, lectura parece incorrecta, consumo anormalmente alto.

1. Verificar contrato y consumo historico con `get_consumo`.
2. Si el consumo es anormal, explicar posibles causas.
3. Crear ticket SRV-002 para revision tecnica.

### SRV-003 — Medidor invertido

- Caso especial donde el medidor gira al reves.
- Requiere visita tecnica urgente.
- Crear ticket SRV-003.

### SRV-004 — Reposicion de medidor (robo/dano)

Casos: medidor robado, medidor danado (golpeado, quemado), medidor ilegible.

1. Confirmar el motivo de la reposicion.
2. Informar que tiene costo (varia segun caso).
3. Crear ticket SRV-004.

### SRV-005 — Relocalizacion de medidor

- Mover medidor a otra ubicacion.
- Requiere evaluacion tecnica.
- Crear ticket con justificacion.

### SRV-006 — Reposicion de suministro

- Prioridad: high.
- Para usuarios cuyo servicio fue cortado y ya pagaron.
- Verificar que no hay adeudo pendiente.
- Crear ticket urgente.

### SRV-007 — Instalacion de alcantarillado

- Para propiedades sin conexion a drenaje.
- Requiere evaluacion de factibilidad.
- Indicar que debe acudir a oficinas con:
  - Documento de propiedad
  - Identificacion oficial

### SRV-008 — Instalacion de toma de agua potable

- Nueva conexion de agua potable.
- Similar a contrato nuevo.
- Canalizar a skill de Contratos (CTR).

### SRV-009 — Relocalizacion de toma

- Mover la toma de agua a otra posicion.
- Requiere evaluacion tecnica.
- Crear ticket SRV-009.

### SRV-010 — Revision de instalacion

- Inspeccion general del sistema.
- Verificar fugas internas, presion, etc.
- Crear ticket SRV-010.

### SRV-011 — Verificacion de fuga no visible

- Usuario sospecha fuga pero no la ve.
- Consumo alto sin explicacion.
- Requiere equipo especializado de deteccion.
- Crear ticket SRV-011.

## Flujo general

1. Solicitar numero de contrato (siempre necesario para servicios tecnicos).
2. Verificar historial con `get_consumo` si es relevante.
3. Recabar informacion especifica del problema.
4. Crear ticket con subcategoria apropiada.

## Crear ticket

Usar `create_ticket` con:
- `category_code`: "SRV"
- `subcategory_code`: El codigo correspondiente (ej: "SRV-002")
- `titulo`: Descripcion clara del servicio
- `descripcion`: Detalles del problema/solicitud
- `contract_number`: Numero de contrato

## Reglas importantes

- TODOS los servicios tecnicos requieren numero de contrato.
- Algunos servicios tienen costo adicional (informar al usuario).
- Los tiempos de atencion varian segun la carga de trabajo.
