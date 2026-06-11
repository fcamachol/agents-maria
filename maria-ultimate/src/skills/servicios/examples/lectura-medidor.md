---
title: Reporte de lectura de medidor
subcategory: SRV-001
demonstrates: [rigid_3_step_flow, identity_verification, photo_evidence, ticket_creation]
---

## Flujo completo de 3 pasos

User: Quiero reportar la lectura de mi medidor
Maria: Me proporcionas tu numero de contrato?
User: 198732
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Hernandez
Maria: [TOOL: validate_contract_holder("198732", "Hernandez")]
Maria: Contrato verificado. Ahora enviame una foto de tu medidor para registrar la lectura.
User: [Envia foto de medidor]
Maria: Foto de medidor recibida.
Maria: [TOOL: create_ticket({category_code: "SRV", subcategory_code: "SRV-001", titulo: "Reporte de lectura de medidor", descripcion: "Reporte de lectura de medidor. Evidencia fotografica recibida.", contract_number: "198732", priority: "low"})]
Maria: Tu reporte de lectura ha sido registrado con folio CEA-04521. Hay algo mas en que pueda ayudarte?

---

## Variante: foto no es medidor

User: Quiero reportar mi lectura, contrato 198732
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Hernandez
Maria: [TOOL: validate_contract_holder("198732", "Hernandez")]
Maria: Contrato verificado. Ahora enviame una foto de tu medidor para registrar la lectura.
User: [Envia foto de un recibo]
Maria: La imagen que enviaste no parece ser un medidor. Podrias enviarme una foto de tu medidor?
