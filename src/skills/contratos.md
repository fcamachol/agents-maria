# Skill: Contratos

## Cuándo Aplicar
Cuando el usuario pregunte por:
- Nuevo contrato / alta de servicio
- Cambio de titular / nombre
- Datos de su contrato
- Cancelar servicio
- Reconexión

## Flujo: Consulta de Contrato

1. Pedir número de contrato
2. Usar `get_contract_details`
3. Presentar información:
   ```
   Datos de tu contrato 💧
   • Titular: [nombre]
   • Dirección: [dirección]
   • Tarifa: [tipo]
   • Estado: [activo/suspendido]
   ```

## Contrato Nuevo (Alta de Servicio)

### Requisitos
1. Identificación oficial vigente (INE/pasaporte)
2. Documento que acredite propiedad del predio:
   - Escrituras
   - Contrato de compraventa
   - Constancia de posesión
3. Carta poder simple (si no es el propietario)

### Costo
- **$175 + IVA** (costo base)
- Puede variar según el tipo de uso

### Respuesta
```
Para un contrato nuevo necesitas traer a oficinas CEA:
• Identificación oficial (INE)
• Comprobante de propiedad del predio
• Carta poder simple (si no eres el propietario)

El costo es $175 + IVA 💧

Oficinas: Lunes a Viernes 8:00-16:00
```

## Cambio de Titular

### Requisitos
1. Número de contrato actual
2. Identificación del nuevo titular
3. Documento de propiedad a nombre del nuevo titular
4. Acudir a oficinas CEA

### Flujo
1. Verificar contrato con `get_contract_details`
2. Explicar requisitos
3. Si hay adeudo, mencionar que debe liquidarse

### Respuesta
```
Para cambio de titular necesitas:
• Identificación oficial del nuevo titular
• Documento de propiedad a su nombre
• Liquidar cualquier adeudo pendiente

El trámite se realiza en oficinas CEA 💧
```

## Estados de Contrato

| Estado | Significado | Acción |
|--------|-------------|--------|
| Activo | Servicio funcionando | Normal |
| Suspendido | Servicio cortado por adeudo | Pagar para reconexión |
| Cortado | Servicio cancelado | Requiere nuevo contrato |

## Reconexión por Adeudo

```
Para reconectar tu servicio:
1. Liquida el adeudo pendiente
2. El pago puede tardar 24-48 hrs en reflejarse
3. La reconexión es automática o puedes llamar para agilizar

¿Quieres que consulte tu saldo? 💧
```

## Información de Oficinas

- **Dirección:** [Dirección oficina central]
- **Horario:** Lunes a Viernes 8:00 - 16:00
- **Teléfono:** 442-XXX-XXXX
