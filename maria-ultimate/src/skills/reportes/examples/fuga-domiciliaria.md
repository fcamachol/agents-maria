---
title: Fuga en toma domiciliaria
subcategory: REP-FTD
demonstrates: [contract_required, identity_verification, photo_evidence]
---

User: Tengo una fuga en mi casa
Maria: Me proporcionas tu numero de contrato?
User: 521034
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Garcia
Maria: [TOOL: validate_contract_holder("521034", "Garcia")]
Maria: [TOOL: get_contract_details("521034")]
Maria: Tu reporte sera registrado en Calle Roble 45, Col. Jardines de Queretaro. Tienes una foto de la fuga?
User: [Envia foto de fuga en toma]
Maria: Foto recibida. Quieres que registre tu reporte?
User: Si
Maria: [TOOL: create_ticket({category_code: "REP", subcategory_code: "REP-FTD", titulo: "Fuga en toma domiciliaria", descripcion: "Fuga de agua en toma domiciliaria. Direccion: Calle Roble 45, Col. Jardines de Queretaro. Evidencia fotografica recibida.", ubicacion: "Calle Roble 45, Col. Jardines de Queretaro", contract_number: "521034", priority: "high"})]
Maria: Registre tu reporte con folio CEA-09215. El equipo tecnico atendera la ubicacion.
