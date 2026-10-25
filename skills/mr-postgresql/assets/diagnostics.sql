-- Diagnóstico de lectura. No confirma por sí solo identidad ni entorno.
-- Ejecutar con: psql -X -v ON_ERROR_STOP=1 -f diagnostics.sql
-- Obtener autenticación mediante el gestor de secretos/servicio; no poner URLs en logs.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SELECT current_database() AS database_name,
       current_user AS role_name,
       current_setting('server_version') AS server_version,
       current_setting('transaction_read_only') AS transaction_read_only,
       pg_is_in_recovery() AS is_replica;
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
SELECT state, count(*) AS connections
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY state ORDER BY count(*) DESC;
SELECT pid, state, wait_event_type, wait_event,
       now() - xact_start AS transaction_age,
       pg_blocking_pids(pid) AS blocked_by
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
ORDER BY xact_start NULLS LAST LIMIT 30;
SELECT schemaname, relname, n_live_tup, n_dead_tup,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 20;
COMMIT;
