import { test, expect } from "bun:test";
import { SQL } from "bun";

// Run only against a disposable PostgreSQL test database:
// RUN_INVENTORY_RACE=1 INVENTORY_RACE_DATABASE_URL=postgres://... bun test inventory-race.test.ts
// Never point this test at a shared staging or production database.
const enabled = Bun.env.RUN_INVENTORY_RACE === "1";
const url = Bun.env.INVENTORY_RACE_DATABASE_URL;

test.skipIf(!enabled)("50 concurrent buyers cannot reserve the final unit", async () => {
  if (!url) throw new Error("INVENTORY_RACE_DATABASE_URL is required");
  const db = new SQL(url);
  const table = "inventory_race_" + crypto.randomUUID().replaceAll("-", "");
  try {
    await db.unsafe("CREATE TABLE " + table + " (id integer PRIMARY KEY, quantity integer NOT NULL CHECK (quantity >= 0), reserved integer NOT NULL CHECK (reserved >= 0 AND reserved <= quantity))");
    await db.unsafe("INSERT INTO " + table + " (id, quantity, reserved) VALUES (1, 1, 0)");
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        db.begin(async (tx) => {
          const rows = await tx.unsafe("SELECT quantity, reserved FROM " + table + " WHERE id = 1 FOR UPDATE");
          if (Number(rows[0].quantity) - Number(rows[0].reserved) < 1) return false;
          const updated = await tx.unsafe("UPDATE " + table + " SET reserved = reserved + 1 WHERE id = 1 AND reserved < quantity RETURNING id");
          return updated.length === 1;
        })
      )
    );
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(0);
    expect(results.filter((r) => r.status === "fulfilled" && r.value === true)).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled" && r.value === false)).toHaveLength(49);
    const stock = await db.unsafe("SELECT quantity, reserved FROM " + table + " WHERE id = 1");
    expect(Number(stock[0].quantity)).toBe(1);
    expect(Number(stock[0].reserved)).toBe(1);
  } finally {
    await db.unsafe("DROP TABLE IF EXISTS " + table);
    await db.close();
  }
});
