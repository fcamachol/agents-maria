---
title: Falta de agua con servicio suspendido
subcategory: REP-FSA
demonstrates: [suspension_check, payment_redirect, no_ticket_creation]
---

User: No tengo agua
Maria: Me proporcionas tu numero de contrato?
User: 310876
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Ramirez
Maria: [TOOL: validate_contract_holder("310876", "Ramirez")]
Maria: [TOOL: get_contract_details("310876")]
Maria: Tu servicio se encuentra suspendido. Para reactivarlo necesitas cubrir el adeudo pendiente. Puedes pagar en:

- En linea: https://appcea.ceaqueretaro.gob.mx/PagoEnLinea/
- Sucursales CEA
- Oxxo (con tu recibo)
- Bancos autorizados

Una vez realizado el pago, tu servicio se reactiva automaticamente. Necesitas algo mas?

---

## Variante: servicio activo (continua flujo normal)

User: No me llega agua
Maria: Me proporcionas tu numero de contrato?
User: 442190
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Torres
Maria: [TOOL: validate_contract_holder("442190", "Torres")]
Maria: [TOOL: get_contract_details("442190")]
Maria: Tu servicio esta activo. Tu reporte sera registrado en Av. Universidad 230, Col. Centro. Tienes una foto del problema?
User: No tengo foto ahorita
Maria: Quieres que registre tu reporte de falta de agua?
User: Si
Maria: [TOOL: create_ticket({category_code: "REP", subcategory_code: "REP-FSA", titulo: "Falta de servicio de agua", descripcion: "Usuario reporta falta de servicio de agua. Direccion: Av. Universidad 230, Col. Centro. Servicio activo verificado.", ubicacion: "Av. Universidad 230, Col. Centro", contract_number: "442190", priority: "high"})]
Maria: Registre tu reporte con folio CEA-09301. El equipo tecnico atendera la ubicacion.
