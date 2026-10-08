type DB = any;

export type HealthSignalDefinition = {
  sourceType: string;
  signalType: string;
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNKNOWN";
  severity: "INFO" | "WARNING" | "CRITICAL";
  observedValue: number | null;
  thresholdValue: number | null;
  unit: string | null;
  message: string;
  correlationKey: string;
  metadata: Record<string, unknown>;
  active: boolean;
};

function envHours(name: string, fallback: number) {
  const n = Number(Bun.env[name] || fallback);
  return Number.isFinite(n) && n > 0 && n <= 720 ? Math.floor(n) : fallback;
}

export async function collectHealthSignals(db: DB): Promise<HealthSignalDefinition[]> {
  const orderSla = envHours("HEALTH_ORDER_STUCK_HOURS", 24);
  const transferSla = envHours("HEALTH_BANK_TRANSFER_SLA_HOURS", 24);
  const fulfillmentSla = envHours("HEALTH_FULFILLMENT_BACKLOG_HOURS", 4);
  const returningSla = envHours("HEALTH_RETURNING_SLA_HOURS", 24);
  const codSla = envHours("HEALTH_COD_RECONCILIATION_SLA_HOURS", 24);

  const [
    expiredReservations,
    stuckOrders,
    pendingTransfers,
    failedAttempts,
    fulfillmentBacklog,
    failedFulfillments,
    returningBacklog,
    codBacklog
  ] = await Promise.all([
    db`
      SELECT COUNT(*)::int AS count,
             COALESCE(MAX(EXTRACT(EPOCH FROM (NOW()-expires_at))/60),0)::int AS oldest_minutes
      FROM inventory_reservations
      WHERE status='ACTIVE' AND expires_at IS NOT NULL AND expires_at<=NOW()`,
    db`
      SELECT COUNT(*)::int AS count,
             COALESCE(MAX(EXTRACT(EPOCH FROM (NOW()-updated_at))/3600),0)::int AS oldest_hours
      FROM orders
      WHERE status IN ('CONFIRMED','PROCESSING','READY','SHIPPED','DELIVERED')
        AND updated_at<=NOW()-(${orderSla}::text||' hours')::interval`,
    db`
      SELECT COUNT(*)::int AS count,
             COALESCE(MAX(EXTRACT(EPOCH FROM (NOW()-updated_at))/3600),0)::int AS oldest_hours
      FROM payments
      WHERE method='BANK_TRANSFER' AND status='PENDING'
        AND updated_at<=NOW()-(${transferSla}::text||' hours')::interval`,
    db`
      SELECT COUNT(*)::int AS count
      FROM payment_attempts
      WHERE status='FAILED' AND created_at>=NOW()-INTERVAL '24 hours'`,
    db`
      SELECT COUNT(*)::int AS count,
             COALESCE(MAX(EXTRACT(EPOCH FROM (NOW()-updated_at))/3600),0)::int AS oldest_hours
      FROM fulfillments
      WHERE status IN ('PREPARING','READY')
        AND updated_at<=NOW()-(${fulfillmentSla}::text||' hours')::interval`,
    db`SELECT COUNT(*)::int AS count FROM fulfillments WHERE status='FAILED'`,
    db`
      SELECT COUNT(*)::int AS count,
             COALESCE(MAX(EXTRACT(EPOCH FROM (NOW()-updated_at))/3600),0)::int AS oldest_hours
      FROM fulfillments
      WHERE status='RETURNING'
        AND updated_at<=NOW()-(${returningSla}::text||' hours')::interval`,
    db`
      SELECT COUNT(*)::int AS count,
             COALESCE(MAX(EXTRACT(EPOCH FROM (NOW()-COALESCE(collected_at,updated_at)))/3600),0)::int AS oldest_hours
      FROM cod_collections
      WHERE status='COLLECTED'
        AND COALESCE(collected_at,updated_at)<=NOW()-(${codSla}::text||' hours')::interval`
  ]);

  const n = (rows: any[]) => Number(rows[0]?.count || 0);
  const rCount=n(expiredReservations), oCount=n(stuckOrders), tCount=n(pendingTransfers);
  const pFail=n(failedAttempts), fBack=n(fulfillmentBacklog), fFail=n(failedFulfillments);
  const rBack=n(returningBacklog), cBack=n(codBacklog);

  return [
    {
      sourceType:"orders", signalType:"reservation_expiry_backlog",
      status:rCount?"DOWN":"HEALTHY", severity:rCount?"CRITICAL":"INFO",
      observedValue:rCount, thresholdValue:0, unit:"reservations",
      message:rCount
        ? rCount+" reserva(s) expirada(s) siguen ACTIVE; antigüedad máxima "+Number(expiredReservations[0]?.oldest_minutes||0)+" min."
        : "No hay reservas expiradas que sigan ACTIVE.",
      correlationKey:"orders:expired-active-reservations",
      metadata:{oldestMinutes:Number(expiredReservations[0]?.oldest_minutes||0)}, active:rCount>0
    },
    {
      sourceType:"orders", signalType:"stuck_orders",
      status:oCount?"DEGRADED":"HEALTHY", severity:oCount?"WARNING":"INFO",
      observedValue:oCount, thresholdValue:orderSla, unit:"orders",
      message:oCount?oCount+" pedido(s) superan "+orderSla+" h sin avanzar.":"Pedidos dentro del SLA de "+orderSla+" h.",
      correlationKey:"orders:stuck",
      metadata:{slaHours:orderSla,oldestHours:Number(stuckOrders[0]?.oldest_hours||0)}, active:oCount>0
    },
    {
      sourceType:"payments", signalType:"bank_transfer_verification_backlog",
      status:tCount?"DEGRADED":"HEALTHY", severity:tCount?"WARNING":"INFO",
      observedValue:tCount, thresholdValue:transferSla, unit:"payments",
      message:tCount?tCount+" transferencia(s) BANK_TRANSFER siguen PENDING > "+transferSla+" h.":"Transferencias dentro del SLA.",
      correlationKey:"payments:bank-transfer-pending",
      metadata:{slaHours:transferSla,oldestHours:Number(pendingTransfers[0]?.oldest_hours||0)}, active:tCount>0
    },
    {
      sourceType:"payments", signalType:"failed_payment_attempts",
      status:pFail?"DEGRADED":"HEALTHY", severity:pFail?"WARNING":"INFO",
      observedValue:pFail, thresholdValue:0, unit:"attempts_24h",
      message:pFail?pFail+" intento(s) de pago FAILED en 24 h.":"Sin intentos de pago FAILED en 24 h.",
      correlationKey:"payments:failed-attempts-24h", metadata:{windowHours:24}, active:pFail>0
    },
    {
      sourceType:"fulfillment", signalType:"fulfillment_backlog",
      status:fBack?"DEGRADED":"HEALTHY", severity:fBack?"WARNING":"INFO",
      observedValue:fBack, thresholdValue:fulfillmentSla, unit:"fulfillments",
      message:fBack?fBack+" fulfillment(s) PREPARING/READY superan "+fulfillmentSla+" h.":"Fulfillment dentro del SLA.",
      correlationKey:"fulfillment:backlog",
      metadata:{slaHours:fulfillmentSla,oldestHours:Number(fulfillmentBacklog[0]?.oldest_hours||0)}, active:fBack>0
    },
    {
      sourceType:"fulfillment", signalType:"failed_delivery",
      status:fFail?"DOWN":"HEALTHY", severity:fFail?"CRITICAL":"INFO",
      observedValue:fFail, thresholdValue:0, unit:"fulfillments",
      message:fFail?fFail+" fulfillment(s) están FAILED.":"No hay fulfillments FAILED.",
      correlationKey:"fulfillment:failed", metadata:{}, active:fFail>0
    },
    {
      sourceType:"fulfillment", signalType:"returning_backlog",
      status:rBack?"DEGRADED":"HEALTHY", severity:rBack?"WARNING":"INFO",
      observedValue:rBack, thresholdValue:returningSla, unit:"fulfillments",
      message:rBack?rBack+" retorno(s) superan "+returningSla+" h en RETURNING.":"Retornos dentro del SLA.",
      correlationKey:"fulfillment:returning-backlog",
      metadata:{slaHours:returningSla,oldestHours:Number(returningBacklog[0]?.oldest_hours||0)}, active:rBack>0
    },
    {
      sourceType:"cod", signalType:"cod_reconciliation_backlog",
      status:cBack?"DEGRADED":"HEALTHY", severity:cBack?"WARNING":"INFO",
      observedValue:cBack, thresholdValue:codSla, unit:"collections",
      message:cBack?cBack+" cobro(s) COD COLLECTED siguen sin RECONCILED > "+codSla+" h.":"COD dentro del SLA.",
      correlationKey:"cod:unreconciled",
      metadata:{slaHours:codSla,oldestHours:Number(codBacklog[0]?.oldest_hours||0)}, active:cBack>0
    },
    {
      sourceType:"fiscal", signalType:"fiscal_authority_state",
      status:"UNKNOWN", severity:"INFO", observedValue:null, thresholdValue:null, unit:null,
      message:"Fiscal/CAI permanece UNKNOWN hasta que M05 exponga estado productivo autoritativo.",
      correlationKey:"fiscal:authority-state",
      metadata:{reason:"M05_not_productively_activated"}, active:false
    }
  ];
}
