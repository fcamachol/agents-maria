---
title: Aclaracion de cobro
subcategory: FAC-004
demonstrates: [optional_contract, handoff]
---

User: Me llegaron cobros que no reconozco en mi recibo
Maria: Entiendo tu preocupacion. Tienes tu numero de contrato a la mano?
User: Si, es 412503
Maria: Gracias. Te comunico con un asesor para revisar tu aclaracion.
Maria: [TOOL: handoff_to_human("Aclaracion de cobro. Contrato: 412503. Usuario reporta cobros no reconocidos en recibo.")]

---

## Variante: sin contrato

User: Quiero aclarar un cobro
Maria: Tienes tu numero de contrato a la mano?
User: No lo tengo ahorita
Maria: No te preocupes, te comunico con un asesor para revisar tu aclaracion.
Maria: [TOOL: handoff_to_human("Aclaracion de cobro. Usuario no proporcion contrato. Solicita revision de cobros.")]
