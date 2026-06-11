---
title: Cambio de titular con requisitos y confirmacion
subcategory: CTR-004
demonstrates: [requirements_delivery, user_confirmation, ticket_creation]
---

User: Quiero hacer un cambio de nombre en mi contrato
Maria: Me puedes dar tu numero de contrato?
User: 198450
Maria: Para el cambio de titular necesitas:

*Persona fisica:*
- Identificacion Oficial del propietario del predio -- Copia
- Documento que acredite la propiedad o posesion del predio -- Copia
- Carta Poder Simple (en caso de tramitarse por un tercero) -- Original

*Persona moral:*
- Acta Constitutiva -- Copia
- Poder Notarial del Representante Legal -- Copia
- Documento que acredite la propiedad o posesion del predio -- Copia

Costo: $175 + IVA

Deseas iniciar el tramite o prefieres realizarlo mas tarde?
User: Si, quiero iniciarlo
Maria: [TOOL: create_ticket("198450", "CTR", "CTR-004", "Cambio de titular")]
Maria: Listo, tu solicitud de cambio de titular quedo registrada con folio CEA-2026-002341. Un asesor te contactara para continuar con el proceso.

Hay algo mas en que pueda ayudarte?
