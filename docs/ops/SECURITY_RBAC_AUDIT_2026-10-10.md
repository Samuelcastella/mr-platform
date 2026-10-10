# Auditoría preliminar de RBAC y pruebas negativas — 2026-10-10

Estado: **observaciones abiertas; no certificado**. Revisión estática de `services/catalog-api/auth.ts` y `inventory-adjustments.ts`. Sin cambios a roles ni producción.

## Hallazgos

**SEC-01 — Alto — MANAGER con privilegios excesivos.** `ROLE_BUNDLES.MANAGER` concede todas las capacidades excepto cuatro, incluyendo `inventory_adjustments.approve`, `inventory_adjustments.post`, `payments.confirm_manual`, `payments.refund` y `settings.manage`. Requiere matriz de mínimo privilegio aprobada por operaciones. Evitar cambios directos a permisos existentes sin evaluar usuarios afectados.

**SEC-02 — Alto — INVENTORY_OPERATOR conserva `inventory.adjust`.** Aunque el flujo de solicitudes de ajuste separa crear/presentar/aprobar/contabilizar, debe auditarse cada ruta que acepte `inventory.adjust` y su capacidad de mutar existencias sin aprobación. Quitar o acotar ese permiso después de identificar consumidores y cobertura de pruebas.

**SEC-03 — Alto — Identidad de servicio transversal.** `authorizeInternal` devuelve acceso si `machineAuthorized` valida el token, antes de evaluar permisos o sucursal. La autenticación de servicio requiere inventario de consumidores, rotación de secreto, segregación por servicio/alcance y pruebas negativas. No revocar el token sin plan de migración.

**SEC-04 — Medio/alto — Listado de ajustes sin locationId.** `inventory-adjustments.ts` permite `GET /v1/internal/inventory-adjustments` sin `locationId` y pasa `null` a `authorizeInternal`. Un usuario con concesión solo LOCATION será rechazado; uno GLOBAL puede listar todas las sucursales. Verificar que la UI siempre solicite el alcance previsto y que otros listados apliquen filtros obligatorios por sucursal.

**SEC-05 — Pendiente — Separación de funciones.** La aprobación usa permiso `inventory_adjustments.approve`, pero hay que verificar si un solicitante con permiso de aprobación puede aprobar su propia solicitud. Añadir regla de cuatro ojos si la política lo exige.

## Pruebas negativas propuestas (CI PostgreSQL aislado)

1. CASHIER sin `inventory_adjustments.approve` intenta aprobar: HTTP 403, sin cambio de estado.
2. INVENTORY_OPERATOR intenta aprobar y contabilizar ajuste: HTTP 403.
3. Usuario con rol LOCATION(A) intenta leer/modificar ajuste de LOCATION(B): HTTP 403, sin filtración de datos.
4. Usuario LOCATION(A) intenta listar sin filtro de sucursal: respuesta controlada, sin datos de B.
5. Solicitud POST autenticada por cookie sin CSRF: HTTP 403.
6. Sesión revocada o expirada: HTTP 401.
7. Usuario sin permiso `roles.manage` intenta asignar roles: HTTP 403.
8. Token de servicio inválido: HTTP 401 o 403; verificar que no opere como usuario.
9. Verificar que la aprobación y contabilización de ajustes generan eventos de auditoría con actor y ubicación.
10. Si se adopta separación de funciones, el creador no puede aprobar su propio ajuste.

## Plan de corrección

1. Inventariar todas las rutas `authorizeInternal`, permisos de inventario y llamadas internas entre servicios.
2. Proponer roles explícitos: ADMIN, MANAGER restringido, INVENTORY_OPERATOR, SUPERVISOR de ajustes (nuevo o asignación explícita), CASHIER, FULFILLMENT_OPERATOR, CUSTOMER_SUPPORT, ANALYST.
3. Incorporar tests negativos antes de modificar la matriz de permisos; comprobar impacto en Control Center.
4. Aplicar cambios a la rama y ejecutar CI. Revisar cambios con responsable operativo antes de fusionar/desplegar.
5. Certificar únicamente con evidencia de pruebas, revisión de rutas y despliegue verificado.

Fiscal y crédito quedan fuera del alcance.
