#!/usr/bin/env bun
/** Static workspace contract checks. Run: bun test services/control-center/workspace.test.ts */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const expected: Record<string,string[]> = {
  General:["/","/health-desk","/integration-matrix"],
  Comercio:["/orders","/customers","/catalog","/credit","/returns"],
  Operaciones:["/inventory-adjustments","/purchases","/fulfillment","/traceability","/quality-control"],
  Proveedores:["/suppliers","/manufacturers","/product-specifications","/production","/landed-cost","/vendor-review","/sourcing","/supplier-evaluations"],
  Inteligencia:["/product-intelligence","/assortment-decisions","/economic-readiness"],
};
test("workspace exposes every documented module as a navigation link",()=>{
  const nav=source.split('<nav id="ws-nav">')[1]?.split("</nav>")[0];
  expect(nav).toBeDefined();
  for (const [group,paths] of Object.entries(expected)) {
    for (const path of paths) expect(nav).toContain('href="'+path+'"');
  }
  expect((nav?.match(/class="ws-link"/g)||[]).length).toBe(Object.values(expected).flat().length);
});
test("workspace has responsive navigation and accessible controls",()=>{
  expect(source).toContain('@media(max-width:850px)');
  expect(source).toContain('aria-controls="ws-side"');
  expect(source).toContain('aria-expanded="false"');
  expect(source).toContain('aria-label="Buscar módulo"');
  expect(source).toContain("e.key==='Escape'");
  expect(source).toContain(".ws-link[hidden],.ws-group[hidden]{display:none!important}");
  expect(source).toContain(".ws-link:focus-visible");
});
test("keyboard users can skip navigation",()=>{
  expect(source).toContain('<a class="ws-skip" href="#main-content">Saltar al contenido</a>');
  expect(source).toContain('<main class="wrap" id="main-content">');
  expect(source).toContain(".ws-skip:focus{top:8px}");
});
test("module search announces results and opens navigation on mobile",()=>{
  expect(source).toContain('id="ws-search-status" role="status" aria-live="polite"');
  expect(source).toContain('aria-controls="ws-nav"');
  expect(source).toContain("No se encontraron módulos");
  expect(source).toContain("count+' módulos encontrados'");
  expect(source).toContain("if(q&&innerWidth<=850)");
});
test("logout remains a CSRF-protected POST",()=>{
  expect(source).toContain('method="post" action="/logout"');
  expect(source).toContain('name="csrf" value="${esc(session.csrf)}"');
});
