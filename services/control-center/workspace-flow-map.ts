/**
 * Read-only Control Center workflow map.
 * A link is shown only when the authenticated StaffUser has the corresponding
 * read permission. The Commerce Core still authorizes every endpoint and write.
 * Availability here means navigation access, not that an integration is live.
 */
export type WorkspaceModule = Readonly<{
  id: string;
  label: string;
  path: string;
  readPermission: string;
  description: string;
}>;

export type WorkspaceFlow = Readonly<{
  id: string;
  title: string;
  description: string;
  modules: readonly string[];
}>;

export const workspaceModules: readonly WorkspaceModule[] = [
  { id: "catalog", label: "Catálogo", path: "/catalog", readPermission: "catalog.read", description: "Productos, variantes y fichas" },
  { id: "orders", label: "Pedidos", path: "/orders", readPermission: "orders.read", description: "Consultar estados de pedidos" },
  { id: "fulfillment", label: "Entregas", path: "/fulfillment", readPermission: "fulfillment.read", description: "Preparación y despacho" },
  { id: "returns", label: "Devoluciones", path: "/returns", readPermission: "returns.read", description: "Casos de devolución" },
  { id: "suppliers", label: "Proveedores", path: "/suppliers", readPermission: "suppliers.read", description: "Relaciones y expedientes" },
  { id: "sourcing", label: "Sourcing", path: "/sourcing", readPermission: "suppliers.read", description: "Ofertas y abastecimiento" },
  { id: "purchases", label: "Compras", path: "/purchases", readPermission: "procurement.read", description: "Órdenes y recepciones" },
  { id: "inventory", label: "Inventario y ajustes", path: "/inventory-adjustments", readPermission: "inventory_adjustments.read", description: "Solicitudes y auditoría Kardex" },
  { id: "traceability", label: "Trazabilidad", path: "/traceability", readPermission: "provenance.read", description: "Origen y movimientos" },
  { id: "manufacturers", label: "Fabricantes", path: "/manufacturers", readPermission: "manufacturers.read", description: "Registro de fabricación" },
  { id: "specifications", label: "Especificaciones", path: "/product-specifications", readPermission: "product_specs.read", description: "Versiones de fichas técnicas" },
  { id: "production", label: "Producción", path: "/production", readPermission: "production_runs.read", description: "Lotes y corridas" },
  { id: "quality", label: "Calidad", path: "/quality-control", readPermission: "quality.read", description: "Inspecciones y defectos" },
  { id: "landed-cost", label: "Costeo", path: "/landed-cost", readPermission: "landed_cost.read", description: "Costos puestos en bodega" },
  { id: "health", label: "Health Desk", path: "/health-desk", readPermission: "health.read", description: "Diagnóstico de operación" },
  { id: "assortment", label: "Decisiones de surtido", path: "/assortment-decisions", readPermission: "assortment.decisions.read", description: "Decisiones y su evidencia" },
  { id: "intelligence", label: "Inteligencia", path: "/product-intelligence", readPermission: "reports.read", description: "Señales de producto y demanda" }
];

export const workspaceFlows: readonly WorkspaceFlow[] = [
  {
    id: "sell",
    title: "Del catálogo a la entrega",
    description: "Consulta el producto, acompaña el pedido y continúa hasta entrega o devolución.",
    modules: ["catalog", "orders", "fulfillment", "returns"]
  },
  {
    id: "source",
    title: "Del proveedor al inventario",
    description: "Relaciona proveedores y ofertas con compras, ajustes controlados y trazabilidad.",
    modules: ["suppliers", "sourcing", "purchases", "inventory", "traceability"]
  },
  {
    id: "make",
    title: "De la especificación a la calidad",
    description: "Sigue el ciclo de fabricación, inspección y revisión del costo.",
    modules: ["manufacturers", "specifications", "production", "quality", "landed-cost"]
  },
  {
    id: "govern",
    title: "Seguimiento y mejora",
    description: "Investiga señales operativas y relaciónalas con decisiones de surtido.",
    modules: ["health", "intelligence", "assortment"]
  }
];

const byId = new Map(workspaceModules.map(m => [m.id, m]));

export function validateWorkspaceFlowMap(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const m of workspaceModules) {
    if (ids.has(m.id)) errors.push("duplicate_module:" + m.id);
    if (paths.has(m.path)) errors.push("duplicate_path:" + m.path);
    if (!/^\/[a-z0-9-]+$/.test(m.path)) errors.push("invalid_path:" + m.path);
    if (!/^[a-z_]+(?:[.][a-z_]+)+$/.test(m.readPermission)) errors.push("invalid_permission:" + m.id);
    ids.add(m.id);
    paths.add(m.path);
  }
  const flowIds = new Set<string>();
  for (const flow of workspaceFlows) {
    if (flowIds.has(flow.id)) errors.push("duplicate_flow:" + flow.id);
    flowIds.add(flow.id);
    if (flow.modules.length < 2) errors.push("too_few_steps:" + flow.id);
    const stepIds = new Set<string>();
    for (const moduleId of flow.modules) {
      if (!byId.has(moduleId)) errors.push("missing_module:" + flow.id + ":" + moduleId);
      if (stepIds.has(moduleId)) errors.push("duplicate_step:" + flow.id + ":" + moduleId);
      stepIds.add(moduleId);
    }
  }
  return errors;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string,string>)[character]
);

export function visibleWorkspacePaths(permissions: readonly string[]): string[] {
  const grants = new Set(permissions);
  return workspaceModules.filter(module => grants.has(module.readPermission)).map(module => module.path);
}

export function renderWorkspaceFlowMap(permissions: readonly string[], selectedFlow?: string): string {
  const grants = new Set(permissions);
  const selected = workspaceFlows.find(flow => flow.id === selectedFlow);
  const flows = selected ? [selected] : workspaceFlows;
  const reachable = workspaceModules.filter(module => grants.has(module.readPermission)).length;

  const filters = [
    '<a class="wf-filter"' + (!selected ? ' aria-current="page"' : '') + ' href="/workspace">Todos</a>',
    ...workspaceFlows.map(flow =>
      '<a class="wf-filter"' + (selected?.id === flow.id ? ' aria-current="page"' : '') +
      ' href="/workspace?flow=' + encodeURIComponent(flow.id) + '">' + escapeHtml(flow.title) + '</a>'
    )
  ].join("");

  const cards = flows.map(flow => {
    const steps = flow.modules.map((moduleId, index) => {
      const module = byId.get(moduleId);
      if (!module) return "";
      const authorized = grants.has(module.readPermission);
      const action = authorized
        ? '<a class="wf-action" href="' + module.path + '" aria-label="Abrir ' + escapeHtml(module.label) + '">Abrir módulo →</a>'
        : '<span class="wf-restricted" aria-label="Acceso restringido">Sin permiso de consulta</span>';
      return '<li class="wf-step"><span class="wf-step-number" aria-hidden="true">' +
        String(index + 1).padStart(2,"0") + '</span><div class="wf-step-info"><strong>' +
        escapeHtml(module.label) + '</strong><span>' + escapeHtml(module.description) +
        '</span></div>' + action + '</li>';
    }).join("");
    const available = flow.modules.filter(id => {
      const module = byId.get(id);
      return module && grants.has(module.readPermission);
    }).length;
    return '<article class="panel wf-card" aria-labelledby="wf-' + flow.id + '">' +
      '<div class="eyebrow">Flujo · ' + available + ' de ' + flow.modules.length + ' accesos</div>' +
      '<h2 id="wf-' + flow.id + '">' + escapeHtml(flow.title) + '</h2>' +
      '<p class="meta">' + escapeHtml(flow.description) + '</p>' +
      '<ol class="wf-steps">' + steps + '</ol></article>';
  }).join("");

  return '<section class="wf-intro" aria-labelledby="wf-title"><div class="eyebrow">MR Adulán · Workspace</div>' +
    '<h1 id="wf-title">Mapa operativo de módulos</h1>' +
    '<p>Consulta cómo se enlazan las áreas del Control Center. Los botones abren pantallas existentes; ' +
    'no crean transacciones ni ejecutan flujos automáticamente.</p>' +
    '<p class="meta">Accesos de consulta habilitados para tu usuario: <strong>' + reachable +
    ' de ' + workspaceModules.length + '</strong>. El backend valida cada permiso y operación.</p></section>' +
    '<nav class="wf-filters" aria-label="Filtrar flujos">' + filters + '</nav>' +
    '<div class="wf-grid">' + cards + '</div>' +
    '<p class="wf-disclaimer">Los pasos muestran el orden operativo recomendado, no el estado en vivo de servicios ' +
    'ni la disponibilidad de una pasarela externa. Las autorizaciones de escritura se gestionan en cada módulo.</p>';
}
