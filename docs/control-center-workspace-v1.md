# MR עדולם — Control Center Workspace V1

## Objetivo
Convertir la navegación administrativa actual en un workspace operativo con jerarquía clara, sin alterar los endpoints, autorizaciones, CSRF, sesiones ni transacciones.

## Navegación propuesta
- **Inicio:** Operación (`/`), Health Desk (`/health-desk`), Integraciones (`/integration-matrix`)
- **Comercio:** Catálogo (`/catalog`), Pedidos (`/orders`), Clientes (`/customers`), Crédito (`/credit`)
- **Inventario y logística:** Compras (`/purchases`), Entregas (`/fulfillment`), Devoluciones (`/returns`), Ajustes (`/inventory-adjustments`)
- **Abastecimiento y fabricación:** Proveedores (`/suppliers`), Fabricantes (`/manufacturers`), Especificaciones (`/product-specifications`), Producción (`/production`), Costeo (`/landed-cost`), Trazabilidad (`/traceability`), Calidad (`/quality-control`), Revisión (`/vendor-review`)
- **Inteligencia y estrategia:** Inteligencia (`/product-intelligence`), Decisiones (`/assortment-decisions`), Sourcing (`/sourcing`), Evaluaciones (`/supplier-evaluations`), Políticas (`/economic-readiness`)

## UX y accesibilidad
1. Sidebar de escritorio, menú móvil desplegable, encabezado con contexto y sesión.
2. Estado activo derivado de la ruta; accesos rápidos y filtro de navegación.
3. Componentes compartidos: tarjetas KPI, tablas con scroll horizontal controlado, estados vacío/error/carga, formularios y alertas.
4. Responsive a 390, 768 y 1440 px; teclado, foco visible y contraste.
5. La identidad MR עדולם conserva la paleta tinta, crema y dorado.

## Criterios de aceptación
- Cada ruta y formulario actual permanece funcional.
- No se exponen módulos ni acciones a usuarios sin autorización del backend.
- No hay scroll horizontal global a 390 px.
- Login, logout y sesiones siguen funcionando.
- Pruebas existentes y capturas Playwright en tres tamaños.
- PR separado y despliegue únicamente después de CI y revisión visual.

## Fases
- **Fase 1:** estructura workspace, navegación y responsive.
- **Fase 2:** panel de inicio y componentes UI reutilizables.
- **Fase 3:** mejora de pantallas por dominio y pruebas de flujos críticos.
- **Fase 4:** inspección visual, revisión de permisos y despliegue gradual.
