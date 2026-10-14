#!/usr/bin/env bun
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildPriorityQueue, priorityQueueCoverage, renderPriorityQueue
} from "./priority-work-queue";
import type { OverviewSnapshots } from "./operational-overview";

const source=readFileSync(new URL("./index.ts",import.meta.url),"utf8");
const permissions=[
  "health.read", "orders.read", "fulfillment.read", "returns.read", "procurement.read"
];
const snapshots: OverviewSnapshots = {
  health: {
    ok: true, body: {
      summary: { openIncidents: 4, criticalSignals: 2 },
      incidents: [
        {id:6, incidentNumber:"INC-006", title:"Webhook fallando", severity:"CRITICAL", status:"OPEN", createdAt:"2026-10-10T09:00:00Z"},
        {id:7, incidentNumber:"INC-007", title:"Lentitud API", severity:"WARNING", status:"OPEN", createdAt:"2026-10-11T09:00:00Z"},
        {id:8, incidentNumber:"INC-008", title:"Ya resuelto", severity:"CRITICAL", status:"RESOLVED", createdAt:"2026-10-09T09:00:00Z"}
      ]
    }
  },
  orders: {
    ok: true, body: {data:[
      {id:13,order_number:"MR-13",status:"PENDING_CONFIRMATION",created_at:"2026-10-07T09:00:00Z"},
      {id:14,order_number:"MR-14",status:"CONFIRMED",created_at:"2026-10-08T09:00:00Z"},
      {id:15,order_number:"MR-15",status:"CANCELLED",created_at:"2026-10-06T09:00:00Z"},
      {id:16,order_number:"MR-16",status:"PROCESSING",created_at:"2026-10-06T09:00:00Z"}
    ]}
  },
  fulfillment: {
    ok: true,body:{data:[
      {id:19,order_number:"MR-15",status:"FAILED",created_at:"2026-10-12T09:00:00Z"},
      {id:20,order_number:"MR-17",status:"READY",created_at:"2026-10-12T11:00:00Z"},
      {id:21,order_number:"MR-18",status:"DELIVERED",created_at:"2026-10-04T09:00:00Z"}
    ]}
  },
  returns: {
    ok:true,body:{data:[
      {id:25,returnNumber:"DEV-25",status:"REQUESTED",requestedAt:"2026-10-13T09:00:00Z"},
      {id:26,returnNumber:"DEV-26",status:"RECEIVED",requestedAt:"2026-10-12T09:00:00Z"},
      {id:27,returnNumber:"DEV-27",status:"REFUNDED",requestedAt:"2026-10-11T09:00:00Z"}
    ]}
  },
  purchases: {
    ok:true,body:{data:[
      {id:31,poNumber:"OC-31",status:"PARTIALLY_RECEIVED",createdAt:"2026-10-05T09:00:00Z"},
      {id:32,poNumber:"OC-32",status:"ORDERED",createdAt:"2026-10-02T09:00:00Z"},
      {id:33,poNumber:"OC-33",status:"CANCELLED",createdAt:"2026-10-01T09:00:00Z"}
    ]}
  }
};

test("only explicitly pending statuses are enqueued and rank precedes age",()=>{
  const items=buildPriorityQueue(permissions,snapshots);
  expect(items.map(x=>x.key)).toEqual([
    "health:6", "fulfillment:19",
    "purchases:31", "orders:13", "health:7", "returns:25",
    "purchases:32", "orders:14", "returns:26", "fulfillment:20"
  ]);
  expect(items.slice(0,2).every(x=>x.priority==="urgent")).toBe(true);
  expect(items.some(x=>x.title==="Ya resuelto")).toBe(false);
  expect(items.some(x=>x.title==="MR-16")).toBe(false);
  expect(items.some(x=>x.title==="DEV-27")).toBe(false);
  expect(items.every(x=>["/orders","/fulfillment","/returns","/purchases","/health-desk"].includes(x.destination.split("#")[0]))).toBe(true);
});

test("staff permissions filter both queue items and their navigation endpoints",()=>{
  const items=buildPriorityQueue(["returns.read"],snapshots);
  expect(items.map(x=>x.key)).toEqual(["returns:25","returns:26"]);
  const html=renderPriorityQueue(["returns.read"],snapshots);
  expect(html).toContain('href="/returns#return-25"');
  expect(html).not.toContain('href="/orders#order-13"');
  expect(html).not.toContain('href="/purchases#purchase-31"');
  expect(html).not.toContain("Webhook fallando");
  expect(html).not.toContain("MR-13");
  const denied=renderPriorityQueue([],snapshots);
  expect(denied).toContain("No tienes permisos de consulta");
  expect(denied).not.toContain('class="wq-item"');
});

test("missing source is not counted as an empty healthy queue",()=>{
  const grants=["orders.read","fulfillment.read","health.read"];
  const partial={
    orders:{ok:true,body:{data:[]}},
    fulfillment:{ok:false},
    health:{ok:true,body:{summary:{openIncidents:9}}}
  };
  expect(priorityQueueCoverage(grants,partial).unavailableSources).toEqual([
    "Health Desk","Entregas"
  ]);
  const html=renderPriorityQueue(grants,partial);
  expect(html).toContain("Fuentes no disponibles: Health Desk, Entregas");
  expect(html).toContain("No se encontraron pendientes con estos filtros");
  const unavailable=renderPriorityQueue(["orders.read"],{orders:{ok:false}});
  expect(unavailable).toContain("No se pudieron consultar las bandejas autorizadas");
  expect(unavailable).not.toContain("Sin incidencias");
});

test("filters are GET-only, allowlisted and do not reflect untrusted parameters",()=>{
  const html=renderPriorityQueue(permissions,snapshots,{priority:"urgent",domain:"fulfillment"});
  expect(html).toContain('href="/work-queue?priority=urgent&amp;domain=fulfillment"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain("Mostrando 1 de 1 pendientes");
  expect(html).toContain("Entrega fallida");
  expect(html).toContain('href="/fulfillment#fulfillment-19"');
  expect(html).not.toContain("INC-006");
  const malicious=renderPriorityQueue(permissions,snapshots,{
    priority:'urgent"><script>alert(1)</script>',domain:'orders" onclick="alert(2)'
  });
  expect(malicious).not.toContain("<script>");
  expect(malicious).not.toContain("onclick");
  expect(malicious).toContain("Mostrando 10 de 10 pendientes");
  expect(html).not.toContain("<form");
  expect(html).not.toContain('method="post"');
});

test("malformed identifiers are ignored, text is escaped and rows deduplicate",()=>{
  const hostile: OverviewSnapshots={orders:{ok:true,body:{data:[
    {id:1,status:"PENDING_CONFIRMATION",order_number:'<img src=x onerror="alert(1)">'},
    {id:1,status:"PENDING_CONFIRMATION",order_number:"Duplicate"},
    {id:-3,status:"CONFIRMED",order_number:"Negative"},
    {id:"13abc",status:"CONFIRMED",order_number:"Non-numeric"},
    {id:9007199254740992,status:"CONFIRMED",order_number:"Unsafe integer"}
  ]}}};
  expect(buildPriorityQueue(["orders.read"],hostile)).toHaveLength(1);
  const html=renderPriorityQueue(["orders.read"],hostile);
  expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("Duplicate");
  expect(html).not.toContain("Unsafe integer");
  expect(html).not.toContain("Negative");
});

test("home preview limits to six and uses already fetched authorized data",()=>{
  const html=renderPriorityQueue(permissions,snapshots,{compact:true});
  expect((html.match(/class="wq-item"/g)||[]).length).toBe(6);
  expect(html).toContain("Mostrando 6 de 10 pendientes");
  expect(html).toContain('href="/work-queue"');
  expect(html).not.toContain('class="wq-filters"');
  const sourceIndex=source.indexOf("async function operationalOverviewForSession");
  const snippet=source.slice(sourceIndex,sourceIndex+380);
  expect(snippet).toContain("operationalContextForSession(session)");
  expect(snippet).toContain("renderOperationalOverview(permissions,snapshots)");
  expect(snippet).toContain("renderPriorityQueue(permissions,snapshots,{compact:true})");
});

test("dedicated work queue requires existing authenticated staff session and is GET only",()=>{
  const authPos=source.indexOf("const session=await readSession(req)");
  const queuePos=source.indexOf('if(url.pathname==="/work-queue"&&req.method==="GET")');
  expect(authPos).toBeGreaterThan(0);
  expect(queuePos).toBeGreaterThan(authPos);
  expect(source).toContain('href="/work-queue" class="ws-link"');
  expect(source).toContain('url.searchParams.get("priority")');
  expect(source).toContain('url.searchParams.get("domain")');
  expect(source).toContain(".wq-open:focus-visible");
  expect(source).toContain("@media(max-width:700px)");
  expect(source).toContain(".item:target");
});
