import { test, expect } from "bun:test";
import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) throw Error("DATABASE_URL required");
const db = new SQL({url,max:5});

test("payment status concurrent confirmation records one transition and audit", async () => {
  await db`DROP SCHEMA IF EXISTS m04_payment_regression CASCADE`;
  await db`CREATE SCHEMA m04_payment_regression`;
  try {
    await db`CREATE TABLE m04_payment_regression.payments(id bigint PRIMARY KEY,status text NOT NULL)`;
    await db`CREATE TABLE m04_payment_regression.payment_status_history(payment_id bigint,from_status text,to_status text)`;
    await db`CREATE TABLE m04_payment_regression.audit_events(payment_id bigint,action text)`;
    await db`INSERT INTO m04_payment_regression.payments VALUES (1,'PENDING')`;
    const confirm = () => db.begin(async tx => {
      await tx`SET LOCAL search_path TO m04_payment_regression`;
      const rows = await tx`SELECT status FROM payments WHERE id=1 FOR UPDATE`;
      if (rows[0].status !== "PENDING") return false;
      await tx`UPDATE payments SET status='PAID' WHERE id=1`;
      await tx`INSERT INTO payment_status_history VALUES (1,'PENDING','PAID')`;
      await tx`INSERT INTO audit_events VALUES (1,'payment.status_changed')`;
      return true;
    });
    const results = await Promise.all([confirm(),confirm()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db`SELECT * FROM m04_payment_regression.payment_status_history`)).toHaveLength(1);
    expect((await db`SELECT * FROM m04_payment_regression.audit_events`)).toHaveLength(1);
  } finally {
    await db`DROP SCHEMA IF EXISTS m04_payment_regression CASCADE`;
  }
});
