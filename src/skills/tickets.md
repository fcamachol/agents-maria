# Skill: Seguimiento de Tickets

## Cuándo Aplicar
Cuando el usuario pregunte por:
- Estado de un reporte/ticket
- Seguimiento de folio
- "¿Ya atendieron mi reporte?"
- Historial de tickets

## Flujo: Consulta de Tickets

1. **¿Tengo el contrato?**
   - Sí → Usar `get_client_tickets`
   - No → Preguntar contrato

2. **Presentar resultados:**
   ```
   Encontré [N] ticket(s) para tu contrato 💧
   
   📋 Folio: [FOLIO]
   Estado: [status]
   Tipo: [tipo]
   Fecha: [fecha]
   [descripción breve]
   ```

3. **Si no hay tickets:**
   "No encontré tickets activos para este contrato."

## Estados de Ticket

| Estado | Significado | Emoji |
|--------|-------------|-------|
| abierto | Recién creado | 🆕 |
| en_proceso | Siendo atendido | 🔄 |
| esperando_cliente | Necesitamos info tuya | ⏳ |
| esperando_interno | En revisión interna | 📋 |
| escalado | Con supervisor | ⬆️ |
| resuelto | Atendido | ✅ |
| cerrado | Finalizado | 📁 |

## Flujo: Actualizar Ticket

Si el usuario quiere agregar información:

1. Pedir el folio del ticket
2. Recabar la información adicional
3. Usar `update_ticket`:
   ```javascript
   update_ticket({
     folio: "[FOLIO]",
     notes: "[información adicional del cliente]"
   })
   ```
4. Confirmar: "He agregado tu información al ticket [FOLIO] 💧"

## Flujo: Cerrar/Cancelar Ticket

Si el usuario quiere cerrar un ticket:

```javascript
update_ticket({
  folio: "[FOLIO]",
  status: "cerrado",
  notes: "Cerrado a solicitud del cliente"
})
```

## Búsqueda por Folio Específico

Si el usuario da un folio directamente (ej: "FUG-20260111-0023"):
- Buscar en `get_client_tickets` filtrando por ese folio
- O informar que necesitas el contrato para verificar

## Tiempos de Respuesta Típicos

| Tipo | Tiempo Estimado |
|------|----------------|
| Fuga urgente | 2-4 horas |
| Fuga normal | 24-48 horas |
| Revisión lectura | 3-5 días hábiles |
| Recibo digital | 1-2 días hábiles |
| Aclaraciones | 5-10 días hábiles |

## Ejemplo

**Usuario:** "Quiero saber cómo va mi reporte"

**María:** "Con gusto. ¿Me proporcionas tu número de contrato? 💧"

**Usuario:** "123456"

**María:** [Usar get_client_tickets]
"Encontré 2 tickets para tu contrato:

📋 FUG-20260110-0015
Estado: en_proceso 🔄
Tipo: Fuga
Fecha: 10/01/2026
Un equipo está atendiendo el reporte.

📋 DIG-20260105-0008
Estado: resuelto ✅
Tipo: Recibo digital
Fecha: 05/01/2026"
