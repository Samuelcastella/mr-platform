import { overviewSources, type OverviewSourceKey, type OverviewSnapshots } from "./operational-overview";

/**
 * A read-only triage view over the SAME authorized list snapshots used by the
 * home KPI cards. This is not a global task list or an SLA enforcement engine.
 * The API may return at most 100 recent rows per resource and may scope by role.
 */
export type QueuePriority = "urgent" | "high" | "normal";
export type QueueDomain = OverviewSourceKey;
export type QueueItem = Readonly<{
  key: string;
  domain: QueueDomain;
  priority: QueuePriority;
  title: string;
  detail: string;
  destination: string;
  reason: string;
  timestampMs: number | null;
}>;

export type QueueFilter = Readonly<{
  priority?: string;
  domain?: string;
  compact?: boolean;
  limit?: number;
}>;

const PRIORITIES: readonly QueuePriority[] = ["urgent", "high", "normal"];
const NAMES: Record<QueueDomain, string> = {
  health: "Health Desk",
  orders: "Pedidos",
  fulfillment: "Entregas",
  returns: "Devoluciones",
  purchases: "Compras"
};
const PATHS: Record<QueueDomain, string> = {
  health: "/health-desk",
  orders: "/orders",
  fulfillment: "/fulfillment",
  returns: "/returns",
  purchases: "/purchases"
};

function safeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string,string>)[ch]
  );
}

function toPositiveId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) return raw;
  if (typeof raw === "string" && /^[1-9][0-9]{0,14}$/.test(raw)) {
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  return null;
}

function dateMs(raw: unknown): number | null {
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw.getTime() : null;
  if (typeof raw !== "string" || !/^\d{4}-\d\d-\d\d(?:[T ][^<>"\r\n]{4,45})?$/.test(raw))
    return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function label(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim()
    ? raw.trim().slice(0, 100) : fallback;
}

function objectRows(raw: unknown): readonly Record<string, unknown>[] | null {
  return Array.isArray(raw)
    ? raw.slice(0, 100).filter((v): v is Record<string, unknown> =>
        v !== null && typeof v === "object" && !Array.isArray(v))
    : null;
}

function rowsFor(
  snapshots: OverviewSnapshots, domain: QueueDomain
): readonly Record<string, unknown>[] | null {
  const snapshot = snapshots[domain];
  if (!snapshot?.ok || !snapshot.body || typeof snapshot.body !== "object") return null;
  const body = snapshot.body as Record<string, unknown>;
  return objectRows(domain === "health" ? body.incidents : body.data);
}

function addRow(
  result: QueueItem[], seen: Set<string>,
  domain: QueueDomain, row: Record<string, unknown>,
  priority: QueuePriority, title: string, detail: string, reason: string, date: unknown
) {
  const id = toPositiveId(row.id);
  if (id === null) return;
  const key = domain + ":" + id;
  if (seen.has(key)) return;
  seen.add(key);
  result.push({
    key, domain, priority, title: title.slice(0, 100),
    detail: detail.slice(0, 160),
    reason, destination: PATHS[domain], timestampMs: dateMs(date)
  });
}

/** Only actionable, explicitly recognized statuses are surfaced as pending. */
export function buildPriorityQueue(
  permissions: readonly string[], snapshots: OverviewSnapshots
): readonly QueueItem[] {
  const grants = new Set(permissions);
  const items: QueueItem[] = [];
  const seen = new Set<string>();

  for (const source of overviewSources) {
    if (!grants.has(source.permission)) continue;
    const rows = rowsFor(snapshots, source.key);
    if (rows === null) continue;
    for (const row of rows) {
      const status = row.status;
      switch (source.key) {
        case "health": {
          if (!["OPEN", "ACKNOWLEDGED", "INVESTIGATING"].includes(String(status))) break;
          const severity = row.severity;
          const priority: QueuePriority =
            severity === "CRITICAL" && status === "OPEN" ? "urgent" :
            severity === "CRITICAL" || severity === "WARNING" && status === "OPEN" ? "high" : "normal";
          addRow(items, seen, "health", row, priority,
            label(row.incidentNumber, "Incidente #" + String(row.id)),
            label(row.title, "Incidente operativo"),
            status === "OPEN" ? "Incidente sin reconocer" : "Incidente en seguimiento",
            row.createdAt);
          break;
        }
        case "orders": {
          if (status !== "PENDING_CONFIRMATION" && status !== "CONFIRMED") break;
          addRow(items, seen, "orders", row,
            status === "PENDING_CONFIRMATION" ? "high" : "normal",
            label(row.order_number, "Pedido #" + String(row.id)),
            status === "PENDING_CONFIRMATION" ? "Pendiente de confirmación" : "Pedido confirmado",
            status === "PENDING_CONFIRMATION" ? "Revisar confirmación y reserva en Pedidos" :
              "Revisar preparación en Pedidos",
            row.created_at);
          break;
        }
        case "fulfillment": {
          if (!["FAILED", "PENDING", "PREPARING", "READY"].includes(String(status))) break;
          addRow(items, seen, "fulfillment", row,
            status === "FAILED" ? "urgent" : "normal",
            label(row.order_number, "Entrega #" + String(row.id)),
            status === "FAILED" ? "Entrega fallida" :
              status === "PENDING" ? "Pendiente de preparación" :
              status === "PREPARING" ? "En preparación" : "Lista para despacho",
            status === "FAILED" ? "Revisar incidencia de entrega" : "Continuar seguimiento logístico",
            row.created_at);
          break;
        }
        case "returns": {
          if (!["REQUESTED", "APPROVED", "RECEIVED", "INSPECTED"].includes(String(status))) break;
          addRow(items, seen, "returns", row,
            status === "REQUESTED" ? "high" : "normal",
            label(row.returnNumber, "Devolución #" + String(row.id)),
            status === "REQUESTED" ? "Devolución por revisar" :
              status === "APPROVED" ? "Aprobada; esperar recepción" :
              status === "RECEIVED" ? "Pendiente de inspección" : "Inspección pendiente de cierre",
            "Revisar caso en Devoluciones; no supone un reembolso financiero",
            row.requestedAt);
          break;
        }
        case "purchases": {
          if (!["APPROVED", "ORDERED", "PARTIALLY_RECEIVED"].includes(String(status))) break;
          addRow(items, seen, "purchases", row,
            status === "PARTIALLY_RECEIVED" ? "high" : "normal",
            label(row.poNumber, "Compra #" + String(row.id)),
            status === "PARTIALLY_RECEIVED" ? "Recepción parcial" :
              status === "APPROVED" ? "Compra aprobada" : "Compra por recibir",
            status === "APPROVED" ? "Continuar emisión de orden" : "Revisar recepción en Compras",
            row.createdAt);
          break;
        }
      }
    }
  }
  const weights = { urgent: 0, high: 1, normal: 2 };
  return items.sort((a, b) =>
    weights[a.priority] - weights[b.priority] ||
    (a.timestampMs === null ? 1 : b.timestampMs === null ? -1 : a.timestampMs - b.timestampMs) ||
    a.key.localeCompare(b.key)
  );
}

export function priorityQueueCoverage(
  permissions: readonly string[], snapshots: OverviewSnapshots
) {
  const grants = new Set(permissions);
  const permitted = overviewSources.filter(s => grants.has(s.permission));
  return {
    permittedSources: permitted.length,
    unavailableSources: permitted.filter(s => rowsFor(snapshots, s.key) === null)
      .map(s => NAMES[s.key])
  };
}

function selectedPriority(value?: string): QueuePriority | null {
  return value && PRIORITIES.includes(value as QueuePriority) ? value as QueuePriority : null;
}
function selectedDomain(value?: string): QueueDomain | null {
  const values = Object.keys(NAMES);
  return value && values.includes(value) ? value as QueueDomain : null;
}

export function renderPriorityQueue(
  permissions: readonly string[], snapshots: OverviewSnapshots, options: QueueFilter = {}
): string {
  const compact = options.compact === true;
  const priority = selectedPriority(options.priority);
  const domain = selectedDomain(options.domain);
  const max = compact ? 6 :
    Number.isSafeInteger(options.limit) && (options.limit || 0) >= 1
      ? Math.min(options.limit!, 100) : 40;
  const all = buildPriorityQueue(permissions, snapshots);
  const filtered = all.filter(item =>
    (!priority || item.priority === priority) && (!domain || item.domain === domain));
  const visible = filtered.slice(0, max);
  const coverage = priorityQueueCoverage(permissions, snapshots);
  const labels: Record<QueuePriority, string> = {
    urgent: "Urgente", high: "Alta", normal: "Normal"
  };
  const currentUrl = (p: QueuePriority | null, d: QueueDomain | null) => {
    const q = new URLSearchParams();
    if (p) q.set("priority", p);
    if (d) q.set("domain", d);
    return "/work-queue" + (q.size ? "?" + q.toString().replaceAll("&", "&amp;") : "");
  };
  const nav = compact ? "" :
    '<nav class="wq-filters" aria-label="Filtros de pendientes">' +
    '<div class="wq-filter-group" aria-label="Prioridad">' +
    ([null, ...PRIORITIES] as (QueuePriority | null)[]).map(p =>
      '<a class="wq-filter" href="' + currentUrl(p, domain) + '"' +
      (priority === p ? ' aria-current="page"' : "") + '>' +
      (p ? labels[p] : "Todas las prioridades") + '</a>').join("") +
    '</div><div class="wq-filter-group" aria-label="Área">' +
    ([null, ...overviewSources.map(s => s.key)] as (QueueDomain | null)[]).map(d =>
      '<a class="wq-filter" href="' + currentUrl(priority, d) + '"' +
      (domain === d ? ' aria-current="page"' : "") + '>' +
      (d ? NAMES[d] : "Todas las áreas") + '</a>').join("") +
    '</div></nav>';

  const cards = visible.map(item =>
    '<li class="wq-item"><div class="wq-item-head">' +
      '<span class="wq-priority wq-' + item.priority + '">' + labels[item.priority] + '</span>' +
      '<span class="wq-area">' + NAMES[item.domain] + '</span></div>' +
      '<h3>' + safeHtml(item.title) + '</h3>' +
      '<p class="wq-detail">' + safeHtml(item.detail) + '</p>' +
      '<p class="wq-reason">' + safeHtml(item.reason) + '</p>' +
      '<a href="' + item.destination + '" class="wq-open" aria-label="Revisar ' +
      safeHtml(item.title) + ' en ' + NAMES[item.domain] + '">Abrir ' +
      NAMES[item.domain] + ' →</a></li>'
  ).join("");

  const resultCount = '<p class="meta wq-result-count">Mostrando ' + visible.length +
    ' de ' + filtered.length + ' pendientes detectados en los listados consultados.' +
    (coverage.unavailableSources.length ? ' Fuentes no disponibles: ' +
      safeHtml(coverage.unavailableSources.join(", ")) + '.' : "") + '</p>';
  const empty = coverage.permittedSources === 0
    ? "No tienes permisos de consulta para estas bandejas."
    : coverage.unavailableSources.length === coverage.permittedSources
      ? "No se pudieron consultar las bandejas autorizadas."
      : filtered.length === 0
        ? "No se encontraron pendientes con estos filtros en los listados disponibles."
        : "";
  return '<section class="wq-section" aria-labelledby="wq-title">' +
    '<div class="wq-header"><div class="eyebrow">Seguimiento operativo · Solo lectura</div>' +
    (compact ? '<h2 id="wq-title">Pendientes priorizados</h2>' :
      '<h1 id="wq-title">Bandejas de trabajo</h1>') +
    '<p class="meta">Prioridad sugerida por estado, no por SLA ni por saldo financiero. ' +
    'La consulta respeta permisos y puede estar limitada a los últimos 100 registros de cada área.</p></div>' +
    nav + resultCount +
    (cards ? '<ol class="wq-list">' + cards + '</ol>' :
      '<div class="panel wq-empty"><p>' + safeHtml(empty) + '</p></div>') +
    (compact ? '<a class="wq-all" href="/work-queue">Abrir todas las bandejas →</a>' : "") +
    '<p class="wq-caution">Los enlaces abren módulos existentes. No confirman pedidos, ' +
    'no hacen cambios de inventario ni ejecutan pagos o reembolsos.</p></section>';
}
