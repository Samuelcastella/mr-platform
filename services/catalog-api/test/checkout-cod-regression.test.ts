import { test, expect } from "bun:test";
import { handleCheckout } from "../checkout";

const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0,max);

test("COD without a delivery rejects before any checkout/payment insert", async () => {
  const writes: string[] = [];
  const query = async (parts: TemplateStringsArray) => {
    const sql = parts.join("?").replace(/\s+/g," ").trim();
    if (/^(INSERT|UPDATE|DELETE)/.test(sql)) { writes.push(sql); throw Error("unexpected_write"); }
    if (sql.includes("FROM checkout_sessions")) return [];
    if (sql.includes("FROM orders")) return [{
      id:1, public_token:"order-token", order_number:"MR-TEST", status:"PENDING_CONFIRMATION",
      currency:"HNL", grand_total_minor:12000
    }];
    if (sql.includes("FROM fulfillments")) return [];
    throw Error("unexpected_sql: "+sql);
  };
  const db: any = Object.assign(query, {begin: async (fn: any) => fn(query)});
  const req = new Request("http://localhost/v1/checkouts", {
    method:"POST", headers:{"idempotency-key":"cod-invalid-123","content-type":"application/json"},
    body:JSON.stringify({orderId:1,orderToken:"order-token",paymentMethod:"CASH_ON_DELIVERY"})
  });
  const response = await handleCheckout(req,new URL(req.url),db,clean);
  expect(response?.status).toBe(409);
  expect((await response!.json()).error).toBe("cod_requires_delivery");
  expect(writes).toHaveLength(0);
});
