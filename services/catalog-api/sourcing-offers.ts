import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function optionalPositiveInt(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : NaN;
}

function optionalNonNegativeInt(value: unknown) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
}

function currencyCode(value: unknown) {
  const code = clean(value, 3).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

function countryCode(value: unknown) {
  const code = clean(value, 2).toUpperCase();
  return !code || /^[A-Z]{2}$/.test(code) ? code : "";
}

function actorFields(actor: any) {
  return actor.type === "USER"
    ? { userId: actor.userId, service: null }
    : { userId: null, service: actor.service };
}

export async function ensureSourcingOffersSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS supplier_variants (
      id BIGSERIAL PRIMARY KEY,
      supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      supplier_sku TEXT,
      quoted_cost_minor BIGINT,
      currency CHAR(3) NOT NULL,
      moq INTEGER,
      lead_time_days INTEGER,
      origin_country_code CHAR(2),
      preferred BOOLEAN NOT NULL DEFAULT FALSE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      last_verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(supplier_id,variant_id),
      CHECK (quoted_cost_minor IS NULL OR quoted_cost_minor >= 0),
      CHECK (moq IS NULL OR moq > 0),
      CHECK (lead_time_days IS NULL OR lead_time_days >= 0)
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_supplier_variants_variant_active
    ON supplier_variants(variant_id,active,preferred DESC,last_verified_at DESC)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_supplier_variants_supplier_active
    ON supplier_variants(supplier_id,active,updated_at DESC)`;

  await db`
    CREATE TABLE IF NOT EXISTS supplier_variant_history (
      id BIGSERIAL PRIMARY KEY,
      supplier_variant_id BIGINT NOT NULL REFERENCES supplier_variants(id) ON DELETE RESTRICT,
      actor_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      actor_service TEXT,
      action TEXT NOT NULL,
      snapshot JSONB NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (
        (actor_user_id IS NOT NULL AND actor_service IS NULL) OR
        (actor_user_id IS NULL AND actor_service IS NOT NULL)
      )
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_supplier_variant_history_offer
    ON supplier_variant_history(supplier_variant_id,id)`;
}

async function currentOffer(db: DB, id: number) {
  const rows = await db`
    SELECT
      sv.id,sv.supplier_id,s.name AS supplier_name,s.country_code AS supplier_country_code,
      sv.variant_id,pv.sku,pv.price,pv.currency AS retail_currency,
      p.id AS product_id,p.name AS product_name,p.category,
      sv.supplier_sku,sv.quoted_cost_minor,sv.currency,sv.moq,
      sv.lead_time_days,sv.origin_country_code,sv.preferred,sv.active,
      sv.last_verified_at,sv.created_at,sv.updated_at,
      sv.created_by_user_id,sv.updated_by_user_id
    FROM supplier_variants sv
    JOIN suppliers s ON s.id=sv.supplier_id
    JOIN product_variants pv ON pv.id=sv.variant_id
    JOIN products p ON p.id=pv.product_id
    WHERE sv.id=${id}
    LIMIT 1`;
  return rows[0] || null;
}

function mapOffer(row: any) {
  const retailPriceMinor = Math.round(Number(row.price || 0) * 100);
  const quotedCostMinor =
    row.quoted_cost_minor == null ? null : Number(row.quoted_cost_minor);
  const quoteCurrency = String(row.currency);
  const retailCurrency = String(row.retail_currency);

  return {
    id:Number(row.id),
    supplier:{
      id:Number(row.supplier_id),
      name:row.supplier_name,
      countryCode:row.supplier_country_code || null
    },
    variant:{
      id:Number(row.variant_id),
      sku:row.sku,
      productId:Number(row.product_id),
      productName:row.product_name,
      category:row.category || null,
      retailPriceMinor,
      retailCurrency
    },
    supplierSku:row.supplier_sku || null,
    quotedCostMinor,
    currency:quoteCurrency,
    moq:row.moq == null ? null : Number(row.moq),
    leadTimeDays:row.lead_time_days == null ? null : Number(row.lead_time_days),
    originCountryCode:row.origin_country_code || null,
    preferred:Boolean(row.preferred),
    active:Boolean(row.active),
    lastVerifiedAt:row.last_verified_at,
    retailSpreadMinor:
      quotedCostMinor != null && quoteCurrency === retailCurrency
        ? retailPriceMinor - quotedCostMinor
        : null,
    retailSpreadComparable:
      quotedCostMinor != null && quoteCurrency === retailCurrency,
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

function snapshot(row: any) {
  const mapped=mapOffer(row);
  return {
    supplierId:mapped.supplier.id,
    variantId:mapped.variant.id,
    supplierSku:mapped.supplierSku,
    quotedCostMinor:mapped.quotedCostMinor,
    currency:mapped.currency,
    moq:mapped.moq,
    leadTimeDays:mapped.leadTimeDays,
    originCountryCode:mapped.originCountryCode,
    preferred:mapped.preferred,
    active:mapped.active,
    lastVerifiedAt:mapped.lastVerifiedAt
  };
}

async function history(db: DB, id: number) {
  const rows = await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM supplier_variant_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.supplier_variant_id=${id}
    ORDER BY h.id`;

  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id == null
      ? {type:"SERVICE",service:row.actor_service}
      : {type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name || null},
    action:row.action,
    snapshot:row.snapshot,
    note:row.note || null,
    createdAt:row.created_at
  }));
}

async function listOffers(req: Request, url: URL, db: DB) {
  const auth=await authorizeInternal(req,db,"suppliers.read");
  if(!auth.ok) return auth.response;

  const variantRaw=url.searchParams.get("variantId");
  const supplierRaw=url.searchParams.get("supplierId");
  const activeRaw=url.searchParams.get("active");

  const variantId=variantRaw ? Number(variantRaw) : null;
  const supplierId=supplierRaw ? Number(supplierRaw) : null;
  if(variantId != null && (!Number.isSafeInteger(variantId)||variantId<1)){
    return json({error:"invalid_variant"},400);
  }
  if(supplierId != null && (!Number.isSafeInteger(supplierId)||supplierId<1)){
    return json({error:"invalid_supplier"},400);
  }
  if(activeRaw!=null && activeRaw!=="" && !["true","false"].includes(activeRaw)){
    return json({error:"invalid_active"},400);
  }
  const active=activeRaw==null||activeRaw===""?null:activeRaw==="true";

  const rows=await db`
    SELECT
      sv.id,sv.supplier_id,s.name AS supplier_name,s.country_code AS supplier_country_code,
      sv.variant_id,pv.sku,pv.price,pv.currency AS retail_currency,
      p.id AS product_id,p.name AS product_name,p.category,
      sv.supplier_sku,sv.quoted_cost_minor,sv.currency,sv.moq,
      sv.lead_time_days,sv.origin_country_code,sv.preferred,sv.active,
      sv.last_verified_at,sv.created_at,sv.updated_at,
      sv.created_by_user_id,sv.updated_by_user_id
    FROM supplier_variants sv
    JOIN suppliers s ON s.id=sv.supplier_id
    JOIN product_variants pv ON pv.id=sv.variant_id
    JOIN products p ON p.id=pv.product_id
    WHERE (${variantId}::bigint IS NULL OR sv.variant_id=${variantId}::bigint)
      AND (${supplierId}::bigint IS NULL OR sv.supplier_id=${supplierId}::bigint)
      AND (${active}::boolean IS NULL OR sv.active=${active}::boolean)
    ORDER BY sv.preferred DESC,sv.active DESC,sv.last_verified_at DESC,sv.id DESC
    LIMIT 300`;

  return json({data:rows.map(mapOffer)});
}

async function createOffer(req: Request, db: DB) {
  const auth=await authorizeInternal(req,db,"suppliers.write",{mutation:true});
  if(!auth.ok) return auth.response;

  let body:any;
  try { body=await req.json(); } catch { return json({error:"invalid_json"},400); }

  const supplierId=Number(body?.supplierId);
  const variantId=Number(body?.variantId);
  if(!Number.isSafeInteger(supplierId)||supplierId<1) return json({error:"invalid_supplier"},400);
  if(!Number.isSafeInteger(variantId)||variantId<1) return json({error:"invalid_variant"},400);

  const suppliers=await db`
    SELECT id,default_currency,active
    FROM suppliers
    WHERE id=${supplierId}
    LIMIT 1`;
  if(!suppliers.length) return json({error:"supplier_not_found"},404);
  if(!suppliers[0].active) return json({error:"supplier_inactive"},409);

  const variants=await db`
    SELECT id
    FROM product_variants
    WHERE id=${variantId}
    LIMIT 1`;
  if(!variants.length) return json({error:"variant_not_found"},404);

  const quotedCostMinor=optionalNonNegativeInt(body?.quotedCostMinor);
  const moq=optionalPositiveInt(body?.moq);
  const leadTimeDays=optionalNonNegativeInt(body?.leadTimeDays);
  if(Number.isNaN(quotedCostMinor)) return json({error:"invalid_quoted_cost"},400);
  if(Number.isNaN(moq)) return json({error:"invalid_moq"},400);
  if(Number.isNaN(leadTimeDays)) return json({error:"invalid_lead_time"},400);

  const currency=currencyCode(body?.currency || suppliers[0].default_currency);
  if(!currency) return json({error:"currency_required"},400);

  const origin=countryCode(body?.originCountryCode);
  if(body?.originCountryCode && !origin) return json({error:"invalid_origin_country"},400);

  const supplierSku=clean(body?.supplierSku,160) || null;
  const preferred=body?.preferred===true;
  const note=clean(body?.note,1000) || null;
  const actor=actorFields(auth.actor);

  try {
    const result:any=await db.begin(async(tx:DB)=>{
      const rows=await tx`
        INSERT INTO supplier_variants(
          supplier_id,variant_id,supplier_sku,quoted_cost_minor,currency,
          moq,lead_time_days,origin_country_code,preferred,active,
          last_verified_at,created_by_user_id,updated_by_user_id
        )
        VALUES(
          ${supplierId},${variantId},${supplierSku},${quotedCostMinor},${currency},
          ${moq},${leadTimeDays},${origin || null},${preferred},TRUE,
          NOW(),${auth.actor.type==="USER"?auth.actor.userId:null},
          ${auth.actor.type==="USER"?auth.actor.userId:null}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      const row=await currentOffer(tx,id);
      const snap=snapshot(row);

      await tx`
        INSERT INTO supplier_variant_history(
          supplier_variant_id,actor_user_id,actor_service,action,snapshot,note
        )
        VALUES(
          ${id},${actor.userId},${actor.service},'CREATED',
          ${JSON.stringify(snap)}::jsonb,${note}
        )`;

      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"supplier_variant.created",
        resourceType:"SupplierVariant",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          supplierId,variantId,currency,
          quotedCostMinor,moq,leadTimeDays,preferred,
          createsPurchaseOrder:false
        }
      });

      return {id};
    });

    const row=await currentOffer(db,result.id);
    return json({
      offer:mapOffer(row),
      createsPurchaseOrder:false,
      inventoryChanged:false
    },201);
  } catch(error:any) {
    if(error?.code==="23505") return json({error:"supplier_variant_exists"},409);
    throw error;
  }
}

async function updateOffer(req: Request, db: DB, id: number) {
  const auth=await authorizeInternal(req,db,"suppliers.write",{mutation:true});
  if(!auth.ok) return auth.response;

  const existing=await currentOffer(db,id);
  if(!existing) return json({error:"not_found"},404);

  let body:any;
  try { body=await req.json(); } catch { return json({error:"invalid_json"},400); }

  const quotedCostMinor=Object.prototype.hasOwnProperty.call(body||{},"quotedCostMinor")
    ? optionalNonNegativeInt(body.quotedCostMinor)
    : existing.quoted_cost_minor == null ? null : Number(existing.quoted_cost_minor);
  const moq=Object.prototype.hasOwnProperty.call(body||{},"moq")
    ? optionalPositiveInt(body.moq)
    : existing.moq == null ? null : Number(existing.moq);
  const leadTimeDays=Object.prototype.hasOwnProperty.call(body||{},"leadTimeDays")
    ? optionalNonNegativeInt(body.leadTimeDays)
    : existing.lead_time_days == null ? null : Number(existing.lead_time_days);

  if(Number.isNaN(quotedCostMinor)) return json({error:"invalid_quoted_cost"},400);
  if(Number.isNaN(moq)) return json({error:"invalid_moq"},400);
  if(Number.isNaN(leadTimeDays)) return json({error:"invalid_lead_time"},400);

  const currency=Object.prototype.hasOwnProperty.call(body||{},"currency")
    ? currencyCode(body.currency)
    : String(existing.currency);
  if(!currency) return json({error:"invalid_currency"},400);

  const origin=Object.prototype.hasOwnProperty.call(body||{},"originCountryCode")
    ? countryCode(body.originCountryCode)
    : String(existing.origin_country_code || "");
  if(body?.originCountryCode && !origin) return json({error:"invalid_origin_country"},400);

  const supplierSku=Object.prototype.hasOwnProperty.call(body||{},"supplierSku")
    ? clean(body.supplierSku,160) || null
    : existing.supplier_sku || null;
  const preferred=Object.prototype.hasOwnProperty.call(body||{},"preferred")
    ? body.preferred===true
    : Boolean(existing.preferred);
  const active=Object.prototype.hasOwnProperty.call(body||{},"active")
    ? body.active===true
    : Boolean(existing.active);
  const note=clean(body?.note,1000) || null;
  const actor=actorFields(auth.actor);

  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE supplier_variants
      SET supplier_sku=${supplierSku},
          quoted_cost_minor=${quotedCostMinor},
          currency=${currency},
          moq=${moq},
          lead_time_days=${leadTimeDays},
          origin_country_code=${origin || null},
          preferred=${preferred},
          active=${active},
          last_verified_at=NOW(),
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;

    const row=await currentOffer(tx,id);
    const snap=snapshot(row);
    await tx`
      INSERT INTO supplier_variant_history(
        supplier_variant_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(snap)}::jsonb,${note}
      )`;

    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"supplier_variant.updated",
      resourceType:"SupplierVariant",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        supplierId:Number(existing.supplier_id),
        variantId:Number(existing.variant_id),
        currency,quotedCostMinor,moq,leadTimeDays,preferred,active,
        createsPurchaseOrder:false
      }
    });
  });

  const row=await currentOffer(db,id);
  return json({
    offer:mapOffer(row),
    history:await history(db,id),
    createsPurchaseOrder:false,
    inventoryChanged:false
  });
}

async function getOffer(req: Request, db: DB, id: number) {
  const auth=await authorizeInternal(req,db,"suppliers.read");
  if(!auth.ok) return auth.response;

  const row=await currentOffer(db,id);
  if(!row) return json({error:"not_found"},404);
  return json({
    offer:mapOffer(row),
    history:await history(db,id),
    createsPurchaseOrder:false
  });
}

async function comparison(req: Request, url: URL, db: DB) {
  const auth=await authorizeInternal(req,db,"suppliers.read");
  if(!auth.ok) return auth.response;

  const variantId=Number(url.searchParams.get("variantId"));
  if(!Number.isSafeInteger(variantId)||variantId<1){
    return json({error:"variant_required"},400);
  }

  const variants=await db`
    SELECT
      pv.id,pv.sku,pv.price,pv.currency,
      p.id AS product_id,p.name AS product_name,p.category
    FROM product_variants pv
    JOIN products p ON p.id=pv.product_id
    WHERE pv.id=${variantId}
    LIMIT 1`;
  if(!variants.length) return json({error:"variant_not_found"},404);
  const variant=variants[0];
  const retailPriceMinor=Math.round(Number(variant.price||0)*100);
  const retailCurrency=String(variant.currency);

  const rows=await db`
    SELECT
      sv.id,sv.supplier_id,s.name AS supplier_name,s.country_code AS supplier_country_code,
      sv.variant_id,pv.sku,pv.price,pv.currency AS retail_currency,
      p.id AS product_id,p.name AS product_name,p.category,
      sv.supplier_sku,sv.quoted_cost_minor,sv.currency,sv.moq,
      sv.lead_time_days,sv.origin_country_code,sv.preferred,sv.active,
      sv.last_verified_at,sv.created_at,sv.updated_at,
      sv.created_by_user_id,sv.updated_by_user_id
    FROM supplier_variants sv
    JOIN suppliers s ON s.id=sv.supplier_id
    JOIN product_variants pv ON pv.id=sv.variant_id
    JOIN products p ON p.id=pv.product_id
    WHERE sv.variant_id=${variantId}
      AND sv.active
    ORDER BY sv.preferred DESC,sv.last_verified_at DESC,s.name`;

  const offers=rows.map(mapOffer);
  const groupMap=new Map<string,any[]>();
  for(const offer of offers){
    const group=groupMap.get(offer.currency)||[];
    group.push(offer);
    groupMap.set(offer.currency,group);
  }

  const groups=[...groupMap.entries()]
    .map(([currency,items])=>({
      currency,
      comparableToRetail:currency===retailCurrency,
      offers:items.sort((a,b)=>{
        const ac=a.quotedCostMinor==null?Number.MAX_SAFE_INTEGER:a.quotedCostMinor;
        const bc=b.quotedCostMinor==null?Number.MAX_SAFE_INTEGER:b.quotedCostMinor;
        return Number(b.preferred)-Number(a.preferred) || ac-bc ||
          (a.leadTimeDays??Number.MAX_SAFE_INTEGER)-(b.leadTimeDays??Number.MAX_SAFE_INTEGER);
      })
    }))
    .sort((a,b)=>{
      if(a.currency===retailCurrency&&b.currency!==retailCurrency) return -1;
      if(b.currency===retailCurrency&&a.currency!==retailCurrency) return 1;
      return a.currency.localeCompare(b.currency);
    });

  return json({
    variant:{
      id:Number(variant.id),
      sku:variant.sku,
      productId:Number(variant.product_id),
      productName:variant.product_name,
      category:variant.category || null,
      retailPriceMinor,
      retailCurrency
    },
    offerCount:offers.length,
    currencyGroups:groups,
    comparisonRules:{
      fxConversionApplied:false,
      retailSpreadMeaning:"retail price minus quoted supplier unit cost when currencies match; not landed margin or accounting profit",
      automaticSupplierSelection:false
    },
    createsPurchaseOrder:false
  });
}

export async function handleSourcingOffers(req: Request, url: URL, db: DB) {
  if(url.pathname==="/v1/internal/sourcing/offers"){
    if(req.method==="GET") return listOffers(req,url,db);
    if(req.method==="POST") return createOffer(req,db);
    return json({error:"method_not_allowed"},405);
  }

  if(url.pathname==="/v1/internal/sourcing/comparison" && req.method==="GET"){
    return comparison(req,url,db);
  }

  const match=url.pathname.match(/^\/v1\/internal\/sourcing\/offers\/(\d+)$/);
  if(match){
    const id=Number(match[1]);
    if(req.method==="GET") return getOffer(req,db,id);
    if(req.method==="PATCH") return updateOffer(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  if(url.pathname.startsWith("/v1/internal/sourcing/")){
    return json({error:"not_found"},404);
  }

  return null;
}
