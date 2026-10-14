#!/usr/bin/env bun
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  loadOperationalSnapshots, operationalMetrics, overviewSources,
  renderOperationalOverview
} from "./operational-overview";

const source=readFileSync(new URL("./index.ts",import.meta.url),"utf8");

test("home summary requests only endpoints with explicitly granted read permissions",async()=>{
  const called:string[]=[];
  const snapshots=await loadOperationalSnapshots(["orders.read","returns.read"],async path=>{
    called.push(path);
    return {ok:true,body:{data:[]}};
  });
  expect(called.sort()).toEqual(["/v1/internal/orders","/v1/internal/returns"].sort());
  expect(Object.keys(snapshots).sort()).toEqual(["orders","returns"]);
  expect(overviewSources.map(x=>x.apiPath)).not.toContain("/v1/internal/payments/refund-requests");
});

test("independent source outages do not hide other metrics or manufacture zeroes",async()=>{
  const grants=["orders.read","fulfillment.read","health.read"];
  const snapshots=await loadOperationalSnapshots(grants,async path=>{
    if(path.endsWith("/fulfillments"))throw new Error("timeout");
    if(path.endsWith("/health-desk"))return {ok:false};
    return {ok:true,body:{data:[{status:"PENDING_CONFIRMATION"},{status:"CONFIRMED"},{status:"CANCELLED"}]}};
  });
  const metrics=operationalMetrics(grants,snapshots);
  expect(metrics.find(m=>m.key==="orders")?.count).toBe(2);
  expect(metrics.find(m=>m.key==="fulfillment")?.count).toBeNull();
  expect(metrics.find(m=>m.key==="critical")?.count).toBeNull();
  const html=renderOperationalOverview(grants,snapshots);
  expect(html).toContain("No disponible o sin acceso en esta ubicación");
  expect(html).toContain("Los listados pueden estar limitados");
  expect(html).not.toContain("Sin avisos en los indicadores consultados");
});

test("admin sees grounded KPIs, review alerts and GET-only shortcuts",()=>{
  const grants=[
    "health.read","orders.read","fulfillment.read","returns.read",
    "procurement.read","inventory_adjustments.read","catalog.read"
  ];
  const snapshots={
    health:{ok:true,body:{summary:{openIncidents:2,criticalSignals:1}}},
    orders:{ok:true,body:{data:[{status:"PENDING_CONFIRMATION"},{status:"PROCESSING"},{status:"DELIVERED"}]}},
    fulfillment:{ok:true,body:{data:[{status:"READY"},{status:"DELIVERED"}]}},
    returns:{ok:true,body:{data:[{status:"REQUESTED"},{status:"INSPECTED"}]}},
    purchases:{ok:true,body:{data:[{status:"PARTIALLY_RECEIVED"},{status:"ORDERED"},{status:"RECEIVED"}]}}
  };
  const metrics=operationalMetrics(grants,snapshots);
  expect(metrics.map(m=>m.count)).toEqual([2,1,2,1,1,2]);
  const html=renderOperationalOverview(grants,snapshots);
  expect(html).toContain("Incidentes abiertos");
  expect(html).toContain("Compras por recibir");
  expect(html).toContain('href="/workspace"');
  expect(html).toContain('href="/health-desk"');
  expect(html).toContain('href="/purchases"');
  expect(html).toContain("revisar en el módulo");
  expect(html).not.toContain("<form");
  expect(html).not.toContain('method="post"');
});

test("restricted users cannot see ungranted links, counts, incidents or private details",()=>{
  const snapshots={
    health:{ok:true,body:{summary:{openIncidents:42,criticalSignals:9}}},
    orders:{ok:true,body:{data:[{status:"CONFIRMED"}]}},
    returns:{ok:true,body:{data:[{status:"REQUESTED"}]}}
  };
  const html=renderOperationalOverview(["catalog.read"],snapshots);
  expect(operationalMetrics(["catalog.read"],snapshots)).toHaveLength(0);
  expect(html).toContain('href="/catalog"');
  expect(html).not.toContain('href="/health-desk"');
  expect(html).not.toContain('href="/orders"');
  expect(html).not.toContain('href="/returns"');
  expect(html).not.toContain("42");
  expect(html).not.toContain("9");
  expect(html).toContain("No hay indicadores habilitados");
});

test("malformed or absent provider responses never become misleading operational totals",()=>{
  const grants=["health.read","orders.read"];
  const html=renderOperationalOverview(grants,{
    health:{ok:true,body:{summary:{openIncidents:"<script>x</script>",criticalSignals:-5}}},
    orders:{ok:true,body:{data:"fake"}}
  });
  expect(operationalMetrics(grants,{
    health:{ok:true,body:{summary:{openIncidents:"<script>x</script>",criticalSignals:-5}}},
    orders:{ok:true,body:{data:"fake"}}
  }).every(m=>m.count===null)).toBe(true);
  expect(html).not.toContain("<script>");
  expect(html).toContain("No disponible o sin acceso");
});

test("operational overview is home for staff without inquiries.read and preserves inquiries dashboard for authorized staff",()=>{
  const guard=source.indexOf('const session=await readSession(req)');
  const overview=source.indexOf("async function operationalOverviewForSession");
  const fallback=source.indexOf('if(!permissions.includes("inquiries.read"))return shell(overview,session)');
  const inquiries=source.indexOf('"/v1/internal/control-center/dashboard"');
  const route=source.indexOf('if(url.pathname==="/"&&req.method==="GET")');
  expect(overview).toBeGreaterThan(0);
  expect(fallback).toBeGreaterThan(overview);
  expect(inquiries).toBeGreaterThan(fallback);
  expect(route).toBeGreaterThan(guard);
  expect(source).toContain('return shell(overview+`');
  expect(source).toContain('class="ov-grid"');
  expect(source).toContain("loadOperationalSnapshots(permissions");
  expect(source).toContain("@media(max-width:650px)");
});
