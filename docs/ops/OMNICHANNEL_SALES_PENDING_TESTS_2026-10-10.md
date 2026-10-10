# Flujo de venta omnicanal — nota de cierre técnico y pruebas pendientes

Fecha: 2026-10-10. Proyecto: MR ADULAN. Estado: **implementación parcial; validación pendiente**.

## Alcance verificado mediante revisión de código
- `services/catalog-api/orders.ts`: canales `STORE`, `PHONE`, `WHATSAPP`, `WEB`, `APP`, `MARKETPLACE`; estados de pedidos y reservas de inventario.
- `services/catalog-api/checkout.ts`: sesiones de checkout, pagos y confirmación interna; métodos `CASH`, `BANK_TRANSFER`, `CASH_ON_DELIVERY`. `OfflinePaymentProvider` genera estado pendiente, no certifica un procesador externo.
- `services/catalog-api/fulfillment.ts`: retiro en tienda, entrega local y courier; estados, tracking y cobro contra entrega.
- Railway: `catalog-api`, `storefront`, `control-center` y PostgreSQL con último despliegue exitoso observado; esto **no** certifica un flujo E2E.

## Pruebas expresamente pendientes (no ejecutadas ni aprobadas)
1. Compra web de extremo a extremo: catálogo → stock → reserva → pedido → checkout → confirmación de pago autorizada → preparación → entrega → conciliación.
2. Concurrencia: 50 solicitudes simultáneas sobre la última unidad; debe haber como máximo una reserva/venta y ninguna existencia negativa.
3. Expiración y cancelación: liberación exacta de reservas, reintentos e idempotencia.
4. Integridad de PostgreSQL: pedido, reserva, movimientos Kardex, pagos y fulfillment, con rollback ante errores.
5. Seguridad: RBAC, autorización de confirmaciones manuales y auditoría de transiciones.
6. Integración real de WhatsApp y POS; un valor de `channel` en la base no demuestra integración.
7. Pasarelas externas, couriers y sus webhooks; credenciales y pruebas sandbox aún no verificadas.
8. Pruebas controladas en producción, observabilidad y plan de reversión antes de marcar `verified`.

## Regla de estado
No cambiar a «cerrado», «verificado» ni «100% funcional» hasta adjuntar evidencia de las pruebas aplicables. El desarrollo existente puede avanzar independientemente de la certificación. Fiscal y crédito permanecen aplazados según la priorización del proyecto.

Responsable de ejecutar pruebas: **pendiente de asignación**. Fecha de ejecución: **pendiente**. Resultado: **no ejecutado**.
