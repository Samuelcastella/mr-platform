-- Real PostgreSQL concurrency regression: two sessions compete for one order.
-- Run with: bash scripts/test-heavy-quote-concurrency.sh
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TEMP TABLE IF NOT EXISTS concurrency_results (winner TEXT, shipping BIGINT);
