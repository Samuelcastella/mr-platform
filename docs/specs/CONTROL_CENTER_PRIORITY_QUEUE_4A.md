# MR Adulán — Bandejas de trabajo priorizadas (Workspace 4A)

## Alcance
Extensión estrictamente **de consulta** para el Control Center. Reutiliza las cinco fuentes API ya utilizadas por los indicadores del panel de inicio, sin endpoints de escritura, migraciones, tareas en segundo plano ni interacciones con la pasarela.

- **Inicio `GET /`:** muestra los primeros seis pendientes detectados y un enlace `Abrir todas las bandejas`, junto a los indicadores existentes; ambas vistas usan la **misma consulta de orígenes** durante cada carga.
- **Pantalla `GET /work-queue`:** hasta 40 casos priorizados, filtros GET `?priority=urgent|high|normal` y `?domain=health|orders|fulfillment|returns|purchases`. Opciones desconocidas se ignoran.
- **Enlaces a registros:** cada pendiente abre el registro dentro de su módulo mediante un ancla de página (`/orders#order-<id>`, `/fulfillment#fulfillment-<id>`, `/returns#return-<id>`, `/purchases#purchase-<id>`, `/health-desk#incident-<id>`). El módulo vuelve a comprobar el acceso y el estado actual. Si cambió la lista o el caso salió de los últimos 100, el módulo aún se abre sin modificar registros.

## Criterios de prioridad sugerida

| Prioridad | Casos | Interpretación |
|---|---|---|
| **Urgente** | Incidente `OPEN` de severidad `CRITICAL`; entrega `FAILED` | Revisión operativa prioritaria |
| **Alta** | Pedido `PENDING_CONFIRMATION`; devolución `REQUESTED`; orden de compra `PARTIALLY_RECEIVED`; incidente `OPEN` de severidad `WARNING` o incidente crítico en investigación | Seguimiento requerido |
| **Normal** | Pedido `CONFIRMED`; entrega `PENDING`, `PREPARING` o `READY`; devolución `APPROVED`, `RECEIVED` o `INSPECTED`; compra `APPROVED` o `ORDERED`; otros incidentes `OPEN`, `ACKNOWLEDGED`, `INVESTIGATING` | Continuidad del flujo |

Las prioridades son reglas **de clasificación visual, no vencimientos SLA**. Se ordenan por prioridad y después por fecha registrada, desde la más antigua; faltas de fecha se colocan al final. No se infiere que existan pagos autorizados, stock listo o reembolsos efectuados.

## Seguridad y límites de datos

- Solo se consultan los endpoints para los que el usuario autenticado tiene permiso: `health.read`, `orders.read`, `fulfillment.read`, `returns.read`, `procurement.read`. La autorización por ubicación y acceso real corresponde al Commerce Core.
- Las tarjetas contienen identificadores operativos y estados, **no nombres de clientes, teléfonos ni importes**. La salida dinámica se escapa para HTML.
- Filas sin un ID numérico válido o con estados desconocidos no generan pendientes; se deduplican identificadores del mismo dominio.
- La fuente `health` utiliza `incidents`; las demás fuentes usan `data`. Fuentes no disponibles se indican explícitamente, **no se presentan como cero pendientes**.
- Los listados existentes pueden estar limitados a 100 registros por endpoint y por ámbito. `40 pendientes` significa `40 de los casos detectados en las respuestas consultadas`, nunca una cifra global.
- La vista no genera POST/PATCH, ni actualiza pedidos, devoluciones, inventario, Kardex, liquidaciones o reembolsos.
- No se ha añadido monitoreo continuo ni notificaciones automáticas; la página se actualiza cuando se vuelve a cargar.

## Pruebas y aceptación

`bun test services/control-center/workspace.test.ts services/control-center/workspace-flow-map.test.ts services/control-center/operational-overview.test.ts services/control-center/priority-work-queue.test.ts`

Verificar que:

1. El orden de prioridades cumple las reglas de estados reconocidos, con antigüedad secundaria.
2. Una sesión sin permisos no recibe tarjetas, enlaces ni información de áreas no autorizadas.
3. Las fuentes caídas o incompletas no se contabilizan como listas vacías sanas.
4. Parámetros GET no permitidos no se reflejan y la salida HTML escapa valores de proveedores.
5. Los enlaces abren registros con anclas existentes en los cinco módulos.
6. El nuevo panel reutiliza los snapshots autorizados y la ruta solo permite GET tras `readSession`.
7. El CI del monorepo y Control Center Runtime CI pasan en un PR separado.

Quedan pendientes: inspección visual responsive (375, 768 y 1280 px), pruebas con sesiones reales de roles restringidos por ubicación, y verificación de que el ámbito de los listados API del Commerce Core coincide con el perfil autorizado. No fusionar ni desplegar esta fase sin completar las validaciones requeridas.
