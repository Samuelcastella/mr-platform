#!/usr/bin/env bun
/** Static workspace contract checks. Run: bun test services/control-center/workspace.test.ts */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("./workspace-ui-script.ts", import.meta.url), "utf8");
const expected: Record<string,string[]> = {
  General:["/","/workspace","/work-queue","/health-desk","/integration-matrix"],
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
  expect(clientSource).toContain('event.key === "Escape"');
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
  expect(clientSource).toContain("No se encontraron módulos");
  expect(clientSource).toContain('visibleCount + " módulos encontrados"');
  expect(clientSource).toContain("if (query && isMobile())");
});
test("logout remains a CSRF-protected POST",()=>{
  expect(source).toContain('method="post" action="/logout"');
  expect(source).toContain('name="csrf" value="${esc(session.csrf)}"');
});

test("workspace controls execute from a same-origin script without unsafe-inline CSP",()=>{
  expect(source).toContain("script-src 'self'");
  expect(source).toContain('<script src="/workspace-ui.js" defer></script>');
  expect(source).toContain('if(url.pathname==="/workspace-ui.js"&&req.method==="GET")');
  expect(source).toContain('"content-type":"application/javascript; charset=utf-8"');
  expect(source).not.toContain(" onclick=");
  expect(source).not.toContain(" oninput=");
  expect(source).not.toContain("<script>");
  expect(clientSource).toContain('menu.addEventListener("click"');
  expect(clientSource).toContain('search.addEventListener("input"');
  expect(clientSource).toContain('menu.setAttribute("aria-expanded", String(open))');
  expect(clientSource).toContain('link.setAttribute("aria-current", "page")');
  expect(clientSource).toContain("menu.focus()");
});
