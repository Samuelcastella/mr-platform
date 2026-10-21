# MR עדולם — Cruce de tienda interactiva con Commerce Core (v1)

**Fecha:** 2026-10-21  
**Estado:** PROPUESTA PARA REVISIÓN — diseño y contratos, no implementado por este documento  
**Método:** Spec-Driven Development (SDD)  
**Superficie objetivo:** `web/storefront/` (SPA/PWA) y posterior reutilización de contratos por `apps/mobile/`  
**Fuente de experiencia:** demostración interactiva en ChatGPT de catálogo, filtros, carrito y preparación de mensaje de WhatsApp, con productos/precios ilustrativos.

## 1. Decisión central

**No crear una segunda tienda ni sustituir el Storefront o el Commerce Core existente.** Incorporar el patrón visual/interactivo de la demostración sobre las rutas y dominios que ya existen. La demo de ChatGPT **no es** el catálogo de producción ni puede definir precios, inventario, impuestos, envíos, pagos o pedidos reales.

Preservar:
- marca exacta **MR עדולם** (עדולם exclusivamente en hebreo), corona 3D, monograma, paleta existente y fallback;
- URLs hash existentes (`#/catalog`, `#/product/:id`, `#/cart`, `#/checkout`, `#/orders`);
- `web/storefront/index.html`, `server.js` y sus rutas públicas `/api/v1/*`;
- `services/catalog-api` como autoridad del catálogo/órdenes/pagos/fulfillment en PostgreSQL;
- `apps/mobile` como cliente futuro del mismo Commerce Core;
- operación hondureña: HNL, retiro en tienda, efectivo, transferencia y COD según disponibilidad;
- modelo comercial híbrido MR + terceros, segunda mano y crecimiento multicategoría, sin activar prematuramente marketplace abierto.

## 2. Evidencia y límites de la inspección de código (2026-10-21)

| Elemento | Hallazgo en `main` | Interpretación |
| --- | --- | --- |
| Catálogo | `syncCatalog()` consulta `/api/v1/products?status=active`; muestra estado explícito vacío/error. | Código existente; no sustituir por tarjetas demo. |
| Búsqueda/categorías | `catalog()`, `filterProducts()`, `searchProducts()`. | Refinar interacción y presentación, no rehacer filtros. |
| Carrito | `cartView()`, estado local de UX. | Debe persistir la **variante exacta**, no solo el producto. |
| Ficha de producto | `productView()` lista variantes pero `addQty()` añade el ID de producto; `resolveVariantId()` selecciona automáticamente una variante en la creación de orden. | **Brecha crítica:** la talla/color elegidos no están vinculados inequívocamente a la línea del carrito. |
| Órdenes | `POST /v1/orders`; `orders.ts` valida variantes, genera reservas, estados e idempotencia. | Reutilizar; jamás confirmar disponibilidad únicamente en navegador. |
| Entrega | `GET /v1/fulfillment/options?department=...`, `POST /v1/fulfillments`, tracking público. | Reutilizar la tarifa/ETA del servidor; no inventar fletes. |
| Pagos offline | `POST /v1/checkouts`: CASH, BANK_TRANSFER, CASH_ON_DELIVERY; `Payment` independiente del `Fulfillment`. | No presentar pago de tarjeta ni conciliación instantánea como activos por defecto. |
| Checkout web | `confirmOrder()` registra Order → Fulfillment → Checkout con claves idempotentes y consulta posterior. | Mejorar microinteracciones, reintentos y comunicación de estados sin romper contratos. |
| WhatsApp | Demo de ChatGPT solo copia texto; `confirmOrder()` examinado no abre enlace WhatsApp. | Diseñar handoff **después** de registrar la orden server-side, nunca como sustituto de ella. |
| Producto visual | Archivo de diseño previo pide sustituir placeholders con fotografía real. | Usar medios autorizados del catálogo, alt, lazy loading y fallbacks. |

Los hallazgos son **inspección de código**, no afirmaciones de salud, conectividad comercial real o pruebas de producción del 2026-10-21.

## 3. Experiencia objetivo

### 3.1 Inicio y catálogo
- Portada `commerce-first`, CTA hacia catálogo; conservar `#/brand` para historia y ecosistema.
- Tarjetas con fotografía del catálogo real, nombre, precio HNL, variantes/condición y disponibilidad, sin datos de demostración.
- Búsqueda reactiva, categorías dinámicas desde catálogo y estados `loading`, `empty`, `error`; mantener navegación y accesibilidad móvil.
- Categorías previstas inicialmente según inventario real: ropa, accesorios personales, cosméticos, higiene, ropa interior; second-hand como atributo/segmento, no stock ficticio. Deportes/escolar/adultos/niños son expansión condicionada a catálogo real.

### 3.2 Ficha de producto y carrito exacto
- Selector explícito de `variantId` por talla/color, SKU, disponibilidad y precio si difiere.
- Cada línea de carrito: `{variantId, productId, quantity}`; dos variantes del mismo producto son dos líneas distintas.
- Cambiar cantidad respeta stock **de la variante**, revalidado por el servidor al crear orden.
- Migración segura de carritos antiguos `{id,q}`: pedir volver a seleccionar variante, **no** asignarla silenciosamente.
- Deshabilitar acciones para combinaciones agotadas; nunca permitir `stockData()` o almacenamiento local como autoridad transaccional.
- Compartir el patrón entre web y app a nivel de contrato/API, no mediante duplicación de datos.

### 3.3 Checkout real
1. Selección de variantes y cantidades.
2. Validación visual de carrito y datos mínimos de contacto (con aviso de privacidad).
3. Retiro o departamento/municipio/dirección; `GET /v1/fulfillment/options?department=...`.
4. Si `quoteRequired=true`, informar que falta cotización y no prometer/fijar envío.
5. Selección condicionada de `CASH`, `BANK_TRANSFER`, `CASH_ON_DELIVERY`; COD solo compatible con entrega.
6. Vista de revisión muestra subtotal **estimado**; precio, importe, flete y demás cantidades finales proceden del servidor.
7. `POST /v1/orders` con `variantId` explícito e `Idempotency-Key`.
8. `POST /v1/fulfillments`, servidor configura flete; luego `POST /v1/checkouts` con importe **no** suministrado por el cliente.
9. Confirmación con número `orderNumber` y estados separados de orden, pago y entrega; enlace de seguimiento por token público según controles vigentes.
10. Respetar conservación/reintento de claves idempotentes ante interrupción y no duplicar órdenes o reservas.

No afirmar pago recibido por una referencia de transferencia digitada por el cliente; solo conciliación/actor autorizado puede marcarlo `PAID`. Mantener COD separado de Payment hasta conciliación. Fiscalidad CAI/ISV depende de M05 y revisión regulatoria vigente; no codificar tasa universal en el frontend.

### 3.4 WhatsApp: cierre conversacional optativo
- Añadir en confirmación y detalle de orden un CTA **"Consultar este pedido por WhatsApp"** solo cuando se configure/valide número comercial oficial.
- Construir mensaje sobre **orden creada**: marca MR עדולם, `orderNumber`, motivo de consulta y opcional resumen no sensible. No generar pedidos exclusivamente a partir de texto copiado.
- No exponer tokens públicos de consulta, dirección completa, datos de pago, teléfono del cliente o secretos en un enlace de WhatsApp.
- Fallo de WhatsApp no revierte ni duplica Order/Checkout; alternativa: copiar número de pedido o pantalla de seguimiento.
- Origen comercial `WEB` se preserva en Order; registrar `whatsapp_handoff_click` como evento si el contrato de analítica se amplía, con consentimiento y minimización de datos.
- No suponer que la conversación de WhatsApp confirma automáticamente pago, reserva, despacho o entrega.

## 4. Cruce con el ecosistema ya diseñado

| Requisito | Dominio existente | Decisión |
| --- | --- | --- |
| Catálogo omnicanal y fotografía | M01, Storefront, Product Media | Reutilizar `/v1/products`; carga autorizada desde Control Center. |
| Reservas y anti-sobreventa | M02, `orders.ts` | Server-side y `variantId` exacto. |
| Efectivo, transferencia, COD, pagos externos futuros | M03, `checkout.ts` | Offline primero, providers autorizados mediante adaptador; no convertir MR en emisor/P2P. |
| Tarifas 18 departamentos y tracking | M04, `fulfillment.ts` | DeliveryZone y estados inmutables; sin cotizaciones ficticias. |
| Comprobante fiscal | M05 | Validar reglas SAR/CAI antes de activar facturación real. |
| Seguridad, consentimiento y acceso | M06, roles | Cliente no puede llamar rutas internas ni manipular precio/stock. |
| CRM / atención | M07 | Consultas y solicitudes con trazabilidad; WhatsApp es canal, no DB comercial. |
| Proveedores, fabricación y costo | M08, W8 | Atributos de producto e inventario sin contaminar experiencia del comprador. |
| Devoluciones | M09 | Flujo posventa; logística inversa no repone stock automáticamente. |
| App | M10 | Reutilizar API con vista de carrito exacto y mismas reglas. |
| Marketplace híbrido / liquidaciones | M11 | Distinguir vendedor y propiedad interna; no activar autoservicio abierto sin gates. |
| Inventario y anomalías | M12 / M14 | Ajustes protegidos, alertas operativas; no exposición al comprador. |
| Crédito / LIRA | M15 / LIRA independiente | Integración futura mediante proveedores autorizados y contratos separados. |
| Recomendaciones / cross-sell | Ideas previas de similarity/cross-sell | **No presumir implementadas**; evaluar como fase posterior condicionada a datos de catálogo fiables. |
| Diseño / corona 3D | `docs/design`, `crown3d.js`, `assets/storefront-design.css` | Mejoras incrementales, no rehacer ni romper navegación, accesibilidad o identidad. |

## 5. Priorización contra roadmap existente

Sin crear un roadmap paralelo: registrar avances en `docs/roadmap/WEB_ROADMAP.md` y specs actuales.

- **P0 — seguridad comercial:** exactitud `variantId` end-to-end, migración del carrito y estados/reintentos del checkout. Bloquea lanzamiento fiable.
- **P1 — confianza y conversión:** fotografía auténtica, tarjetas responsive, búsqueda/categorías rápidas, estados vacíos, información de entrega y precios visuales claramente estimados.
- **P1 — WhatsApp vinculado:** handoff posterior a `orderNumber` real y número empresarial configurado, sin información sensible en URL.
- **P2 — atención y crecimiento:** solicitudes, back-in-stock por variante, seguimiento legible, recomendaciones y venta cruzada verificadas.
- **P3 — marketplace y personalización inteligente:** productos de terceros, atribución de vendedor, motores de recomendación y asistencia conversacional respetando autorizaciones y sin delegar decisiones transaccionales al modelo.

## 6. Contratos a conservar / no introducir silenciosamente

- Entrada venta: `POST /api/v1/orders` `{channel:"WEB", items:[{variantId,quantity}], customer:{...}}` + `idempotency-key`.
- Fulfillment: `GET /api/v1/fulfillment/options?department=...` y `POST /api/v1/fulfillments` con `orderId/orderToken`, tipo y destino según modo.
- Checkout: `POST /api/v1/checkouts` con `orderId/orderToken/paymentMethod` + `idempotency-key`.
- Seguimiento público: endpoints ya existentes con tokens opacos, minimización de exposición.
- No añadir un nuevo endpoint `/whatsapp-checkout` antes de verificar si basta construir un handoff seguro del lado del navegador después de crear orden.
- No cambiar esquemas ni enums de Payment para atender únicamente un rediseño visual.

## 7. Plan de implementación en PRs pequeños

1. **PR A — variante exacta:** UI de selector por `variantId`; carrito/migración; cambios de cantidad y prueba de variantes del mismo producto. Afecta `web/storefront/index.html` y `web/storefront/test/`.
2. **PR B — merchandising:** foto real del catálogo como protagonista, categorías/búsqueda, fichas y tarjetas; no cambiar endpoints de producción. Reutilizar CSS y assets de marca.
3. **PR C — checkout claro + handoff:** revisión y estados, errores de stock/precio, tarifa pendiente, reintentos, WhatsApp enlazado tras número de pedido si existe número comercial validado.
4. **PR D — medición y QA:** pruebas end-to-end con API de prueba, capturas responsive, performance y accesibilidad; contrastar con W3–W6 y gates.

## 8. Criterios de aceptación

- [ ] La elección de talla/color llega sin alteración del catálogo al carrito y a `POST /v1/orders`.
- [ ] Dos variantes del mismo producto permanecen separadas; carrito antiguo no compra variante incorrecta.
- [ ] Ningún precio, disponibilidad o flete demo se usa como fuente autoritativa.
- [ ] Carrito/checkout soportan doble clic, recarga, timeout, reintentos y falta de stock sin duplicar órdenes.
- [ ] Métodos de pago conservan sus estados de verificación; transferencia y COD no se confunden con `PAID`.
- [ ] WhatsApp incluye número de pedido del servidor y no revela datos sensibles; funciona la ruta alternativa sin WhatsApp.
- [ ] Filtro, grid, selector, mensajes de error y botones funcionan con teclado, lector, 390/768/1440 px y `prefers-reduced-motion`.
- [ ] Corona 3D y fallback se mantienen; no se pierde marca hebrea.
- [ ] `cd web/storefront && npm test` y pruebas pertinentes backend pasan.
- [ ] PR revisado y fusionado; despliegue Railway `SUCCESS`, `/ready`, pruebas reales de extremo a extremo y catálogo genuino verificados antes de declarar producción lista.

## 9. Referencias existentes (fuentes de verdad)

- `docs/PROJECT_CONTEXT_MEMORY.md`
- `docs/roadmap/WEB_ROADMAP.md`
- `docs/design/STOREFRONT_COMMERCE_FIRST_V1.2.md`
- `docs/design/ai-design-skills-adoption.md`
- `docs/specs/M01_CATALOG_INVENTORY_V1.md`
- `docs/specs/M02_ORDERS_RESERVATIONS_V1.md`
- `docs/specs/M03_CHECKOUT_PAYMENTS_V1.md` y `M03_CHECKOUT_PAYMENTS_V2_AMENDMENT.md`
- `docs/specs/M04_FULFILLMENT_LOGISTICS_V1.md`
- `services/catalog-api/{index,orders,checkout,fulfillment}.ts`
- `web/storefront/{index.html,server.js,assets/storefront-design.css}`

**Gate de esta propuesta:** solo integrar al código tras revisión de alcance; este documento por sí mismo no implica despliegue, catálogo real publicado ni activación de pagos o couriers.
