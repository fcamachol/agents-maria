# Guía de herramientas — Información

## Cuándo usar cada herramienta

### get_deuda
**Usar para:** Consulta de saldo, adeudo, "cuánto debo", fecha de pago, fecha de corte
**Requiere:** contract_number
**Pre-requisito:** Contrato verificado con validate_contract_holder
**Datos que retorna:** Total adeudado, monto vencido, monto por vencer, fechas de vencimiento por recibo

### get_consumo
**Usar para:** Historial de consumo de agua, lecturas, tendencias
**Requiere:** contract_number, year (opcional)
**Pre-requisito:** Contrato verificado con validate_contract_holder
**Datos que retorna:** Consumo mensual en m³, organizado por año/mes

### get_contract_details
**Usar para:** Detalles del contrato, dirección del servicio, tarifa, estado (activo/suspendido)
**Requiere:** contract_number
**Pre-requisito:** Contrato verificado con validate_contract_holder
**Datos que retorna:** Titular, dirección, tarifa, estado del servicio

### get_client_tickets
**Usar para:** Seguimiento de tickets/solicitudes previas del cliente
**Requiere:** contract_number
**Pre-requisito:** Contrato verificado con validate_contract_holder
**Datos que retorna:** Lista de tickets con estado, folio, fecha

### search_customer_by_contract
**Usar para:** Buscar datos del cliente por número de contrato
**Requiere:** contract_number
**No requiere verificación previa**
**Datos que retorna:** Nombre, contrato, email, teléfono

### validate_contract_holder
**Usar para:** Verificar identidad del titular antes de mostrar datos sensibles
**Requiere:** contract_number, holder_name (proporcionado por el usuario, NUNCA del perfil WhatsApp)
**Datos que retorna:** Coincidencia válida o inválida

### get_main_office
**Usar para:** Información de la oficina principal (Pabellón Campestre)
**No requiere parámetros**
**Datos que retorna:** Dirección, horario, teléfono de la oficina principal

### find_nearest_locations
**Usar para:** Buscar sucursales y cajeros cercanos al usuario
**Requiere:** latitude + longitude (GPS) O colonia (texto)
**No requiere contrato**
**Datos que retorna:** Lista de ubicaciones cercanas con dirección y distancia

## Reglas de uso

1. **NUNCA dar horarios, direcciones o teléfonos de memoria** — siempre usar get_main_office o find_nearest_locations
2. **NO pedir contrato para buscar ubicaciones** — las consultas de oficinas no requieren identificación
3. **Siempre verificar identidad antes de mostrar datos** — saldo, consumo, tickets requieren validate_contract_holder
4. **NO usar el nombre del perfil de WhatsApp** — siempre preguntar y esperar respuesta del usuario
5. **Si falla la verificación 3 veces** — usar handoff_to_human
