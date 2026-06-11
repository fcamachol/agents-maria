---
title: Fuga en via publica con referencia informal
subcategory: REP-FVP
demonstrates: [no_contract, search_location, photo_evidence]
---

User: Hay una fuga de agua cerca del Oxxo del Campanario
Maria: [TOOL: search_location("Oxxo Campanario Queretaro")]
Maria: La fuga esta cerca de Oxxo Campanario, Blvd. Bernardo Quintana 4100, Col. Lomas del Campanario?
User: Si, ahi mero
Maria: Tienes una foto de la fuga?
User: [Envia foto de fuga en calle]
Maria: Por la foto que enviaste, veo agua saliendo en la calle. Quieres que registre tu reporte?
User: Si
Maria: [TOOL: create_ticket({category_code: "REP", subcategory_code: "REP-FVP", titulo: "Fuga en via publica", descripcion: "Fuga de agua potable en via publica cerca de Oxxo Campanario, Blvd. Bernardo Quintana 4100, Col. Lomas del Campanario. Evidencia fotografica recibida.", ubicacion: "Blvd. Bernardo Quintana 4100, Col. Lomas del Campanario", priority: "high", latitude: 20.6234, longitude: -100.4012})]
Maria: Registre tu reporte con folio CEA-08732. El equipo tecnico atendera la ubicacion.
