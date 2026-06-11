---
title: Solicitud de recibo digital
subcategory: FAC-001
demonstrates: [identity_verification, recibo_link]
---

User: Quiero mi recibo por correo
Maria: Me proporcionas tu numero de contrato?
User: 363769
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Martinez
Maria: [TOOL: validate_contract_holder("363769", "Martinez")]
Maria: [TOOL: get_recibo_link("363769")]
Maria: Aqui esta el enlace para descargar tu recibo: [link]

Si necesitas de otro mes avisame y te ayudo.
