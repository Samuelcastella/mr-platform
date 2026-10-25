# Diagnóstico, rendimiento y recuperación

## Lectura inicial

Ejecutar assets/diagnostics.sql con psql -X y ON_ERROR_STOP o adaptar las consultas al cliente real. Revisar permisos antes de ampliar observabilidad. El archivo no muestra textos de consultas ni secretos y limita sus resultados; no sustituye telemetría histórica.

Medir consultas frecuentes/lentas y distribución de datos. Empezar con EXPLAIN sin ANALYZE en producción; EXPLAIN ANALYZE ejecuta la sentencia y puede modificar datos o generar carga. Probarlo sobre copia representativa o dentro del alcance operativo autorizado.

Revisar índices que cubran filtros, joins y ordenamiento reales; FK no garantiza índice en columnas del lado referenciante. Evaluar costo de escritura y tamaño antes de añadir índices. Verificar estadísticas, autovacuum, tuplas muertas, transacciones largas, saturación de pool, I/O y replica lag cuando haya réplicas. No eliminar índices a partir de una sola ventana de estadísticas.

Ante bloqueos, identificar bloqueador y operación comercial antes de cancelar. No terminar sesiones, VACUUM FULL, REINDEX ni cambiar configuración global por defecto. Preparar efecto, ventana y autorización aplicable. Distinguir degradación de consulta de un problema de capacidad.

## Respaldo y restauración

1. Acordar RPO (pérdida de datos tolerada), RTO (tiempo de recuperación) y retención con el usuario/operación; identificarlos como pendientes si no existen.
2. Verificar respaldo lógico o físico y, si se requiere recuperación a un instante, disponibilidad real de base backup y cadena WAL/PITR. Un dump aislado no ofrece PITR.
3. Registrar versión del servidor y herramientas. pg_dump no debe ser más antiguo que el mayor del servidor origen; comprobar compatibilidad de destino y extensiones, no asumir downgrade.
4. Proteger copias con cifrado, controles de acceso y retención. Incluir estrategia para roles/privilegios, extensiones, configuración y adjuntos externos, según alcance. No subir dumps al repositorio.
5. Restaurar primero en un destino aislado verificado; no sobreescribir producción para probar un respaldo.
6. Verificar esquema, conteos por dominio, FK, totales, conciliación de inventario, idempotencia y humo de API; medir RTO y comprobar punto recuperado frente a RPO.
7. Documentar conexiones de aplicación, rotación de secretos y conciliación de efectos externos posteriores al punto recuperado antes de una recuperación real.

Para un upgrade mayor probar extensiones, collation, drivers y estrategia pg_upgrade o dump/restore según soporte y proveedor. Ensayar y medir ventana; no mezclar upgrade mayor con un cambio comercial innecesariamente.
