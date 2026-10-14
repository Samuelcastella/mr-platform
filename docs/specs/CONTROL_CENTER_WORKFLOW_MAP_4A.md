# MR Adulán — Mapa operativo del Control Center (incremento 4A)

## Objetivo
Relacionar los módulos administrativos en recorridos operativos claros, sin convertir la interfaz en un motor de transacciones ni alterar checkout, Kardex, inventario, pagos o pasarelas.

## Implementación
- Página **GET `/workspace`**, servida únicamente tras la validación de sesión StaffUser existente.
- Fuente de módulos y rutas: `services/control-center/workspace-flow-map.ts`.
- Botones de navegación: enlaces internos GET a rutas que ya existían; el módulo no presenta formularios ni ejecuta acciones de negocio.
- Filtros GET `/workspace?flow=sell|source|make|govern`. Los identificadores desconocidos muestran el mapa completo sin interpretar HTML provisto por el usuario.
- Enlaces habilitados solo cuando `session.user.permissions` contiene el permiso de consulta correspondiente al módulo. Los pasos sin autorización se muestran como «Sin permiso de consulta», sin enlace. El backend sigue siendo la autoridad para sesiones, alcance por ubicación, CSRF y cada mutación.
- Cuadrícula responsive y controles con foco visible, enlaces semánticos y pasos numerados.

## Recorridos
| ID | Recorrido | Módulos |
| --- | --- | --- |
| `sell` | Del catálogo a la entrega | Catálogo → Pedidos → Entregas → Devoluciones |
| `source` | Del proveedor al inventario | Proveedores → Sourcing → Compras → Ajustes de inventario → Trazabilidad |
| `make` | De la especificación a la calidad | Fabricantes → Especificaciones → Producción → Calidad → Costeo |
| `govern` | Seguimiento y mejora | Health Desk → Inteligencia → Decisiones de surtido |

## Alcance y límites de seguridad
La página es **un mapa de navegación, no un orquestador**. La secuencia recomendada no implica que los sistemas externos estén homologados, que haya fondos capturados o que el stock ya esté liberado. No hay consultas adicionales al backend ni lectura de datos financieros. El permiso de consulta no implica permiso de escritura. La barra lateral original conserva su comportamiento actual; el filtrado por permisos de este incremento corresponde a los botones del mapa.

## Verificación
`bun test services/control-center/workspace.test.ts services/control-center/workspace-flow-map.test.ts` valida:
1. Integridad de rutas, unicidad de identificadores y enlaces a módulos existentes.
2. Ausencia de enlaces operativos cuando falta el permiso del actor.
3. Filtros validados mediante identificadores de flujo predefinidos.
4. Preservación de guardia de sesión en la ruta y navegación solo GET.
5. Accesibilidad básica (listas ordenadas, estado activo, foco y responsive).
6. Mantenimiento de controles existentes de login y logout con CSRF.

El workflow **Control Center Runtime CI** exige estas pruebas y el build de Bun. Las pruebas estáticas no sustituyen una inspección visual en 375/768/1280 px ni pruebas de rol extremo a extremo contra PostgreSQL; ambas siguen pendientes antes de habilitar producción.

## Panel de inicio por permisos (segunda fase)

El inicio `GET /` ahora antepone una vista operativa basada únicamente en APIs de consulta existentes: `/v1/internal/health-desk`, `/v1/internal/orders`, `/v1/internal/fulfillments`, `/v1/internal/returns` y `/v1/internal/procurement/purchase-orders`.

- El backend del Control Center **solo solicita** un origen cuando `StaffUser.permissions` contiene el permiso de lectura requerido. Cada API mantiene sus comprobaciones de ámbito por ubicación.
- Health Desk presenta los valores `openIncidents` y `criticalSignals` declarados en su resumen. Los demás indicadores cuentan registros con estados operativos concretos **en el listado recibido**, que puede estar paginado o limitado por alcance; no se presentan como totales globales.
- Errores, respuestas sin datos válidos o falta de acceso se muestran como `—` con explicación: nunca se convierten en 0.
- Los avisos son enlaces GET de revisión hacia módulos autorizados y no crean incidencias, modifican inventario, ejecutan pagos ni confirman pedidos. Los accesos rápidos se derivan del mismo catálogo de módulos y permisos del mapa.
- El inicio se abre para todo StaffUser autenticado. Los usuarios sin `inquiries.read` reciben la vista operativa y no se consulta la bandeja; aquellos con el permiso siguen viendo el dashboard de intenciones existente debajo del resumen. Si la bandeja no responde, los indicadores disponibles siguen visibles.
- La consulta ocurre al abrir la página. No hay suscripciones en vivo, background polling, cambios de estado ni afirmaciones sobre un proveedor bancario.

Las pruebas `services/control-center/operational-overview.test.ts` verifican aislamiento por permisos, no ejecutar consultas sin autorización, conservación de fuentes saludables cuando otras fallan, valores ausentes no equivalentes a cero, estadísticas basadas en estados conocidos, acceso rápido solo GET y preservación de la bandeja heredada.

Antes de desplegar aún faltan inspección visual en 375/768/1280 px y pruebas integrales con identidades y ubicaciones reales. La etiqueta «panel operativo» no implica que todas las integraciones del proyecto estén listas.

## Integración
Este incremento se desarrolla en `feat/control-center-workflow-map` y se enviará a PR separado, sin modificar Railway mientras el despliegue previo continúe. La fusión debe seguir la aprobación de CI y revisión.
