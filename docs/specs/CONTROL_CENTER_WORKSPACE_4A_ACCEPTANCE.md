# Control Center — Workspace 4A: integración y aceptación

Estado: implementación parcial; no publicar hasta completar verificaciones.

## Mapa de navegación
- General: Inicio, Health Desk, Integraciones.
- Comercio: Pedidos, Clientes, Catálogo, Crédito, Devoluciones.
- Operaciones: Inventario (ajustes), Compras, Entregas, Trazabilidad, Calidad.
- Proveedores y producción: Proveedores, Fabricantes, Especificaciones, Producción, Costeo, Revisión, Sourcing, Evaluaciones.
- Inteligencia: Inteligencia de productos, Decisiones de surtido, Políticas económicas.

## Flujo transversal de operación
1. Catálogo y compras reciben productos y variantes; inventario conserva la fuente de verdad.
2. Checkout solicita reserva atómica; el sistema rechaza la última unidad ya reservada.
3. La confirmación de pago verificable activa pedido y movimiento Kardex dentro de una transacción.
4. Pago tardío tras reserva vencida abre excepción y nunca fuerza venta automática.
5. Fulfillment entrega; devoluciones y reembolsos mantienen autorización y ejecución financiera separadas.
6. Crédito, integraciones y auditoría se consultan según permisos del actor.

## Botones y contratos
- Menú: abre/cierra navegación móvil; debe exponer aria-expanded.
- Buscar módulo: filtra enlaces; sin mutaciones en servidor.
- Enlaces de sección: navegación GET; no deben alterar estado.
- Salir: POST /logout con token CSRF.
- Acciones de negocio: conservar endpoints y autorización RBAC existentes; no inventar rutas de mutación.

## Pruebas obligatorias antes de fusionar
- Bun: parseo/arranque de control-center y suite del monorepo.
- Navegación: todas las rutas devuelven pantalla autorizada o 403/estado vacío coherente.
- Responsive: 375, 768, 1280 píxeles; teclado, foco y menú.
- Seguridad: CSRF, cookie de sesión, permisos, XSS y no exposición de secretos.
- Operación: reserva simultánea, webhook duplicado, pago tardío, Kardex, reembolso.
- Railway: deploy de staging, smoke tests y health verde antes de cualquier producción.

## Definición de terminado
No declarar el producto 4A terminado sin CI verde, validación visual, integración comprobada y aprobación explícita del despliegue.
