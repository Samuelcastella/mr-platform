import { SQL } from "bun";

/**
 * M15 isolated financing database connection.
 * Never falls back to the commerce database: an absent financing URL disables
 * database-backed M15 features without touching orders, stock, or payments.
 */
let financingDb: SQL | null = null;

export function getFinancingDb(): SQL | null {
  const url = Bun.env.FINANCING_DATABASE_URL;
  if (!url) return null;
  if (!financingDb) {
    financingDb = new SQL(url);
  }
  return financingDb;
}

export async function getFinancingSchemaStatus(): Promise<{
  connected: boolean;
  schemaReady: boolean;
  tables: string[];
}> {
  const db = getFinancingDb();
  if (!db) return { connected: false, schemaReady: false, tables: [] };
  const rows = await db`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'financing'
      AND table_name IN ('providers', 'offer_versions', 'quotes',
                         'applications', 'provider_events', 'audit_events')
    ORDER BY table_name
  `;
  const tables = rows.map((row) => String(row.table_name));
  return { connected: true, schemaReady: tables.length === 6, tables };
}
