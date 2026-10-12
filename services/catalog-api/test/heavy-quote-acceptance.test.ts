import { test, expect } from "bun:test";
import { acceptHeavyQuoteInTx } from "../heavy-quote-acceptance";

const order = { id: 1, public_token: "token", status: "PENDING_CONFIRMATION",
  currency: "HNL", subtotal_minor: 10000, discount_total_minor: 1000, tax_total_minor: 1350 };
const quote = { id: 7, variant_id: 3, status: "DRAFT", currency: "HNL", shipping_minor: 2000,
  expires_at: "2099-01-01T00:00:00Z" };
function mockTx(options: { order?: any; quote?: any; checkout?: boolean; fulfillment?: boolean; other?: boolean; lines?: any[]; snapshots?: any[] } = {}) {
  const writes: string[] = [];
  const tx = async (parts: TemplateStringsArray) => {
    const sql = parts.join("?").replace(/\s+/g, " ");
    if (sql.startsWith("SELECT id, public_token")) return options.order === null ? [] : [options.order ?? order];
    if (sql.startsWith("SELECT id, variant_id, status, currency")) return options.quote === null ? [] : [options.quote ?? quote];
    if (sql.includes("FROM heavy_logistics_quote_lines")) return options.snapshots ?? [];
    if (sql.includes("FROM order_items")) return options.lines ?? [{ variant_id: 3, quantity: 1 }];
    if (sql.includes("FROM checkout_sessions")) return options.checkout ? [{ id: 1 }] : [];
    if (sql.includes("FROM fulfillments")) return options.fulfillment ? [{ id: 1 }] : [];
    if (sql.startsWith("UPDATE")) { writes.push(sql); return []; }
    if (sql.includes("status = 'ACCEPTED'")) return options.other ? [{ id: 2 }] : [];
    throw Error("unexpected SQL: " + sql);
  };
  return { tx, writes };
}
test("accepts and updates order and quote once", async () => {
  const { tx, writes } = mockTx();
  expect(await acceptHeavyQuoteInTx(tx, 1, 7, "token")).toEqual({
    accepted: true, replayed: false, shippingMinor: 2000, grandTotalMinor: 12350
  });
  expect(writes).toHaveLength(2);
});
test("rejects expired quote without writes", async () => {
  const { tx, writes } = mockTx({ quote: { ...quote, expires_at: "2020-01-01T00:00:00Z" } });
  expect((await acceptHeavyQuoteInTx(tx, 1, 7, "token")).error).toBe("quote_unavailable");
  expect(writes).toHaveLength(0);
});
test("rejects checkout started without writes", async () => {
  const { tx, writes } = mockTx({ checkout: true });
  expect((await acceptHeavyQuoteInTx(tx, 1, 7, "token")).error).toBe("checkout_started");
  expect(writes).toHaveLength(0);
});
test("rejects prior fulfillment without writes", async () => {
  const { tx, writes } = mockTx({ fulfillment: true });
  expect((await acceptHeavyQuoteInTx(tx, 1, 7, "token")).error).toBe("fulfillment_exists");
  expect(writes).toHaveLength(0);
});
test("rejects another accepted quote without writes", async () => {
  const { tx, writes } = mockTx({ other: true });
  expect((await acceptHeavyQuoteInTx(tx, 1, 7, "token")).error).toBe("another_quote_accepted");
  expect(writes).toHaveLength(0);
});
test("rejects incorrect order token without writes", async () => {
  const { tx, writes } = mockTx();
  expect((await acceptHeavyQuoteInTx(tx, 1, 7, "wrong")).error).toBe("order_not_found");
  expect(writes).toHaveLength(0);
});

test("rejects multiple order items without changing totals", async () => {
  const { tx, writes } = mockTx({ lines: [{ variant_id: 3, quantity: 1 }, { variant_id: 4, quantity: 1 }] });
  expect((await acceptHeavyQuoteInTx(tx, 1, 7, "token")).error).toBe("heavy_quote_order_coverage_required");
  expect(writes).toHaveLength(0);
});
test("rejects multiple units or mismatched variants without changing totals", async () => {
  for (const lines of [[{ variant_id: 3, quantity: 2 }], [{ variant_id: 4, quantity: 1 }]]) {
    const { tx, writes } = mockTx({ lines });
    expect((await acceptHeavyQuoteInTx(tx, 1, 7, "token")).error).toBe("heavy_quote_order_coverage_required");
    expect(writes).toHaveLength(0);
  }
});

test("accepts matching multi-line snapshot with exact shipping sum", async () => {
  const { tx, writes } = mockTx({
    lines: [{ variant_id: 3, quantity: 2 }, { variant_id: 4, quantity: 1 }],
    snapshots: [{ variant_id: 3, quantity: 2, shipping_minor: 1500 },
                { variant_id: 4, quantity: 1, shipping_minor: 500 }]
  });
  expect((await acceptHeavyQuoteInTx(tx, 1, 7, "token")).accepted).toBe(true);
  expect(writes).toHaveLength(2);
});
test("rejects stale quantities and tampered consolidated totals", async () => {
  for (const snapshots of [
    [{ variant_id: 3, quantity: 1, shipping_minor: 2000 }],
    [{ variant_id: 3, quantity: 2, shipping_minor: 1999 }]
  ]) {
    const { tx, writes } = mockTx({ lines: [{ variant_id: 3, quantity: 2 }], snapshots });
    expect((await acceptHeavyQuoteInTx(tx, 1, 7, "token")).error).toBeTruthy();
    expect(writes).toHaveLength(0);
  }
});
