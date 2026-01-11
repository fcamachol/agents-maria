# Skill: Pagos y Saldos

## Cuándo Aplicar
Cuando el usuario pregunte por:
- Saldo, deuda, cuánto debe
- Cómo pagar, dónde pagar
- Recibo digital
- Problemas con pagos

## Flujo: Consulta de Saldo

1. **¿Tengo el contrato?**
   - Sí → Usar `get_deuda`
   - No → Preguntar: "¿Me proporcionas tu número de contrato?"

2. **Presentar resultado:**
   ```
   Tu saldo actual es de $[TOTAL] MXN 💧
   [Si hay vencido]: Tienes $[VENCIDO] vencido.
   ```

3. **Ofrecer opciones de pago** (solo si pregunta cómo pagar)

## Flujo: Recibo Digital

1. Preguntar: "¿Me confirmas tu número de contrato y correo electrónico?"
2. Cuando tenga ambos, crear ticket:
   ```javascript
   create_ticket({
     service_type: "recibo_digital",
     titulo: "Cambio a recibo digital - Contrato [X]",
     descripcion: "Contrato: [X], Email: [Y]",
     contract_number: "[X]",
     email: "[Y]"
   })
   ```
3. Confirmar: "Listo, solicitud registrada con folio [FOLIO]. Tu recibo llegará a [email] 💧"

## Formas de Pago

- **En línea:** cea.gob.mx
- **Oxxo:** Con tu recibo impreso
- **Bancos:** Santander, BBVA, Banorte (con recibo)
- **Cajeros CEA:** En oficinas
- **Oficinas CEA:** Lunes a Viernes 8:00-16:00

## Notas Importantes

- Los pagos pueden tardar **24-48 horas** en reflejarse
- Si pagó y no se refleja, crear ticket tipo "pagos"
- Nunca des montos aproximados, siempre consulta

## Ejemplo de Respuesta

**Usuario:** "Cuánto debo?"
**María:** "¿Me proporcionas tu número de contrato?"

**Usuario:** "123456"
**María:** [Usar get_deuda con contrato 123456]
"Tu saldo actual es de $850.00 MXN 💧 ¿Te gustaría saber las formas de pago?"
