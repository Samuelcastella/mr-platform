# MR עדולם — Fase 3: ficha móvil con persuasión ética

**Estado:** PROPUESTA EN RAMA — no publicado ni fusionado
**Fecha:** 2026-10-21
**Dependencias:** [SPEC-PD-ETH-001 web](https://github.com/Samuelcastella/mr-platform/blob/feat/product-detail-ethical-ux-20261021/docs/specs/PRODUCT_DETAIL_ETHICAL_UX_V1.md) (PR #143, pendiente de integración), [SKILL-PERSUASION-001](../../skills/skill-persuasion-001/SKILL.md) (PR #141), M10.1/M10.2
**Stack:** Expo SDK 57 + React Native, Commerce Core existente
**Prioridad solicitada:** tercera fase, después de la ficha web y su SDD.

## Meta

Alinear la ficha nativa con las decisiones de confianza de la web sin volver a implementar pedidos, pagos o inventario. El usuario podrá ver imágenes **publicadas** por el catálogo, elegir una variante exacta y entender qué información todavía no existe sin recibir mensajes engañosos.

## Línea de base validada en el repositorio

- `apps/mobile/App.tsx` **ya** selecciona `selectedVariantId`, limita cantidad, separa el carrito por `variantId`, crea Order APP idempotente, y consulta cumplimiento/checkout nativos. No duplicar esta funcionalidad.
- `apps/mobile/src/commerce.ts` contiene el cliente de la API `/v1/products?status=active`.
- La API actualmente devuelve `images[]` y `defaultCondition` además de `variants[]`, pero el tipo Product móvil no modelaba esos campos.
- La ficha original mostraba texto y variantes, sin galería de imágenes ni explicación de ausencia de reseñas verificadas.

## Requisitos funcionales

| ID | Requisito | Fuente de verdad |
|---|---|---|
| MOB-PD-01 | Galería de imágenes publicadas con selección táctil y etiquetas accesibles | `Product.images[]` de Catalog API |
| MOB-PD-02 | Si no hay imagen HTTPS válida, mostrar ícono oficial y explicar la ausencia de fotografía | Asset local de marca |
| MOB-PD-03 | Mostrar condición solamente cuando API indique `new`/equivalente o segunda mano reconocida | `defaultCondition` |
| MOB-PD-04 | Mantener selección exacta de variante, SKU, precio propio y disponibilidad | `selectedVariantId` y `variants[]` |
| MOB-PD-05 | Disponibilidad es informativa, no reserva, y se revalida al crear Order | Commerce Core |
| MOB-PD-06 | Guía general gratuita y aviso de que aún no hay medidas específicas publicadas | Sin registro y sin datos de talla inventados |
| MOB-PD-07 | Opiniones no implementadas se presentan con estado vacío honesto | Sin estrellas, recuentos ni testimonios artificiales |
| MOB-PD-08 | Entrega se calcula en flujo nativo M10.2 por departamento; la ficha no inventa ETA | `fetchDeliveryOptions` en checkout |
| MOB-PD-09 | Ofrecer enlace contextual a la ficha web para solicitar apoyo por los canales públicos disponibles | `EXPO_PUBLIC_STOREFRONT_URL` |
| MOB-PD-10 | Ningún archivo de la fase 3 toca backend financiero o aplica promociones ocultas | M03/M10 |

## Flujo
`Catálogo APP → ficha → foto publicada / respaldo → variante exacta → información de talla + revisión de stock → carrito en memoria → Order APP → Fulfillment → Checkout → estado de pago autoritativo`.

Al seleccionar otra foto no se alteran carrito, variante ni precio. Enlace a la web abre el producto público pero no transmite teléfono, token de orden ni otros datos personales. Si el enlace externo falla, el comprador puede seguir comprando desde la app.

## Estados y casos límite
- Foto ausente: asset oficial + mensaje de fotografía no publicada.
- Fotos incorrectas `javascript:`/data:/: bloquearlas; cargar únicamente imágenes HTTPS.
- Variante ausente: no se habilita agregar.
- Variante agotada: botón deshabilitado; no fingir escasez temporal.
- Condición no reconocida: no afirmar que es producto nuevo ni usado.
- Opiniones: no existe sistema de reseñas verificadas; indicar limitación.
- Medidas: no fabricar tabla específica por talla ni composición.
- Costo y tiempo de envío: remitir al flujo de entrega con opciones servidor.
- Error de red: mantener estados de recuperación actuales.
- Respetar temas claro/oscuro y accesibilidad de Pressables.

## Métricas y guardrails
La app no debe emitir métricas nuevas sin contrato de backend y consentimiento apropiado. KPI de ventas: Order confirmado/checkout autoritativo, nunca `addToCart`. Guardrails: errores de selección, pedidos erróneos, fallos de imagen/enlace, carga lenta, accesibilidad, devoluciones e insatisfacción.

## Aceptación y calidad
- [ ] El paquete TypeScript completa `npm run typecheck`.
- [ ] CI mobile de GitHub completa export Android con `npm run export:android`.
- [ ] Captura manual de detalle iOS/Android en tema claro y oscuro.
- [ ] Selección M/Negro del producto real mantiene `variantId` correcto hasta Order.
- [ ] Imagen no HTTPS no se renderiza.
- [ ] Fotografía ausente produce fallback de marca.
- [ ] Stock agotado no se agrega al carrito.
- [ ] Sin reseñas no aparecen estrellas ni opiniones ficticias.
- [ ] Ayuda no requiere consentimiento de marketing ni compra.
- [ ] Enlace web respeta el identificador público del producto.
- [ ] M10.1, M10.2 y estados de Pago PENDING conservan sus invariantes.

**Estado del check:** no marcar como aprobado sin pruebas realizadas. El CI de código fuente no sustituye QA en dispositivos físicos.

## Despliegue y reversión
Se entrega en **PR draft** distinto del web; no desplegar Expo ni modificar `main` sin revisión. Publicar app solo después de aceptar web+SDD, seguridad, pruebas en dispositivos y plan de reversión. Sin efectos sobre Railway por esta fase.

## Referencias
- `docs/specs/PRODUCT_DETAIL_ETHICAL_UX_V1.md` — PR #143
- `docs/specs/M10_1_MOBILE_CART_ORDER_RESERVATION_V1.md`
- `docs/specs/M10_2_MOBILE_FULFILLMENT_CHECKOUT_V1.md`
- `apps/mobile/App.tsx` y `apps/mobile/src/commerce.ts`
