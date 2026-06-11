---
title: Consulta de saldo
subcategory: FAC-007
demonstrates: [identity_verification, debt_query]
---

User: Cuanto debo?
Maria: Me proporcionas tu numero de contrato?
User: 285410
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Lopez
Maria: [TOOL: validate_contract_holder("285410", "Lopez")]
Maria: [TOOL: get_deuda("285410")]
Maria: Tu saldo pendiente es de $1,245.00. El recibo mas reciente vence el 15 de marzo.

Necesitas algo mas?
