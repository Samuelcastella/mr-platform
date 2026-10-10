# Controles de consistencia: reservas, Kardex y pagos tardíos

Fecha: 2026-10-10. Alcance: MR Adulán / Catalog API / Control Center. **Documento de requisitos y criterios de aceptación; no constituye evidencia de implementación ni de pruebas.**

## 1. Salida física y movimiento Kardex atómicos
- La confirmación de pago o de pedido no equivale a salida física; el consumo definitivo debe ocurrir en la transición logística autorizada (actualmente, verificar transición READY -> COMPLETED).
- En **una misma transacción PostgreSQL**: bloquear pedido, líneas, reservas e inventario relevantes; validar estado y cantidades; descontar `inventory.quantity`, reducir `inventory.reserved`, insertar movimiento `inventory_movements` tipo `SALE` con referencia única de pedido/línea/ubicación, y registrar transición/auditoría.
- Si falla cualquier paso, hacer rollback completo. Reintentos o eventos duplicados no pueden producir un segundo descuento ni segundo movimiento.
- Pruebas: transición normal, fallo forzado al insertar movimiento (rollback), dos finalizaciones concurrentes, replay de evento, saldo insuficiente y trazabilidad por ubicación.

## 2. Conciliación periódica sin autocorrección silenciosa
- Comparar por SKU/variante y ubicación: `on_hand = inventory.quantity`, `reserved = inventory.reserved`, suma de reservas activas no vencidas y movimientos Kardex; usar un corte temporal consistente y contemplar reservas expiradas aún no procesadas.
- Detectar: `reserved > on_hand`, saldos negativos, divergencia entre reservas activas y `reserved`, movimientos duplicados/ausentes, reservas huérfanas, y diferencias entre saldo inicial + movimientos y saldo actual (si existe saldo inicial auditable).
- Generar reporte con timestamp, ubicación, SKU, magnitud, identificadores y severidad; exponer excepciones en Control Center con responsable, estado y auditoría. **No ajustar existencias automáticamente**; ajustes requieren aprobación y Kardex.
- Pruebas: inventario consistente, reserva huérfana, diferencia artificial, duplicado, conciliaciones concurrentes e idempotencia de alertas.

## 3. Pago asíncrono recibido tras vencimiento
- Validar autenticidad del webhook, persistir evento de proveedor con identificador único e idempotencia y conciliar estado del pago.
- Bloquear pedido y reserva en transacción; si la reserva expiró/fue liberada, **no confirmar automáticamente pedido ni consumir inventario**, aunque el proveedor confirme captura/cobro.
- Crear excepción `LATE_PAYMENT_EXPIRED_RESERVATION` para revisión. Rutas de resolución: (a) revalidar y adquirir una **nueva** reserva atómica si hay stock y autorización; (b) reembolso/void según estado de pago y política del proveedor; nunca reactivar reserva expirada por simple cambio de estado.
- Pruebas: webhook a tiempo, webhook tardío, entrega duplicada, expiración y webhook simultáneos, stock agotado, revalidación exitosa y fallida, reembolso fallido/reintentable y auditoría completa.
- La integración real con pasarela queda pendiente de credenciales y sandbox del proveedor; usar simulador de eventos en CI sin afirmar homologación externa.

## 4. Liberación de reservas vencidas exactamente una vez
- Dos workers simultáneos sobre la misma reserva: una sola transición ACTIVE -> EXPIRED, un solo decremento de `reserved`, sin saldos negativos. Usar bloqueo transaccional y condición de estado; verificar carrera con confirmación del pedido.
- Pruebas en PostgreSQL aislado; **prohibido ejecutar tests con TRUNCATE sobre producción**.

## Evidencia y cierre
- CI #225: prueba de 50 compras sobre una unidad, 1 éxito, 49 rechazos, 1 reserva activa: **aprobada**.
- Controles 1–4 anteriores: **pendientes de auditoría de código, implementación de brechas y pruebas específicas**; no inferirlos de la prueba de 50 compras.
- Cierre requiere: tests verdes, logs vinculados, revisión de permisos/auditoría, PR fusionada y verificación de despliegue sin mutar datos de producción.
- Fiscal y crédito fuera de alcance por decisión de proyecto.
