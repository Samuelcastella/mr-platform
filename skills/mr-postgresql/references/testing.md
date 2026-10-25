# Pruebas verificables

## Niveles

| Nivel | Casos mínimos |
|---|---|
| Unitarias | Dinero, redondeo, reglas de estado e idempotencia, sin depender de DB |
| SQL/integración | Migraciones reales, CHECK/FK/UNIQUE, consultas, rollback y permisos |
| API con PostgreSQL | Catálogo, reserva, pedido, conciliación, envío y exportación |
| Concurrencia | Última unidad, idempotencia simultánea, vencimiento/confirmación y deadlocks |
| Seguridad | Aislamiento entre usuarios/tiendas si aplica, parámetros, roles y RLS |
| Rendimiento | Carga representativa, p95/p99, errores, conexiones, locks y planes |
| Recuperación | Restaurar copia en destino aislado y verificar invariantes |

Usar PostgreSQL real para semántica SQL y transaccional; SQLite o mocks no validan bloqueo, tipos ni restricciones PostgreSQL. No sustituir pruebas de API por SQL directo solamente.

## Datos y aislamiento

Crear fixtures deterministas DEMO con IDs propios y casos límite: SKU único, prenda usada con una unidad, cero existencias, reserva vencida, envío parcial, pago repetido y devolución parcial. Mantener reloj controlable para expiraciones. Transacción con rollback sirve solo si el código probado usa esa misma conexión; para API multi-conexión usar base efímera y limpieza con alcance comprobado. No hacer truncado global de una base compartida.

## Carreras con conexiones independientes

- Preparar un SKU con una unidad disponible. Lanzar dos reservas desde sesiones distintas, sincronizando el punto de competencia mediante barrera explícita. Exigir exactamente un éxito, un rechazo comercial y disponibilidad final cero. Verificar efecto en Kardex/reservas y reintento del ganador.
- Enviar dos solicitudes con la misma clave idempotente. Exigir un único efecto persistente y respuesta coherente; cambiar payload debe producir conflicto.
- Competir confirmación y expiración de una reserva. Exigir una sola transición ganadora, sin doble liberación ni doble descuento.
- Usar plazo máximo para cada test y cerrar conexiones en finally; no depender únicamente de sleeps para generar carreras.
- Si hay reintentos 40001/40P01, probar el límite y ausencia de efectos externos duplicados.

## Otros criterios de aceptación

- UPDATE/DELETE no autorizados fallan usando el rol de aplicación, no el owner.
- Un fallo entre cabecera y líneas revierte el pedido completo; un fallo después del commit conserva el resultado para reintentos.
- Totales y devoluciones cuadran al centavo; fechas en límites de día usan la zona comercial configurada.
- Consultas de reportes no multiplican pedidos por joins; CSV no filtra PII innecesaria.
- Promoción bloqueada si migración o pruebas críticas fallan; medir presupuesto de latencia acordado sin inventar SLA.

## Evidencia

Registrar comando, versión, revisión del código, entorno sin secretos, casos, resultado y duración. Marcar cada nivel no ejecutado y el motivo. Validar el YAML de una skill no equivale a probar una base de datos.
