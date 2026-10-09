import { SQL } from "bun";

if (Bun.env.ALLOW_DESTRUCTIVE_TEST_DB !== "true") {
  throw new Error("Refusing destructive integration test without ALLOW_DESTRUCTIVE_TEST_DB=true");
}

const db = new SQL({
  hostname: Bun.env.PGHOST!,
  port: Number(Bun.env.PGPORT || 5432),
  username: Bun.env.PGUSER!,
  password: Bun.env.PGPASSWORD!,
  database: Bun.env.PGDATABASE!,
  tls: false,
  max: 5
});

const base = Bun.env.API_BASE_URL || "http://127.0.0.1:3011";
let failures = 0;

function ok(condition: unknown, message: string) {
  if (!condition) {
    failures++;
    console.error("FAIL", message);
  } else {
    console.log("ok  ", message);
  }
}

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(base + path, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function cookieFrom(response: Response) {
  return (response.headers.get("set-cookie") || "").split(";")[0] || "";
}

async function createStaff(roleCode: string, prefix: string) {
  const slug = prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const email = slug + "-" + crypto.randomUUID().slice(0,8) + "@example.test";
  const password = "ASSORT-" + crypto.randomUUID() + "-R9!";
  const hash = await Bun.password.hash(password, { algorithm:"argon2id" });

  const users = await db`
    INSERT INTO staff_users(
      email_normalized,display_name,password_hash,status,email_verified_at
    )
    VALUES(${email},${prefix},${hash},'ACTIVE',NOW())
    RETURNING id`;
  const roles = await db`SELECT id FROM roles WHERE code=${roleCode} LIMIT 1`;
  if (!roles.length) throw new Error("role_missing:" + roleCode);
  await db`
    INSERT INTO user_role_assignments(user_id,role_id,scope_type,scope_location_id)
    VALUES(${Number(users[0].id)},${Number(roles[0].id)},'GLOBAL',NULL)`;

  const login = await api("/v1/auth/login",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({email,password})
  });

  return {
    userId:Number(users[0].id),
    cookie:cookieFrom(login.response),
    csrf:String(login.body.csrfToken||""),
    login
  };
}

function authHeaders(session:{cookie:string;csrf:string}) {
  return {
    cookie:session.cookie,
    "x-csrf-token":session.csrf,
    "content-type":"application/json"
  };
}

const productRows = await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES(
    'Producto Assortment CI',
    ${"assortment-ci-"+crypto.randomUUID()},
    'Calzado',
    'Marca Test',
    'active'
  )
  RETURNING id,name,category,brand,status`;
const productId=Number(productRows[0].id);

const manager=await createStaff("MANAGER","Assortment Manager");
const analyst=await createStaff("ANALYST","Assortment Analyst");
ok(manager.login.response.status===200,"manager inicia sesión");
ok(analyst.login.response.status===200,"analyst inicia sesión");

const beforeProduct=(await db`
  SELECT name,category,brand,status
  FROM products WHERE id=${productId}`)[0];
const beforePO=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const beforeSources=Number((await db`SELECT COUNT(*)::int count FROM inventory_sources`)[0]?.count||0);

const analystList=await api("/v1/internal/assortment-decisions",{
  headers:{cookie:analyst.cookie}
});
ok(analystList.response.status===200,"Analyst puede leer decisiones");

const analystCreate=await api("/v1/internal/assortment-decisions",{
  method:"POST",
  headers:authHeaders(analyst),
  body:JSON.stringify({
    targetType:"PRODUCT",
    productId,
    direction:"WATCH",
    priority:1,
    rationale:"Analyst should not be able to mutate this log."
  })
});
ok(
  analystCreate.response.status===403 && analystCreate.body.error==="forbidden",
  "Analyst no puede crear decisiones"
);

const shortRationale=await api("/v1/internal/assortment-decisions",{
  method:"POST",
  headers:authHeaders(manager),
  body:JSON.stringify({
    targetType:"PRODUCT",
    productId,
    direction:"WATCH",
    priority:1,
    rationale:"corto"
  })
});
ok(
  shortRationale.response.status===400 &&
  shortRationale.body.error==="rationale_required",
  "rationale insuficiente se rechaza"
);

const createProduct=await api("/v1/internal/assortment-decisions",{
  method:"POST",
  headers:authHeaders(manager),
  body:JSON.stringify({
    targetType:"PRODUCT",
    productId,
    direction:"WATCH",
    priority:2,
    rationale:"Ventas prometedoras; observar dos ciclos adicionales antes de invertir.",
    evidenceReference:"Product Intelligence 90d"
  })
});
ok(createProduct.response.status===201,"manager registra decisión de producto");
ok(createProduct.body.automatedActionsTriggered===false,"crear decisión declara cero acciones automáticas");
const decisionId=Number(createProduct.body.decision?.id);
ok(Number(createProduct.body.decision?.productId)===productId,"decisión conserva product target");
ok(createProduct.body.decision?.targetLabel==="Producto Assortment CI","snapshot de label conserva producto");
ok(createProduct.body.decision?.direction==="WATCH","dirección inicial WATCH");
ok(createProduct.body.decision?.status==="OPEN","estado inicial OPEN");

const createCategory=await api("/v1/internal/assortment-decisions",{
  method:"POST",
  headers:authHeaders(manager),
  body:JSON.stringify({
    targetType:"CATEGORY",
    category:"Vestuario",
    direction:"SOURCE_SUPPLIER",
    priority:1,
    rationale:"Demanda no cubierta justifica explorar proveedores locales.",
    evidenceReference:"Intent queue + Product Intelligence"
  })
});
ok(createCategory.response.status===201,"manager registra decisión de categoría");
ok(createCategory.body.decision?.category==="Vestuario","categoría queda explícita");

const list=await api("/v1/internal/assortment-decisions?status=OPEN",{
  headers:{cookie:analyst.cookie}
});
ok(list.response.status===200,"lista filtrada responde");
ok(
  Array.isArray(list.body.data) &&
  list.body.data.some((x:any)=>Number(x.id)===decisionId),
  "lista contiene decisión creada"
);

const update=await api("/v1/internal/assortment-decisions/"+decisionId,{
  method:"PATCH",
  headers:authHeaders(manager),
  body:JSON.stringify({
    direction:"PRIVATE_LABEL_CANDIDATE",
    status:"VALIDATED",
    priority:3,
    rationale:"Datos suficientes para estudiar factibilidad de marca propia; aún no autoriza inversión.",
    evidenceReference:"Product Intelligence 90d + revisión de devoluciones",
    note:"Se valida únicamente como hipótesis estratégica."
  })
});
ok(update.response.status===200,"manager actualiza dirección y lifecycle");
ok(update.body.decision?.direction==="PRIVATE_LABEL_CANDIDATE","dirección cambia a candidate");
ok(update.body.decision?.status==="VALIDATED","decision record puede validarse");
ok(update.body.automatedActionsTriggered===false,"actualización tampoco ejecuta acciones");
ok(
  Array.isArray(update.body.history) && update.body.history.length===2,
  "historial append-only conserva creación y actualización"
);

const detail=await api("/v1/internal/assortment-decisions/"+decisionId,{
  headers:{cookie:analyst.cookie}
});
ok(detail.response.status===200,"Analyst consulta detalle e historial");
ok(detail.body.history?.[0]?.action==="CREATED","historial inicia con CREATED");
ok(detail.body.history?.[1]?.action==="UPDATED","historial registra UPDATED");

const archive=await api("/v1/internal/assortment-decisions/"+decisionId,{
  method:"PATCH",
  headers:authHeaders(manager),
  body:JSON.stringify({
    status:"ARCHIVED",
    note:"Se archiva el registro después de revisión."
  })
});
ok(archive.response.status===200 && archive.body.decision?.status==="ARCHIVED","decisión puede archivarse");

const reopenArchived=await api("/v1/internal/assortment-decisions/"+decisionId,{
  method:"PATCH",
  headers:authHeaders(manager),
  body:JSON.stringify({status:"OPEN",note:"Intento inválido"})
});
ok(
  reopenArchived.response.status===409 &&
  reopenArchived.body.error==="decision_archived",
  "ARCHIVED es terminal"
);

const afterProduct=(await db`
  SELECT name,category,brand,status
  FROM products WHERE id=${productId}`)[0];
ok(
  JSON.stringify(afterProduct)===JSON.stringify(beforeProduct),
  "decision log no modifica producto/catalog status/brand"
);

const afterPO=Number((await db`SELECT COUNT(*)::int count FROM purchase_orders`)[0]?.count||0);
const afterSources=Number((await db`SELECT COUNT(*)::int count FROM inventory_sources`)[0]?.count||0);
ok(afterPO===beforePO,"decision log no crea PurchaseOrder");
ok(afterSources===beforeSources,"decision log no crea InventorySource");

const auditRows=await db`
  SELECT action
  FROM audit_events
  WHERE resource_type='AssortmentDecision'
    AND resource_id=${String(decisionId)}
  ORDER BY id`;
ok(
  auditRows.some((x:any)=>x.action==="assortment_decision.created"),
  "creación queda en audit_events"
);
ok(
  auditRows.filter((x:any)=>x.action==="assortment_decision.updated").length>=2,
  "cambios quedan en audit_events"
);

const moneyTables=await db`
  SELECT
    to_regclass('public.settlement_lines') AS settlement_lines,
    to_regclass('public.settlement_statements') AS settlement_statements,
    to_regclass('public.commission_accruals') AS commission_accruals,
    to_regclass('public.commission_statements') AS commission_statements`;
ok(moneyTables[0]?.settlement_lines==null,"no crea SettlementLine");
ok(moneyTables[0]?.settlement_statements==null,"no crea SettlementStatement");
ok(moneyTables[0]?.commission_accruals==null,"no crea CommissionAccrual");
ok(moneyTables[0]?.commission_statements==null,"no crea CommissionStatement");

const unauth=await api("/v1/internal/assortment-decisions");
ok(unauth.response.status===401,"registro interno exige autenticación");

if(failures){
  console.error(failures+" fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — Assortment Decision Log v1");
await db.close();
