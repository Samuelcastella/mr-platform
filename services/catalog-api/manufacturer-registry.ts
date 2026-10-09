import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const TARGET_TYPES = new Set(["PRODUCT","VARIANT"]);

const json=(body:unknown,status=200)=>
  Response.json(body,{
    status,
    headers:{
      "cache-control":"no-store",
      "x-content-type-options":"nosniff"
    }
  });

function clean(value:unknown,max:number){
  return typeof value==="string" ? value.trim().slice(0,max) : "";
}

function normalizeCountry(value:unknown){
  const code=clean(value,2).toUpperCase();
  return !code || /^[A-Z]{2}$/.test(code) ? code : "";
}

function validEmail(value:string){
  return !value || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function validWebsite(value:string){
  if(!value)return true;
  try{
    const u=new URL(value);
    return u.protocol==="https:" || u.protocol==="http:";
  }catch{
    return false;
  }
}

function actorFields(actor:any){
  return actor.type==="USER"
    ? {userId:actor.userId,service:null}
    : {userId:null,service:actor.service};
}

export async function ensureManufacturerRegistrySchema(db:DB){
  await db`
    CREATE TABLE IF NOT EXISTS manufacturers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      legal_name TEXT,
      country_code CHAR(2),
      city TEXT,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      website TEXT,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_manufacturers_active_name
    ON manufacturers(active,name,id)`;

  await db`
    CREATE TABLE IF NOT EXISTS manufacturer_history (
      id BIGSERIAL PRIMARY KEY,
      manufacturer_id BIGINT NOT NULL REFERENCES manufacturers(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_manufacturer_history_record
    ON manufacturer_history(manufacturer_id,id)`;

  await db`
    CREATE TABLE IF NOT EXISTS manufacturer_links (
      id BIGSERIAL PRIMARY KEY,
      manufacturer_id BIGINT NOT NULL REFERENCES manufacturers(id) ON DELETE RESTRICT,
      target_type TEXT NOT NULL,
      product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
      variant_id BIGINT REFERENCES product_variants(id) ON DELETE RESTRICT,
      manufacturer_reference TEXT,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (target_type IN ('PRODUCT','VARIANT')),
      CHECK (
        (target_type='PRODUCT' AND product_id IS NOT NULL AND variant_id IS NULL) OR
        (target_type='VARIANT' AND product_id IS NULL AND variant_id IS NOT NULL)
      )
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturer_links_product_unique
    ON manufacturer_links(manufacturer_id,product_id)
    WHERE target_type='PRODUCT'`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturer_links_variant_unique
    ON manufacturer_links(manufacturer_id,variant_id)
    WHERE target_type='VARIANT'`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_manufacturer_links_manufacturer
    ON manufacturer_links(manufacturer_id,active,updated_at DESC)`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_manufacturer_links_product
    ON manufacturer_links(product_id,active,updated_at DESC)
    WHERE product_id IS NOT NULL`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_manufacturer_links_variant
    ON manufacturer_links(variant_id,active,updated_at DESC)
    WHERE variant_id IS NOT NULL`;

  await db`
    CREATE TABLE IF NOT EXISTS manufacturer_link_history (
      id BIGSERIAL PRIMARY KEY,
      manufacturer_link_id BIGINT NOT NULL REFERENCES manufacturer_links(id) ON DELETE RESTRICT,
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
    CREATE INDEX IF NOT EXISTS idx_manufacturer_link_history_record
    ON manufacturer_link_history(manufacturer_link_id,id)`;
}

async function manufacturerRow(db:DB,id:number){
  const rows=await db`
    SELECT
      m.id,m.name,m.legal_name,m.country_code,m.city,m.contact_name,
      m.email,m.phone,m.website,m.notes,m.active,
      m.created_by_user_id,creator.display_name AS created_by_display_name,
      m.updated_by_user_id,updater.display_name AS updated_by_display_name,
      m.created_at,m.updated_at
    FROM manufacturers m
    LEFT JOIN staff_users creator ON creator.id=m.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=m.updated_by_user_id
    WHERE m.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapManufacturer(row:any){
  return {
    id:Number(row.id),
    name:row.name,
    legalName:row.legal_name||null,
    countryCode:row.country_code||null,
    city:row.city||null,
    contactName:row.contact_name||null,
    email:row.email||null,
    phone:row.phone||null,
    website:row.website||null,
    notes:row.notes||null,
    active:Boolean(row.active),
    createdBy:row.created_by_user_id==null?null:{
      userId:Number(row.created_by_user_id),
      displayName:row.created_by_display_name||null
    },
    updatedBy:row.updated_by_user_id==null?null:{
      userId:Number(row.updated_by_user_id),
      displayName:row.updated_by_display_name||null
    },
    createdAt:row.created_at,
    updatedAt:row.updated_at
  };
}

function manufacturerSnapshot(row:any){
  const m=mapManufacturer(row);
  return {
    name:m.name,
    legalName:m.legalName,
    countryCode:m.countryCode,
    city:m.city,
    contactName:m.contactName,
    email:m.email,
    phone:m.phone,
    website:m.website,
    notes:m.notes,
    active:m.active
  };
}

async function manufacturerHistory(db:DB,id:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM manufacturer_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.manufacturer_id=${id}
    ORDER BY h.id`;
  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id==null
      ? {type:"SERVICE",service:row.actor_service}
      : {type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name||null},
    action:row.action,
    snapshot:row.snapshot,
    note:row.note||null,
    createdAt:row.created_at
  }));
}

async function linkRow(db:DB,id:number){
  const rows=await db`
    SELECT
      l.id,l.manufacturer_id,m.name AS manufacturer_name,m.active AS manufacturer_active,
      l.target_type,l.product_id,l.variant_id,l.manufacturer_reference,l.notes,l.active,
      COALESCE(p.id,pv_product.id) AS resolved_product_id,
      COALESCE(p.name,pv_product.name) AS product_name,
      COALESCE(p.category,pv_product.category) AS category,
      pv.sku,pv.size,pv.color,
      l.created_by_user_id,creator.display_name AS created_by_display_name,
      l.updated_by_user_id,updater.display_name AS updated_by_display_name,
      l.created_at,l.updated_at
    FROM manufacturer_links l
    JOIN manufacturers m ON m.id=l.manufacturer_id
    LEFT JOIN products p ON p.id=l.product_id
    LEFT JOIN product_variants pv ON pv.id=l.variant_id
    LEFT JOIN products pv_product ON pv_product.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=l.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=l.updated_by_user_id
    WHERE l.id=${id}
    LIMIT 1`;
  return rows[0]||null;
}

function mapLink(row:any){
  return {
    id:Number(row.id),
    manufacturer:{
      id:Number(row.manufacturer_id),
      name:row.manufacturer_name,
      active:Boolean(row.manufacturer_active)
    },
    targetType:row.target_type,
    productId:row.resolved_product_id==null?null:Number(row.resolved_product_id),
    variantId:row.variant_id==null?null:Number(row.variant_id),
    productName:row.product_name||null,
    category:row.category||null,
    sku:row.sku||null,
    size:row.size||null,
    color:row.color||null,
    manufacturerReference:row.manufacturer_reference||null,
    notes:row.notes||null,
    active:Boolean(row.active),
    createdBy:row.created_by_user_id==null?null:{
      userId:Number(row.created_by_user_id),
      displayName:row.created_by_display_name||null
    },
    updatedBy:row.updated_by_user_id==null?null:{
      userId:Number(row.updated_by_user_id),
      displayName:row.updated_by_display_name||null
    },
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    supplierCreated:false,
    supplierVariantCreated:false,
    productionRunCreated:false,
    inventoryChanged:false
  };
}

function linkSnapshot(row:any){
  const l=mapLink(row);
  return {
    manufacturerId:l.manufacturer.id,
    targetType:l.targetType,
    productId:l.productId,
    variantId:l.variantId,
    manufacturerReference:l.manufacturerReference,
    notes:l.notes,
    active:l.active
  };
}

async function linkHistory(db:DB,id:number){
  const rows=await db`
    SELECT
      h.id,h.actor_user_id,u.display_name AS actor_display_name,
      h.actor_service,h.action,h.snapshot,h.note,h.created_at
    FROM manufacturer_link_history h
    LEFT JOIN staff_users u ON u.id=h.actor_user_id
    WHERE h.manufacturer_link_id=${id}
    ORDER BY h.id`;
  return rows.map((row:any)=>({
    id:Number(row.id),
    actor:row.actor_user_id==null
      ? {type:"SERVICE",service:row.actor_service}
      : {type:"USER",userId:Number(row.actor_user_id),displayName:row.actor_display_name||null},
    action:row.action,
    snapshot:row.snapshot,
    note:row.note||null,
    createdAt:row.created_at
  }));
}

async function listManufacturers(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"manufacturers.read");
  if(!auth.ok)return auth.response;

  const activeRaw=url.searchParams.get("active");
  if(activeRaw!=null&&activeRaw!==""&&!["true","false"].includes(activeRaw)){
    return json({error:"invalid_active"},400);
  }
  const active=activeRaw==null||activeRaw===""?null:activeRaw==="true";
  const rows=await db`
    SELECT
      m.id,m.name,m.legal_name,m.country_code,m.city,m.contact_name,
      m.email,m.phone,m.website,m.notes,m.active,
      m.created_by_user_id,creator.display_name AS created_by_display_name,
      m.updated_by_user_id,updater.display_name AS updated_by_display_name,
      m.created_at,m.updated_at
    FROM manufacturers m
    LEFT JOIN staff_users creator ON creator.id=m.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=m.updated_by_user_id
    WHERE (${active}::boolean IS NULL OR m.active=${active}::boolean)
    ORDER BY m.active DESC,m.name,m.id
    LIMIT 300`;
  return json({data:rows.map(mapManufacturer)});
}

async function createManufacturer(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"manufacturers.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const name=clean(body?.name,180);
  const legalName=clean(body?.legalName,240)||null;
  const countryCode=normalizeCountry(body?.countryCode);
  const city=clean(body?.city,160)||null;
  const contactName=clean(body?.contactName,160)||null;
  const email=clean(body?.email,254).toLowerCase()||null;
  const phone=clean(body?.phone,80)||null;
  const website=clean(body?.website,1000)||null;
  const notes=clean(body?.notes,4000)||null;

  if(name.length<2)return json({error:"name_required"},400);
  if(body?.countryCode&&!countryCode)return json({error:"invalid_country"},400);
  if(email&&!validEmail(email))return json({error:"invalid_email"},400);
  if(website&&!validWebsite(website))return json({error:"invalid_website"},400);

  const actor=actorFields(auth.actor);
  const result:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      INSERT INTO manufacturers(
        name,legal_name,country_code,city,contact_name,email,phone,website,notes,active,
        created_by_user_id,updated_by_user_id
      )
      VALUES(
        ${name},${legalName},${countryCode||null},${city},${contactName},
        ${email},${phone},${website},${notes},TRUE,
        ${auth.actor.type==="USER"?auth.actor.userId:null},
        ${auth.actor.type==="USER"?auth.actor.userId:null}
      )
      RETURNING id`;
    const id=Number(rows[0].id);
    const row=await manufacturerRow(tx,id);
    await tx`
      INSERT INTO manufacturer_history(
        manufacturer_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'CREATED',
        ${JSON.stringify(manufacturerSnapshot(row))}::jsonb,${notes}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"manufacturer.created",
      resourceType:"Manufacturer",
      resourceId:id,
      outcome:"SUCCESS",
      metadata:{
        supplierCreated:false,
        productionRunCreated:false,
        inventoryChanged:false
      }
    });
    return {id};
  });

  const row=await manufacturerRow(db,result.id);
  return json({
    manufacturer:mapManufacturer(row),
    supplierCreated:false,
    productionRunCreated:false,
    inventoryChanged:false
  },201);
}

async function updateManufacturer(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"manufacturers.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await manufacturerRow(db,id);
  if(!existing)return json({error:"not_found"},404);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const name=body?.name==null?existing.name:clean(body.name,180);
  const legalName=body?.legalName==null?existing.legal_name:(clean(body.legalName,240)||null);
  const rawCountry=body?.countryCode==null?existing.country_code:body.countryCode;
  const countryCode=normalizeCountry(rawCountry);
  const city=body?.city==null?existing.city:(clean(body.city,160)||null);
  const contactName=body?.contactName==null?existing.contact_name:(clean(body.contactName,160)||null);
  const email=body?.email==null?existing.email:(clean(body.email,254).toLowerCase()||null);
  const phone=body?.phone==null?existing.phone:(clean(body.phone,80)||null);
  const website=body?.website==null?existing.website:(clean(body.website,1000)||null);
  const notes=body?.notes==null?existing.notes:(clean(body.notes,4000)||null);
  const active=body?.active==null?Boolean(existing.active):body.active===true;
  const note=clean(body?.changeNote,1000)||null;

  if(name.length<2)return json({error:"name_required"},400);
  if(rawCountry&&!countryCode)return json({error:"invalid_country"},400);
  if(email&&!validEmail(email))return json({error:"invalid_email"},400);
  if(website&&!validWebsite(website))return json({error:"invalid_website"},400);

  const actor=actorFields(auth.actor);
  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE manufacturers
      SET name=${name},legal_name=${legalName},country_code=${countryCode||null},
          city=${city},contact_name=${contactName},email=${email},phone=${phone},
          website=${website},notes=${notes},active=${active},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    const row=await manufacturerRow(tx,id);
    await tx`
      INSERT INTO manufacturer_history(
        manufacturer_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(manufacturerSnapshot(row))}::jsonb,${note}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"manufacturer.updated",
      resourceType:"Manufacturer",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{
        fromActive:Boolean(existing.active),
        toActive:active,
        supplierCreated:false,
        productionRunCreated:false,
        inventoryChanged:false
      }
    });
  });

  const row=await manufacturerRow(db,id);
  return json({
    manufacturer:mapManufacturer(row),
    history:await manufacturerHistory(db,id),
    supplierCreated:false,
    productionRunCreated:false,
    inventoryChanged:false
  });
}

async function getManufacturer(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"manufacturers.read");
  if(!auth.ok)return auth.response;
  const row=await manufacturerRow(db,id);
  if(!row)return json({error:"not_found"},404);
  const links=await db`
    SELECT
      l.id,l.manufacturer_id,m.name AS manufacturer_name,m.active AS manufacturer_active,
      l.target_type,l.product_id,l.variant_id,l.manufacturer_reference,l.notes,l.active,
      COALESCE(p.id,pv_product.id) AS resolved_product_id,
      COALESCE(p.name,pv_product.name) AS product_name,
      COALESCE(p.category,pv_product.category) AS category,
      pv.sku,pv.size,pv.color,
      l.created_by_user_id,creator.display_name AS created_by_display_name,
      l.updated_by_user_id,updater.display_name AS updated_by_display_name,
      l.created_at,l.updated_at
    FROM manufacturer_links l
    JOIN manufacturers m ON m.id=l.manufacturer_id
    LEFT JOIN products p ON p.id=l.product_id
    LEFT JOIN product_variants pv ON pv.id=l.variant_id
    LEFT JOIN products pv_product ON pv_product.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=l.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=l.updated_by_user_id
    WHERE l.manufacturer_id=${id}
    ORDER BY l.active DESC,l.updated_at DESC,l.id DESC`;
  return json({
    manufacturer:mapManufacturer(row),
    links:links.map(mapLink),
    history:await manufacturerHistory(db,id),
    automaticManufacturerSelection:false,
    productionRunCreated:false
  });
}

async function resolveTarget(db:DB,targetType:string,targetId:number){
  if(targetType==="PRODUCT"){
    const rows=await db`
      SELECT id,name,category,commercial_model
      FROM products
      WHERE id=${targetId}
      LIMIT 1`;
    if(!rows.length)return {error:"product_not_found" as const,status:404};
    return {
      productId:targetId,
      variantId:null,
      productName:rows[0].name,
      commercialModel:rows[0].commercial_model||null
    };
  }

  const rows=await db`
    SELECT
      pv.id,pv.product_id,pv.sku,p.name,p.commercial_model
    FROM product_variants pv
    JOIN products p ON p.id=pv.product_id
    WHERE pv.id=${targetId}
    LIMIT 1`;
  if(!rows.length)return {error:"variant_not_found" as const,status:404};
  return {
    productId:null,
    variantId:targetId,
    resolvedProductId:Number(rows[0].product_id),
    productName:rows[0].name,
    sku:rows[0].sku,
    commercialModel:rows[0].commercial_model||null
  };
}

async function listLinks(req:Request,url:URL,db:DB){
  const auth=await authorizeInternal(req,db,"manufacturers.read");
  if(!auth.ok)return auth.response;

  const manufacturerRaw=url.searchParams.get("manufacturerId");
  const productRaw=url.searchParams.get("productId");
  const variantRaw=url.searchParams.get("variantId");
  const activeRaw=url.searchParams.get("active");

  const manufacturerId=manufacturerRaw?Number(manufacturerRaw):null;
  const productId=productRaw?Number(productRaw):null;
  const variantId=variantRaw?Number(variantRaw):null;
  if(manufacturerId!=null&&(!Number.isSafeInteger(manufacturerId)||manufacturerId<1)){
    return json({error:"invalid_manufacturer"},400);
  }
  if(productId!=null&&(!Number.isSafeInteger(productId)||productId<1)){
    return json({error:"invalid_product"},400);
  }
  if(variantId!=null&&(!Number.isSafeInteger(variantId)||variantId<1)){
    return json({error:"invalid_variant"},400);
  }
  if(activeRaw!=null&&activeRaw!==""&&!["true","false"].includes(activeRaw)){
    return json({error:"invalid_active"},400);
  }
  const active=activeRaw==null||activeRaw===""?null:activeRaw==="true";

  const rows=await db`
    SELECT
      l.id,l.manufacturer_id,m.name AS manufacturer_name,m.active AS manufacturer_active,
      l.target_type,l.product_id,l.variant_id,l.manufacturer_reference,l.notes,l.active,
      COALESCE(p.id,pv_product.id) AS resolved_product_id,
      COALESCE(p.name,pv_product.name) AS product_name,
      COALESCE(p.category,pv_product.category) AS category,
      pv.sku,pv.size,pv.color,
      l.created_by_user_id,creator.display_name AS created_by_display_name,
      l.updated_by_user_id,updater.display_name AS updated_by_display_name,
      l.created_at,l.updated_at
    FROM manufacturer_links l
    JOIN manufacturers m ON m.id=l.manufacturer_id
    LEFT JOIN products p ON p.id=l.product_id
    LEFT JOIN product_variants pv ON pv.id=l.variant_id
    LEFT JOIN products pv_product ON pv_product.id=pv.product_id
    LEFT JOIN staff_users creator ON creator.id=l.created_by_user_id
    LEFT JOIN staff_users updater ON updater.id=l.updated_by_user_id
    WHERE (${manufacturerId}::bigint IS NULL OR l.manufacturer_id=${manufacturerId}::bigint)
      AND (
        ${productId}::bigint IS NULL OR
        l.product_id=${productId}::bigint OR
        pv.product_id=${productId}::bigint
      )
      AND (${variantId}::bigint IS NULL OR l.variant_id=${variantId}::bigint)
      AND (${active}::boolean IS NULL OR l.active=${active}::boolean)
    ORDER BY l.active DESC,m.name,l.updated_at DESC,l.id DESC
    LIMIT 500`;

  return json({data:rows.map(mapLink)});
}

async function createLink(req:Request,db:DB){
  const auth=await authorizeInternal(req,db,"manufacturers.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const manufacturerId=Number(body?.manufacturerId);
  const targetType=clean(body?.targetType,20).toUpperCase();
  const targetId=Number(body?.targetId);
  const manufacturerReference=clean(body?.manufacturerReference,240)||null;
  const notes=clean(body?.notes,2000)||null;

  if(!Number.isSafeInteger(manufacturerId)||manufacturerId<1){
    return json({error:"invalid_manufacturer"},400);
  }
  if(!TARGET_TYPES.has(targetType))return json({error:"invalid_target_type"},400);
  if(!Number.isSafeInteger(targetId)||targetId<1)return json({error:"invalid_target"},400);

  const manufacturers=await db`
    SELECT id,active
    FROM manufacturers
    WHERE id=${manufacturerId}
    LIMIT 1`;
  if(!manufacturers.length)return json({error:"manufacturer_not_found"},404);
  if(!manufacturers[0].active)return json({error:"manufacturer_inactive"},409);

  const target:any=await resolveTarget(db,targetType,targetId);
  if(target.error)return json({error:target.error},target.status||400);

  const actor=actorFields(auth.actor);
  try{
    const result:any=await db.begin(async(tx:DB)=>{
      const rows=await tx`
        INSERT INTO manufacturer_links(
          manufacturer_id,target_type,product_id,variant_id,
          manufacturer_reference,notes,active,created_by_user_id,updated_by_user_id
        )
        VALUES(
          ${manufacturerId},${targetType},${target.productId},${target.variantId},
          ${manufacturerReference},${notes},TRUE,
          ${auth.actor.type==="USER"?auth.actor.userId:null},
          ${auth.actor.type==="USER"?auth.actor.userId:null}
        )
        RETURNING id`;
      const id=Number(rows[0].id);
      const row=await linkRow(tx,id);
      await tx`
        INSERT INTO manufacturer_link_history(
          manufacturer_link_id,actor_user_id,actor_service,action,snapshot,note
        )
        VALUES(
          ${id},${actor.userId},${actor.service},'CREATED',
          ${JSON.stringify(linkSnapshot(row))}::jsonb,${notes}
        )`;
      await writeAuditEvent(tx,{
        ...auditActor(auth.actor),
        action:"manufacturer_link.created",
        resourceType:"ManufacturerLink",
        resourceId:id,
        outcome:"SUCCESS",
        metadata:{
          manufacturerId,
          targetType,
          targetId,
          commercialModelObserved:target.commercialModel||null,
          commercialModelChanged:false,
          supplierCreated:false,
          supplierVariantCreated:false,
          productionRunCreated:false,
          inventoryChanged:false
        }
      });
      return {id};
    });

    const row=await linkRow(db,result.id);
    return json({
      link:mapLink(row),
      automaticManufacturerSelection:false,
      productionRunCreated:false,
      inventoryChanged:false
    },201);
  }catch(error:any){
    if(error?.code==="23505" || String(error?.message||"").includes("duplicate key")){
      return json({error:"manufacturer_link_exists"},409);
    }
    throw error;
  }
}

async function updateLink(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"manufacturers.manage",{mutation:true});
  if(!auth.ok)return auth.response;

  const existing=await linkRow(db,id);
  if(!existing)return json({error:"not_found"},404);

  let body:any;
  try{body=await req.json();}catch{return json({error:"invalid_json"},400);}

  const manufacturerReference=body?.manufacturerReference==null
    ? existing.manufacturer_reference
    : (clean(body.manufacturerReference,240)||null);
  const notes=body?.notes==null?existing.notes:(clean(body.notes,2000)||null);
  const active=body?.active==null?Boolean(existing.active):body.active===true;
  const changeNote=clean(body?.changeNote,1000)||null;

  if(active && !existing.active && !existing.manufacturer_active){
    return json({error:"manufacturer_inactive"},409);
  }

  const actor=actorFields(auth.actor);
  await db.begin(async(tx:DB)=>{
    await tx`
      UPDATE manufacturer_links
      SET manufacturer_reference=${manufacturerReference},
          notes=${notes},
          active=${active},
          updated_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
          updated_at=NOW()
      WHERE id=${id}`;
    const row=await linkRow(tx,id);
    await tx`
      INSERT INTO manufacturer_link_history(
        manufacturer_link_id,actor_user_id,actor_service,action,snapshot,note
      )
      VALUES(
        ${id},${actor.userId},${actor.service},'UPDATED',
        ${JSON.stringify(linkSnapshot(row))}::jsonb,${changeNote}
      )`;
    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"manufacturer_link.updated",
      resourceType:"ManufacturerLink",
      resourceId:id,
      outcome:"SUCCESS",
      reason:changeNote,
      metadata:{
        fromActive:Boolean(existing.active),
        toActive:active,
        commercialModelChanged:false,
        supplierCreated:false,
        supplierVariantCreated:false,
        productionRunCreated:false,
        inventoryChanged:false
      }
    });
  });

  const row=await linkRow(db,id);
  return json({
    link:mapLink(row),
    history:await linkHistory(db,id),
    automaticManufacturerSelection:false,
    productionRunCreated:false,
    inventoryChanged:false
  });
}

async function getLink(req:Request,db:DB,id:number){
  const auth=await authorizeInternal(req,db,"manufacturers.read");
  if(!auth.ok)return auth.response;
  const row=await linkRow(db,id);
  if(!row)return json({error:"not_found"},404);
  return json({
    link:mapLink(row),
    history:await linkHistory(db,id),
    automaticManufacturerSelection:false,
    productionRunCreated:false
  });
}

export async function handleManufacturerRegistry(req:Request,url:URL,db:DB){
  if(url.pathname==="/v1/internal/manufacturers"){
    if(req.method==="GET")return listManufacturers(req,url,db);
    if(req.method==="POST")return createManufacturer(req,db);
    return json({error:"method_not_allowed"},405);
  }

  const manufacturerMatch=url.pathname.match(/^\/v1\/internal\/manufacturers\/(\d+)$/);
  if(manufacturerMatch){
    const id=Number(manufacturerMatch[1]);
    if(req.method==="GET")return getManufacturer(req,db,id);
    if(req.method==="PATCH")return updateManufacturer(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  if(url.pathname==="/v1/internal/manufacturer-links"){
    if(req.method==="GET")return listLinks(req,url,db);
    if(req.method==="POST")return createLink(req,db);
    return json({error:"method_not_allowed"},405);
  }

  const linkMatch=url.pathname.match(/^\/v1\/internal\/manufacturer-links\/(\d+)$/);
  if(linkMatch){
    const id=Number(linkMatch[1]);
    if(req.method==="GET")return getLink(req,db,id);
    if(req.method==="PATCH")return updateLink(req,db,id);
    return json({error:"method_not_allowed"},405);
  }

  if(
    url.pathname.startsWith("/v1/internal/manufacturers") ||
    url.pathname.startsWith("/v1/internal/manufacturer-links")
  ){
    return json({error:"not_found"},404);
  }

  return null;
}
