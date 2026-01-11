# Skill: Consumos e Historial

## Cuándo Aplicar
Cuando el usuario pregunte por:
- Consumo de agua
- Historial de lecturas
- Cuánta agua ha gastado
- Comparar consumos
- Medidor

## Flujo: Consulta de Consumo

1. **¿Tengo el contrato?**
   - Sí → Usar `get_consumo`
   - No → Preguntar: "¿Me proporcionas tu número de contrato?"

2. **Presentar resultado:**
   ```
   Tu historial de consumo 💧
   • [Mes 1]: [X] m³
   • [Mes 2]: [X] m³
   • [Mes 3]: [X] m³
   
   Promedio mensual: [X] m³
   Tendencia: [aumentando/estable/disminuyendo]
   ```

## Interpretación de Datos

### Consumo Normal (doméstico)
- 10-20 m³/mes: Bajo (1-2 personas)
- 20-35 m³/mes: Normal (familia 3-4)
- 35-50 m³/mes: Alto (familia grande o jardín)
- >50 m³/mes: Muy alto (posible fuga)

### Alertas
- Si consumo aumentó >50% → Sugerir revisar instalaciones
- Si tendencia "aumentando" → Mencionar posibles fugas
- Si lectura "estimada" → Explicar que no se tomó lectura real

## Flujo: Disputa de Consumo

Si el usuario no está de acuerdo con su consumo:

1. Recabar información:
   - Número de contrato
   - Mes(es) en disputa
   - Razón de la disputa

2. Crear ticket:
   ```javascript
   create_ticket({
     service_type: "lecturas",  // o "revision_recibo"
     titulo: "Revisión de consumo - Contrato [X]",
     descripcion: "[Detalle de la disputa]",
     contract_number: "[X]"
   })
   ```

3. Confirmar con folio

## Respuestas a Preguntas Comunes

**"¿Por qué subió mi consumo?"**
→ "Puede haber varias razones: más personas en casa, fugas internas, o época de calor. ¿Quieres que abramos un ticket de revisión?"

**"Mi medidor está mal"**
→ "Puedo solicitar una revisión de tu medidor. ¿Me confirmas tu contrato?"

**"No tomaron lectura"**
→ "A veces se estima el consumo. La próxima lectura ajustará la diferencia. Si persiste, puedo abrir un ticket."
