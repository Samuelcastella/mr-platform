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

function n(value: unknown) {
  const x=Number(value);
  return Number.isFinite(x)?x:0;
}

function oneDecimal(value: unknown) {
  if (value == null || value === "") return null;
  const x=Number(value);
  return Number.isFinite(x)?Math.round(x*10)/10:null;
}

function pct(num:number,den:number) {
  return den>0?Math.round((num/den)*1000)/10:null;
}

async function authorize(req: Request, db: DB) {
  const supplierAuth=await authorizeInternal(req,db,"suppliers.read");
  if(!supplierAuth.ok) return supplierAuth;
  const procurementAuth=await authorizeInternal(req,db,"procurement.read");
  if(!procurementAuth.ok) return procurementAuth;
  return procurementAuth;
}

export async function handleSupplierPerformance(req: Request, url: URL, db: DB) {
  if(url.pathname!=="/v1/internal/supplier-performance") return null;
  if(req.method!=="GET") return json({error:"method_not_allowed"},405);

  const auth=await authorize(req,db);
  if(!auth.ok) return auth.response;

  const raw=url.searchParams.get("days");
  const days=raw==null||raw===""?90:Number(raw);
  if(!Number.isSafeInteger(days)||days<30||days>365){
    return json({error:"invalid_days",min:30,max:365},400);
  }

  const [supplierRows,spendRows,totalsRows]=await Promise.all([
    db`
      WITH po_window AS (
        SELECT
          po.id,po.supplier_id,po.status,po.ordered_at,po.expected_at
        FROM purchase_orders po
        WHERE po.ordered_at IS NOT NULL
          AND po.status IN ('ORDERED','PARTIALLY_RECEIVED','RECEIVED')
          AND po.ordered_at >= NOW()-(${days}::text||' days')::interval
      ),
      item_stats AS (
        SELECT
          pw.supplier_id,
          COUNT(DISTINCT pw.id)::int AS po_count,
          COUNT(DISTINCT pw.id) FILTER(WHERE pw.status='ORDERED')::int AS ordered_open_count,
          COUNT(DISTINCT pw.id) FILTER(WHERE pw.status='PARTIALLY_RECEIVED')::int AS partial_count,
          COUNT(DISTINCT pw.id) FILTER(WHERE pw.status='RECEIVED')::int AS received_count,
          COALESCE(SUM(poi.quantity_ordered),0)::bigint AS ordered_units,
          COALESCE(SUM(poi.quantity_received),0)::bigint AS received_units
        FROM po_window pw
        JOIN purchase_order_items poi ON poi.purchase_order_id=pw.id
        GROUP BY pw.supplier_id
      ),
      receipt_times AS (
        SELECT
          pw.id AS purchase_order_id,
          pw.supplier_id,pw.status,pw.ordered_at,pw.expected_at,
          MIN(gr.received_at) AS first_received_at,
          MAX(gr.received_at) AS last_received_at
        FROM po_window pw
        LEFT JOIN goods_receipts gr ON gr.purchase_order_id=pw.id
        GROUP BY pw.id,pw.supplier_id,pw.status,pw.ordered_at,pw.expected_at
      ),
      timing_stats AS (
        SELECT
          supplier_id,
          AVG(EXTRACT(EPOCH FROM (first_received_at-ordered_at))/86400.0)
            FILTER(WHERE first_received_at IS NOT NULL) AS avg_days_first_receipt,
          AVG(EXTRACT(EPOCH FROM (last_received_at-ordered_at))/86400.0)
            FILTER(WHERE status='RECEIVED' AND last_received_at IS NOT NULL) AS avg_days_complete_receipt,
          COUNT(*) FILTER(
            WHERE status='RECEIVED' AND expected_at IS NOT NULL AND last_received_at IS NOT NULL
          )::int AS on_time_eligible,
          COUNT(*) FILTER(
            WHERE status='RECEIVED' AND expected_at IS NOT NULL
              AND last_received_at IS NOT NULL AND last_received_at<=expected_at
          )::int AS on_time_count
        FROM receipt_times
        GROUP BY supplier_id
      ),
      offer_stats AS (
        SELECT
          supplier_id,
          COUNT(*) FILTER(WHERE active)::int AS active_offer_count,
          COUNT(*) FILTER(WHERE active AND preferred)::int AS preferred_offer_count,
          COUNT(DISTINCT variant_id) FILTER(WHERE active)::int AS active_variant_count
        FROM supplier_variants
        GROUP BY supplier_id
      )
      SELECT
        s.id,s.name,s.country_code,s.default_currency,s.active,
        COALESCE(i.po_count,0)::int AS po_count,
        COALESCE(i.ordered_open_count,0)::int AS ordered_open_count,
        COALESCE(i.partial_count,0)::int AS partial_count,
        COALESCE(i.received_count,0)::int AS received_count,
        COALESCE(i.ordered_units,0)::bigint AS ordered_units,
        COALESCE(i.received_units,0)::bigint AS received_units,
        t.avg_days_first_receipt,t.avg_days_complete_receipt,
        COALESCE(t.on_time_eligible,0)::int AS on_time_eligible,
        COALESCE(t.on_time_count,0)::int AS on_time_count,
        COALESCE(o.active_offer_count,0)::int AS active_offer_count,
        COALESCE(o.preferred_offer_count,0)::int AS preferred_offer_count,
        COALESCE(o.active_variant_count,0)::int AS active_variant_count
      FROM suppliers s
      LEFT JOIN item_stats i ON i.supplier_id=s.id
      LEFT JOIN timing_stats t ON t.supplier_id=s.id
      LEFT JOIN offer_stats o ON o.supplier_id=s.id
      WHERE s.active
         OR COALESCE(i.po_count,0)>0
         OR COALESCE(o.active_offer_count,0)>0
      ORDER BY COALESCE(i.po_count,0) DESC,s.name
      LIMIT 250
    `,
    db`
      WITH po_window AS (
        SELECT id,supplier_id
        FROM purchase_orders
        WHERE ordered_at IS NOT NULL
          AND status IN ('ORDERED','PARTIALLY_RECEIVED','RECEIVED')
          AND ordered_at >= NOW()-(${days}::text||' days')::interval
      )
      SELECT
        pw.supplier_id,gri.currency,
        SUM(gri.quantity_received*gri.unit_cost_minor)::bigint AS received_cost_minor
      FROM po_window pw
      JOIN goods_receipts gr ON gr.purchase_order_id=pw.id
      JOIN goods_receipt_items gri ON gri.goods_receipt_id=gr.id
      GROUP BY pw.supplier_id,gri.currency
      ORDER BY pw.supplier_id,gri.currency
    `,
    db`
      WITH po_window AS (
        SELECT id,status,ordered_at,expected_at
        FROM purchase_orders
        WHERE ordered_at IS NOT NULL
          AND status IN ('ORDERED','PARTIALLY_RECEIVED','RECEIVED')
          AND ordered_at >= NOW()-(${days}::text||' days')::interval
      ),
      items AS (
        SELECT
          COALESCE(SUM(poi.quantity_ordered),0)::bigint AS ordered_units,
          COALESCE(SUM(poi.quantity_received),0)::bigint AS received_units
        FROM po_window pw
        JOIN purchase_order_items poi ON poi.purchase_order_id=pw.id
      )
      SELECT
        COUNT(*)::int AS po_count,
        COUNT(*) FILTER(WHERE status='ORDERED')::int AS ordered_open_count,
        COUNT(*) FILTER(WHERE status='PARTIALLY_RECEIVED')::int AS partial_count,
        COUNT(*) FILTER(WHERE status='RECEIVED')::int AS received_count,
        (SELECT ordered_units FROM items)::bigint AS ordered_units,
        (SELECT received_units FROM items)::bigint AS received_units
      FROM po_window
    `
  ]);

  const spendBySupplier=new Map<number,Record<string,number>>();
  const receivedCostByCurrency:Record<string,number>={};
  for(const row of spendRows as any[]){
    const supplierId=Number(row.supplier_id);
    const currency=String(row.currency);
    const amount=n(row.received_cost_minor);
    const map=spendBySupplier.get(supplierId)||{};
    map[currency]=(map[currency]||0)+amount;
    spendBySupplier.set(supplierId,map);
    receivedCostByCurrency[currency]=(receivedCostByCurrency[currency]||0)+amount;
  }

  const suppliers=(supplierRows as any[]).map(row=>{
    const orderedUnits=n(row.ordered_units);
    const receivedUnits=n(row.received_units);
    const eligible=n(row.on_time_eligible);
    const onTime=n(row.on_time_count);
    return {
      supplier:{
        id:Number(row.id),
        name:row.name,
        countryCode:row.country_code || null,
        defaultCurrency:row.default_currency || null,
        active:Boolean(row.active)
      },
      purchaseOrders:{
        total:n(row.po_count),
        orderedOpen:n(row.ordered_open_count),
        partiallyReceived:n(row.partial_count),
        received:n(row.received_count)
      },
      units:{
        ordered:orderedUnits,
        received:receivedUnits,
        receiptProgressPct:pct(receivedUnits,orderedUnits)
      },
      timing:{
        avgDaysToFirstReceipt:oneDecimal(row.avg_days_first_receipt),
        avgDaysToCompleteReceipt:oneDecimal(row.avg_days_complete_receipt),
        onTimeEligibleOrders:eligible,
        onTimeOrders:onTime,
        onTimeCompletionPct:pct(onTime,eligible)
      },
      receivedCostByCurrency:spendBySupplier.get(Number(row.id))||{},
      sourcing:{
        activeOffers:n(row.active_offer_count),
        preferredOffers:n(row.preferred_offer_count),
        activeVariants:n(row.active_variant_count)
      }
    };
  });

  const t=totalsRows[0]||{};
  const orderedUnits=n(t.ordered_units);
  const receivedUnits=n(t.received_units);

  return json({
    windowDays:days,
    generatedAt:new Date().toISOString(),
    summary:{
      purchaseOrders:n(t.po_count),
      orderedOpen:n(t.ordered_open_count),
      partiallyReceived:n(t.partial_count),
      received:n(t.received_count),
      orderedUnits,
      receivedUnits,
      receiptProgressPct:pct(receivedUnits,orderedUnits),
      receivedCostByCurrency
    },
    suppliers,
    methodology:{
      windowAnchor:"PurchaseOrder.ordered_at",
      includedStatuses:["ORDERED","PARTIALLY_RECEIVED","RECEIVED"],
      receivedCost:"GoodsReceiptItem quantity_received × unit_cost_minor, grouped by currency",
      onTime:"Only completed RECEIVED purchase orders with expected_at and at least one receipt are eligible",
      fxConversionApplied:false,
      supplierScoreCalculated:false,
      automaticSupplierDecision:false
    }
  });
}
