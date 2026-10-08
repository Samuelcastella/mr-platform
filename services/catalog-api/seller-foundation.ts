import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const MODES = new Set(["OWNED","CONSIGNMENT","COMMISSION","WHOLESALE_MARGIN","MARKETPLACE_FUTURE"]);
const OWNER_TYPES = new Set(["MR","THIRD_PARTY"]);
const SELLER_STATUSES = new Set(["PROSPECT","ACTIVE","SUSPENDED","CLOSED"]);

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function positiveInt(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function optionalPositiveInt(value: unknown) {
  if (value == null || value === "") return null;
  return positiveInt(value);
}
function nonNegativeInt(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export async function ensureSellerFoundationSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS seller_accounts (
      id BIGSERIAL PRIMARY KEY,
      legal_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROSPECT',
      country_code CHAR(2),
      tax_identifier TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('PROSPECT','ACTIVE','SUSPENDED','CLOSED'))
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_accounts_supplier_unique
    ON seller_accounts(supplier_id)
    WHERE supplier_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS seller_agreements (
      id BIGSERIAL PRIMARY KEY,
      seller_id BIGINT NOT NULL REFERENCES seller_accounts(id) ON DELETE RESTRICT,
      commercial_mode TEXT NOT NULL,
      agreement_version INTEGER NOT NULL,
      effective_from TIMESTAMPTZ NOT NULL,
      effective_to TIMESTAMPTZ,
      currency CHAR(3) NOT NULL DEFAULT 'HNL',
      commission_basis TEXT,
      commission_rate_bps INTEGER,
      fixed_fee_minor BIGINT,
      discount_allocation_rule TEXT,
      return_allocation_rule TEXT,
      shipping_allocation_rule TEXT,
      payment_fee_allocation_rule TEXT,
      shrinkage_liability_rule TEXT,
      settlement_frequency TEXT,
      settlement_delay_days INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      approved_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(seller_id,agreement_version),
      CHECK (commercial_mode IN ('OWNED','CONSIGNMENT','COMMISSION','WHOLESALE_MARGIN','MARKETPLACE_FUTURE')),
      CHECK (status IN ('DRAFT','APPROVED','ACTIVE','EXPIRED','TERMINATED')),
      CHECK (commission_rate_bps IS NULL OR (commission_rate_bps >= 0 AND commission_rate_bps <= 10000)),
      CHECK (fixed_fee_minor IS NULL OR fixed_fee_minor >= 0),
      CHECK (settlement_delay_days >= 0)
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS inventory_sources (
      id BIGSERIAL PRIMARY KEY,
      variant_id BIGINT NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
      location_id BIGINT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      source_type TEXT NOT NULL,
      commercial_mode TEXT NOT NULL,
      economic_owner_type TEXT NOT NULL,
      seller_id BIGINT REFERENCES seller_accounts(id) ON DELETE RESTRICT,
      seller_agreement_id BIGINT REFERENCES seller_agreements(id) ON DELETE RESTRICT,
      supplier_id BIGINT REFERENCES suppliers(id) ON DELETE SET NULL,
      procurement_lot_id BIGINT,
      currency CHAR(3) NOT NULL DEFAULT 'HNL',
      cost_basis_minor BIGINT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      effective_to TIMESTAMPTZ,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (source_type IN ('PROCUREMENT','CONSIGNMENT','THIRD_PARTY','OWNED_OPENING_STOCK','RETURNED_STOCK','OTHER')),
      CHECK (commercial_mode IN ('OWNED','CONSIGNMENT','COMMISSION','WHOLESALE_MARGIN')),
      CHECK (economic_owner_type IN ('MR','THIRD_PARTY')),
      CHECK (status IN ('ACTIVE','INACTIVE')),
      CHECK (cost_basis_minor IS NULL OR cost_basis_minor >= 0),
      CHECK (
        (economic_owner_type='MR' AND seller_id IS NULL)
        OR
        (economic_owner_type='THIRD_PARTY' AND seller_id IS NOT NULL)
      )
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_sources_one_active_per_variant_location
    ON inventory_sources(variant_id,location_id)
    WHERE status='ACTIVE'`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_seller_agreements_seller_status
    ON seller_agreements(seller_id,status,effective_from DESC)`;
}

async function listSellers(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "sellers.read");
  if (!auth.ok) return auth.response;

  const rows = await db`
    SELECT id,legal_name,display_name,status,country_code,contact_email,contact_phone,
           supplier_id,created_at,updated_at
    FROM seller_accounts
    ORDER BY display_name,id`;
  return json({ data: rows.map((r:any)=>({
    id:Number(r.id), legalName:r.legal_name, displayName:r.display_name, status:r.status,
    countryCode:r.country_code||null, contactEmail:r.contact_email||null,
    contactPhone:r.contact_phone||null,
    supplierId:r.supplier_id==null?null:Number(r.supplier_id),
    createdAt:r.created_at, updatedAt:r.updated_at
  }))});
}

async function createSeller(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "sellers.manage", { mutation:true });
  if (!auth.ok) return auth.response;

  let body:any;
  try { body=await req.json(); } catch { return json({error:"invalid_json"},400); }

  const legalName=clean(body?.legalName,180);
  const displayName=clean(body?.displayName,180) || legalName;
  const status=(clean(body?.status,24)||"PROSPECT").toUpperCase();
  const supplierId=optionalPositiveInt(body?.supplierId);
  if(!legalName)return json({error:"legal_name_required"},400);
  if(!SELLER_STATUSES.has(status))return json({error:"invalid_status"},400);

  if(supplierId){
    const supplier=await db`SELECT id FROM suppliers WHERE id=${supplierId} LIMIT 1`;
    if(!supplier.length)return json({error:"supplier_not_found"},404);
  }

  const rows=await db`
    INSERT INTO seller_accounts(
      legal_name,display_name,status,country_code,tax_identifier,
      contact_email,contact_phone,supplier_id
    )
    VALUES(
      ${legalName},${displayName},${status},
      ${clean(body?.countryCode,2).toUpperCase()||null},
      ${clean(body?.taxIdentifier,80)||null},
      ${clean(body?.contactEmail,254).toLowerCase()||null},
      ${clean(body?.contactPhone,60)||null},
      ${supplierId}
    )
    RETURNING id,legal_name,display_name,status,supplier_id,created_at`;

  await writeAuditEvent(db,{
    ...auditActor(auth.actor),
    action:"seller.created",
    resourceType:"SellerAccount",
    resourceId:Number(rows[0].id),
    outcome:"SUCCESS",
    metadata:{supplierId}
  });

  return json({ seller:{
    id:Number(rows[0].id), legalName:rows[0].legal_name, displayName:rows[0].display_name,
    status:rows[0].status, supplierId:rows[0].supplier_id==null?null:Number(rows[0].supplier_id),
    createdAt:rows[0].created_at
  }},201);
}

async function createAgreement(req: Request, db: DB, sellerId:number) {
  const auth=await authorizeInternal(req,db,"seller_agreements.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try { body=await req.json(); } catch { return json({error:"invalid_json"},400); }

  const seller=await db`SELECT id,status FROM seller_accounts WHERE id=${sellerId} LIMIT 1`;
  if(!seller.length)return json({error:"seller_not_found"},404);

  const commercialMode=clean(body?.commercialMode,40).toUpperCase();
  if(!MODES.has(commercialMode))return json({error:"invalid_commercial_mode"},400);
  if(commercialMode==="MARKETPLACE_FUTURE")return json({error:"marketplace_not_active"},409);

  const version=positiveInt(body?.agreementVersion);
  if(!version)return json({error:"invalid_agreement_version"},400);
  const commissionRateBps=body?.commissionRateBps==null?null:nonNegativeInt(body.commissionRateBps);
  if(commissionRateBps!=null&&commissionRateBps>10000)return json({error:"invalid_commission_rate"},400);
  const fixedFeeMinor=body?.fixedFeeMinor==null?null:nonNegativeInt(body.fixedFeeMinor);
  const delay=body?.settlementDelayDays==null?0:nonNegativeInt(body.settlementDelayDays);
  if(delay==null)return json({error:"invalid_settlement_delay"},400);

  const rows=await db`
    INSERT INTO seller_agreements(
      seller_id,commercial_mode,agreement_version,effective_from,effective_to,currency,
      commission_basis,commission_rate_bps,fixed_fee_minor,
      discount_allocation_rule,return_allocation_rule,shipping_allocation_rule,
      payment_fee_allocation_rule,shrinkage_liability_rule,settlement_frequency,
      settlement_delay_days,notes,created_by_user_id,status
    )
    VALUES(
      ${sellerId},${commercialMode},${version},
      ${body?.effectiveFrom?new Date(body.effectiveFrom):new Date()},
      ${body?.effectiveTo?new Date(body.effectiveTo):null},
      ${clean(body?.currency,3).toUpperCase()||"HNL"},
      ${clean(body?.commissionBasis,40)||null},${commissionRateBps},${fixedFeeMinor},
      ${clean(body?.discountAllocationRule,40)||null},
      ${clean(body?.returnAllocationRule,40)||null},
      ${clean(body?.shippingAllocationRule,40)||null},
      ${clean(body?.paymentFeeAllocationRule,40)||null},
      ${clean(body?.shrinkageLiabilityRule,80)||null},
      ${clean(body?.settlementFrequency,40)||null},
      ${delay},${clean(body?.notes,1000)||null},
      ${auth.actor.type==="USER"?auth.actor.userId:null},
      'DRAFT'
    )
    RETURNING id,seller_id,commercial_mode,agreement_version,status,created_at`;

  await writeAuditEvent(db,{
    ...auditActor(auth.actor),
    action:"seller_agreement.created",
    resourceType:"SellerAgreement",
    resourceId:Number(rows[0].id),
    outcome:"SUCCESS",
    metadata:{sellerId,commercialMode,agreementVersion:version}
  });

  return json({ agreement:{
    id:Number(rows[0].id), sellerId:Number(rows[0].seller_id),
    commercialMode:rows[0].commercial_mode, agreementVersion:Number(rows[0].agreement_version),
    status:rows[0].status, createdAt:rows[0].created_at
  }},201);
}

async function createInventorySource(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"sellers.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try { body=await req.json(); } catch { return json({error:"invalid_json"},400); }

  const variantId=positiveInt(body?.variantId);
  const locationId=positiveInt(body?.locationId);
  if(!variantId||!locationId)return json({error:"invalid_variant_or_location"},400);

  const sourceType=clean(body?.sourceType,40).toUpperCase();
  const owner=clean(body?.economicOwnerType,24).toUpperCase();
  const commercialMode=clean(body?.commercialMode,40).toUpperCase();
  if(!new Set(["PROCUREMENT","CONSIGNMENT","THIRD_PARTY","OWNED_OPENING_STOCK","RETURNED_STOCK","OTHER"]).has(sourceType))
    return json({error:"invalid_source_type"},400);
  if(!OWNER_TYPES.has(owner))return json({error:"invalid_economic_owner_type"},400);
  if(!new Set(["OWNED","CONSIGNMENT","COMMISSION","WHOLESALE_MARGIN"]).has(commercialMode))
    return json({error:"invalid_commercial_mode"},400);
  if(owner==="MR"&&!["OWNED","WHOLESALE_MARGIN"].includes(commercialMode))
    return json({error:"invalid_mode_for_mr_owned"},409);
  if(owner==="THIRD_PARTY"&&!["CONSIGNMENT","COMMISSION"].includes(commercialMode))
    return json({error:"invalid_mode_for_third_party"},409);

  const sellerId=optionalPositiveInt(body?.sellerId);
  const agreementId=optionalPositiveInt(body?.sellerAgreementId);
  const supplierId=optionalPositiveInt(body?.supplierId);
  if(owner==="MR"&&(sellerId||agreementId))return json({error:"mr_owned_cannot_have_seller_agreement"},409);
  if(owner==="THIRD_PARTY"&&(!sellerId||!agreementId))return json({error:"third_party_requires_seller_agreement"},409);

  const [variant,location]=await Promise.all([
    db`SELECT id,cost,currency FROM product_variants WHERE id=${variantId} LIMIT 1`,
    db`SELECT id FROM locations WHERE id=${locationId} AND active LIMIT 1`
  ]);
  if(!variant.length)return json({error:"variant_not_found"},404);
  if(!location.length)return json({error:"location_not_found"},404);

  if(sellerId){
    const seller=await db`SELECT id,status FROM seller_accounts WHERE id=${sellerId} LIMIT 1`;
    if(!seller.length)return json({error:"seller_not_found"},404);
    if(seller[0].status!=="ACTIVE")return json({error:"seller_not_active"},409);
  }

  if(agreementId){
    const agreement=await db`
      SELECT id,seller_id,commercial_mode,agreement_version,status
      FROM seller_agreements WHERE id=${agreementId} LIMIT 1`;
    if(!agreement.length)return json({error:"agreement_not_found"},404);
    if(sellerId!==Number(agreement[0].seller_id))return json({error:"agreement_seller_mismatch"},409);
    if(!["APPROVED","ACTIVE"].includes(agreement[0].status))
      return json({error:"agreement_not_active"},409);
    if(commercialMode!==String(agreement[0].commercial_mode))
      return json({error:"agreement_mode_mismatch"},409);
  }

  const rawCost=body?.costBasisMinor;
  const costBasisMinor=rawCost==null
    ? (variant[0].cost==null?null:Math.round(Number(variant[0].cost)*100))
    : nonNegativeInt(rawCost);
  if(rawCost!=null&&costBasisMinor==null)return json({error:"invalid_cost_basis"},400);

  try{
    const rows=await db`
      INSERT INTO inventory_sources(
        variant_id,location_id,source_type,commercial_mode,economic_owner_type,seller_id,
        seller_agreement_id,supplier_id,currency,cost_basis_minor,created_by_user_id
      )
      VALUES(
        ${variantId},${locationId},${sourceType},${commercialMode},${owner},${sellerId},
        ${agreementId},${supplierId},
        ${clean(body?.currency,3).toUpperCase()||String(variant[0].currency||"HNL")},
        ${costBasisMinor},
        ${auth.actor.type==="USER"?auth.actor.userId:null}
      )
      RETURNING id,variant_id,location_id,source_type,commercial_mode,economic_owner_type,
                seller_id,seller_agreement_id,supplier_id,currency,cost_basis_minor,status`;
    await writeAuditEvent(db,{
      ...auditActor(auth.actor),
      action:"inventory_source.created",
      resourceType:"InventorySource",
      resourceId:Number(rows[0].id),
      locationId,
      outcome:"SUCCESS",
      metadata:{variantId,owner,sourceType,commercialMode,sellerId,agreementId}
    });
    return json({inventorySource:{
      id:Number(rows[0].id),variantId:Number(rows[0].variant_id),locationId:Number(rows[0].location_id),
      sourceType:rows[0].source_type,commercialMode:rows[0].commercial_mode,economicOwnerType:rows[0].economic_owner_type,
      sellerId:rows[0].seller_id==null?null:Number(rows[0].seller_id),
      sellerAgreementId:rows[0].seller_agreement_id==null?null:Number(rows[0].seller_agreement_id),
      supplierId:rows[0].supplier_id==null?null:Number(rows[0].supplier_id),
      currency:rows[0].currency,costBasisMinor:rows[0].cost_basis_minor==null?null:Number(rows[0].cost_basis_minor),
      status:rows[0].status
    }},201);
  }catch(error:any){
    if(error?.code==="23505")return json({error:"active_inventory_source_exists"},409);
    throw error;
  }
}

export async function handleSellerFoundation(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/sellers"){
    if(req.method==="GET")return listSellers(req,db);
    if(req.method==="POST")return createSeller(req,db);
  }

  const agreement=url.pathname.match(/^\/v1\/internal\/sellers\/(\d+)\/agreements$/);
  if(agreement&&req.method==="POST"){
    return createAgreement(req,db,Number(agreement[1]));
  }

  if(url.pathname==="/v1/internal/inventory-sources"&&req.method==="POST"){
    return createInventorySource(req,db);
  }

  if(
    url.pathname.startsWith("/v1/internal/sellers") ||
    url.pathname.startsWith("/v1/internal/inventory-sources")
  ){
    return json({error:"not_found"},404);
  }

  return null;
}
