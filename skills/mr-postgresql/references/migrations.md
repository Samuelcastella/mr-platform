# Migraciones y despliegue

## Antes del cambio

Identificar ejecutor, ledger y checksum de migraciones, quién las ejecuta y cómo evita ejecuciones simultáneas. Inspeccionar versión, tablas afectadas, volumen, dependencias, réplica y permisos. Estimar bloqueos con datos representativos; configurar lock_timeout y statement_timeout específicos para el cambio.

## Expandir, migrar, contraer

1. Añadir estructuras compatibles y probar aplicaciones antigua/nueva.
2. Hacer backfill por lotes con clave estable y checkpoint; limitar presión y validar conteos e invariantes. Evitar transacciones gigantes.
3. Activar escritura/lectura nuevas con estrategia explícita para escrituras concurrentes y reconciliación.
4. Validar restricciones y resultados antes de eliminar columnas o rutas antiguas en otra entrega.

Añadir CHECK/foreign key como NOT VALID y luego VALIDATE cuando corresponda y sea compatible con la versión y operación. No asumir que toda clase de constraint admite NOT VALID. Revisar el lock real de cada ALTER TABLE.

CREATE INDEX CONCURRENTLY requiere una fase fuera del bloque de transacción. Comprobar índices inválidos tras fallos y limpiarlos/reintentarlos con un plan explícito. No envolver automáticamente todo archivo SQL en BEGIN.

## Validación

- Migrar una base vacía y una de la versión anterior; comparar esquema esperado y ledger.
- Verificar compatibilidad, integridad, roles y planes de consulta.
- Probar fallo intermedio, reanudación de backfill y exclusión de migradores concurrentes.
- No modificar migraciones ya aplicadas; agregar una nueva salvo convención explícita del repositorio.
- No afirmar que una migración es idempotente porque usa IF NOT EXISTS: comprobar definición, estado y ledger.

## Recuperación

Distinguir rollback de código, migración compensatoria y restauración de datos. Un down que borra una columna no recupera datos. Preferir corrección hacia adelante cuando preserve integridad. Para cambios irreversibles preparar backup recuperable, ensayo de restauración y ventana operativa dentro del alcance autorizado. Documentar pérdidas y reconciliación previstas; no ejecutar automáticamente down ni restore en producción.
