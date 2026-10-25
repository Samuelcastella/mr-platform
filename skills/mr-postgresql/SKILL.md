---
name: mr-postgresql
description: Diseñar, revisar y operar PostgreSQL para MR עדולם y mr-platform con Spec-Driven Development. Usar para SQL, modelos de catálogo, inventario, pedidos, pagos y envíos, migraciones, índices, transacciones, seguridad, pruebas unitarias y de integración, concurrencia, CI, entornos local/desarrollo/test/preview/staging/producción, respaldos, restauración y diagnóstico de bases de datos.
---

# PostgreSQL para MR עדולם

## Respetar el alcance acordado para MR

- Trabajar únicamente con MR עדולם y `Samuelcastella/mr-platform`. No utilizar conexiones, credenciales, bases, servicios ni entornos de SEMSE para esta tarea.
- Para corregir y verificar checkout, pedidos, reservas y pagos, usar datos ficticios DEMO y una base PostgreSQL desechable dedicada a MR. No tocar producción durante estas pruebas.
- Primero corregir y comprobar los flujos funcionales y su conciliación. Dejar la incorporación o modificación del CI para el final, después de las pruebas funcionales.
- Mantener el resto de las guías de operación como referencia para trabajos futuros expresamente autorizados; no confundir su presencia con autorización para operar producción.

## Determinar el estado real

1. Leer AGENTS.md y las especificaciones del repositorio objetivo. Localizar la API, dependencias, esquema, migraciones, adaptador SQL, pruebas y CI. No asumir que archivos o módulos mencionados en conversaciones ya están implementados.
2. Tratar `Samuelcastella/mr-platform`, `services/catalog-api` y Bun/TypeScript como contexto declarado de MR; comprobarlos antes de escribir integración. Reutilizar el ORM o cliente y el ejecutor de migraciones existentes. No agregar un segundo sistema sin necesidad.
3. Identificar entorno, identidad de conexión, permisos, versión con `SHOW server_version`, extensiones, volumen y presupuesto de conexiones sin mostrar credenciales. Consultar documentación oficial de esa versión; no actualizar automáticamente al mayor más reciente.
4. Si faltan accesos, preparar cambios, fixtures y comandos verificables; informar qué ejecución queda pendiente. Crear esta skill no concede acceso a ninguna base de datos.

## Seguir Spec-Driven Development

- Escribir requisito, invariante, criterio de aceptación y prueba antes de modificar esquema.
- Relacionar cada cambio con una especificación, migración y evidencia de prueba; separar confirmado, propuesto y no ejecutado.
- Entregar el menor cambio coherente con el repositorio. Mantener compatibilidad con las versiones de aplicación que convivan durante despliegue.
- Para cada operación identificar base, entorno y efecto. Proceder con lecturas y cambios ya autorizados. No interpretar una solicitud genérica de pruebas como autorización para borrar datos de producción.

## Seleccionar recursos

- Leer [dominio](references/domain.md) para catálogo, inventario, precios, pedidos, envíos, cobros y facturación.
- Leer [entornos y seguridad](references/environments.md) para conexiones, roles, CI, aislamiento, datos y configuración.
- Leer [migraciones](references/migrations.md) para DDL, backfills, despliegues y reversión.
- Leer [pruebas](references/testing.md) para contratos, integración, carreras, rendimiento y aceptación.
- Leer [operación](references/operations.md) para índices, bloqueos, respaldo, recuperación e incidentes.
- Consultar [fuentes oficiales](references/sources.md) y fijar la versión aplicable al proyecto.
- Usar [diagnostics.sql](assets/diagnostics.sql) únicamente como diagnóstico de lectura; no confundirlo con una auditoría completa ni con una prueba funcional.

## Aplicar reglas transversales

- Parametrizar valores SQL; permitir identificadores dinámicos solo mediante lista explícita y quoting del cliente.
- Proteger invariantes con restricciones y transacciones; no confiar únicamente en validaciones HTTP.
- Usar dinero exacto, moneda explícita, zona horaria y redondeo definido. No usar float para importes ni recalcular pedidos históricos con precios actuales.
- Mantener transacciones breves. No llamar couriers, WhatsApp ni procesadores dentro de una transacción abierta. Usar outbox cuando haya entrega asíncrona que deba coordinarse con el commit.
- Usar una única conexión de transacción en todas sus consultas; comprobar que el cliente no las distribuya entre conexiones del pool.
- Reintentar la transacción completa ante SQLSTATE 40001 o 40P01, con límite y espera variable, solo si los efectos externos son idempotentes o se difieren al commit.
- No volcar secretos, datos personales, cadenas de conexión ni contenido de pagos en logs, documentación, fixtures o Git.
- Usar fixtures sintéticos identificados como DEMO. No copiar producción a test sin autorización y tratamiento de datos definido.
- No ejecutar restauraciones, TRUNCATE, DROP ni migraciones destructivas contra un destino ambiguo. Verificar identidad real, alcance autorizado y recuperación antes de actuar.

## Entregar evidencia

Informar cambios y archivos, entorno y versión verificados, pruebas ejecutadas y resultados, pruebas pendientes, efectos sobre datos y bloqueos, y procedimiento de recuperación. Nunca afirmar que algo está desplegado, restaurado o aprobado por CI a partir de un plan o un mock.
