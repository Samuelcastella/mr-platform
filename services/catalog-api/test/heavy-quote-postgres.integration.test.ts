import { test, expect } from "bun:test";
import { SQL } from "bun";
import { acceptHeavyQuoteInTx } from "../heavy-quote-acceptance";

const url = process.env.DATABASE_URL;
if (!url) throw Error("DATABASE_URL required for PostgreSQL integration test");
const db = new SQL({ url, max: 5 });

test("real acceptance function serializes competing transactions and preserves payment guard", async () => {
  await db`DROP SCHEMA IF EXISTS m04_acceptance_integration CASCADE`;
  await db`CREATE SCHEMA m04_acceptance_integration`;
  // Dedicated tables with the exact columns queried by the production helper.
  await db`CREATE TABLE m04_acceptance_integration.orders(
    id bigint PRIMARY KEY, public_token text, status text, currency text,
    subtotal_minor bigint, discount_total_minor bigint, tax_total_minor bigint,
    shipping_total_minor bigint DEFAULT 0, grand_total_minor bigint DEFAULT 0, updated_at timestamptz)`;
  await db`CREATE TABLE m04_acceptance_integration.heavy_logistics_quotes(
    id bigint PRIMARY KEY, order_id bigint, variant_id bigint, status text,
    currency text, shipping_minor bigint, expires_at timestamptz, accepted_at timestamptz)`;
  await db`CREATE UNIQUE INDEX one_accepted_per_order ON m04_acceptance_integration.heavy_logistics_quotes(order_id) WHERE status='ACCEPTED'`;
  await db`CREATE TABLE m04_acceptance_integration.order_items(order_id bigint,variant_id bigint,quantity int)`;
  await db`CREATE TABLE m04_acceptance_integration.heavy_logistics_quote_lines(quote_id bigint,variant_id bigint,quantity int,shipping_minor bigint)`;
  await db`CREATE TABLE m04_acceptance_integration.checkout_sessions(id bigint,order_id bigint)`;
  await db`CREATE TABLE m04_acceptance_integration.fulfillments(id bigint,order_id bigint)`;
  await db`INSERT INTO m04_acceptance_integration.orders(id,public_token,status,currency,subtotal_minor,discount_total_minor,tax_total_minor)
    VALUES(1,'test-token','PENDING_CONFIRMATION','HNL',10000,0,0)`;
  await db`INSERT INTO m04_acceptance_integration.order_items VALUES(1,3,2),(1,4,1)`;
  await db`INSERT INTO m04_acceptance_integration.heavy_logistics_quotes VALUES
    (10,1,3,'DRAFT','HNL',1000,NOW()+interval '1 hour',NULL),
    (20,1,3,'DRAFT','HNL',2000,NOW()+interval '1 hour',NULL)`;
  await db`INSERT INTO m04_acceptance_integration.heavy_logistics_quote_lines VALUES
    (10,3,2,600),(10,4,1,400),(20,3,2,1200),(20,4,1,800)`;
  // Each transaction has its own connection and its own search_path.
  const accept = (quoteId: number) => db.begin(async tx => {
    await tx`SET LOCAL search_path TO m04_acceptance_integration`;
    return acceptHeavyQuoteInTx(tx, 1, quoteId, "test-token");
  });
  const results = await Promise.all([accept(10), accept(20)]);
  expect(results.filter((r: any) => r.accepted && !r.replayed)).toHaveLength(1);
  expect(results.filter((r: any) => r.error === "another_quote_accepted")).toHaveLength(1);
  const accepted = await db`SELECT id, shipping_minor FROM m04_acceptance_integration.heavy_logistics_quotes WHERE status='ACCEPTED'`;
  expect(accepted).toHaveLength(1);
  const order = await db`SELECT shipping_total_minor,grand_total_minor FROM m04_acceptance_integration.orders WHERE id=1`;
  expect(Number(order[0].shipping_total_minor)).toBe(Number(accepted[0].shipping_minor));
  expect(Number(order[0].grand_total_minor)).toBe(10000 + Number(accepted[0].shipping_minor));
  // A payment/checkout started before quote acceptance must prevent new acceptance.
  await db`INSERT INTO m04_acceptance_integration.orders(id,public_token,status,currency,subtotal_minor,discount_total_minor,tax_total_minor)
    VALUES(2,'paid-token','PENDING_CONFIRMATION','HNL',10000,0,0)`;
  await db`INSERT INTO m04_acceptance_integration.order_items VALUES(2,3,1)`;
  await db`INSERT INTO m04_acceptance_integration.heavy_logistics_quotes VALUES
    (30,2,3,'DRAFT','HNL',1000,NOW()+interval '1 hour',NULL)`;
  await db`INSERT INTO m04_acceptance_integration.checkout_sessions VALUES(1,2)`;
  const blocked = await db.begin(async tx => {
    await tx`SET LOCAL search_path TO m04_acceptance_integration`;
    return acceptHeavyQuoteInTx(tx,2,30,"paid-token");
  });
  expect(blocked.error).toBe("checkout_started");
  const paid = await db`SELECT shipping_total_minor FROM m04_acceptance_integration.orders WHERE id=2`;
  expect(Number(paid[0].shipping_total_minor)).toBe(0);
  await db`DROP SCHEMA m04_acceptance_integration CASCADE`;
});
