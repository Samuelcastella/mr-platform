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
