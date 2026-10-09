import { authorizeInternal } from "./auth";

type DB = any;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

type MoneyMap = Record<string, number>;

type ProductMetric = {
  key: string;
  productId: number | null;
  name: string;
  category: string;
  brand: string | null;
  completedUnits: number;
  returnedUnits: number;
  currentAvailableUnits: number;
  restockInterest: number;
  productRequests: number;
  mrOwnedUnits: number;
  thirdPartyUnits: number;
  unclassifiedUnits: number;
  costKnownUnits: number;
  grossByCurrency: MoneyMap;
  knownGrossMarginProxyByCurrency: MoneyMap;
};

function number(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function addMoney(target: MoneyMap, currency: unknown, amount: unknown) {
  const code = String(currency || "UNKNOWN").toUpperCase().slice(0, 3);
  target[code] = number(target[code]) + number(amount);
}

function productKey(row: any) {
  const id = row?.product_id == null ? null : Number(row.product_id);
  if (id && Number.isSafeInteger(id) && id > 0) return "product:" + id;
  return "snapshot:" + String(row?.product_name || "Producto histórico").trim().toLowerCase();
}

function metricFor(map: Map<string, ProductMetric>, row: any) {
  const key = productKey(row);
  let metric = map.get(key);
  if (!metric) {
    metric = {
      key,
      productId: row?.product_id == null ? null : Number(row.product_id),
      name: String(row?.product_name || "Producto histórico"),
      category: String(row?.category || "Sin categoría"),
      brand: row?.brand ? String(row.brand) : null,
      completedUnits: 0,
      returnedUnits: 0,
      currentAvailableUnits: 0,
      restockInterest: 0,
      productRequests: 0,
      mrOwnedUnits: 0,
      thirdPartyUnits: 0,
      unclassifiedUnits: 0,
      costKnownUnits: 0,
      grossByCurrency: {},
      knownGrossMarginProxyByCurrency: {}
    };
    map.set(key, metric);
  } else {
    if (metric.productId == null && row?.product_id != null) metric.productId = Number(row.product_id);
    if ((!metric.name || metric.name === "Producto histórico") && row?.product_name) {
      metric.name = String(row.product_name);
    }
    if ((metric.category === "Sin categoría") && row?.category) metric.category = String(row.category);
    if (!metric.brand && row?.brand) metric.brand = String(row.brand);
  }
  return metric;
}

function publicMetric(metric: ProductMetric) {
  const completed = metric.completedUnits;
  const costCoveragePct = completed > 0
    ? Math.round((metric.costKnownUnits / completed) * 1000) / 10
    : 0;
  return {
    productId: metric.productId,
    name: metric.name,
    category: metric.category,
    brand: metric.brand,
    completedUnits: metric.completedUnits,
    returnedUnits: metric.returnedUnits,
    currentAvailableUnits: metric.currentAvailableUnits,
    restockInterest: metric.restockInterest,
    productRequests: metric.productRequests,
    demandSignals: metric.restockInterest + metric.productRequests,
    ownershipMix: {
      mrOwnedUnits: metric.mrOwnedUnits,
      thirdPartyUnits: metric.thirdPartyUnits,
      unclassifiedUnits: metric.unclassifiedUnits
    },
    costKnownUnits: metric.costKnownUnits,
    costCoveragePct,
    completedGrossByCurrency: metric.grossByCurrency,
    knownGrossMarginProxyByCurrency: metric.knownGrossMarginProxyByCurrency
  };
}

function categoryRollup(products: ProductMetric[]) {
  const map = new Map<string, any>();
  for (const p of products) {
    const category = p.category || "Sin categoría";
    let row = map.get(category);
    if (!row) {
      row = {
        category,
        productsWithActivity: 0,
        completedUnits: 0,
        returnedUnits: 0,
        currentAvailableUnits: 0,
        restockInterest: 0,
        productRequests: 0,
        mrOwnedUnits: 0,
        thirdPartyUnits: 0,
        unclassifiedUnits: 0,
        costKnownUnits: 0,
        completedGrossByCurrency: {} as MoneyMap,
        knownGrossMarginProxyByCurrency: {} as MoneyMap
      };
      map.set(category, row);
    }
    row.productsWithActivity += 1;
    row.completedUnits += p.completedUnits;
    row.returnedUnits += p.returnedUnits;
    row.currentAvailableUnits += p.currentAvailableUnits;
    row.restockInterest += p.restockInterest;
    row.productRequests += p.productRequests;
    row.mrOwnedUnits += p.mrOwnedUnits;
    row.thirdPartyUnits += p.thirdPartyUnits;
    row.unclassifiedUnits += p.unclassifiedUnits;
    row.costKnownUnits += p.costKnownUnits;
    for (const [currency, amount] of Object.entries(p.grossByCurrency)) {
      addMoney(row.completedGrossByCurrency, currency, amount);
    }
    for (const [currency, amount] of Object.entries(p.knownGrossMarginProxyByCurrency)) {
      addMoney(row.knownGrossMarginProxyByCurrency, currency, amount);
    }
  }

  return [...map.values()]
    .map(row => ({
      ...row,
      demandSignals: row.restockInterest + row.productRequests,
      costCoveragePct: row.completedUnits > 0
        ? Math.round((row.costKnownUnits / row.completedUnits) * 1000) / 10
        : 0
    }))
    .sort((a, b) =>
      b.completedUnits - a.completedUnits ||
      b.demandSignals - a.demandSignals ||
      a.category.localeCompare(b.category)
    );
}

async function buildProductIntelligence(db: DB, days: number) {
  const interval = days;

  const [
    salesRows,
    returnRows,
    stockRows,
    interestRows,
    missingDemandRows,
    completedOrderRows
  ] = await Promise.all([
    db`
      WITH completed_orders AS (
        SELECT DISTINCT h.order_id
        FROM order_status_history h
        JOIN orders o ON o.id=h.order_id
        WHERE h.to_status='COMPLETED'
          AND o.status='COMPLETED'
          AND h.created_at >= NOW() - (${interval}::text || ' days')::interval
      )
      SELECT
        p.id AS product_id,
        COALESCE(p.name,oi.product_name_snapshot) AS product_name,
        COALESCE(p.category,'Sin categoría') AS category,
        p.brand,
        oi.currency,
        SUM(oi.quantity)::bigint AS completed_units,
        SUM(oi.line_total_minor)::bigint AS completed_gross_minor,
        SUM(CASE WHEN oi.economic_owner_type='MR' THEN oi.quantity ELSE 0 END)::bigint AS mr_owned_units,
        SUM(CASE WHEN oi.economic_owner_type='THIRD_PARTY' THEN oi.quantity ELSE 0 END)::bigint AS third_party_units,
        SUM(CASE WHEN oi.economic_owner_type IS NULL OR oi.economic_owner_type NOT IN ('MR','THIRD_PARTY') THEN oi.quantity ELSE 0 END)::bigint AS unclassified_units,
        SUM(CASE WHEN oi.unit_cost_basis_minor IS NOT NULL THEN oi.quantity ELSE 0 END)::bigint AS cost_known_units,
        SUM(
          CASE WHEN oi.unit_cost_basis_minor IS NOT NULL
            THEN (oi.unit_price_minor-oi.unit_cost_basis_minor)*oi.quantity
            ELSE 0
          END
        )::bigint AS known_margin_proxy_minor
      FROM completed_orders co
      JOIN order_items oi ON oi.order_id=co.order_id
      LEFT JOIN product_variants pv ON pv.id=oi.variant_id
      LEFT JOIN products p ON p.id=pv.product_id
      GROUP BY p.id,COALESCE(p.name,oi.product_name_snapshot),COALESCE(p.category,'Sin categoría'),p.brand,oi.currency
    `,
    db`
      SELECT
        p.id AS product_id,
        COALESCE(p.name,oi.product_name_snapshot) AS product_name,
        COALESCE(p.category,'Sin categoría') AS category,
        p.brand,
        SUM(ri.quantity_received)::bigint AS returned_units
      FROM return_cases rc
      JOIN return_items ri ON ri.return_case_id=rc.id
      JOIN order_items oi ON oi.id=ri.order_item_id
      LEFT JOIN product_variants pv ON pv.id=oi.variant_id
      LEFT JOIN products p ON p.id=pv.product_id
      WHERE rc.status='COMPLETED'
        AND rc.completed_at IS NOT NULL
        AND rc.completed_at >= NOW() - (${interval}::text || ' days')::interval
      GROUP BY p.id,COALESCE(p.name,oi.product_name_snapshot),COALESCE(p.category,'Sin categoría'),p.brand
    `,
    db`
      SELECT
        p.id AS product_id,p.name AS product_name,
        COALESCE(p.category,'Sin categoría') AS category,p.brand,
        COALESCE(SUM(i.quantity-i.reserved),0)::bigint AS current_available_units
      FROM products p
      JOIN product_variants pv ON pv.product_id=p.id AND pv.active
      LEFT JOIN inventory i ON i.variant_id=pv.id
      GROUP BY p.id,p.name,p.category,p.brand
    `,
    db`
      SELECT
        p.id AS product_id,p.name AS product_name,
        COALESCE(p.category,'Sin categoría') AS category,p.brand,
        COUNT(*) FILTER(WHERE i.kind='notify')::int AS restock_interest,
        COUNT(*) FILTER(WHERE i.kind='product_request')::int AS product_requests
      FROM public_inquiries i
      JOIN products p ON p.id=i.product_id
      WHERE i.created_at >= NOW() - (${interval}::text || ' days')::interval
        AND i.kind IN ('notify','product_request')
      GROUP BY p.id,p.name,p.category,p.brand
    `,
    db`
      SELECT
        COALESCE(
          NULLIF(metadata->>'requestedProduct',''),
          NULLIF(message,''),
          'Sin especificar'
        ) AS item,
        COUNT(*)::int AS count
      FROM public_inquiries
      WHERE kind='product_request'
        AND product_id IS NULL
        AND created_at >= NOW() - (${interval}::text || ' days')::interval
      GROUP BY 1
      ORDER BY count DESC,item
      LIMIT 20
    `,
    db`
      SELECT COUNT(DISTINCT h.order_id)::int AS count
      FROM order_status_history h
      JOIN orders o ON o.id=h.order_id
      WHERE h.to_status='COMPLETED'
        AND o.status='COMPLETED'
        AND h.created_at >= NOW() - (${interval}::text || ' days')::interval
    `
  ]);

  const products = new Map<string, ProductMetric>();

  for (const row of salesRows as any[]) {
    const metric = metricFor(products, row);
    metric.completedUnits += number(row.completed_units);
    metric.mrOwnedUnits += number(row.mr_owned_units);
    metric.thirdPartyUnits += number(row.third_party_units);
    metric.unclassifiedUnits += number(row.unclassified_units);
    metric.costKnownUnits += number(row.cost_known_units);
    addMoney(metric.grossByCurrency, row.currency, row.completed_gross_minor);
    addMoney(metric.knownGrossMarginProxyByCurrency, row.currency, row.known_margin_proxy_minor);
  }

  for (const row of returnRows as any[]) {
    metricFor(products, row).returnedUnits += number(row.returned_units);
  }

  for (const row of stockRows as any[]) {
    metricFor(products, row).currentAvailableUnits = number(row.current_available_units);
  }

  for (const row of interestRows as any[]) {
    const metric = metricFor(products, row);
    metric.restockInterest += number(row.restock_interest);
    metric.productRequests += number(row.product_requests);
  }

  const productList = [...products.values()]
    .filter(p =>
      p.completedUnits > 0 ||
      p.returnedUnits > 0 ||
      p.currentAvailableUnits > 0 ||
      p.restockInterest > 0 ||
      p.productRequests > 0
    )
    .sort((a, b) =>
      b.completedUnits - a.completedUnits ||
      (b.restockInterest + b.productRequests) - (a.restockInterest + a.productRequests) ||
      a.name.localeCompare(b.name)
    );

  const totals = productList.reduce((acc, p) => {
    acc.completedUnits += p.completedUnits;
    acc.returnedUnits += p.returnedUnits;
    acc.currentAvailableUnits += p.currentAvailableUnits;
    acc.restockInterest += p.restockInterest;
    acc.productRequests += p.productRequests;
    acc.mrOwnedUnits += p.mrOwnedUnits;
    acc.thirdPartyUnits += p.thirdPartyUnits;
    acc.unclassifiedUnits += p.unclassifiedUnits;
    acc.costKnownUnits += p.costKnownUnits;
    for (const [currency, amount] of Object.entries(p.grossByCurrency)) {
      addMoney(acc.completedGrossByCurrency, currency, amount);
    }
    for (const [currency, amount] of Object.entries(p.knownGrossMarginProxyByCurrency)) {
      addMoney(acc.knownGrossMarginProxyByCurrency, currency, amount);
    }
    return acc;
  }, {
    completedUnits:0,
    returnedUnits:0,
    currentAvailableUnits:0,
    restockInterest:0,
    productRequests:0,
    mrOwnedUnits:0,
    thirdPartyUnits:0,
    unclassifiedUnits:0,
    costKnownUnits:0,
    completedGrossByCurrency:{} as MoneyMap,
    knownGrossMarginProxyByCurrency:{} as MoneyMap
  });

  return {
    windowDays: days,
    generatedAt: new Date().toISOString(),
    methodology: {
      completedSales: "Order status history transition to COMPLETED within the selected window, with current order status still COMPLETED.",
      returns: "ReturnCase COMPLETED in the selected window; units use quantity_received.",
      marginProxy: "OrderItem unit price minus snapshotted cost basis, before order-level allocations. Internal analytical proxy, not accounting profit.",
      ranking: "Products sorted by completed units, then linked demand signals. No private-label score is calculated."
    },
    summary: {
      completedOrders: number(completedOrderRows[0]?.count),
      productsWithSignals: productList.length,
      ...totals,
      demandSignals: totals.restockInterest + totals.productRequests,
      costCoveragePct: totals.completedUnits > 0
        ? Math.round((totals.costKnownUnits / totals.completedUnits) * 1000) / 10
        : 0
    },
    ownershipMix: {
      mrOwnedUnits: totals.mrOwnedUnits,
      thirdPartyUnits: totals.thirdPartyUnits,
      unclassifiedUnits: totals.unclassifiedUnits
    },
    products: productList.slice(0, 100).map(publicMetric),
    categories: categoryRollup(productList),
    missingDemand: (missingDemandRows as any[]).map(row => ({
      item:String(row.item),
      count:number(row.count)
    }))
  };
}

export async function handleProductIntelligence(req: Request, url: URL, db: DB) {
  if (url.pathname !== "/v1/internal/product-intelligence") return null;
  if (req.method !== "GET") return json({ error:"method_not_allowed" },405);

  const auth = await authorizeInternal(req, db, "reports.read");
  if (!auth.ok) return auth.response;

  const raw = url.searchParams.get("days");
  const days = raw == null || raw === "" ? 90 : Number(raw);
  if (!Number.isSafeInteger(days) || days < 7 || days > 365) {
    return json({ error:"invalid_days", min:7, max:365 },400);
  }

  return json(await buildProductIntelligence(db, days));
}
