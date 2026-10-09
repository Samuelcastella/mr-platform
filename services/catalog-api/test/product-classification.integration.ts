import { SQL } from "bun";

if (Bun.env.ALLOW_DESTRUCTIVE_TEST_DB !== "true") {
  throw new Error("Refusing destructive integration test without ALLOW_DESTRUCTIVE_TEST_DB=true");
}

const db = new SQL({
  hostname:Bun.env.PGHOST!,
  port:Number(Bun.env.PGPORT||5432),
  username:Bun.env.PGUSER!,
  password:Bun.env.PGPASSWORD!,
  database:Bun.env.PGDATABASE!,
  tls:false,
  max:5
});

const base=Bun.env.API_BASE_URL||"http://127.0.0.1:3011";
const serviceKey=Bun.env.INTERNAL_API_TOKEN||"ci-internal-token";
let failures=0;

function ok(condition:unknown,message:string){
  if(!condition){failures++;console.error("FAIL",message);}
  else console.log("ok  ",message);
}

async function api(path:string,options:RequestInit={}){
  const response=await fetch(base+path,options);
  const body=await response.json().catch(()=>({}));
  return {response,body};
}

const internalHeaders={
  "content-type":"application/json",
  "x-internal-key":serviceKey
};

const legacyDraftRows=await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES(
    'Legacy Classification Draft',
    ${"legacy-class-draft-"+crypto.randomUUID()},
    'Legacy',
    'Legacy Brand',
    'draft'
  )
  RETURNING id`;
const legacyDraftId=Number(legacyDraftRows[0].id);

const legacyActiveRows=await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES(
    'Legacy Classification Active',
    ${"legacy-class-active-"+crypto.randomUUID()},
    'Legacy',
    'Legacy Brand',
    'active'
  )
  RETURNING id`;
const legacyActiveId=Number(legacyActiveRows[0].id);

const internalList=await api("/v1/internal/catalog",{
  headers:{"x-internal-key":serviceKey}
});
ok(internalList.response.status===200,"catálogo interno responde");
const legacyDraft=Array.isArray(internalList.body?.data)
  ? internalList.body.data.find((x:any)=>Number(x.id)===legacyDraftId)
  : null;
ok(Boolean(legacyDraft),"producto legacy permanece legible");
ok(legacyDraft?.commercial_model==null,"legacy no se reclasifica automáticamente");
ok(legacyDraft?.default_condition==null,"legacy no recibe condición inventada");

const publicLegacy=await api("/v1/products?status=active");
const legacyVisible=Array.isArray(publicLegacy.body?.data)
  ? publicLegacy.body.data.find((x:any)=>Number(x.id)===legacyActiveId)
  : null;
ok(Boolean(legacyVisible),"producto legacy ya activo no se despublica");
ok(legacyVisible?.commercialModel==null,"activo legacy conserva commercialModel null");
ok(legacyVisible?.defaultCondition==null,"activo legacy conserva defaultCondition null");

const publishUnclassified=await api("/v1/internal/catalog/products/"+legacyDraftId,{
  method:"PATCH",
  headers:internalHeaders,
  body:JSON.stringify({status:"active"})
});
ok(
  publishUnclassified.response.status===409 &&
  publishUnclassified.body.error==="classification_required",
  "legacy sin clasificación no puede pasar a active"
);

const partialLegacyClassification=await api("/v1/internal/catalog/products/"+legacyDraftId,{
  method:"PATCH",
  headers:internalHeaders,
  body:JSON.stringify({
    commercialModel:"third_party"
  })
});
ok(
  partialLegacyClassification.response.status===409 &&
  partialLegacyClassification.body.error==="classification_required",
  "reclasificación explícita no puede quedar parcial"
);

const classifyLegacy=await api("/v1/internal/catalog/products/"+legacyDraftId,{
  method:"PATCH",
  headers:internalHeaders,
  body:JSON.stringify({
    status:"active",
    commercialModel:"third_party",
    defaultCondition:"second_hand"
  })
});
ok(classifyLegacy.response.status===200,"legacy puede clasificarse explícitamente y publicarse");
ok(classifyLegacy.body.product?.commercial_model==="third_party","legacy conserva modelo explícito");
ok(classifyLegacy.body.product?.default_condition==="second_hand","legacy conserva condición explícita");

const missingModel=await api("/v1/internal/catalog/products",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({
    name:"Missing Classification Model",
    defaultCondition:"new",
    status:"draft",
    variants:[{
      sku:"MISS-MODEL-"+crypto.randomUUID().slice(0,8),
      price:100,
      currency:"HNL",
      stock:0
    }]
  })
});
ok(
  missingModel.response.status===400 &&
  missingModel.body.error==="commercial_model_required",
  "nueva alta exige commercialModel"
);

const missingCondition=await api("/v1/internal/catalog/products",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({
    name:"Missing Classification Condition",
    commercialModel:"curated",
    status:"draft",
    variants:[{
      sku:"MISS-COND-"+crypto.randomUUID().slice(0,8),
      price:100,
      currency:"HNL",
      stock:0
    }]
  })
});
ok(
  missingCondition.response.status===400 &&
  missingCondition.body.error==="default_condition_required",
  "nueva alta exige defaultCondition"
);

const invalidModel=await api("/v1/internal/catalog/products",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({
    name:"Invalid Classification Model",
    commercialModel:"consignment",
    defaultCondition:"new",
    status:"draft",
    variants:[{
      sku:"BAD-MODEL-"+crypto.randomUUID().slice(0,8),
      price:100,
      currency:"HNL",
      stock:0
    }]
  })
});
ok(
  invalidModel.response.status===400 &&
  invalidModel.body.error==="invalid_commercial_model",
  "rechaza vocabulario comercial fuera de M01"
);

const invalidCondition=await api("/v1/internal/catalog/products",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({
    name:"Invalid Classification Condition",
    commercialModel:"curated",
    defaultCondition:"used",
    status:"draft",
    variants:[{
      sku:"BAD-COND-"+crypto.randomUUID().slice(0,8),
      price:100,
      currency:"HNL",
      stock:0
    }]
  })
});
ok(
  invalidCondition.response.status===400 &&
  invalidCondition.body.error==="invalid_default_condition",
  "rechaza condición fuera del vocabulario M01"
);

const created=await api("/v1/internal/catalog/products",{
  method:"POST",
  headers:internalHeaders,
  body:JSON.stringify({
    name:"Classification CI Product",
    category:"Vestuario",
    brand:"MR",
    commercialModel:"curated",
    defaultCondition:"new",
    status:"active",
    variants:[{
      sku:"CLASS-CI-"+crypto.randomUUID().slice(0,8),
      size:"M",
      color:"Negro",
      price:900,
      currency:"HNL",
      stock:0
    }]
  })
});
ok(created.response.status===201,"crea producto nuevo con clasificación explícita");
const productId=Number(created.body.product?.id);
ok(created.body.product?.commercial_model==="curated","create devuelve commercial_model");
ok(created.body.product?.default_condition==="new","create devuelve default_condition");

const beforeSources=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_sources
  WHERE variant_id IN (
    SELECT id FROM product_variants WHERE product_id=${productId}
  )`)[0]?.count||0);
const beforeMovements=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_movements
  WHERE variant_id IN (
    SELECT id FROM product_variants WHERE product_id=${productId}
  )`)[0]?.count||0);
const beforeInventory=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory
  WHERE variant_id IN (
    SELECT id FROM product_variants WHERE product_id=${productId}
  )`)[0]?.count||0);

const reclassified=await api("/v1/internal/catalog/products/"+productId,{
  method:"PATCH",
  headers:internalHeaders,
  body:JSON.stringify({
    commercialModel:"private_label",
    defaultCondition:"new"
  })
});
ok(reclassified.response.status===200,"permite reclasificación manual");
ok(reclassified.body.product?.commercial_model==="private_label","reclasificación cambia merchandising model");

const afterSources=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_sources
  WHERE variant_id IN (
    SELECT id FROM product_variants WHERE product_id=${productId}
  )`)[0]?.count||0);
const afterMovements=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory_movements
  WHERE variant_id IN (
    SELECT id FROM product_variants WHERE product_id=${productId}
  )`)[0]?.count||0);
const afterInventory=Number((await db`
  SELECT COUNT(*)::int count
  FROM inventory
  WHERE variant_id IN (
    SELECT id FROM product_variants WHERE product_id=${productId}
  )`)[0]?.count||0);

ok(afterSources===beforeSources,"commercial_model no crea ni modifica InventorySource");
ok(afterMovements===beforeMovements,"reclasificación no crea movimientos de inventario");
ok(afterInventory===beforeInventory,"reclasificación no crea niveles de inventario");

const publicCreated=await api("/v1/products?status=active");
const publicProduct=Array.isArray(publicCreated.body?.data)
  ? publicCreated.body.data.find((x:any)=>Number(x.id)===productId)
  : null;
ok(Boolean(publicProduct),"producto clasificado aparece públicamente");
ok(publicProduct?.commercialModel==="private_label","API pública expone modelo comercial");
ok(publicProduct?.defaultCondition==="new","API pública expone condición");

const commercialConstraint=await db`
  SELECT conname
  FROM pg_constraint
  WHERE conname='products_commercial_model_check'`;
ok(commercialConstraint.length===1,"constraint DB de commercial_model existe");

let constraintRejected=false;
try{
  await db`
    INSERT INTO products(
      name,slug,category,brand,status,commercial_model,default_condition
    )
    VALUES(
      'Constraint Invalid',
      ${"constraint-invalid-"+crypto.randomUUID()},
      'Test','Test','draft','seller_owned','new'
    )`;
}catch{
  constraintRejected=true;
}
ok(constraintRejected,"constraint DB rechaza commercial_model inválido");

const audit=await db`
  SELECT action,metadata
  FROM audit_events
  WHERE resource_type='Product'
    AND resource_id=${String(productId)}
  ORDER BY id`;
ok(audit.some((x:any)=>x.action==="catalog.product_created"),"creación queda auditada");
const updateAudit=audit.find((x:any)=>x.action==="catalog.product_updated");
ok(Boolean(updateAudit),"reclasificación queda auditada");
let updateMetadata:any={};
try{
  updateMetadata=typeof updateAudit?.metadata==="string"
    ? JSON.parse(updateAudit.metadata)
    : (updateAudit?.metadata||{});
}catch{
  updateMetadata={};
}
ok(
  updateMetadata.economicOwnershipChanged===false,
  "audit explicita que ownership económico no cambió"
);

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — M01 Product Classification v1");
await db.close();
