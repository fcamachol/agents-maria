---
name: Consumos
description: Historial de consumo de agua, lecturas, tendencias de uso
allowed-tools: get_consumo get_contract_details get_deuda create_ticket validate_contract_holder
default-priority: low
keywords: consumo historial lectura metros cubicos tendencia
---

# Consumos (CNS)

Skill para atender consultas de historial de consumo de agua, lecturas y tendencias de uso.

## Subcategorias

| Codigo  | Nombre                             | Prioridad |
|---------|------------------------------------|-----------|
| CNS-001 | Consulta de historial de consumo   | low       |
| CNS-002 | Consumo por ano especifico         | low       |
| CNS-003 | Tendencia de consumo               | low       |

## Herramientas permitidas

| Herramienta              | Uso                                              |
|--------------------------|--------------------------------------------------|
| get_consumo              | Consultar historial de consumo de agua            |
| get_contract_details     | Obtener detalles del contrato                     |
| get_deuda                | Consultar saldo y adeudo de un contrato           |
| create_ticket            | Crear ticket de revision si se detecta anomalia   |
| validate_contract_holder | Verificar identidad del usuario vs titular        |

## Verificacion de identidad

Antes de consultar consumo o detalles de un contrato, se DEBE verificar la identidad:

1. Si el contrato NO esta en "Contratos ya verificados", PREGUNTAR al usuario: "Me puedes dar el nombre o apellido del titular?"
2. ESPERAR su respuesta. NUNCA usar el "Nombre de perfil WhatsApp" para verificacion.
3. Usar `validate_contract_holder` con el nombre que EL USUARIO ESCRIBIO.
4. Proceder solo si `validated=true`.

## Procedimientos por subcategoria

### CNS-001 — Consulta de historial de consumo

1. Solicitar numero de contrato si no se tiene.
2. Verificar identidad si no esta verificado.
3. Usar `get_consumo` para obtener el historial.
4. Presentar los datos organizados por ano/mes.
5. Mostrar consumo en metros cubicos (m3).
6. Indicar el promedio mensual.
7. Mencionar si el consumo esta aumentando, estable o disminuyendo.

### CNS-002 — Consumo por ano especifico

1. Solicitar numero de contrato si no se tiene.
2. Verificar identidad si no esta verificado.
3. Usar `get_consumo` con el parametro `year` para el ano solicitado.
4. Presentar los datos del ano especifico.

### CNS-003 — Tendencia de consumo

1. Solicitar numero de contrato si no se tiene.
2. Verificar identidad si no esta verificado.
3. Usar `get_consumo` para obtener historial completo.
4. Analizar y presentar la tendencia (aumentando, estable, disminuyendo).
5. Si hay anomalias, senalarlas.

## Presentacion de datos

Ejemplo de respuesta:
"Tu historial de consumo del contrato [X]:

2024:
- Enero: 15 m3
- Febrero: 12 m3
- Marzo: 18 m3

Promedio mensual: 15 m3
Tendencia: estable"

## Si el consumo es alto

- Sugerir revisar si hay fugas.
- Ofrecer crear un ticket de revision si el usuario lo solicita (usar `create_ticket` con categoria SRV y subcategoria SRV-011 o SRV-002).

## Restricciones

- NO hacer ajustes de facturacion (eso es skill FAC).
- NO resolver disputas de lectura (transferir a asesor con `handoff_to_human`).
