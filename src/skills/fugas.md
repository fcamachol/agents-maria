# Skill: Reporte de Fugas

## Cuándo Aplicar
Cuando el usuario mencione:
- Fuga de agua
- No hay agua / sin servicio
- Inundación
- Tubería rota
- Agua en la calle
- Emergencia de agua

## Información Necesaria

1. **Ubicación exacta** (OBLIGATORIO)
   - Calle y número
   - Colonia
   - Referencias (entre qué calles, cerca de qué)

2. **Tipo de fuga**
   - Vía pública (calle, banqueta, poste)
   - Dentro de propiedad (casa, negocio)

3. **Gravedad**
   - Goteo menor
   - Fuga considerable
   - Inundación / mucha agua

## Flujo de Reporte

```
1. Identificar que es fuga
2. Preguntar ubicación (si no la dio)
3. Preguntar tipo (vía pública o propiedad)
4. Evaluar gravedad
5. Crear ticket
6. Confirmar con folio
```

### Preguntas Clave

- "¿Me puedes dar la dirección exacta de la fuga?"
- "¿La fuga es en la calle o dentro de tu propiedad?"
- "¿Es mucha agua o es un goteo?"

## Crear el Ticket

```javascript
create_ticket({
  service_type: "fuga",
  titulo: "Fuga en [vía pública/propiedad] - [Colonia]",
  descripcion: "Ubicación: [dirección completa]. Tipo: [descripción]. Gravedad: [nivel].",
  ubicacion: "[dirección exacta]",
  priority: "urgente"  // si hay inundación
           // "alta"     // si es considerable
           // "media"    // si es goteo
})
```

## Respuesta Después de Crear

```
He registrado tu reporte con el folio [FOLIO] 💧

Un equipo de CEA acudirá a la ubicación. Para fugas urgentes, 
el tiempo de respuesta es de [X] horas.

Si la situación empeora, llama al 442-XXX-XXXX.
```

## Reglas Especiales

- **NO pidas contrato** para fugas en vía pública
- **SÍ pide contrato** si la fuga es dentro de propiedad
- Si envían **foto**: Úsala para entender la situación
- Si es **emergencia grave**: Prioridad "urgente" + mencionar teléfono de emergencias

## Ejemplo

**Usuario:** "Hay una fuga enorme en mi calle"

**María:** "Voy a registrar el reporte. ¿Me das la dirección exacta? (calle, número, colonia) 💧"

**Usuario:** "Av. Constituyentes 450, Col. Centro"

**María:** "¿La fuga es en la banqueta/calle o dentro de alguna propiedad?"

**Usuario:** "En la calle, está saliendo mucha agua"

**María:** [Crear ticket con priority: "urgente"]
"He registrado tu reporte con el folio FUG-20260111-0023 💧
Un equipo de CEA acudirá a Av. Constituyentes 450 lo antes posible."
