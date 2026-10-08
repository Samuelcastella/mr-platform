type DB = any;

const COOKIE_NAME = "mrstaff";
const SESSION_HOURS = Math.max(1, Math.min(24, Number(Bun.env.STAFF_SESSION_HOURS || 8)));

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export type StaffGrant = {
  permission: string;
  scopeType: "GLOBAL" | "LOCATION";
  locationId: number | null;
};

export type StaffActor = {
  type: "USER";
  userId: number;
  email: string;
  displayName: string;
  sessionId: number;
  csrfHash: string;
  grants: StaffGrant[];
};

const PERMISSIONS: Record<string, string> = {
  "catalog.read": "Read catalog",
  "catalog.write": "Create/update catalog",
  "catalog.publish": "Publish catalog products",
  "inventory.read": "Read inventory",
  "inventory.receive": "Receive inventory",
  "inventory.adjust": "Adjust inventory",
  "inventory.transfer": "Transfer inventory",
  "inventory_adjustments.read": "Read inventory adjustments",
  "inventory_adjustments.create": "Create inventory adjustments",
  "inventory_adjustments.submit": "Submit inventory adjustments",
  "inventory_adjustments.approve": "Approve inventory adjustments",
  "inventory_adjustments.post": "Post inventory adjustments",
  "inventory_adjustments.audit": "Audit inventory adjustments",
  "inventory_adjustments.evidence.read": "Read inventory adjustment evidence",
  "health.read": "Read operational health desk",
  "health.incidents.manage": "Acknowledge and investigate operational incidents",
  "health.incidents.assign": "Assign operational incidents",
  "health.incidents.resolve": "Resolve operational incidents",
  "health.admin": "Manage operational health configuration",
  "orders.read": "Read orders",
  "orders.create": "Create orders",
  "orders.confirm": "Confirm orders",
  "orders.cancel": "Cancel orders",
  "payments.read": "Read payments",
  "payments.confirm_manual": "Confirm manual/offline payments",
  "payments.refund": "Issue refunds",
  "fulfillment.read": "Read fulfillment",
  "fulfillment.prepare": "Prepare fulfillment",
  "fulfillment.dispatch": "Dispatch fulfillment",
  "fulfillment.deliver": "Confirm delivery",
  "customers.read": "Read customer data",
  "customers.write": "Update customer data",
  "customers.merge": "Merge duplicate customer records",
  "suppliers.read": "Read supplier data",
  "suppliers.write": "Create/update supplier data",
  "procurement.read": "Read purchase orders and receipts",
  "procurement.create": "Create purchase orders",
  "procurement.approve": "Approve purchase orders",
  "procurement.receive": "Receive purchased inventory",
  "procurement.cancel": "Cancel purchase orders",
  "returns.read": "Read customer return cases",
  "returns.create": "Create customer return cases",
  "returns.approve": "Approve/reject customer return cases",
  "returns.cancel": "Cancel customer return cases",
  "returns.receive": "Receive returned merchandise",
  "returns.inspect": "Inspect returned merchandise",
  "inquiries.read": "Read inquiries",
  "inquiries.write": "Update inquiries",
  "reports.read": "Read reports",
  "users.manage": "Manage staff users",
  "roles.manage": "Manage roles and permissions",
  "audit.read": "Read audit events",
  "settings.manage": "Manage operational settings"
};

const ROLE_BUNDLES: Record<string, { name: string; permissions: string[] }> = {
  ADMIN: {
    name: "Administrator",
    permissions: Object.keys(PERMISSIONS)
  },
  MANAGER: {
    name: "Manager",
    permissions: Object.keys(PERMISSIONS).filter(
      p => !["users.manage", "roles.manage", "health.admin"].includes(p)
    )
  },
  CASHIER: {
    name: "Cashier",
    permissions: [
      "catalog.read",
      "inventory.read",
      "orders.read",
      "orders.create",
      "orders.confirm",
      "payments.read",
      "payments.confirm_manual",
      "customers.read",
      "customers.write",
      "returns.read",
      "returns.create"
    ]
  },
  INVENTORY_OPERATOR: {
    name: "Inventory operator",
    permissions: [
      "catalog.read",
      "inventory.read",
      "inventory.receive",
      "inventory.adjust",
      "inventory.transfer",
      "inventory_adjustments.read",
      "inventory_adjustments.create",
      "inventory_adjustments.submit",
      "inventory_adjustments.evidence.read",
      "health.read",
      "suppliers.read",
      "procurement.read",
      "procurement.receive",
      "returns.read",
      "returns.receive",
      "returns.inspect"
    ]
  },
  FULFILLMENT_OPERATOR: {
    name: "Fulfillment operator",
    permissions: [
      "orders.read",
      "payments.read",
      "inventory.read",
      "fulfillment.read",
      "fulfillment.prepare",
      "fulfillment.dispatch",
      "fulfillment.deliver",
      "health.read",
      "returns.read"
    ]
  },
  CUSTOMER_SUPPORT: {
    name: "Customer support",
    permissions: [
      "orders.read",
      "payments.read",
      "fulfillment.read",
      "customers.read",
      "customers.write",
      "inquiries.read",
      "inquiries.write",
      "health.read",
      "returns.read",
      "returns.create"
    ]
  },
  ANALYST: {
    name: "Analyst",
    permissions: [
      "catalog.read",
      "inventory.read",
      "orders.read",
      "payments.read",
      "fulfillment.read",
      "health.read",
      "reports.read"
    ]
  }
};

const jsonHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...jsonHeaders, ...extra } });
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeEmail(value: unknown) {
  return cleanText(value, 254).toLowerCase();
}

function validEmail(email: string) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function randomToken(bytes = 32) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

function sha256(value: string) {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function machineAuthorized(req: Request) {
  const expected = Bun.env.INTERNAL_API_TOKEN || "";
  const supplied = req.headers.get("x-internal-key") || "";
  return Boolean(expected) && constantTimeEqual(expected, supplied);
}

function cookieValue(req: Request, name: string) {
  const header = req.headers.get("cookie") || "";
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function sessionCookie(token: string, maxAgeSeconds: number) {
  const secure = Bun.env.AUTH_COOKIE_SECURE !== "false";
  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`
  ].filter(Boolean).join("; ");
}

function clearSessionCookie() {
  const secure = Bun.env.AUTH_COOKIE_SECURE !== "false";
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Strict",
    "Max-Age=0"
  ].filter(Boolean).join("; ");
}

function clientAddress(req: Request) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function loginKey(req: Request, email: string) {
  const salt = Bun.env.AUTH_LOG_SALT || "mr-auth";
  return sha256(`${salt}|${clientAddress(req)}|${email}`);
}

function loginAllowed(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  return current.count < 5;
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const current = loginAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  current.count += 1;
  loginAttempts.set(key, current);
}

function resetLoginFailures(key: string) {
  loginAttempts.delete(key);
}

function fingerprint(value: string) {
  const salt = Bun.env.AUTH_LOG_SALT || "mr-auth";
  return sha256(`${salt}|${value}`);
}

export async function writeAuditEvent(
  db: DB,
  input: {
    actorType: "USER" | "SERVICE" | "SYSTEM";
    actorUserId?: number | null;
    actorService?: string | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | number | null;
    locationId?: number | null;
    outcome: "SUCCESS" | "FAILURE";
    reason?: string | null;
    correlationId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const metadata = JSON.stringify(input.metadata || {}).slice(0, 4000);
  await db`
    INSERT INTO audit_events(
      actor_type, actor_user_id, actor_service, action, resource_type, resource_id,
      location_id, outcome, reason, correlation_id, metadata
    )
    VALUES(
      ${input.actorType}, ${input.actorUserId || null}, ${input.actorService || null},
      ${input.action}, ${input.resourceType || null},
      ${input.resourceId == null ? null : String(input.resourceId)},
      ${input.locationId || null}, ${input.outcome}, ${input.reason || null},
      ${input.correlationId || null}, ${metadata}::jsonb
    )`;
}

async function grantsForUser(db: DB, userId: number): Promise<StaffGrant[]> {
  const rows = await db`
    SELECT DISTINCT
      rp.permission_code AS permission,
      ura.scope_type,
      ura.scope_location_id
    FROM user_role_assignments ura
    JOIN role_permissions rp ON rp.role_id = ura.role_id
    WHERE ura.user_id = ${userId}`;
  return rows.map((row: any) => ({
    permission: String(row.permission),
    scopeType: row.scope_type,
    locationId: row.scope_location_id == null ? null : Number(row.scope_location_id)
  }));
}

async function rolesForUser(db: DB, userId: number) {
  const rows = await db`
    SELECT r.code, r.name, ura.scope_type, ura.scope_location_id
    FROM user_role_assignments ura
    JOIN roles r ON r.id = ura.role_id
    WHERE ura.user_id = ${userId}
    ORDER BY r.code, ura.scope_type, ura.scope_location_id NULLS FIRST`;
  return rows.map((row: any) => ({
    code: row.code,
    name: row.name,
    scopeType: row.scope_type,
    locationId: row.scope_location_id == null ? null : Number(row.scope_location_id)
  }));
}

export function permissionAllowed(
  grants: StaffGrant[],
  permission: string,
  locationId?: number | null
) {
  return grants.some(grant => {
    if (grant.permission !== permission) return false;
    if (grant.scopeType === "GLOBAL") return true;
    return (
      grant.scopeType === "LOCATION" &&
      locationId != null &&
      grant.locationId === Number(locationId)
    );
  });
}

export async function readStaffSession(req: Request, db: DB): Promise<StaffActor | null> {
  const token = cookieValue(req, COOKIE_NAME);
  if (!token) return null;

  const tokenHash = sha256(token);
  const rows = await db`
    SELECT
      s.id AS session_id, s.user_id, s.csrf_hash, s.status AS session_status,
      s.expires_at, u.email_normalized, u.display_name, u.status AS user_status
    FROM staff_sessions s
    JOIN staff_users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash}
    LIMIT 1`;
  if (!rows.length) return null;

  const row = rows[0];
  if (row.session_status !== "ACTIVE") return null;
  if (row.user_status !== "ACTIVE") {
    await db`
      UPDATE staff_sessions
      SET status = 'REVOKED', revoked_at = COALESCE(revoked_at, NOW())
      WHERE id = ${Number(row.session_id)} AND status = 'ACTIVE'`;
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db`
      UPDATE staff_sessions
      SET status = 'EXPIRED'
      WHERE id = ${Number(row.session_id)} AND status = 'ACTIVE'`;
    return null;
  }

  await db`
    UPDATE staff_sessions
    SET last_seen_at = NOW()
    WHERE id = ${Number(row.session_id)}`;

  const userId = Number(row.user_id);
  return {
    type: "USER",
    userId,
    email: row.email_normalized,
    displayName: row.display_name,
    sessionId: Number(row.session_id),
    csrfHash: row.csrf_hash,
    grants: await grantsForUser(db, userId)
  };
}

export async function requireStaffPermission(
  req: Request,
  db: DB,
  permission: string,
  options: { locationId?: number | null; requireCsrf?: boolean } = {}
) {
  const actor = await readStaffSession(req, db);
  if (!actor) return { ok: false as const, response: json({ error: "unauthorized" }, 401) };

  if (options.requireCsrf) {
    const supplied = req.headers.get("x-csrf-token") || "";
    if (!supplied || !constantTimeEqual(sha256(supplied), actor.csrfHash)) {
      return { ok: false as const, response: json({ error: "csrf_required" }, 403) };
    }
  }

  if (!permissionAllowed(actor.grants, permission, options.locationId)) {
    return { ok: false as const, response: json({ error: "forbidden" }, 403) };
  }

  return { ok: true as const, actor };
}

export type InternalActor =
  | StaffActor
  | {
      type: "SERVICE";
      service: string;
    };

export async function authorizeInternal(
  req: Request,
  db: DB,
  permission: string,
  options: { locationId?: number | null; mutation?: boolean } = {}
) {
  if (machineAuthorized(req)) {
    return {
      ok: true as const,
      actor: { type: "SERVICE" as const, service: "internal-api" }
    };
  }

  return requireStaffPermission(req, db, permission, {
    locationId: options.locationId,
    requireCsrf: options.mutation === true
  });
}

export function auditActor(actor: InternalActor) {
  if (actor.type === "SERVICE") {
    return {
      actorType: "SERVICE" as const,
      actorService: actor.service,
      actorUserId: null
    };
  }
  return {
    actorType: "USER" as const,
    actorService: null,
    actorUserId: actor.userId
  };
}

export async function ensureAuthSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS staff_users (
      id BIGSERIAL PRIMARY KEY,
      email_normalized TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      mfa_required BOOLEAN NOT NULL DEFAULT FALSE,
      email_verified_at TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('INVITED','ACTIVE','LOCKED','DISABLED'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS permissions (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS roles (
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
      PRIMARY KEY(role_id, permission_code)
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS user_role_assignments (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL DEFAULT 'GLOBAL',
      scope_location_id BIGINT REFERENCES locations(id) ON DELETE CASCADE,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (scope_type IN ('GLOBAL','LOCATION')),
      CHECK (
        (scope_type = 'GLOBAL' AND scope_location_id IS NULL) OR
        (scope_type = 'LOCATION' AND scope_location_id IS NOT NULL)
      )
    )`;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_role_assignments_unique_scope
    ON user_role_assignments(
      user_id, role_id, scope_type, COALESCE(scope_location_id, 0)
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS staff_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      csrf_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ,
      user_agent_hash TEXT,
      ip_hash TEXT,
      CHECK (status IN ('ACTIVE','REVOKED','EXPIRED'))
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_staff_sessions_user_status
    ON staff_sessions(user_id, status, expires_at)`;

  await db`
    CREATE TABLE IF NOT EXISTS audit_events (
      id BIGSERIAL PRIMARY KEY,
      actor_type TEXT NOT NULL,
      actor_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      actor_service TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      location_id BIGINT REFERENCES locations(id) ON DELETE SET NULL,
      outcome TEXT NOT NULL,
      reason TEXT,
      correlation_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (actor_type IN ('USER','SERVICE','SYSTEM')),
      CHECK (outcome IN ('SUCCESS','FAILURE'))
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_audit_events_action_time
    ON audit_events(action, occurred_at DESC)`;

  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await db`
      INSERT INTO permissions(code, description)
      VALUES(${code}, ${description})
      ON CONFLICT(code) DO UPDATE SET description = EXCLUDED.description`;
  }

  for (const [code, bundle] of Object.entries(ROLE_BUNDLES)) {
    const roleRows = await db`
      INSERT INTO roles(code, name)
      VALUES(${code}, ${bundle.name})
      ON CONFLICT(code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id`;
    const roleId = Number(roleRows[0].id);

    await db`DELETE FROM role_permissions WHERE role_id = ${roleId}`;
    for (const permission of bundle.permissions) {
      await db`
        INSERT INTO role_permissions(role_id, permission_code)
        VALUES(${roleId}, ${permission})
        ON CONFLICT DO NOTHING`;
    }
  }
}

async function bootstrap(req: Request, db: DB) {
  if (!machineAuthorized(req)) return json({ error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const email = normalizeEmail(body?.email);
  const displayName = cleanText(body?.displayName, 120);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!validEmail(email)) return json({ error: "invalid_email" }, 400);
  if (!displayName) return json({ error: "display_name_required" }, 400);
  if (password.length < 12 || password.length > 256) {
    return json({ error: "invalid_password_length" }, 400);
  }

  try {
    const result: any = await db.begin(async (tx: DB) => {
      const existing = await tx`SELECT COUNT(*)::int AS count FROM staff_users`;
      if (Number(existing[0]?.count || 0) > 0) {
        return { error: "bootstrap_already_completed", status: 409 };
      }

      const passwordHash = await Bun.password.hash(password, {
        algorithm: "argon2id"
      });

      const users = await tx`
        INSERT INTO staff_users(
          email_normalized, display_name, password_hash, status, email_verified_at
        )
        VALUES(${email}, ${displayName}, ${passwordHash}, 'ACTIVE', NOW())
        RETURNING id, email_normalized, display_name, status, created_at`;
      const user = users[0];

      const roles = await tx`SELECT id FROM roles WHERE code = 'ADMIN' LIMIT 1`;
      if (!roles.length) throw new Error("admin_role_missing");

      await tx`
        INSERT INTO user_role_assignments(
          user_id, role_id, scope_type, scope_location_id
        )
        VALUES(${Number(user.id)}, ${Number(roles[0].id)}, 'GLOBAL', NULL)`;

      await writeAuditEvent(tx, {
        actorType: "SERVICE",
        actorService: "bootstrap",
        action: "security.bootstrap_admin",
        resourceType: "StaffUser",
        resourceId: Number(user.id),
        outcome: "SUCCESS"
      });

      return { user };
    });

    if (result.error) return json({ error: result.error }, result.status || 409);
    return json({
      user: {
        id: Number(result.user.id),
        email: result.user.email_normalized,
        displayName: result.user.display_name,
        status: result.user.status,
        createdAt: result.user.created_at
      }
    }, 201);
  } catch (error) {
    console.error("security_bootstrap_failed");
    return json({ error: "bootstrap_failed" }, 500);
  }
}

async function login(req: Request, db: DB) {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > 8192) return json({ error: "payload_too_large" }, 413);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const key = loginKey(req, email);

  if (!loginAllowed(key)) {
    return json({ error: "too_many_attempts" }, 429, { "retry-after": "900" });
  }

  const rows = await db`
    SELECT id, email_normalized, display_name, password_hash, status
    FROM staff_users
    WHERE email_normalized = ${email}
    LIMIT 1`;

  const genericFailure = async (reason: string) => {
    recordLoginFailure(key);
    await writeAuditEvent(db, {
      actorType: "SYSTEM",
      action: "security.login",
      outcome: "FAILURE",
      reason,
      metadata: { identifierHash: fingerprint(email || "missing") }
    });
    return json({ error: "invalid_credentials" }, 401);
  };

  if (!rows.length) return genericFailure("invalid_credentials");
  const user = rows[0];
  if (user.status !== "ACTIVE") return genericFailure("account_not_active");

  let verified = false;
  try {
    verified = await Bun.password.verify(password, user.password_hash);
  } catch {
    verified = false;
  }
  if (!verified) return genericFailure("invalid_credentials");

  resetLoginFailures(key);

  const token = randomToken(32);
  const csrf = randomToken(24);
  const maxAgeSeconds = SESSION_HOURS * 60 * 60;
  const userAgent = req.headers.get("user-agent") || "";
  const ip = clientAddress(req);

  const sessionRows = await db`
    INSERT INTO staff_sessions(
      user_id, token_hash, csrf_hash, status, expires_at, user_agent_hash, ip_hash
    )
    VALUES(
      ${Number(user.id)}, ${sha256(token)}, ${sha256(csrf)}, 'ACTIVE',
      NOW() + (${SESSION_HOURS}::text || ' hours')::interval,
      ${fingerprint(userAgent)}, ${fingerprint(ip)}
    )
    RETURNING id, expires_at`;

  await db`
    UPDATE staff_users
    SET last_login_at = NOW(), updated_at = NOW()
    WHERE id = ${Number(user.id)}`;

  await writeAuditEvent(db, {
    actorType: "USER",
    actorUserId: Number(user.id),
    action: "security.login",
    resourceType: "StaffSession",
    resourceId: Number(sessionRows[0].id),
    outcome: "SUCCESS"
  });

  const roles = await rolesForUser(db, Number(user.id));
  const grants = await grantsForUser(db, Number(user.id));

  return json({
    user: {
      id: Number(user.id),
      email: user.email_normalized,
      displayName: user.display_name,
      status: user.status,
      roles,
      permissions: [...new Set(grants.map(g => g.permission))].sort()
    },
    csrfToken: csrf,
    expiresAt: sessionRows[0].expires_at
  }, 200, {
    "set-cookie": sessionCookie(token, maxAgeSeconds)
  });
}

async function me(req: Request, db: DB) {
  const actor = await readStaffSession(req, db);
  if (!actor) return json({ error: "unauthorized" }, 401);

  return json({
    user: {
      id: actor.userId,
      email: actor.email,
      displayName: actor.displayName,
      roles: await rolesForUser(db, actor.userId),
      permissions: [...new Set(actor.grants.map(g => g.permission))].sort()
    }
  });
}

async function logout(req: Request, db: DB) {
  const actor = await readStaffSession(req, db);
  if (!actor) {
    return json({ error: "unauthorized" }, 401, {
      "set-cookie": clearSessionCookie()
    });
  }

  const csrf = req.headers.get("x-csrf-token") || "";
  if (!csrf || !constantTimeEqual(sha256(csrf), actor.csrfHash)) {
    return json({ error: "csrf_required" }, 403);
  }

  await db`
    UPDATE staff_sessions
    SET status = 'REVOKED', revoked_at = NOW()
    WHERE id = ${actor.sessionId} AND status = 'ACTIVE'`;

  await writeAuditEvent(db, {
    actorType: "USER",
    actorUserId: actor.userId,
    action: "security.logout",
    resourceType: "StaffSession",
    resourceId: actor.sessionId,
    outcome: "SUCCESS"
  });

  return json({ ok: true }, 200, {
    "set-cookie": clearSessionCookie()
  });
}

export async function handleAuth(req: Request, url: URL, db: DB) {
  if (url.pathname === "/v1/security/bootstrap" && req.method === "POST") {
    return bootstrap(req, db);
  }

  if (url.pathname === "/v1/auth/login" && req.method === "POST") {
    return login(req, db);
  }

  if (url.pathname === "/v1/auth/me" && req.method === "GET") {
    return me(req, db);
  }

  if (url.pathname === "/v1/auth/logout" && req.method === "POST") {
    return logout(req, db);
  }

  if (url.pathname.startsWith("/v1/auth/") || url.pathname.startsWith("/v1/security/")) {
    return json({ error: "method_not_allowed" }, 405);
  }

  return null;
}
