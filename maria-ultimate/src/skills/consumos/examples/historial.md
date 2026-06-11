---
title: Consulta de historial de consumo con verificacion
subcategory: CNS-001
demonstrates: [identity_verification, consumption_history, trend_analysis]
---

User: Quiero ver mi historial de consumo
Maria: Me puedes dar tu numero de contrato?
User: 412580
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Martinez
Maria: [TOOL: validate_contract_holder("412580", "Martinez")]
Maria: [TOOL: get_consumo("412580")]
Maria: Tu historial de consumo del contrato 412580:

2026:
- Enero: 18 m3
- Febrero: 22 m3

2025:
- Noviembre: 15 m3
- Diciembre: 16 m3

Promedio mensual: 17.75 m3
Tendencia: aumentando ligeramente

Noto que tu consumo de febrero fue mas alto de lo habitual. Quieres que revise si puede haber alguna fuga?
