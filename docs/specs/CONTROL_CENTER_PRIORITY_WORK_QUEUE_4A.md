# MR Adulán — Bandeja de trabajo priorizada (Control Center 4A)

## Objetivo y alcance

Vista de **solo lectura** para reunir en una misma bandeja situaciones operativas que requieren revisión. No se crea una entidad de tareas, no se modifica el estado de los objetos y no se convierte una prioridad sugerida en un SLA contractual.

- **GET `/work-queue`**: pendientes con filtros GET `priority=urgent|high|normal` y `domain=health|orders|fulfillment|returns|purchases`.
- **GET `/`**: muestra los seis primeros pendientes debajo de los KPI existentes, reutilizando las **mismas respuestas de consulta** del contexto de inicio.
- Se obtienen datos de `/v1/internal/health-desk`, `/v1/internal/orders`, `/v1/internal/fulfillments`, `/v1/internal/returns`, `/v1/internal/procurement/purchase-orders`. No se requieren endpoints nuevos del catálogo ni migraciones PostgreSQL.
- Todas las consultas se hacen **solo si** StaffUser tiene el permiso de lectura que requiere el endpoint correspondiente. La API conserva la autorización real, el ámbito de ubicación y la sesión; la vista no implica permiso de escritura. Los filtros de área también ocultan opciones sin permiso.
- Cada ítem enlaza mediante GET a un **ancla de registro existente** en su módulo: `/orders#order-ID`, `/fulfillment#fulfillment-ID`, `/returns#return-ID`, `/purchases#purchase-ID`, `/health-desk#incident-ID`. En cada pantalla se añade el `id` HTML de destino a su tarjeta correspondiente.

## Reglas de priorización

| Prioridad | Regla inicial |
| --- | --- |
| **Urgente** | Incidente abierto crítico; entrega fallida |
| **Alta** | Incidente abierto WARNING o crítico en seguimiento; pedido PENDING_CONFIRMATION; devolución REQUESTED; compra PARTIALLY_RECEIVED |
| **Normal** | Incidente restante abierto, confirmado o investigándose; pedido CONFIRMED; entrega PENDING/PREPARING/READY; devolución APPROVED/RECEIVED/INSPECTED; compra APPROVED/ORDERED |

Los estados terminales (ej. pedido CANCELLED, entrega DELIVERED, incidente RESOLVED) no generan pendientes. El orden es prioridad, antigüedad del registro cuando hay fecha válida y clave estable como desempate; fechas inválidas se ordenan al final de su prioridad. La regla no infiere urgencia por tiempo transcurrido ni modifica Kardex, reservas o aprobaciones.

## Evidencia y límites

- La lista consulta hasta **100 filas recientes** de cada origen, según contrato actual; el contador describe exclusivamente el subconjunto devuelto por las APIs, **nunca** las obligaciones globales.
- Una fuente que falla o carece de una lista válida se identifica en la pantalla como **no disponible**, no como ausencia de trabajo.
- Los datos ingresados en los títulos se escapan antes de dibujarse en HTML; los identificadores de fila se validan como enteros positivos seguros. Se eliminan duplicados con la clave `dominio:id`.
- La bandeja no muestra nombres, teléfonos, contactos o importes de los pedidos. Solo muestra números de operación, estados y motivos de revisión.
- Los controles son enlaces GET de navegación. Para cualquier mutación el operador deberá entrar al módulo y superar la autorización, CSRF y validación transaccional existentes.
- `GET /work-queue` no tiene persistencia, asignación de responsable, alarmas temporizadas, estados de tarea ni reconciliación financiera. Ningún resultado es una confirmación de pago o devolución.

## Pruebas y validación

- `bun test services/control-center/priority-work-queue.test.ts`: ranking, deduplicación, filtros válidos, seguridad HTML, permisos, fallos independientes y acceso a cada ancla.
- `Control Center Runtime CI` amplía la batería de workspace a esta prueba.
- Pendiente antes de producción: revisión visual en 375, 768 y 1280 px y comprobación end-to-end con sesiones de personal y datos de distintas ubicaciones.

**Entrega:** rama `feat/control-center-priority-queue`, PR independiente dirigido a `main`; no tocar Railway ni pasarelas de pago.
