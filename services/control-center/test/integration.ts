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
  max: 4
});

const apiBase = Bun.env.API_BASE_URL || "http://127.0.0.1:3011";
const centerBase = "http://127.0.0.1:3022";
const serviceKey = Bun.env.INTERNAL_API_TOKEN || "ci-service-token";
let failures = 0;

function ok(condition: unknown, message: string) {
  if (!condition) {
    failures++;
    console.error("FAIL", message);
  } else {
    console.log("ok  ", message);
  }
}

async function jsonApi(path: string, options: RequestInit = {}) {
  const response = await fetch(apiBase + path, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function setCookieValues(response: Response) {
  const headers: any = response.headers;
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const value = response.headers.get("set-cookie");
  return value ? [value] : [];
}

function cookieHeaderFrom(response: Response) {
  return setCookieValues(response)
    .map((value: string) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

function cookieValue(header: string, name: string) {
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

await db.unsafe(
  "TRUNCATE TABLE audit_events, staff_sessions, user_role_assignments, staff_users RESTART IDENTITY CASCADE"
);

const adminSecret = "CC-" + crypto.randomUUID() + "-9z!";
const bootstrap = await jsonApi("/v1/security/bootstrap", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-internal-key": serviceKey
  },
  body: JSON.stringify({
    email: "control-center-ci@example.test",
    displayName: "Control Center CI",
    password: adminSecret
  })
});
ok(bootstrap.response.status === 201, "crea StaffUser para Control Center");

const inquiry = await db`
  INSERT INTO public_inquiries(
    kind, name, contact, message, status, public_token
  )
  VALUES(
    'product_request', 'Cliente Control CI', '5555-1010',
    'Necesito producto de prueba', 'new', ${crypto.randomUUID()}
  )
  RETURNING id`;
const inquiryId = Number(inquiry[0].id);

const purchaseLocation = await db`
  INSERT INTO locations(name,country_code,type,active)
  VALUES(${"Control Center Store " + crypto.randomUUID().slice(0,6)},'HN','store',TRUE)
  RETURNING id`;
const purchaseLocationId = Number(purchaseLocation[0].id);

const purchaseSupplier = await db`
  INSERT INTO suppliers(name,country_code,active)
  VALUES('Proveedor Control Center CI','HN',TRUE)
  RETURNING id`;
const purchaseSupplierId = Number(purchaseSupplier[0].id);

const purchaseProduct = await db`
  INSERT INTO products(name,slug,category,brand,status)
  VALUES(
    'Producto Compra Control CI',
    ${"cc-purchase-" + crypto.randomUUID()},
    'Prueba',
    'MR',
    'active'
  )
  RETURNING id`;
const purchaseProductId = Number(purchaseProduct[0].id);

const purchaseVariant = await db`
  INSERT INTO product_variants(
    product_id,sku,size,color,cost,price,currency,active
  )
  VALUES(
    ${purchaseProductId},
    ${"CC-PUR-" + crypto.randomUUID().slice(0,8)},
    'M','Negro',0,300.00,'HNL',TRUE
  )
  RETURNING id`;
const purchaseVariantId = Number(purchaseVariant[0].id);

const child = Bun.spawn({
  cmd: ["bun", "run", "services/control-center/index.ts"],
  env: {
    ...Bun.env,
    PORT: "3022",
    CATALOG_API_URL: apiBase,
    CONTROL_CENTER_PASSWORD: "",
    CONTROL_CENTER_SESSION_SECRET: ""
  },
  stdout: "pipe",
  stderr: "pipe"
});

try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(centerBase + "/ready");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await Bun.sleep(250);
  }
  ok(ready, "Control Center inicia usando Commerce Core sin contraseña compartida");

  const loginPage = await fetch(centerBase + "/login");
  const loginHtml = await loginPage.text();
  ok(
    loginPage.status === 200 &&
    loginHtml.includes('name="email"') &&
    loginHtml.includes("StaffUser"),
    "pantalla de acceso solicita identidad individual"
  );

  const loginResponse = await fetch(centerBase + "/login", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      email: "control-center-ci@example.test",
      password: adminSecret
    }).toString()
  });
  const cookies = cookieHeaderFrom(loginResponse);
  const csrf = cookieValue(cookies, "mrcc_csrf");
  ok(loginResponse.status === 303, "login del Control Center autentica contra Catalog API");
  ok(
    cookies.includes("mrstaff=") && Boolean(csrf),
    "Control Center establece sesión StaffUser y CSRF"
  );

  const dashboard = await fetch(centerBase + "/", {
    headers: { cookie: cookies }
  });
  const dashboardHtml = await dashboard.text();
  ok(
    dashboard.status === 200 &&
    dashboardHtml.includes("Control Center CI") &&
    dashboardHtml.includes("Cliente Control CI"),
    "dashboard consume datos autorizados del Commerce Core"
  );

  const purchasesPage = await fetch(centerBase + "/purchases", {
    headers: { cookie: cookies }
  });
  const purchasesHtml = await purchasesPage.text();
  ok(
    purchasesPage.status === 200 &&
    purchasesHtml.includes("Registrar compra de mercadería") &&
    purchasesHtml.includes("Proveedor Control Center CI") &&
    purchasesHtml.includes("Producto Compra Control CI"),
    "Compras muestra formulario con proveedor, ubicación y variante"
  );

  const createPurchase = await fetch(centerBase + "/purchases", {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: cookies,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      csrf,
      supplierId: String(purchaseSupplierId),
      destinationLocationId: String(purchaseLocationId),
      variantId: String(purchaseVariantId),
      quantityOrdered: "3",
      unitCost: "125.50",
      supplierSku: "SUP-CC-001",
      originCountryCode: "HN",
      supplierReference: "CC-PO-INTEGRATION",
      shippingEstimate: "10",
      taxEstimate: "5",
      otherCosts: "2.50"
    }).toString()
  });
  ok(createPurchase.status === 303, "Control Center crea orden de compra");

  const poRows = await db`
    SELECT id,status,subtotal_minor,grand_total_minor
    FROM purchase_orders
    WHERE supplier_reference='CC-PO-INTEGRATION'
    ORDER BY id DESC
    LIMIT 1`;
  const purchaseOrderId = Number(poRows[0]?.id);
  ok(
    purchaseOrderId > 0 &&
    poRows[0]?.status === "DRAFT" &&
    Number(poRows[0]?.subtotal_minor) === 37650 &&
    Number(poRows[0]?.grand_total_minor) === 39400,
    "orden creada desde UI conserva cálculo server-side"
  );

  const approvePurchase = await fetch(
    centerBase + "/purchases/" + purchaseOrderId + "/approve",
    {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: cookies,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ csrf }).toString()
    }
  );
  ok(approvePurchase.status === 303, "Control Center aprueba orden de compra");

  const orderPurchase = await fetch(
    centerBase + "/purchases/" + purchaseOrderId + "/order",
    {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: cookies,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ csrf }).toString()
    }
  );
  ok(orderPurchase.status === 303, "Control Center marca compra como ordenada");

  const orderedPage = await fetch(centerBase + "/purchases", {
    headers: { cookie: cookies }
  });
  const orderedHtml = await orderedPage.text();
  ok(
    orderedPage.status === 200 &&
    orderedHtml.includes("Recibir mercadería") &&
    orderedHtml.includes("Producto Compra Control CI"),
    "orden ORDERED habilita recepción de mercadería"
  );

  const poItemRows = await db`
    SELECT id
    FROM purchase_order_items
    WHERE purchase_order_id=${purchaseOrderId}
    LIMIT 1`;
  const purchaseOrderItemId = Number(poItemRows[0]?.id);

  const receivePurchase = await fetch(
    centerBase + "/purchases/" + purchaseOrderId + "/receive",
    {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: cookies,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        csrf,
        supplierDeliveryReference: "CC-DELIVERY-1",
        ["qty_" + purchaseOrderItemId]: "3"
      }).toString()
    }
  );
  ok(receivePurchase.status === 303, "Control Center registra recepción");

  const receivedPo = await db`
    SELECT status
    FROM purchase_orders
    WHERE id=${purchaseOrderId}`;
  const receivedInventory = await db`
    SELECT quantity,reserved
    FROM inventory
    WHERE variant_id=${purchaseVariantId}
      AND location_id=${purchaseLocationId}`;
  ok(
    receivedPo[0]?.status === "RECEIVED" &&
    Number(receivedInventory[0]?.quantity) === 3 &&
    Number(receivedInventory[0]?.reserved) === 0,
    "recepción desde UI suma inventario y completa la orden"
  );

  const invalidUpdate = await fetch(centerBase + "/inquiries/" + inquiryId + "/update", {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: cookies,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      csrf: "invalid",
      status: "reviewing",
      priority: "2"
    }).toString()
  });
  ok(invalidUpdate.status === 403, "BFF rechaza formulario con CSRF inválido");

  const update = await fetch(centerBase + "/inquiries/" + inquiryId + "/update", {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: cookies,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      csrf,
      status: "qualified",
      priority: "2",
      assigned_to: "Equipo CI",
      internal_notes: "Validado por integración"
    }).toString()
  });
  ok(update.status === 303, "mutación autorizada se procesa por API");

  const updated = await db`
    SELECT status, priority, assigned_to, internal_notes
    FROM public_inquiries
    WHERE id = ${inquiryId}`;
  ok(
    updated[0]?.status === "qualified" &&
    Number(updated[0]?.priority) === 2 &&
    updated[0]?.assigned_to === "Equipo CI",
    "API persiste campos operativos del Control Center"
  );

  const opportunity = await fetch(
    centerBase + "/inquiries/" + inquiryId + "/opportunity",
    {
      method: "POST",
      redirect: "manual",
      headers: {
        cookie: cookies,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ csrf }).toString()
    }
  );
  ok(opportunity.status === 303, "StaffUser puede crear oportunidad con permiso");

  const opportunityRows = await db`
    SELECT inquiry_id, owner, status
    FROM sourcing_opportunities
    WHERE inquiry_id = ${inquiryId}`;
  ok(
    opportunityRows.length === 1 &&
    String(opportunityRows[0].owner).startsWith("staff:"),
    "oportunidad registra actor StaffUser"
  );

  const auditRows = await db`
    SELECT actor_type, actor_user_id, action
    FROM audit_events
    WHERE action IN ('inquiry.updated','inquiry.opportunity_created')
    ORDER BY id`;
  ok(
    auditRows.length >= 2 &&
    auditRows.every((row: any) => row.actor_type === "USER"),
    "acciones del panel quedan auditadas como usuario humano"
  );

  const logout = await fetch(centerBase + "/logout", {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: cookies,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ csrf }).toString()
  });
  ok(logout.status === 303, "logout revoca sesión mediante Commerce Core");

  const afterLogout = await fetch(centerBase + "/", {
    headers: { cookie: cookies }
  });
  ok(afterLogout.status === 401, "sesión revocada ya no abre Control Center");
} finally {
  child.kill();
  await child.exited;
  await db.close();
}

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — Control Center StaffUser/BFF");
