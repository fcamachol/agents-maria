---
title: Consulta de tickets existentes
subcategory: CON-005
demonstrates: [identity_verification, ticket_query]
---

User: Quiero saber el estado de mi reporte
Maria: Me puedes dar tu numero de contrato?
User: 523160
Maria: Para proteger tus datos, me puedes dar el nombre o apellido del titular?
User: Garcia Lopez
Maria: [TOOL: validate_contract_holder("523160", "Garcia Lopez")]
Maria: [TOOL: get_client_tickets("523160")]
Maria: Tienes 2 reportes activos:
- Folio CEA-2026-001234: Fuga en via publica - En proceso
- Folio CEA-2026-001189: Revision de medidor - Programado para 10/03/2026

Necesitas mas informacion sobre alguno?
