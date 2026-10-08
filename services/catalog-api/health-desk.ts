import { auditActor, authorizeInternal, writeAuditEvent } from "./auth";
import { collectHealthSignals } from "./health-signals";

type DB = any;

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function incidentNumber() {
  return "INC-" + new Date().toISOString().slice(0, 10).replaceAll("-", "") + "-" +
    crypto.randomUUID().slice(0, 8).toUpperCase();
}

export async function ensureHealthDeskSchema(db: DB) {
  await db`
    CREATE TABLE IF NOT EXISTS health_signals (
      id BIGSERIAL PRIMARY KEY,
      source_type TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      status TEXT NOT NULL,
      severity TEXT NOT NULL,
      observed_value BIGINT,
      threshold_value BIGINT,
      unit TEXT,
      message TEXT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_healthy_at TIMESTAMPTZ,
      correlation_key TEXT UNIQUE NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      active BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (status IN ('HEALTHY','DEGRADED','DOWN','UNKNOWN')),
      CHECK (severity IN ('INFO','WARNING','CRITICAL'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS operational_incidents (
      id BIGSERIAL PRIMARY KEY,
      incident_number TEXT UNIQUE NOT NULL,
      correlation_key TEXT UNIQUE NOT NULL,
      incident_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_signal_id BIGINT REFERENCES health_signals(id) ON DELETE SET NULL,
      assigned_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      acknowledged_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      resolved_by_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      acknowledged_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      resolution_code TEXT,
      resolution_notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (severity IN ('INFO','WARNING','CRITICAL')),
      CHECK (status IN ('OPEN','ACKNOWLEDGED','INVESTIGATING','RESOLVED','CLOSED','SUPPRESSED'))
    )`;

  await db`
    CREATE TABLE IF NOT EXISTS operational_incident_history (
      id BIGSERIAL PRIMARY KEY,
      incident_id BIGINT NOT NULL REFERENCES operational_incidents(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_user_id BIGINT REFERENCES staff_users(id) ON DELETE SET NULL,
      actor_service TEXT,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

  await db`
    CREATE INDEX IF NOT EXISTS idx_operational_incidents_status_severity
    ON operational_incidents(status,severity,created_at DESC)`;
}

async function refreshHealth(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "health.incidents.manage", { mutation:true });
  if (!auth.ok) return auth.response;

  const definitions = await collectHealthSignals(db);
  let opened = 0;
  let autoResolved = 0;

  await db.begin(async (tx: DB) => {
    for (const signal of definitions) {
      const rows = await tx`
        INSERT INTO health_signals(
          source_type,signal_type,status,severity,observed_value,threshold_value,
          unit,message,correlation_key,metadata_json,active,last_healthy_at
        )
        VALUES(
          ${signal.sourceType},${signal.signalType},${signal.status},${signal.severity},
          ${signal.observedValue},${signal.thresholdValue},${signal.unit},${signal.message},
          ${signal.correlationKey},${JSON.stringify(signal.metadata)}::jsonb,${signal.active},
          ${signal.status==="HEALTHY"?new Date():null}
        )
        ON CONFLICT(correlation_key) DO UPDATE SET
          source_type=EXCLUDED.source_type,
          signal_type=EXCLUDED.signal_type,
          status=EXCLUDED.status,
          severity=EXCLUDED.severity,
          observed_value=EXCLUDED.observed_value,
          threshold_value=EXCLUDED.threshold_value,
          unit=EXCLUDED.unit,
          message=EXCLUDED.message,
          metadata_json=EXCLUDED.metadata_json,
          active=EXCLUDED.active,
          last_seen_at=NOW(),
          last_healthy_at=CASE
            WHEN EXCLUDED.status='HEALTHY' THEN NOW()
            ELSE health_signals.last_healthy_at
          END,
          updated_at=NOW()
        RETURNING id`;
      const signalId = Number(rows[0].id);

      const incidents = await tx`
        SELECT id,status
        FROM operational_incidents
        WHERE correlation_key=${signal.correlationKey}
        LIMIT 1`;

      if (signal.active) {
        if (!incidents.length) {
          const created = await tx`
            INSERT INTO operational_incidents(
              incident_number,correlation_key,incident_type,severity,status,
              title,summary,source_signal_id
            )
            VALUES(
              ${incidentNumber()},${signal.correlationKey},${signal.signalType},
              ${signal.severity},'OPEN',${signal.message},${signal.message},${signalId}
            )
            RETURNING id`;
          await tx`
            INSERT INTO operational_incident_history(
              incident_id,from_status,to_status,actor_user_id,actor_service,note
            )
            VALUES(
              ${Number(created[0].id)},NULL,'OPEN',
              ${auth.actor.type==="USER"?auth.actor.userId:null},
              ${auth.actor.type==="SERVICE"?auth.actor.service:null},
              'signal_became_active'
            )`;
          opened++;
        } else {
          const id = Number(incidents[0].id);
          const current = String(incidents[0].status);
          if (["RESOLVED","CLOSED"].includes(current)) {
            await tx`
              UPDATE operational_incidents
              SET status='OPEN',severity=${signal.severity},title=${signal.message},
                  summary=${signal.message},source_signal_id=${signalId},
                  resolved_by_user_id=NULL,resolved_at=NULL,resolution_code=NULL,
                  resolution_notes=NULL,updated_at=NOW()
              WHERE id=${id}`;
            await tx`
              INSERT INTO operational_incident_history(
                incident_id,from_status,to_status,actor_user_id,actor_service,note
              )
              VALUES(
                ${id},${current},'OPEN',
                ${auth.actor.type==="USER"?auth.actor.userId:null},
                ${auth.actor.type==="SERVICE"?auth.actor.service:null},
                'signal_reactivated'
              )`;
            opened++;
          } else {
            await tx`
              UPDATE operational_incidents
              SET severity=${signal.severity},title=${signal.message},
                  summary=${signal.message},source_signal_id=${signalId},updated_at=NOW()
              WHERE id=${id}`;
          }
        }
      } else if (
        incidents.length &&
        ["OPEN","ACKNOWLEDGED","INVESTIGATING"].includes(String(incidents[0].status))
      ) {
        const id = Number(incidents[0].id);
        const current = String(incidents[0].status);
        await tx`
          UPDATE operational_incidents
          SET status='RESOLVED',resolved_at=NOW(),resolution_code='AUTO_HEALTHY',
              resolution_notes='Signal returned to deterministic healthy state.',updated_at=NOW()
          WHERE id=${id}`;
        await tx`
          INSERT INTO operational_incident_history(
            incident_id,from_status,to_status,actor_user_id,actor_service,note
          )
          VALUES(
            ${id},${current},'RESOLVED',
            ${auth.actor.type==="USER"?auth.actor.userId:null},
            ${auth.actor.type==="SERVICE"?auth.actor.service:null},
            'auto_resolved_healthy_signal'
          )`;
        autoResolved++;
      }
    }

    await writeAuditEvent(tx, {
      ...auditActor(auth.actor),
      action:"health.refresh",
      resourceType:"HealthDesk",
      outcome:"SUCCESS",
      metadata:{ signalCount:definitions.length, opened, autoResolved }
    });
  });

  return json({ ok:true, signalCount:definitions.length, opened, autoResolved });
}

async function snapshot(req: Request, db: DB) {
  const auth = await authorizeInternal(req, db, "health.read");
  if (!auth.ok) return auth.response;

  const [signals, incidents] = await Promise.all([
    db`
      SELECT id,source_type,signal_type,status,severity,observed_value,threshold_value,
             unit,message,correlation_key,metadata_json,active,first_seen_at,last_seen_at,last_healthy_at
      FROM health_signals
      ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
               active DESC,source_type,signal_type`,
    db`
      SELECT id,incident_number,correlation_key,incident_type,severity,status,title,summary,
             assigned_user_id,acknowledged_by_user_id,resolved_by_user_id,
             created_at,acknowledged_at,resolved_at,resolution_code,resolution_notes,updated_at
      FROM operational_incidents
      ORDER BY
        CASE status WHEN 'OPEN' THEN 1 WHEN 'ACKNOWLEDGED' THEN 2 WHEN 'INVESTIGATING' THEN 3 ELSE 4 END,
        CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT 100`
  ]);

  const active = signals.filter((x:any)=>Boolean(x.active));
  const overall =
    active.some((x:any)=>x.severity==="CRITICAL") ? "DOWN" :
    active.length ? "DEGRADED" : "HEALTHY";

  return json({
    overall,
    summary:{
      activeSignals:active.length,
      criticalSignals:active.filter((x:any)=>x.severity==="CRITICAL").length,
      warningSignals:active.filter((x:any)=>x.severity==="WARNING").length,
      openIncidents:incidents.filter((x:any)=>
        ["OPEN","ACKNOWLEDGED","INVESTIGATING"].includes(x.status)
      ).length
    },
    signals:signals.map((x:any)=>({
      id:Number(x.id), sourceType:x.source_type, signalType:x.signal_type,
      status:x.status, severity:x.severity,
      observedValue:x.observed_value==null?null:Number(x.observed_value),
      thresholdValue:x.threshold_value==null?null:Number(x.threshold_value),
      unit:x.unit, message:x.message, correlationKey:x.correlation_key,
      metadata:x.metadata_json||{}, active:Boolean(x.active),
      firstSeenAt:x.first_seen_at,lastSeenAt:x.last_seen_at,lastHealthyAt:x.last_healthy_at
    })),
    incidents:incidents.map((x:any)=>({
      id:Number(x.id),incidentNumber:x.incident_number,correlationKey:x.correlation_key,
      incidentType:x.incident_type,severity:x.severity,status:x.status,
      title:x.title,summary:x.summary,
      assignedUserId:x.assigned_user_id==null?null:Number(x.assigned_user_id),
      acknowledgedByUserId:x.acknowledged_by_user_id==null?null:Number(x.acknowledged_by_user_id),
      resolvedByUserId:x.resolved_by_user_id==null?null:Number(x.resolved_by_user_id),
      createdAt:x.created_at,acknowledgedAt:x.acknowledged_at,resolvedAt:x.resolved_at,
      resolutionCode:x.resolution_code,resolutionNotes:x.resolution_notes,updatedAt:x.updated_at
    }))
  });
}

async function transitionIncident(
  req: Request,
  db: DB,
  id: number,
  target: "ACKNOWLEDGED" | "INVESTIGATING" | "RESOLVED"
) {
  const permission =
    target==="RESOLVED" ? "health.incidents.resolve" : "health.incidents.manage";
  const auth = await authorizeInternal(req, db, permission, { mutation:true });
  if (!auth.ok) return auth.response;

  let body:any={};
  try { body=await req.json(); } catch {}
  const note=clean(body?.note,1000)||null;
  const resolutionCode=
    target==="RESOLVED"
      ? clean(body?.resolutionCode,80).toUpperCase()||"MANUAL_RESOLUTION"
      : null;

  const result:any=await db.begin(async(tx:DB)=>{
    const rows=await tx`
      SELECT id,status FROM operational_incidents WHERE id=${id} FOR UPDATE`;
    if(!rows.length)return {error:"not_found",status:404};

    const current=String(rows[0].status);
    if(current==="CLOSED")return {error:"incident_closed",status:409};
    if(current===target)return {ok:true,replayed:true};

    if(target==="ACKNOWLEDGED"){
      await tx`
        UPDATE operational_incidents
        SET status='ACKNOWLEDGED',
            acknowledged_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
            acknowledged_at=NOW(),updated_at=NOW()
        WHERE id=${id}`;
    } else if(target==="INVESTIGATING"){
      await tx`
        UPDATE operational_incidents
        SET status='INVESTIGATING',updated_at=NOW()
        WHERE id=${id}`;
    } else {
      await tx`
        UPDATE operational_incidents
        SET status='RESOLVED',
            resolved_by_user_id=${auth.actor.type==="USER"?auth.actor.userId:null},
            resolved_at=NOW(),resolution_code=${resolutionCode},
            resolution_notes=${note},updated_at=NOW()
        WHERE id=${id}`;
    }

    await tx`
      INSERT INTO operational_incident_history(
        incident_id,from_status,to_status,actor_user_id,actor_service,note
      )
      VALUES(
        ${id},${current},${target},
        ${auth.actor.type==="USER"?auth.actor.userId:null},
        ${auth.actor.type==="SERVICE"?auth.actor.service:null},
        ${note}
      )`;

    await writeAuditEvent(tx,{
      ...auditActor(auth.actor),
      action:"health_incident."+target.toLowerCase(),
      resourceType:"OperationalIncident",
      resourceId:id,
      outcome:"SUCCESS",
      reason:note,
      metadata:{fromStatus:current,toStatus:target,resolutionCode}
    });
    return {ok:true,replayed:false};
  });

  return result.error ? json(result,result.status||409) : json(result);
}

async function assignIncident(req: Request, db: DB, id: number) {
  const auth=await authorizeInternal(req,db,"health.incidents.assign",{mutation:true});
  if(!auth.ok)return auth.response;

  let body:any;
  try { body=await req.json(); } catch { return json({error:"invalid_json"},400); }
  const userId=Number(body?.userId);
  if(!Number.isSafeInteger(userId)||userId<1)return json({error:"invalid_user"},400);

  const users=await db`
    SELECT id FROM staff_users WHERE id=${userId} AND status='ACTIVE' LIMIT 1`;
  if(!users.length)return json({error:"user_not_found"},404);

  const rows=await db`
    UPDATE operational_incidents
    SET assigned_user_id=${userId},updated_at=NOW()
    WHERE id=${id}
    RETURNING id`;
  if(!rows.length)return json({error:"not_found"},404);

  await writeAuditEvent(db,{
    ...auditActor(auth.actor),
    action:"health_incident.assigned",
    resourceType:"OperationalIncident",
    resourceId:id,
    outcome:"SUCCESS",
    metadata:{assignedUserId:userId}
  });

  return json({ok:true,assignedUserId:userId});
}

export async function handleHealthDesk(req:Request,url:URL,db:DB){
  if(!url.pathname.startsWith("/v1/internal/health-desk"))return null;

  if(url.pathname==="/v1/internal/health-desk"&&req.method==="GET"){
    return snapshot(req,db);
  }
  if(url.pathname==="/v1/internal/health-desk/refresh"&&req.method==="POST"){
    return refreshHealth(req,db);
  }

  const action=url.pathname.match(
    /^\/v1\/internal\/health-desk\/incidents\/(\d+)\/(acknowledge|investigate|resolve|assign)$/
  );
  if(action&&req.method==="POST"){
    const id=Number(action[1]);
    const name=action[2];
    if(name==="assign")return assignIncident(req,db,id);
    if(name==="acknowledge")return transitionIncident(req,db,id,"ACKNOWLEDGED");
    if(name==="investigate")return transitionIncident(req,db,id,"INVESTIGATING");
    if(name==="resolve")return transitionIncident(req,db,id,"RESOLVED");
  }

  return json({error:"not_found"},404);
}
