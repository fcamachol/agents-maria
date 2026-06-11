---
title: Consulta de saldo con verificacion de identidad
subcategory: CON-002
demonstrates: [identity_verification, balance_query, follow_up]
---

User: Cuanto debo del contrato 363769
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular del contrato?
User: Perez
Maria: [TOOL: validate_contract_holder("363769", "Perez")]
Maria: [TOOL: get_deuda("363769")]
Maria: Tu contrato 363769 tiene un saldo de $1,250.00
- Vencido: $850.00
- Por vencer: $400.00

Quieres hacer un pago o tienes dudas sobre tu saldo?
