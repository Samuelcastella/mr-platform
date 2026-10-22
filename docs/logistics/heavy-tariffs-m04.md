# M04.3 — Motor inicial de tarifas logísticas pesadas

## Estado y alcance
Implementa cálculo determinista por paquete para el comercio de MR עדולם en Honduras. Este cambio **no importa tarifas comerciales verificadas**, no activa transportistas ni cambia el checkout. El catálogo ya gestiona perfiles por variante y el pedido conserva una cotización auditable por línea, con aceptación vinculada al pedido.

## Fuente de verdad
- `product_shipping_profiles`: peso real (gramos), dimensiones (cm) y `requires_special_handling`.
- `carrier_heavy_rates`: departamento, tipo de servicio, proveedor, vigencia, moneda HNL, banda de peso y componentes opcionales. **Sólo tarifas `active = true` vigentes** participan.
- `heavy_logistics_quotes` y `heavy_logistics_quote_lines`: snapshots de las cotizaciones emitidas. La aceptación aplica el costo al pedido dentro de una transacción.

## Cálculo por unidad
1. Peso volumétrico en gramos: `ceil(largo_cm * ancho_cm * alto_cm * 1000 / divisor_volumetrico)`.
2. Peso facturable: `max(peso_real, peso_volumetrico)`.
3. Kilos adicionales: `ceil(max(0, peso_facturable - gramos_incluidos) / 1000)`.
4. Tarifa por unidad en centavos HNL: `max(minimum_minor, base_minor + kilos_adicionales * additional_minor_per_kg + handling_minor)`.
5. Para pedidos, se multiplica por la cantidad de cada línea y se suman las unidades como paquetes independientes. **No hay descuento por consolidación** sin un acuerdo de transporte.

El motor exige **cotización manual** sin perfil completo, sin tarifa habilitada, si supera `max_billable_grams`, si la mayor dimensión supera `max_edge_cm`, o si `requires_special_handling = true`. No calcula automáticamente instalación, acceso por escaleras, subida de pisos, grúa, seguros ni entrega especial: estos casos deben pasar por cotización validada/operación manual, nunca por una tarifa inventada.

## Operación y despliegue
1. Aplicar `db/migrations/016_heavy_logistics.sql`, `017_heavy_logistics_quotes.sql`, `018_installation_jobs.sql`, `019_heavy_quote_lines.sql` y **`020_heavy_tariff_guards.sql`** en orden, si aún no existen.
2. Registrar y auditar los perfiles de productos; marcar manipulación especial cuando corresponda.
3. Cargar tarifas autorizadas y fechadas por proveedor/departamento con `active = false` hasta completar la homologación comercial, incluyendo manejo, mínimo y máximo dimensional si forman parte de la tarifa contratada.
4. Activar tarifas sólo después de comprobar su correspondencia con el contrato del transportista. Verificar la cotización con pedidos de prueba sin realizar cobros reales.
5. Ejecutar pruebas CI de M04 (unidades y PostgreSQL). Fusionar/implementar la API **después** de aplicar la migración, pues la consulta usa sus nuevas columnas.

## Controles
- Nunca se confía en un importe de envío remitido por el cliente.
- Cada cotización de pedido guarda identificador de tarifa, vencimiento y detalle por variante/cantidad.
- Una cotización aceptada no puede reemplazarse por otra aceptada del mismo pedido; el total se reconcilia con sus líneas.
- Los importes se calculan en enteros (centavos). Entradas fuera de rango, importes negativos y desbordamientos se rechazan.
- El **precio de lista** de transportistas, tarifas por distancia/municipio, permisos de acceso, cobertura y condiciones de montaje siguen pendientes de homologación comercial. No incluirlos ni asumirlos en cargos automáticos.
