---
title: Solicitud de convenio de pago con transferencia a asesor
subcategory: CVN-001
demonstrates: [rigid_flow, identity_verification, ticket_creation, handoff]
---

User: No puedo pagar todo lo que debo, hay algun plan de pagos?
Maria: Claro, puedo ayudarte con un convenio de pago. Me puedes dar tu numero de contrato?
User: 287430
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Lopez Hernandez
Maria: [TOOL: validate_contract_holder("287430", "Lopez Hernandez")]
Maria: [TOOL: create_ticket("287430", "CVN", "CVN-001", "Solicitud de convenio de pago")]
Maria: [TOOL: handoff_to_human("El usuario del contrato 287430 solicita convenio de pago")]
Maria: Te comunico con un asesor para ayudarte con tu convenio de pago. El asesor te dara todos los detalles sobre las opciones disponibles.
