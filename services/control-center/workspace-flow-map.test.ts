#!/usr/bin/env bun
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  workspaceModules, workspaceFlows, validateWorkspaceFlowMap,
  renderWorkspaceFlowMap, visibleWorkspacePaths
} from "./workspace-flow-map";

const source=readFileSync(new URL("./index.ts",import.meta.url),"utf8");

test("workflow topology has unique module paths, valid permissions and existing navigation targets",()=>{
  expect(validateWorkspaceFlowMap()).toEqual([]);
  const linked=[...new Set(workspaceFlows.flatMap(flow=>flow.modules))];
  expect(linked.length).toBe(workspaceModules.length);
  const nav=source.split('<nav id="ws-nav">')[1]?.split("</nav>")[0]||"";
  for(const module of workspaceModules){
    expect(nav).toContain('href="'+module.path+'"');
  }
  for(const id of linked)expect(workspaceModules.some(module=>module.id===id)).toBe(true);
});

test("read-only workflows do not offer links without required StaffUser grants",()=>{
  const empty=renderWorkspaceFlowMap([]);
  expect(visibleWorkspacePaths([])).toEqual([]);
  expect(empty).toContain("0 de "+workspaceModules.length);
  expect(empty).not.toContain('class="wf-action"');
  expect(empty).toContain('Sin permiso de consulta');
  expect(empty).not.toContain("<form");
  expect(empty).not.toContain('method="post"');
});

test("cashier sees only the modules authorized by its read permissions",()=>{
  const grants=["catalog.read","orders.read","payments.read","returns.read","customers.read"];
  const view=renderWorkspaceFlowMap(grants);
  const paths=visibleWorkspacePaths(grants);
  expect(paths).toContain("/catalog");
  expect(paths).toContain("/orders");
  expect(paths).toContain("/returns");
  expect(paths).not.toContain("/purchases");
  expect(paths).not.toContain("/inventory-adjustments");
  expect(view).toContain('href="/catalog" aria-label="Abrir Catálogo"');
  expect(view).toContain('href="/orders" aria-label="Abrir Pedidos"');
  expect(view).not.toContain('href="/purchases" aria-label="Abrir Compras"');
});

test("workflow filtering accepts only registered flow ids",()=>{
  const authorized=workspaceModules.map(x=>x.readPermission);
  const focused=renderWorkspaceFlowMap(authorized,"make");
  expect(focused).toContain('id="wf-make"');
  expect(focused).not.toContain('id="wf-sell"');
  expect(focused).not.toContain('id="wf-govern"');
  expect(focused).toContain('href="/production"');
  const unrecognized=renderWorkspaceFlowMap(authorized,'foo"><script>alert(1)</script>');
  expect(unrecognized).toContain('id="wf-sell"');
  expect(unrecognized).toContain('id="wf-make"');
  expect(unrecognized).not.toContain("<script>");
});

test("workspace route is behind existing StaffUser authentication and GET only",()=>{
  const authGuard=source.indexOf("const session=await readSession(req)");
  const route=source.indexOf('if(url.pathname==="/workspace"&&req.method==="GET")');
  expect(authGuard).toBeGreaterThan(0);
  expect(route).toBeGreaterThan(authGuard);
  expect(source).toContain("renderWorkspaceFlowMap(permissions,url.searchParams.get");
  expect(source).toContain('href="/workspace" class="ws-link"');
  expect(renderWorkspaceFlowMap(["catalog.read"])).toContain('aria-label="Filtrar flujos"');
});

test("workflow map uses semantic steps and visible keyboard focus",()=>{
  const html=renderWorkspaceFlowMap(["catalog.read","orders.read"],"sell");
  expect(html).toContain('<ol class="wf-steps">');
  expect(html).toContain('aria-labelledby="wf-sell"');
  expect(html).toContain('aria-current="page" href="/workspace?flow=sell"');
  expect(source).toContain(".wf-action:focus-visible");
  expect(source).toContain("@media(max-width:480px)");
});
