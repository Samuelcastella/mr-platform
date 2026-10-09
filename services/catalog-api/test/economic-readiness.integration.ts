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

async function login(email: string, password: string) {
  const result = await api("/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  return {
    ...result,
    cookie: cookieFrom(result.response),
    csrf: String(result.body.csrfToken || "")
  };
}

function headers(session: { cookie: string; csrf: string }) {
  return {
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
    "content-type": "application/json"
  };
}

async function createStaff(email: string, displayName: string, roleCode = "MANAGER") {
  const password = "READY-" + crypto.randomUUID() + "-R9!";
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  const users = await db`
    INSERT INTO staff_users(
      email_normalized,display_name,password_hash,status,email_verified_at
    )
    VALUES(${email},${displayName},${hash},'ACTIVE',NOW())
    RETURNING id`;
  const roles = await db`SELECT id FROM roles WHERE code=${roleCode} LIMIT 1`;
  if (!roles.length) throw new Error("role_missing:" + roleCode);
  await db`
    INSERT INTO user_role_assignments(user_id,role_id,scope_type,scope_location_id)
    VALUES(${Number(users[0].id)},${Number(roles[0].id)},'GLOBAL',NULL)`;
  return {
    userId: Number(users[0].id),
    session: await login(email, password)
  };
}

const manager1 = await createStaff(
  "readiness-manager1-" + crypto.randomUUID().slice(0,6) + "@example.test",
  "Readiness Manager One"
);
const manager2 = await createStaff(
  "readiness-manager2-" + crypto.randomUUID().slice(0,6) + "@example.test",
  "Readiness Manager Two"
);

ok(manager1.session.response.status === 200, "manager 1 inicia sesión");
ok(manager2.session.response.status === 200, "manager 2 inicia sesión");

const created = await api("/v1/internal/commission-rules", {
  method: "POST",
  headers: headers(manager1.session),
  body: JSON.stringify({
    name: "CI explicit rule " + crypto.randomUUID().slice(0,6),
    version: 1,
    scopeType: "GLOBAL",
    effectiveFrom: new Date(Date.now() - 60_000).toISOString()
  })
});
ok(created.response.status === 201, "crea CommissionRule solo como DRAFT");
const ruleId = Number(created.body.rule?.id);

const initialReadiness = await api("/v1/internal/commission-rules/" + ruleId + "/readiness", {
  headers: { cookie: manager1.session.cookie }
});
ok(initialReadiness.response.status === 200, "consulta readiness de regla");
ok(initialReadiness.body.configurationReady === false, "regla vacía no está configuration-ready");
ok(
  Array.isArray(initialReadiness.body.blockers?.configuration) &&
  initialReadiness.body.blockers.configuration.includes("earning_trigger_missing"),
  "readiness explica el blocker de earning trigger"
);

const incompleteApprove = await api("/v1/internal/commission-rules/" + ruleId + "/approve", {
  method: "POST",
  headers: headers(manager2.session),
  body: "{}"
});
ok(
  incompleteApprove.response.status === 409 &&
  incompleteApprove.body.error === "rule_policy_incomplete",
  "regla incompleta no puede aprobarse"
);

const configured = await api("/v1/internal/commission-rules/" + ruleId, {
  method: "PATCH",
  headers: headers(manager1.session),
  body: JSON.stringify({
    earningTrigger: "ORDER_COMPLETED",
    calculationBasis: "NET_SALES",
    rateBps: 1250,
    eligibleAttributionRoles: ["PRIMARY_SALESPERSON"],
    eligibleCommercialModes: ["OWNED"],
    discountTreatment: "AFTER_DISCOUNT",
    shippingTreatment: "EXCLUDE",
    returnReversalPolicy: "REVERSE",
    cancellationReversalPolicy: "REVERSE",
    statementFrequency: "MANUAL",
    negativeCarryForwardPolicy: "MANUAL_REVIEW"
  })
});
ok(
  configured.response.status === 200 && configured.body.configurationReady === true,
  "configuración explícita deja la regla lista para aprobación"
);

const selfApprove = await api("/v1/internal/commission-rules/" + ruleId + "/approve", {
  method: "POST",
  headers: headers(manager1.session),
  body: "{}"
});
ok(
  selfApprove.response.status === 409 &&
  selfApprove.body.error === "self_approval_forbidden",
  "creador no puede autoaprobar CommissionRule"
);

const approve = await api("/v1/internal/commission-rules/" + ruleId + "/approve", {
  method: "POST",
  headers: headers(manager2.session),
  body: "{}"
});
ok(approve.response.status === 200, "segundo manager aprueba CommissionRule completo");

const activate = await api("/v1/internal/commission-rules/" + ruleId + "/activate", {
  method: "POST",
  headers: headers(manager2.session),
  body: "{}"
});
ok(activate.response.status === 200, "regla aprobada y efectiva puede activarse");

const activeReadiness = await api("/v1/internal/commission-rules/" + ruleId + "/readiness", {
  headers: { cookie: manager1.session.cookie }
});
ok(activeReadiness.body.commissionReady === true, "regla ACTIVE completa queda commission-ready");

const overall = await api("/v1/internal/economic-readiness", {
  headers: { cookie: manager1.session.cookie }
});
ok(overall.response.status === 200, "diagnóstico agregado responde");
ok(overall.body.moneyCreationEnabled === false, "Policy Readiness no habilita creación de dinero");
ok(
  Number(overall.body.commissions?.ready || 0) >= 1,
  "diagnóstico agregado reconoce regla completa"
);

const absentMoneyTables = await db`
  SELECT
    to_regclass('public.commission_accruals') AS commission_accruals,
    to_regclass('public.commission_statements') AS commission_statements,
    to_regclass('public.settlement_lines') AS settlement_lines,
    to_regclass('public.settlement_statements') AS settlement_statements`;
ok(absentMoneyTables[0]?.commission_accruals == null, "no existe CommissionAccrual table");
ok(absentMoneyTables[0]?.commission_statements == null, "no existe CommissionStatement table");
ok(absentMoneyTables[0]?.settlement_lines == null, "no existe SettlementLine table");
ok(absentMoneyTables[0]?.settlement_statements == null, "no existe SettlementStatement table");

await db`
  UPDATE commission_rules
  SET shipping_treatment=NULL
  WHERE id=${ruleId}`;

const refresh = await api("/v1/internal/health-desk/refresh", {
  method: "POST",
  headers: headers(manager2.session),
  body: "{}"
});
ok(refresh.response.status === 200, "Health Desk refresca con policy diagnostics");

const health = await api("/v1/internal/health-desk", {
  headers: { cookie: manager2.session.cookie }
});
const policySignal = health.body.signals?.find(
  (x: any) => x.correlationKey === "economics:commission-policy-readiness"
);
ok(policySignal?.active === true, "Health Desk detecta regla ACTIVE inconsistente");
ok(Number(policySignal?.observedValue || 0) >= 1, "Health Desk cuantifica policy blocker");

await db`
  UPDATE commission_rules
  SET shipping_treatment='EXCLUDE'
  WHERE id=${ruleId}`;

const refreshHealthy = await api("/v1/internal/health-desk/refresh", {
  method: "POST",
  headers: headers(manager2.session),
  body: "{}"
});
ok(refreshHealthy.response.status === 200, "Health Desk puede volver a estado saludable");

const healthAfter = await api("/v1/internal/health-desk", {
  headers: { cookie: manager2.session.cookie }
});
const healedSignal = healthAfter.body.signals?.find(
  (x: any) => x.correlationKey === "economics:commission-policy-readiness"
);
ok(healedSignal?.active === false, "signal se auto-resuelve al restaurar policy completa");

const unauth = await api("/v1/internal/economic-readiness");
ok(unauth.response.status === 401, "readiness interno exige autenticación");

if (failures) {
  console.error(failures + " fallo(s)");
  process.exit(1);
}

console.log("Todo correcto — fail-closed economic policy readiness");
await db.close();
