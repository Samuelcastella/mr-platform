import { test, expect } from "bun:test";
import { SQL } from "bun";

// Isolated transaction-level test for expiry and idempotent release.
// Requires the same explicit disposable database settings as inventory-race.test.ts.
const enabled = Bun.env.RUN_INVENTORY_RACE === "1";
const url = Bun.env.INVENTORY_RACE_DATABASE_URL;

test.skipIf(!enabled)("concurrent expiry workers release a reservation only once", async () => {
  if (!url) throw new Error("INVENTORY_RACE_DATABASE_URL is required");
  const db = new SQL(url);
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const stock = "expiry_stock_" + suffix;
  const reservation = "expiry_reservation_" + suffix;
  try {
    await db.unsafe("CREATE TABLE " + stock + " (id integer PRIMARY KEY, quantity integer NOT NULL, reserved integer NOT NULL CHECK (reserved >= 0 AND reserved <= quantity))");
    await db.unsafe("CREATE TABLE " + reservation + " (id integer PRIMARY KEY, status text NOT NULL, quantity integer NOT NULL)");
    await db.unsafe("INSERT INTO " + stock + " VALUES (1, 1, 1)");
    await db.unsafe("INSERT INTO " + reservation + " VALUES (1, 'ACTIVE', 1)");
    const attempts = await Promise.allSettled(Array.from({ length: 2 }, () => db.begin(async tx => {
      const rows = await tx.unsafe("SELECT status, quantity FROM " + reservation + " WHERE id = 1 FOR UPDATE");
      if (rows[0].status !== "ACTIVE") return false;
      await tx.unsafe("UPDATE " + stock + " SET reserved = reserved - 1 WHERE id = 1 AND reserved >= 1");
      await tx.unsafe("UPDATE " + reservation + " SET status = 'EXPIRED' WHERE id = 1");
      return true;
    })));
    expect(attempts.filter(r => r.status === "rejected")).toHaveLength(0);
    expect(attempts.filter(r => r.status === "fulfilled" && r.value === true)).toHaveLength(1);
    const rows = await db.unsafe("SELECT quantity, reserved FROM " + stock + " WHERE id = 1");
    expect(Number(rows[0].quantity)).toBe(1);
    expect(Number(rows[0].reserved)).toBe(0);
  } finally {
    await db.unsafe("DROP TABLE IF EXISTS " + reservation);
    await db.unsafe("DROP TABLE IF EXISTS " + stock);
    await db.close();
  }
});
