import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";

type DB = any;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });

const SELLER_TRIGGERS = new Set(["ORDER_DELIVERED", "ORDER_COMPLETED"]);
const PAYMENT_POLICIES = new Set(["PAYMENT_PAID_REQUIRED", "COD_RECONCILED_REQUIRED", "METHOD_SPECIFIC"]);
const SETTLEMENT_FREQUENCIES = new Set(["WEEKLY", "BIWEEKLY", "MONTHLY", "MANUAL"]);
const ALLOCATION_RULES = new Set(["MR", "SELLER", "PROPORTIONAL", "NOT_APPLICABLE"]);
const FISCAL_ISSUER_MODELS = new Set(["MR", "SELLER", "OTHER"]);

const RULE_SCOPES = new Set(["GLOBAL", "USER", "ROLE", "LOCATION", "CATEGORY", "PRODUCT", "CHANNEL"]);
const EARNING_TRIGGERS = new Set(["ORDER_PAID", "ORDER_DELIVERED", "ORDER_COMPLETED"]);
const CALCULATION_BASES = new Set(["GROSS_SALES", "NET_SALES", "GROSS_MARGIN", "FIXED_PER_ORDER", "FIXED_PER_UNIT"]);
const ATTRIBUTION_ROLES = new Set(["PRIMARY_SALESPERSON", "ASSIST"]);
const COMMERCIAL_MODES = new Set(["OWNED", "WHOLESALE_MARGIN", "CONSIGNMENT", "COMMISSION"]);
const DISCOUNT_TREATMENTS = new Set(["BEFORE_DISCOUNT", "AFTER_DISCOUNT", "NOT_APPLICABLE"]);
const SHIPPING_TREATMENTS = new Set(["INCLUDE", "EXCLUDE", "NOT_APPLICABLE"]);
const REVERSAL_POLICIES = new Set(["REVERSE", "HOLD_FOR_REVIEW", "NOT_APPLICABLE"]);
const NEGATIVE_POLICIES = new Set(["CARRY_FORWARD", "CAP_AT_ZERO_WITH_REVIEW", "MANUAL_REVIEW"]);

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function positiveInt(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function nonNegativeInt(value: unknown) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function uniqueUpperList(value: unknown, allowed: Set<string>) {
  if (!Array.isArray(value)) return null;
  const normalized = [...new Set(value.map(v => clean(v, 64).toUpperCase()).filter(Boolean))];
  if (!normalized.length || normalized.some(v => !allowed.has(v))) return null;
  return normalized;
}

function jsonStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(v => String(v)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function ensureEconomicReadinessSchema(db: DB) {
  await db`ALTER TABLE seller_agreements ADD COLUMN IF NOT EXISTS settlement_trigger TEXT`;
  await db`ALTER TABLE seller_agreements ADD COLUMN IF NOT EXISTS payment_eligibility_policy TEXT`;
  await db`ALTER TABLE seller_agreements ADD COLUMN IF NOT EXISTS settlement_delay_configured BOOLEAN NOT NULL DEFAULT FALSE`;
  await db`ALTER TABLE seller_agreements ADD COLUMN IF NOT EXISTS fiscal_issuer_model TEXT`;
  await db`ALTER TABLE seller_agreements ADD COLUMN IF NOT EXISTS fiscal_treatment_validated_at TIMESTAMPTZ`;
  await db`ALTER TABLE seller_agreements ADD COLUMN IF NOT EXISTS fiscal_treatment_validated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL`;
  await db`ALTER TABLE seller_agreements ADD COLUMN IF NOT EXISTS fiscal_validation_reference TEXT`;
  await db`ALTER TABLE seller_agreements ADD COLUMN IF NOT EXISTS policy_updated_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL`;
  await db`ALTER TABLE seller_agreements ADD COLUMN IF NOT EXISTS policy_updated_at TIMESTAMPTZ`;

  await db`
    CREATE TABLE IF NOT EXISTS commission_rules (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      effective_from TIMESTAMPTZ NOT NULL,
      effective_to TIMESTAMPTZ,
      scope_type TEXT NOT NULL,
      scope_reference TEXT,
      earning_trigger TEXT,
      calculation_basis TEXT,
      rate_bps INTEGER,
      fixed_amount_minor BIGINT,
      currency CHAR(3),
      minimum_margin_bps INTEGER,
      cap_minor BIGINT,
      eligible_attribution_roles JSONB,
      eligible_commercial_modes JSONB,
      discount_treatment TEXT,
      shipping_treatment TEXT,
      return_reversal_policy TEXT,
      cancellation_reversal_policy TEXT,
      statement_frequency TEXT,
      negative_carry_forward_policy TEXT,
      created_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      approved_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(name,version),
      CHECK (status IN ('DRAFT','APPROVED','ACTIVE','EXPIRED','DISABLED')),
      CHECK (scope_type IN ('GLOBAL','USER','ROLE','LOCATION','CATEGORY','PRODUCT','CHANNEL')),
      CHECK (earning_trigger IS NULL OR earning_trigger IN ('ORDER_PAID','ORDER_DELIVERED','ORDER_COMPLETED')),
      CHECK (calculation_basis IS NULL OR calculation_basis IN ('GROSS_SALES','NET_SALES','GROSS_MARGIN','FIXED_PER_ORDER','FIXED_PER_UNIT')),
      CHECK (rate_bps IS NULL OR (rate_bps >= 0 AND rate_bps <= 10000)),
      CHECK (fixed_amount_minor IS NULL OR fixed_amount_minor >= 0),
      CHECK (minimum_margin_bps IS NULL OR (minimum_margin_bps >= 0 AND minimum_margin_bps <= 10000)),
      CHECK (cap_minor IS NULL OR cap_minor >= 0)
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_commission_rules_status_effective
    ON commission_rules(status,effective_from,effective_to)`;
}

export function sellerAgreementConfigurationBlockers(row: any): string[] {
  const blockers: string[] = [];
  const mode = String(row?.commercial_mode || "");

  if (!["CONSIGNMENT", "COMMISSION"].includes(mode)) blockers.push("commercial_mode_not_third_party");
  if (!row?.settlement_trigger) blockers.push("settlement_trigger_missing");
  if (!row?.payment_eligibility_policy) blockers.push("payment_eligibility_policy_missing");
  if (!row?.settlement_frequency) blockers.push("settlement_frequency_missing");
  if (!row?.settlement_delay_configured) blockers.push("settlement_delay_not_explicit");
  if (!row?.discount_allocation_rule) blockers.push("discount_allocation_missing");
  if (!row?.shipping_allocation_rule) blockers.push("shipping_allocation_missing");
  if (!row?.payment_fee_allocation_rule) blockers.push("payment_fee_allocation_missing");
  if (!row?.return_allocation_rule) blockers.push("return_allocation_missing");
  if (!row?.shrinkage_liability_rule) blockers.push("shrinkage_liability_missing");

  const basis = String(row?.commission_basis || "").toUpperCase();
  if (!basis) {
    blockers.push("commission_basis_missing");
  } else if (basis !== "NONE" && row?.commission_rate_bps == null && row?.fixed_fee_minor == null) {
    blockers.push("commission_terms_missing");
  }

  return blockers;
}

export function sellerAgreementFiscalBlockers(row: any): string[] {
  const blockers: string[] = [];
  if (!row?.fiscal_issuer_model) blockers.push("fiscal_issuer_model_missing");
  if (!row?.fiscal_treatment_validated_at) blockers.push("fiscal_treatment_not_validated");
  if (!row?.fiscal_validation_reference) blockers.push("fiscal_validation_reference_missing");
  return blockers;
}

export function sellerAgreementActivationBlockers(row: any): string[] {
  const blockers = [
    ...sellerAgreementConfigurationBlockers(row),
    ...sellerAgreementFiscalBlockers(row)
  ];
  if (String(row?.seller_status || "") !== "ACTIVE") blockers.push("seller_not_active");
  return [...new Set(blockers)];
}

function commissionRuleConfigurationBlockers(row: any): string[] {
  const blockers: string[] = [];
  const scope = String(row?.scope_type || "");
  const basis = String(row?.calculation_basis || "");

  if (!row?.earning_trigger) blockers.push("earning_trigger_missing");
  if (!basis) blockers.push("calculation_basis_missing");

  if (scope !== "GLOBAL" && !row?.scope_reference) blockers.push("scope_reference_missing");

  const roles = jsonStringList(row?.eligible_attribution_roles);
  if (!roles.length) blockers.push("eligible_attribution_roles_missing");

  const modes = jsonStringList(row?.eligible_commercial_modes);
  if (!modes.length) blockers.push("eligible_commercial_modes_missing");

  if (!row?.discount_treatment) blockers.push("discount_treatment_missing");
  if (!row?.shipping_treatment) blockers.push("shipping_treatment_missing");
  if (!row?.return_reversal_policy) blockers.push("return_reversal_policy_missing");
  if (!row?.cancellation_reversal_policy) blockers.push("cancellation_reversal_policy_missing");
  if (!row?.statement_frequency) blockers.push("statement_frequency_missing");
  if (!row?.negative_carry_forward_policy) blockers.push("negative_carry_forward_policy_missing");

  if (["GROSS_SALES", "NET_SALES", "GROSS_MARGIN"].includes(basis) && row?.rate_bps == null) {
    blockers.push("rate_missing");
  }
  if (["FIXED_PER_ORDER", "FIXED_PER_UNIT"].includes(basis) && row?.fixed_amount_minor == null) {
    blockers.push("fixed_amount_missing");
  }
  if (["FIXED_PER_ORDER", "FIXED_PER_UNIT"].includes(basis) && !row?.currency) {
    blockers.push("currency_missing_for_fixed_amount");
  }

  return blockers;
}

function commissionRuleActivationBlockers(row: any) {
  const blockers = commissionRuleConfigurationBlockers(row);
  const now = Date.now();
  const from = row?.effective_from ? new Date(row.effective_from).getTime() : NaN;
  const to = row?.effective_to ? new Date(row.effective_to).getTime() : null;

  if (!Number.isFinite(from) || from > now) blockers.push("effective_window_not_started");
  if (to != null && to <= now) blockers.push("effective_window_expired");
  return [...new Set(blockers)];
}

async function sellerAgreementRow(db: DB, id: number) {
  const rows = await db`
    SELECT
      a.*,
      s.status AS seller_status,
      s.display_name AS seller_display_name
    FROM seller_agreements a
    JOIN seller_accounts s ON s.id=a.seller_id
    WHERE a.id=${id}
    LIMIT 1`;
  return rows[0] || null;
}

async function sellerReadiness(req: Request, db: DB, id: number) {
  const auth = await authorizeInternal(req, db, "economics.policy.read");
  if (!auth.ok) return auth.response;

  const row = await sellerAgreementRow(db, id);
  if (!row) return json({ error: "not_found" }, 404);

  const configurationBlockers = sellerAgreementConfigurationBlockers(row);
  const fiscalBlockers = sellerAgreementFiscalBlockers(row);
  const activationBlockers = sellerAgreementActivationBlockers(row);

  return json({
    type: "SELLER_AGREEMENT",
    agreementId: id,
    sellerId: Number(row.seller_id),
    agreementVersion: Number(row.agreement_version),
    status: row.status,
    configurationReady: configurationBlockers.length === 0,
    settlementReady: activationBlockers.length === 0 && row.status === "ACTIVE",
    blockers: {
      configuration: configurationBlockers,
      fiscal: fiscalBlockers,
      activation: activationBlockers
    }
  });
}

async function patchSellerPolicy(req: Request, db: DB, id: number) {
  const auth = await authorizeInternal(req, db, "economics.policy.manage", { mutation:true });
  if (!auth.ok) return auth.response;

  const existing = await sellerAgreementRow(db, id);
  if (!existing) return json({ error: "not_found" }, 404);
  if (existing.status !== "DRAFT") return json({ error: "policy_locked_after_draft" }, 409);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const settlementTrigger = clean(body?.settlementTrigger, 40).toUpperCase();
  const paymentPolicy = clean(body?.paymentEligibilityPolicy, 40).toUpperCase();
  const frequency = clean(body?.settlementFrequency, 40).toUpperCase();
  const discount = clean(body?.discountAllocationRule, 40).toUpperCase();
  const shipping = clean(body?.shippingAllocationRule, 40).toUpperCase();
  const paymentFee = clean(body?.paymentFeeAllocationRule, 40).toUpperCase();
  const returns = clean(body?.returnAllocationRule, 40).toUpperCase();
  const shrinkage = clean(body?.shrinkageLiabilityRule, 80).toUpperCase();
  const commissionBasis = clean(body?.commissionBasis, 40).toUpperCase();
  const delay = nonNegativeInt(body?.settlementDelayDays);
  const rate = body?.commissionRateBps == null ? null : nonNegativeInt(body.commissionRateBps);
  const fixedFee = body?.fixedFeeMinor == null ? null : nonNegativeInt(body.fixedFeeMinor);

  if (!SELLER_TRIGGERS.has(settlementTrigger)) return json({ error: "invalid_settlement_trigger" }, 400);
  if (!PAYMENT_POLICIES.has(paymentPolicy)) return json({ error: "invalid_payment_eligibility_policy" }, 400);
  if (!SETTLEMENT_FREQUENCIES.has(frequency)) return json({ error: "invalid_settlement_frequency" }, 400);
  if (![discount, shipping, paymentFee, returns].every(v => ALLOCATION_RULES.has(v))) {
    return json({ error: "invalid_allocation_rule" }, 400);
  }
  if (!shrinkage) return json({ error: "shrinkage_liability_rule_required" }, 400);
  if (!commissionBasis) return json({ error: "commission_basis_required" }, 400);
  if (delay == null) return json({ error: "invalid_settlement_delay" }, 400);
  if (rate != null && rate > 10000) return json({ error: "invalid_commission_rate" }, 400);
  if (body?.commissionRateBps != null && rate == null) return json({ error: "invalid_commission_rate" }, 400);
  if (body?.fixedFeeMinor != null && fixedFee == null) return json({ error: "invalid_fixed_fee" }, 400);
  if (commissionBasis !== "NONE" && rate == null && fixedFee == null) {
    return json({ error: "commission_terms_required" }, 400);
  }

  await db`
    UPDATE seller_agreements
    SET settlement_trigger=${settlementTrigger},
        payment_eligibility_policy=${paymentPolicy},
        settlement_frequency=${frequency},
        settlement_delay_days=${delay},
        settlement_delay_configured=TRUE,
        discount_allocation_rule=${discount},
        shipping_allocation_rule=${shipping},
        payment_fee_allocation_rule=${paymentFee},
        return_allocation_rule=${returns},
        shrinkage_liability_rule=${shrinkage},
        commission_basis=${commissionBasis},
        commission_rate_bps=${rate},
        fixed_fee_minor=${fixedFee},
        policy_updated_by_user_id=${auth.actor.type==="USER" ? auth.actor.userId : null},
        policy_updated_at=NOW(),
        updated_at=NOW()
    WHERE id=${id}`;

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "seller_agreement.policy_updated",
    resourceType: "SellerAgreement",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { settlementTrigger, paymentPolicy, frequency }
  });

  return sellerReadiness(req, db, id);
}

async function validateSellerFiscal(req: Request, db: DB, id: number) {
  const auth = await authorizeInternal(req, db, "economics.fiscal.validate", { mutation:true });
  if (!auth.ok) return auth.response;
  if (auth.actor.type !== "USER") return json({ error: "staff_validation_required" }, 403);

  const existing = await sellerAgreementRow(db, id);
  if (!existing) return json({ error: "not_found" }, 404);
  if (!["APPROVED", "ACTIVE"].includes(existing.status)) {
    return json({ error: "agreement_must_be_approved" }, 409);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const issuer = clean(body?.fiscalIssuerModel, 24).toUpperCase();
  const reference = clean(body?.validationReference, 500);
  if (!FISCAL_ISSUER_MODELS.has(issuer)) return json({ error: "invalid_fiscal_issuer_model" }, 400);
  if (reference.length < 8) return json({ error: "validation_reference_required" }, 400);

  await db`
    UPDATE seller_agreements
    SET fiscal_issuer_model=${issuer},
        fiscal_treatment_validated_at=NOW(),
        fiscal_treatment_validated_by_user_id=${auth.actor.userId},
        fiscal_validation_reference=${reference},
        updated_at=NOW()
    WHERE id=${id}`;

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "seller_agreement.fiscal_policy_validated",
    resourceType: "SellerAgreement",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { fiscalIssuerModel: issuer, validationReference: reference }
  });

  return sellerReadiness(req, db, id);
}

function mapCommissionRule(row: any) {
  return {
    id: Number(row.id),
    name: row.name,
    version: Number(row.version),
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    scopeType: row.scope_type,
    scopeReference: row.scope_reference || null,
    earningTrigger: row.earning_trigger || null,
    calculationBasis: row.calculation_basis || null,
    rateBps: row.rate_bps == null ? null : Number(row.rate_bps),
    fixedAmountMinor: row.fixed_amount_minor == null ? null : Number(row.fixed_amount_minor),
    currency: row.currency || null,
    minimumMarginBps: row.minimum_margin_bps == null ? null : Number(row.minimum_margin_bps),
    capMinor: row.cap_minor == null ? null : Number(row.cap_minor),
    eligibleAttributionRoles: row.eligible_attribution_roles || [],
    eligibleCommercialModes: row.eligible_commercial_modes || [],
    discountTreatment: row.discount_treatment || null,
    shippingTreatment: row.shipping_treatment || null,
    returnReversalPolicy: row.return_reversal_policy || null,
    cancellationReversalPolicy: row.cancellation_reversal_policy || null,
    statementFrequency: row.statement_frequency || null,
    negativeCarryForwardPolicy: row.negative_carry_forward_policy || null,
    createdAt: row.created_at,
    approvedAt: row.approved_at || null,
    updatedAt: row.updated_at
  };
}

async function commissionRuleRow(db: DB, id: number) {
  const rows = await db`SELECT * FROM commission_rules WHERE id=${id} LIMIT 1`;
  return rows[0] || null;
}

async function commissionReadiness(req: Request, db: DB, id: number) {
  const auth = await authorizeInternal(req, db, "economics.policy.read");
  if (!auth.ok) return auth.response;

  const row = await commissionRuleRow(db, id);
  if (!row) return json({ error: "not_found" }, 404);

  const config = commissionRuleConfigurationBlockers(row);
  const activation = commissionRuleActivationBlockers(row);

  return json({
    type: "COMMISSION_RULE",
    ruleId: id,
    name: row.name,
    version: Number(row.version),
    status: row.status,
    configurationReady: config.length === 0,
    commissionReady: activation.length === 0 && row.status === "ACTIVE",
    blockers: { configuration: config, activation }
  });
}

async function listCommissionRules(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "commissions.rules.read");
  if (!auth.ok) return auth.response;
  const rows = await db`SELECT * FROM commission_rules ORDER BY name,version DESC,id DESC`;
  return json({ data: rows.map(mapCommissionRule) });
}

async function createCommissionRule(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "commissions.rules.manage", { mutation:true });
  if (!auth.ok) return auth.response;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const name = clean(body?.name, 160);
  const version = positiveInt(body?.version);
  const scopeType = clean(body?.scopeType, 32).toUpperCase();
  const scopeReference = clean(body?.scopeReference, 160) || null;
  if (!name) return json({ error: "name_required" }, 400);
  if (!version) return json({ error: "invalid_version" }, 400);
  if (!RULE_SCOPES.has(scopeType)) return json({ error: "invalid_scope_type" }, 400);
  if (scopeType !== "GLOBAL" && !scopeReference) return json({ error: "scope_reference_required" }, 400);

  if (!body?.effectiveFrom) return json({ error: "effective_from_required" }, 400);
  const effectiveFrom = new Date(body.effectiveFrom);
  const effectiveTo = body?.effectiveTo ? new Date(body.effectiveTo) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime()))) {
    return json({ error: "invalid_effective_window" }, 400);
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) return json({ error: "invalid_effective_window" }, 400);

  try {
    const rows = await db`
      INSERT INTO commission_rules(
        name,version,status,effective_from,effective_to,scope_type,scope_reference,created_by_user_id
      )
      VALUES(
        ${name},${version},'DRAFT',${effectiveFrom},${effectiveTo},${scopeType},${scopeReference},
        ${auth.actor.type==="USER" ? auth.actor.userId : null}
      )
      RETURNING *`;

    await writeAuditEvent(db, {
      ...auditActor(auth.actor),
      action: "commission_rule.created",
      resourceType: "CommissionRule",
      resourceId: Number(rows[0].id),
      outcome: "SUCCESS",
      metadata: { name, version, scopeType, scopeReference }
    });

    return json({ rule: mapCommissionRule(rows[0]) }, 201);
  } catch (error: any) {
    if (error?.code === "23505") return json({ error: "rule_version_conflict" }, 409);
    throw error;
  }
}

async function patchCommissionRule(req: Request, db: DB, id: number) {
  const auth = await authorizeInternal(req, db, "commissions.rules.manage", { mutation:true });
  if (!auth.ok) return auth.response;

  const existing = await commissionRuleRow(db, id);
  if (!existing) return json({ error: "not_found" }, 404);
  if (existing.status !== "DRAFT") return json({ error: "rule_locked_after_draft" }, 409);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const earningTrigger = clean(body?.earningTrigger, 40).toUpperCase();
  const calculationBasis = clean(body?.calculationBasis, 40).toUpperCase();
  const roles = uniqueUpperList(body?.eligibleAttributionRoles, ATTRIBUTION_ROLES);
  const modes = uniqueUpperList(body?.eligibleCommercialModes, COMMERCIAL_MODES);
  const discount = clean(body?.discountTreatment, 40).toUpperCase();
  const shipping = clean(body?.shippingTreatment, 40).toUpperCase();
  const returnPolicy = clean(body?.returnReversalPolicy, 40).toUpperCase();
  const cancellationPolicy = clean(body?.cancellationReversalPolicy, 40).toUpperCase();
  const frequency = clean(body?.statementFrequency, 40).toUpperCase();
  const negative = clean(body?.negativeCarryForwardPolicy, 40).toUpperCase();
  const rate = body?.rateBps == null ? null : nonNegativeInt(body.rateBps);
  const fixed = body?.fixedAmountMinor == null ? null : nonNegativeInt(body.fixedAmountMinor);
  const minMargin = body?.minimumMarginBps == null ? null : nonNegativeInt(body.minimumMarginBps);
  const cap = body?.capMinor == null ? null : nonNegativeInt(body.capMinor);
  const currency = clean(body?.currency, 3).toUpperCase() || null;

  if (!EARNING_TRIGGERS.has(earningTrigger)) return json({ error: "invalid_earning_trigger" }, 400);
  if (!CALCULATION_BASES.has(calculationBasis)) return json({ error: "invalid_calculation_basis" }, 400);
  if (!roles) return json({ error: "invalid_eligible_attribution_roles" }, 400);
  if (!modes) return json({ error: "invalid_eligible_commercial_modes" }, 400);
  if (!DISCOUNT_TREATMENTS.has(discount)) return json({ error: "invalid_discount_treatment" }, 400);
  if (!SHIPPING_TREATMENTS.has(shipping)) return json({ error: "invalid_shipping_treatment" }, 400);
  if (!REVERSAL_POLICIES.has(returnPolicy) || !REVERSAL_POLICIES.has(cancellationPolicy)) {
    return json({ error: "invalid_reversal_policy" }, 400);
  }
  if (!SETTLEMENT_FREQUENCIES.has(frequency)) return json({ error: "invalid_statement_frequency" }, 400);
  if (!NEGATIVE_POLICIES.has(negative)) return json({ error: "invalid_negative_carry_forward_policy" }, 400);
  if (rate != null && rate > 10000) return json({ error: "invalid_rate" }, 400);
  if (minMargin != null && minMargin > 10000) return json({ error: "invalid_minimum_margin" }, 400);
  if (body?.rateBps != null && rate == null) return json({ error: "invalid_rate" }, 400);
  if (body?.fixedAmountMinor != null && fixed == null) return json({ error: "invalid_fixed_amount" }, 400);
  if (body?.capMinor != null && cap == null) return json({ error: "invalid_cap" }, 400);

  if (["GROSS_SALES", "NET_SALES", "GROSS_MARGIN"].includes(calculationBasis) && rate == null) {
    return json({ error: "rate_required_for_percentage_basis" }, 400);
  }
  if (["FIXED_PER_ORDER", "FIXED_PER_UNIT"].includes(calculationBasis) && fixed == null) {
    return json({ error: "fixed_amount_required_for_fixed_basis" }, 400);
  }
  if (["FIXED_PER_ORDER", "FIXED_PER_UNIT"].includes(calculationBasis) && !currency) {
    return json({ error: "currency_required_for_fixed_basis" }, 400);
  }

  await db`
    UPDATE commission_rules
    SET earning_trigger=${earningTrigger},
        calculation_basis=${calculationBasis},
        rate_bps=${rate},
        fixed_amount_minor=${fixed},
        currency=${currency},
        minimum_margin_bps=${minMargin},
        cap_minor=${cap},
        eligible_attribution_roles=to_jsonb(${roles}::text[]),
        eligible_commercial_modes=to_jsonb(${modes}::text[]),
        discount_treatment=${discount},
        shipping_treatment=${shipping},
        return_reversal_policy=${returnPolicy},
        cancellation_reversal_policy=${cancellationPolicy},
        statement_frequency=${frequency},
        negative_carry_forward_policy=${negative},
        updated_at=NOW()
    WHERE id=${id}`;

  await writeAuditEvent(db, {
    ...auditActor(auth.actor),
    action: "commission_rule.policy_updated",
    resourceType: "CommissionRule",
    resourceId: id,
    outcome: "SUCCESS",
    metadata: { earningTrigger, calculationBasis, roles, modes }
  });

  return commissionReadiness(req, db, id);
}

async function transitionCommissionRule(
  req: Request,
  db: DB,
  id: number,
  target: "APPROVED" | "ACTIVE" | "DISABLED"
) {
  const permission = target === "APPROVED" ? "commissions.rules.approve" : "commissions.rules.manage";
  const auth = await authorizeInternal(req, db, permission, { mutation:true });
  if (!auth.ok) return auth.response;
  if (target === "APPROVED" && auth.actor.type !== "USER") {
    return json({ error: "staff_approval_required" }, 403);
  }

  const result: any = await db.begin(async (tx: DB) => {
    const rows = await tx`SELECT * FROM commission_rules WHERE id=${id} FOR UPDATE`;
    if (!rows.length) return { error: "not_found", status:404 };
    const row = rows[0];
    const current = String(row.status);

    if (target === "APPROVED") {
      if (current !== "DRAFT") return { error: "invalid_transition", status:409, current, target };
      const blockers = commissionRuleConfigurationBlockers(row);
      if (blockers.length) return { error: "rule_policy_incomplete", status:409, blockers };
      if (row.created_by_user_id != null && auth.actor.type === "USER" &&
          Number(row.created_by_user_id) === auth.actor.userId) {
        return { error: "self_approval_forbidden", status:409 };
      }
      await tx`
        UPDATE commission_rules
        SET status='APPROVED',approved_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
            approved_at=NOW(),updated_at=NOW()
        WHERE id=${id}`;
    } else if (target === "ACTIVE") {
      if (current !== "APPROVED") return { error: "invalid_transition", status:409, current, target };
      const blockers = commissionRuleActivationBlockers(row);
      if (blockers.length) return { error: "rule_not_activation_ready", status:409, blockers };
      await tx`UPDATE commission_rules SET status='ACTIVE',updated_at=NOW() WHERE id=${id}`;
    } else {
      if (!["APPROVED", "ACTIVE"].includes(current)) {
        return { error: "invalid_transition", status:409, current, target };
      }
      await tx`UPDATE commission_rules SET status='DISABLED',updated_at=NOW() WHERE id=${id}`;
    }

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action: "commission_rule." + target.toLowerCase(),
      resourceType: "CommissionRule",
      resourceId: id,
      outcome: "SUCCESS",
      metadata: { fromStatus: current, toStatus: target }
    });

    return { ok:true, fromStatus:current, toStatus:target };
  });

  return result.error ? json(result, result.status || 409) : json(result);
}

async function overallReadiness(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "economics.policy.read");
  if (!auth.ok) return auth.response;

  const agreements = await db`
    SELECT a.*,s.status AS seller_status,s.display_name AS seller_display_name
    FROM seller_agreements a
    JOIN seller_accounts s ON s.id=a.seller_id
    WHERE a.status IN ('APPROVED','ACTIVE')
    ORDER BY a.id`;
  const rules = await db`
    SELECT *
    FROM commission_rules
    WHERE status IN ('APPROVED','ACTIVE')
    ORDER BY id`;

  const sellerItems = agreements.map((row:any) => {
    const config = sellerAgreementConfigurationBlockers(row);
    const fiscal = sellerAgreementFiscalBlockers(row);
    const activation = sellerAgreementActivationBlockers(row);
    return {
      agreementId:Number(row.id),
      sellerId:Number(row.seller_id),
      sellerDisplayName:row.seller_display_name,
      status:row.status,
      configurationReady:config.length===0,
      settlementReady:activation.length===0 && row.status==="ACTIVE",
      blockers:{configuration:config,fiscal,activation}
    };
  });

  const commissionItems = rules.map((row:any) => {
    const config = commissionRuleConfigurationBlockers(row);
    const activation = commissionRuleActivationBlockers(row);
    return {
      ruleId:Number(row.id),
      name:row.name,
      version:Number(row.version),
      status:row.status,
      configurationReady:config.length===0,
      commissionReady:activation.length===0 && row.status==="ACTIVE",
      blockers:{configuration:config,activation}
    };
  });

  return json({
    settlement: {
      configured: sellerItems.length,
      ready: sellerItems.filter((x:any)=>x.settlementReady).length,
      blocked: sellerItems.filter((x:any)=>!x.settlementReady).length,
      items: sellerItems
    },
    commissions: {
      configured: commissionItems.length,
      ready: commissionItems.filter((x:any)=>x.commissionReady).length,
      blocked: commissionItems.filter((x:any)=>!x.commissionReady).length,
      items: commissionItems
    },
    moneyCreationEnabled: false
  });
}

export async function handleEconomicReadiness(req: Request, url: URL, db: DB) {
  if (url.pathname === "/v1/internal/economic-readiness" && req.method === "GET") {
    return overallReadiness(req, db);
  }

  const sellerReady = url.pathname.match(/^\/v1\/internal\/seller-agreements\/(\d+)\/readiness$/);
  if (sellerReady && req.method === "GET") {
    return sellerReadiness(req, db, Number(sellerReady[1]));
  }

  const sellerPolicy = url.pathname.match(/^\/v1\/internal\/seller-agreements\/(\d+)\/policy$/);
  if (sellerPolicy && req.method === "PATCH") {
    return patchSellerPolicy(req, db, Number(sellerPolicy[1]));
  }

  const sellerFiscal = url.pathname.match(/^\/v1\/internal\/seller-agreements\/(\d+)\/fiscal-validation$/);
  if (sellerFiscal && req.method === "POST") {
    return validateSellerFiscal(req, db, Number(sellerFiscal[1]));
  }

  if (url.pathname === "/v1/internal/commission-rules") {
    if (req.method === "GET") return listCommissionRules(req, db);
    if (req.method === "POST") return createCommissionRule(req, db);
  }

  const rule = url.pathname.match(/^\/v1\/internal\/commission-rules\/(\d+)$/);
  if (rule && req.method === "PATCH") {
    return patchCommissionRule(req, db, Number(rule[1]));
  }

  const ruleReady = url.pathname.match(/^\/v1\/internal\/commission-rules\/(\d+)\/readiness$/);
  if (ruleReady && req.method === "GET") {
    return commissionReadiness(req, db, Number(ruleReady[1]));
  }

  const ruleAction = url.pathname.match(
    /^\/v1\/internal\/commission-rules\/(\d+)\/(approve|activate|disable)$/
  );
  if (ruleAction && req.method === "POST") {
    const id = Number(ruleAction[1]);
    if (ruleAction[2] === "approve") return transitionCommissionRule(req, db, id, "APPROVED");
    if (ruleAction[2] === "activate") return transitionCommissionRule(req, db, id, "ACTIVE");
    return transitionCommissionRule(req, db, id, "DISABLED");
  }

  if (
    url.pathname.startsWith("/v1/internal/economic-readiness") ||
    url.pathname.startsWith("/v1/internal/commission-rules") ||
    url.pathname.includes("/readiness") ||
    url.pathname.includes("/fiscal-validation")
  ) {
    return json({ error: "not_found" }, 404);
  }

  return null;
}
