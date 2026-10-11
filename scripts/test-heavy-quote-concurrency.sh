#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to an isolated PostgreSQL test database}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS m04_concurrency_test CASCADE;
CREATE SCHEMA m04_concurrency_test;
CREATE TABLE m04_concurrency_test.orders(id bigint PRIMARY KEY, shipping_total_minor bigint NOT NULL DEFAULT 0, grand_total_minor bigint NOT NULL DEFAULT 10000);
INSERT INTO m04_concurrency_test.orders(id) VALUES (1);
CREATE TABLE m04_concurrency_test.heavy_logistics_quotes(
 id bigint PRIMARY KEY, order_id bigint NOT NULL REFERENCES m04_concurrency_test.orders(id),
 status text NOT NULL DEFAULT 'DRAFT', shipping_minor bigint NOT NULL);
CREATE UNIQUE INDEX one_accepted_quote ON m04_concurrency_test.heavy_logistics_quotes(order_id) WHERE status='ACCEPTED';
INSERT INTO m04_concurrency_test.heavy_logistics_quotes(id,order_id,shipping_minor)
 VALUES (10,1,1000),(20,1,2000);
SQL
# Both sessions lock the order before reading competing accepted quotes.
# The first holds the lock long enough to force the second to wait.
run_accept() {
  local quote="$1" delay="$2"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v q="$quote" -v delay="$delay" <<'SQL'
BEGIN;
SET LOCAL search_path = m04_concurrency_test;
SELECT id FROM orders WHERE id=1 FOR UPDATE;
SELECT pg_sleep(:delay);
DO $block$
DECLARE q bigint := current_setting('m04.quote_id')::bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM heavy_logistics_quotes WHERE order_id=1 AND status='ACCEPTED') THEN
   RETURN;
 END IF;
 UPDATE orders SET shipping_total_minor=(SELECT shipping_minor FROM heavy_logistics_quotes WHERE id=q),
   grand_total_minor=10000+(SELECT shipping_minor FROM heavy_logistics_quotes WHERE id=q) WHERE id=1;
 UPDATE heavy_logistics_quotes SET status='ACCEPTED' WHERE id=q;
END
$block$;
COMMIT;
SQL
}
# Session-local quote ID is set via psql substitution, not client SQL identifiers.
run_accept() {
  local quote="$1" delay="$2"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v q="$quote" -v delay="$delay" <<'SQL'
BEGIN;
SET LOCAL search_path = m04_concurrency_test;
SELECT set_config('m04.quote_id', :'q', true);
SELECT id FROM orders WHERE id=1 FOR UPDATE;
SELECT pg_sleep(:delay);
DO $block$
DECLARE q bigint := current_setting('m04.quote_id')::bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM heavy_logistics_quotes WHERE order_id=1 AND status='ACCEPTED') THEN
   RETURN;
 END IF;
 UPDATE orders SET shipping_total_minor=(SELECT shipping_minor FROM heavy_logistics_quotes WHERE id=q),
   grand_total_minor=10000+(SELECT shipping_minor FROM heavy_logistics_quotes WHERE id=q) WHERE id=1;
 UPDATE heavy_logistics_quotes SET status='ACCEPTED' WHERE id=q;
END
$block$;
COMMIT;
SQL
}
run_accept 10 1 >/dev/null &
first=$!
sleep 0.1
run_accept 20 0 >/dev/null &
second=$!
wait "$first"
wait "$second"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
DO $verify$
DECLARE accepted_count int; total bigint; shipping bigint;
BEGIN
 SELECT count(*) INTO accepted_count FROM m04_concurrency_test.heavy_logistics_quotes WHERE status='ACCEPTED';
 SELECT grand_total_minor,shipping_total_minor INTO total,shipping FROM m04_concurrency_test.orders WHERE id=1;
 IF accepted_count <> 1 OR total <> 11000 OR shipping <> 1000 THEN
  RAISE EXCEPTION 'concurrency violation: accepted %, total %, shipping %', accepted_count,total,shipping;
 END IF;
END
$verify$;
SQL
echo "PASS: one accepted quote; order charged exactly once"
