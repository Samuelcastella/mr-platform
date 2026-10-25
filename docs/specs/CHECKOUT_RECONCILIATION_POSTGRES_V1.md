# MR עדולם — QA de conciliación checkout / PostgreSQL

**SPEC-QA-RECON-001 · 2026-10-24 · Estado: preparada, aún no ejecutada en PostgreSQL.**

## Objetivo
Comprobar contra API y PostgreSQL reales que perder la respuesta del cliente tras un commit no duplica pedidos, reservas de inventario, fulfillment, checkout ni pagos. La protección entre pestañas no sustituye la idempotencia del servidor.

## Escenarios de aceptación
1. Order: repetir exactamente la misma clave y el mismo cuerpo recupera el mismo pedido (`HTTP 200`, `replayed: true`); existe una única reserva activa.
2. Order: reutilizar la clave con cantidad o variante distinta devuelve `HTTP 409 idempotency_conflict`.
3. Fulfillment: perder una respuesta y repetir la misma solicitud devuelve el mismo fulfillment, sin duplicar el registro.
4. Checkout: perder una respuesta y repetir devuelve la misma sesión; persisten un solo `Payment` y un solo `PaymentAttempt`.
5. Después de los reintentos: el pedido sigue `CONFIRMED`, el pago manual sigue `PENDING`, no existen ventas Kardex prematuras y no se duplica `inventory.reserved`.
6. Checkout: misma clave con otro método de pago devuelve `HTTP 409 idempotency_conflict`.
7. **Prueba de carrera:** dos solicitudes simultáneas con la misma clave y petición sobre la última unidad deben recuperar **el mismo Order**; no es correcto devolver `insufficient_stock` a una de ellas si esa misma clave ya creó el pedido.

## Riesgo detectado por revisión estática, pendiente de reproducir
`services/catalog-api/orders.ts` lee la clave de idempotencia antes de iniciar la transacción y bloquear inventario. Un segundo POST concurrente puede no encontrar aún el pedido sin confirmar, esperar el bloqueo de inventario y recibir `insufficient_stock` al liberarse el bloqueo, antes de alcanzar el INSERT protegido por unicidad. Es una **hipótesis**, no un fallo reproducido contra PostgreSQL.

## Condiciones de ejecución
- Solo usar base PostgreSQL local y desechable llamada `mr_checkout_reconciliation_test` y API local en `http://127.0.0.1:3011`; no usar Railway, SEMSE, producción ni staging compartido.
- Los datos de prueba deben ser ficticios y aislados; prohibido usar TRUNCATE global contra una base compartida.
- El archivo de prueba autónomo debe requerir activación explícita y comprobar nombre de BD, host y URL de API antes de escribir.
- El entorno actual no cuenta con Bun ni PostgreSQL: **aún no se ejecutaron pruebas de base de datos**.

## Orden de entrega
Pruebas funcionales locales → pruebas con PostgreSQL → navegador / iPhone → inventario y logística → documentación → **CI como última validación técnica** → revisión humana para integrar y desplegar.

**Seguridad de cambios:** no modificar `main`, PR #143, Railway ni SEMSE; no ejecutar GitHub Actions en esta etapa.
