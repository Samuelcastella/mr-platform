import { workspaceModules } from "./workspace-flow-map";

/**
 * Administrative home overview. Uses existing read-only Commerce Core endpoints;
 * returned list counts are *visible-list counts*, never global totals.
 * No client-provided data is trusted as HTML and no write route is exposed.
 */
export type OverviewSourceKey = "health" | "orders" | "fulfillment" | "returns" | "purchases";

export type OverviewSnapshot = Readonly<{
  ok: boolean;
  body?: unknown;
}>;

export type OverviewSnapshots = Partial<Record<OverviewSourceKey, OverviewSnapshot>>;

export const overviewSources: ReadonlyArray<Readonly<{
  key: OverviewSourceKey;
  permission: string;
  apiPath: string;
}>> = [
  { key: "health", permission: "health.read", apiPath: "/v1/internal/health-desk" },
  { key: "orders", permission: "orders.read", apiPath: "/v1/internal/orders" },
  { key: "fulfillment", permission: "fulfillment.read", apiPath: "/v1/internal/fulfillments" },
  { key: "returns", permission: "returns.read", apiPath: "/v1/internal/returns" },
  { key: "purchases", permission: "procurement.read", apiPath: "/v1/internal/procurement/purchase-orders" }
];

export async function loadOperationalSnapshots(
  permissions: readonly string[],
  read: (path: string) => Promise<OverviewSnapshot>
): Promise<OverviewSnapshots> {
  const grants = new Set(permissions);
  const enabled = overviewSources.filter(source => grants.has(source.permission));
  const results = await Promise.all(enabled.map(async source => {
    try {
      const response = await read(source.apiPath);
      return [source.key, response && response.ok === true ?
        { ok: true, body: response.body } : { ok: false }] as const;
    } catch {
      return [source.key, { ok: false }] as const;
    }
  }));
  return Object.fromEntries(results) as OverviewSnapshots;
}

function safeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string,string>)[ch]
  );
}

function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : typeof value === "string" && /^(0|[1-9][0-9]{0,12})$/.test(value) &&
      Number.isSafeInteger(Number(value)) ? Number(value) : null;
}

function readList(snapshot?: OverviewSnapshot): readonly Record<string, unknown>[] | null {
  if (!snapshot?.ok || typeof snapshot.body !== "object" || snapshot.body === null) return null;
  const data = (snapshot.body as Record<string, unknown>).data;
  return Array.isArray(data) ? data.filter((row): row is Record<string, unknown> =>
    row !== null && typeof row === "object" && !Array.isArray(row)) : null;
}

function countStatus(snapshot: OverviewSnapshot | undefined, statuses: readonly string[]): number | null {
  const rows = readList(snapshot);
  if (!rows) return null;
  return rows.filter(row => statuses.includes(row.status as string)).length;
}

type Metric = Readonly<{
  key: string;
  permission: string;
  label: string;
  count: number | null;
  href: string;
  scope: string;
}>;

export function operationalMetrics(
  permissions: readonly string[], snapshots: OverviewSnapshots
): readonly Metric[] {
  const grants = new Set(permissions);
  const health = snapshots.health;
  const summary = health?.ok && health.body && typeof health.body === "object" ?
    (health.body as Record<string, unknown>).summary : null;
  const safeSummary = summary && typeof summary === "object" ?
    summary as Record<string, unknown> : null;
  const metrics: Metric[] = [
    {
      key: "incidents", permission: "health.read", label: "Incidentes abiertos",
      count: safeSummary ? safeCount(safeSummary.openIncidents) : null,
      href: "/health-desk", scope: "Resumen del Health Desk"
    },
    {
      key: "critical", permission: "health.read", label: "Señales críticas",
      count: safeSummary ? safeCount(safeSummary.criticalSignals) : null,
      href: "/health-desk", scope: "Resumen del Health Desk"
    },
    {
      key: "orders", permission: "orders.read", label: "Pedidos en gestión",
      count: countStatus(snapshots.orders, ["PENDING_CONFIRMATION", "CONFIRMED", "PROCESSING"]),
      href: "/orders", scope: "En el listado consultado"
    },
    {
      key: "fulfillment", permission: "fulfillment.read", label: "Entregas por preparar",
      count: countStatus(snapshots.fulfillment, ["PENDING", "PREPARING", "READY"]),
      href: "/fulfillment", scope: "En el listado consultado"
    },
    {
      key: "returns", permission: "returns.read", label: "Devoluciones solicitadas",
      count: countStatus(snapshots.returns, ["REQUESTED"]),
      href: "/returns", scope: "En el listado consultado"
    },
    {
      key: "purchases", permission: "procurement.read", label: "Compras por recibir",
      count: countStatus(snapshots.purchases, ["ORDERED", "PARTIALLY_RECEIVED"]),
      href: "/purchases", scope: "En el listado consultado"
    }
  ];
  return metrics.filter(metric => grants.has(metric.permission));
}

export function renderOperationalOverview(
  permissions: readonly string[], snapshots: OverviewSnapshots
): string {
  const metrics = operationalMetrics(permissions, snapshots);
  const grants = new Set(permissions);
  const cards = metrics.map(metric => {
    const value = metric.count === null ? "—" : String(metric.count);
    const hint = metric.count === null ? "No disponible o sin acceso en esta ubicación" : metric.scope;
    return '<a class="ov-metric" href="' + metric.href + '" aria-label="Abrir ' +
      safeHtml(metric.label) + '"><span class="ov-label">' + safeHtml(metric.label) +
      '</span><strong class="ov-value">' + value + '</strong><span class="ov-context">' +
      safeHtml(hint) + '</span></a>';
  }).join("");

  const alertMetrics = metrics.filter(metric => metric.count !== null && metric.count > 0 &&
    ["critical", "incidents", "returns", "purchases"].includes(metric.key));
  const alerts = alertMetrics.map(metric =>
    '<li><a href="' + metric.href + '"><strong>' + metric.count + '</strong> · ' +
    safeHtml(metric.label) + ' — revisar en el módulo</a></li>'
  ).join("");

  const priorityModules = [
    "orders", "fulfillment", "returns", "purchases", "inventory",
    "health", "catalog", "sourcing", "production", "quality",
    "intelligence", "assortment"
  ];
  const shortcutItems = priorityModules.map(id => workspaceModules.find(module => module.id === id))
    .filter((module): module is (typeof workspaceModules)[number] => Boolean(module) &&
      grants.has(module.readPermission))
    .slice(0, 8);
  const shortcuts = shortcutItems.map(module =>
    '<a class="ov-shortcut" href="' + module.path + '">' + safeHtml(module.label) +
    ' <span aria-hidden="true">↗</span></a>'
  ).join("");

  return '<section class="ov-overview" aria-labelledby="ov-title">' +
    '<div class="eyebrow">MR Adulán · Centro de operaciones</div>' +
    '<h1 id="ov-title">Resumen de trabajo</h1>' +
    '<p class="meta">Datos consultados al abrir esta página. Los listados pueden estar limitados por ' +
    'paginación, permisos y ubicación; no son totales globales.</p>' +
    (cards ? '<div class="ov-grid" aria-label="Indicadores operativos">' + cards + '</div>' :
      '<div class="panel"><p>No hay indicadores habilitados para este usuario. ' +
      'Consulta el mapa para revisar los módulos.</p></div>') +
    '<div class="ov-columns"><section class="panel" aria-labelledby="ov-alerts">' +
    '<h2 id="ov-alerts">Avisos para revisar</h2>' +
    (alerts ? '<ul class="ov-alerts">' + alerts + '</ul>' :
      '<p class="meta">Sin avisos en los indicadores consultados. ' +
      'Una fuente no disponible no significa que esté sin incidencias.</p>') +
    '</section><section class="panel" aria-labelledby="ov-shortcuts">' +
    '<h2 id="ov-shortcuts">Accesos rápidos</h2>' +
    (shortcuts ? '<div class="ov-shortcuts">' + shortcuts + '</div>' :
      '<p class="meta">No hay accesos de lectura autorizados.</p>') +
    '<a class="ov-map" href="/workspace">Ver mapa completo de procesos →</a>' +
    '</section></div></section>';
}
