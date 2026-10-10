# Auditoría de integración de proveedores — Railway (2026-10-10)

**Alcance:** inspección no destructiva de nombres de variables en producción y del código de la rama `feature/technology-evaluation-matrix`. No se consultaron valores secretos, no se modificó Railway y no se probaron credenciales de terceros.

## Evidencia comprobada
- Servicios Railway con último despliegue exitoso: `control-center`, `storefront`, `catalog-api`, `Postgres`. El estado del contenedor no certifica cada proceso comercial.
- `catalog-api`: `DATABASE_URL`, `INTERNAL_API_TOKEN`, variables PG*.
- `control-center`: `CATALOG_API_URL`, `BOOTSTRAP_API_TOKEN`, `CONTROL_CENTER_SESSION_SECRET`, variables PG*.
- `storefront`: `CATALOG_API_URL`.
- Buckets del proyecto: `project-documents`, `MRImages`; no se verificó su conexión efectiva desde la aplicación.
- No se identificaron en los servicios principales nombres de variables inequívocamente asociados a credenciales de WhatsApp Business, pasarela de tarjetas o courier externo. Esto **no** prueba ausencia de código ni de integración en otros entornos.

## Matriz de proveedores y dependencias
| Proveedor / familia | Estado comprobado | Dependencias para verificar | Acción pendiente |
| --- | --- | --- | --- |
| Railway (hosting) | Servicios base desplegados | Dominios, health checks, logs | Pruebas HTTP y flujos de extremo a extremo |
| PostgreSQL | Servicio y variables de conexión presentes | Acceso autorizado, migraciones, consistencia | Pruebas transaccionales con DB |
| Almacenamiento Railway S3 | Dos buckets existentes | Permisos, referencias de variables, adapter, carga/lectura | Probar carga, descarga y controles de acceso |
| Pasarela de pagos externa | Sin credenciales identificadas; no verificada | Contrato, API, sandbox, claves, firma webhook, conciliación | Seleccionar proveedor y validar adapter sin marcar PAID por captura |
| WhatsApp Business | Sin credenciales identificadas; no verificada | Cuenta WABA, token, phone number ID, webhook verification, consentimiento | Implementar/probar adapter y webhooks |
| Courier / mensajería | Sin credenciales identificadas; no verificada | Proveedor, API, cobertura, tarifas, tracking, webhooks | Probar cotización, etiqueta y estado de entrega |
| Fiscal Honduras | **Aplazado/bloqueado** | CAI y criterios fiscales validados | Mantener bloqueado para producción |
| Crédito externo | **Aplazado** | Contrato, autorización legal, API, condiciones | Mantener fuera de producción |

## Hallazgo de código de la matriz
En `services/catalog-api/integration-matrix.ts` de la rama de PR #119 existe una matriz de **11 componentes funcionales** (`catalog`, `inventory`, `orders`, `payments`, `fiscal`, `reconciliation`, `logistics`, `notifications`, `credit`, `loyalty`, `outfits`) y seis dimensiones de control (`api`, `webhooks`, `authentication`, `inventorySync`, `fiscalCompliance`, `production`). **No es todavía un inventario individual de proveedores**: los IDs son módulos, no empresas. No se deben equiparar «matriz funcional» y «matriz de proveedores» sin un registro separado de proveedor, adapter, owner, entorno y evidencia.

## Criterios de cierre por proveedor
1. Identificar nombre legal, producto, entorno y responsable; confirmar contrato y permisos.
2. Registrar **solo nombres** de variables necesarias; valores secretos exclusivamente en Railway.
3. Confirmar que existe adapter propio y que maneja timeouts, reintentos e idempotencia.
4. Probar conexión y flujo de sandbox, con errores y firma de webhook cuando aplique.
5. Registrar evidencia reproducible y fecha; usar `verified` solo después de pruebas.
6. Probar en producción de forma controlada y documentar rollback, monitoreo y auditoría.

**Pendiente en PR #119:** pruebas PostgreSQL de concurrencia, RBAC y endpoints; validación UI; revisión y merge; despliegue. No se declara completada la integración de ningún tercero por la mera presencia de variables.
