# Auditoría LOM inicial — 2026-10-11

**Alcance:** lectura de README.md y services/catalog-api/package.json de la rama main de Samuelcastella/mr-platform. No se examinó código fuente completo, historial de despliegues, base de datos ni logs de producción.

## Fuentes
- SRC-001: README.md (main), documentación de arquitectura y operación.
- SRC-002: services/catalog-api/package.json (main), metadatos y scripts del servicio.

## Nodos y relaciones
- REPO-001: mr-platform.
- SVC-001: web/storefront, documentado en SRC-001.
- SVC-002: services/catalog-api, documentado en SRC-001 y SRC-002.
- INF-001: Railway production, descrito en SRC-001, **sin comprobación independiente**.
- APP-001: apps/mobile, descrita en SRC-001.
- SVC-002 DEPENDS_ON PostgreSQL: **declaración documental**.
- SVC-001 DEPLOYED_TO Railway: **declaración documental**.

## Observaciones preliminares
- OBS-001: README declara que catalog-api todavía se despliega pegando index.ts manualmente en Railway Function. Esto implica posible riesgo de divergencia entre commit y despliegue. **Estado: pendiente de verificar**. Próxima prueba: comparar SHA, método de despliegue y artefacto en Railway.
- OBS-002: package.json expone solo script start; no declara test ni lint para catalog-api. **Hecho limitado al manifiesto consultado**; no demuestra ausencia de pruebas en otros lugares. Próxima prueba: revisar workflows, archivos de tests y ejecuciones CI.
- OBS-003: README describe controles de seguridad y CI de storefront. **Afirmaciones documentales, no verificadas en ejecución**. Próxima prueba: inspeccionar workflows y ejecutar pruebas autorizadas.

## Conclusión
Auditoría exploratoria incompleta. No se certifica producción, seguridad, cumplimiento legal ni inventario. Requiere inventario de fuentes, pruebas y comprobación de infraestructura antes de elevar observaciones a hallazgos confirmados.


## Segunda pasada documental — 2026-10-11

**Fuentes adicionales consultadas en main:**
- SRC-003: `.github/workflows/ci.yml`.
- SRC-004: `web/storefront/package.json`.
- SRC-005: `services/catalog-api/index.ts` (inspección parcial de su contenido).
- SRC-006: `docs/ops/RAILWAY.md`.
- SRC-007: `docs/specs/M01_CATALOG_INVENTORY_V1.md`.

### Hallazgos documentales y rectificaciones

- **FND-001 / Diferencia documental de despliegue (CONFIRMADO EN ARCHIVOS, NO EN RAILWAY):** README declara que `catalog-api` se despliega manualmente pegando `index.ts` en Railway Function; `docs/ops/RAILWAY.md` declara que el mismo servicio está conectado a GitHub `main` con raíz `services/catalog-api`. Ambas descripciones no pueden tomarse simultáneamente como descripción actual del mismo despliegue sin una explicación temporal. **Acción:** comprobar configuración y último deployment de Railway; actualizar documento obsoleto mediante PR.
- **OBS-002 RECTIFICADA / Pruebas del backend (CONFIRMADO EN ARCHIVOS):** aunque `services/catalog-api/package.json` solo declara `start`, `.github/workflows/ci.yml` sí incluye prueba unitaria cross-sell, compilaciones Bun e integraciones de órdenes, checkout, fulfillment, autenticación, catálogo, proveedores, compras y otros módulos. Por tanto, sería incorrecto afirmar que el backend carece de pruebas o CI. **Pendiente:** comprobar resultados de ejecuciones, cobertura y correspondencia con producción.
- **OBS-003 AMPLIADA / Storefront (CONFIRMADO EN ARCHIVOS):** `web/storefront/package.json` declara `npm test` como `node test/smoke.js`, y el workflow CI ejecuta ese comando. **Pendiente:** validar resultados reales y cobertura.
- **OBS-004 / Riesgo de esquema (REQUIERE CONTRASTE):** `docs/specs/M01_CATALOG_INVENTORY_V1.md` exige aprovisionamiento multiproveedor, movimientos inmutables, costos históricos y dinero en unidades menores; la sección inicial de `services/catalog-api/index.ts` crea `product_variants.supplier_id` y columnas monetarias `NUMERIC(12,2)`. La diferencia no prueba incumplimiento final: otras migraciones/módulos pueden ampliar el esquema. **Acción:** revisar migraciones y consultas efectivas, ejecutar pruebas de invariantes en entorno aislado.
- **OBS-005 / Inicialización del esquema (CONFIRMADO EN CÓDIGO INSPECCIONADO):** `index.ts` contiene `CREATE TABLE IF NOT EXISTS` y `ALTER TABLE` en inicialización. **Acción:** revisar política de migraciones, concurrencia y rollback antes de proponer cambios.

### Próximas verificaciones prioritarias
1. Comparar README, docs/ops/RAILWAY.md y configuración/deployments reales de Railway.
2. Consultar estado de checks del PR y CI de main; no inferir éxito de la presencia del workflow.
3. Revisar módulo de proveedores, inventario y migraciones frente a invariantes de M01.
4. Verificar permisos y protección de rutas internas, sin exponer secretos.

**Límite:** esta segunda pasada es inspección documental y lectura parcial de código, sin ejecución local de pruebas ni acceso a producción.
