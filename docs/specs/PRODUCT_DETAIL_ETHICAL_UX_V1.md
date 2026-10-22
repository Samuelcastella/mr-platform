# MR עדולם — Product Detail Ethical UX (ficha de producto)

**Código de especificación:** SPEC-PD-ETH-001
**Versión:** 1.0.0 (propuesta)
**Fecha:** 2026-10-21
**Método:** Spec-Driven Development (SDD)
**Estado:** IMPLEMENTACIÓN EN PR, no fusionado / no desplegado
**Principio rector:** información comprobable y decisiones voluntarias
**Dependencia conceptual:** [SKILL-PERSUASION-001](../../skills/skill-persuasion-001/SKILL.md) (PR #141, aún no fusionado)
**Issue:** [#142](https://github.com/Samuelcastella/mr-platform/issues/142)

## 1. Contexto, usuario y problema
MR עדולם opera inicialmente en Honduras y diseña un comercio móvil, web y físico con catálogo y checkout autoritativo en servidor. La ficha histórica ofrecía lista de variantes pero agregaba carrito por **producto** y el backend elegía una variante disponible en `resolveVariantId`; esta discrepancia podía registrar una talla o color distinta a lo esperado. Faltaban galería navegable, información honesta de reseñas, consulta opcional de cobertura en la ficha y educación libre para elección de talla.

**Usuario:** comprador/a desde navegador móvil o desktop en Honduras, incluyendo compra como invitado. **Necesidad:** reconocer la opción que se llevará, conocer el precio correspondiente, verificar su disponibilidad y explorar entrega/soporte sin presión comercial.

## 2. Objetivos
1. Mostrar imagen y campos **reales** del catálogo, sin inventar materiales, testimonios o certificados.
2. Seleccionar talla/color de forma accesible y mantener el **variantId** elegido desde ficha hasta Order.
3. Distinguir stock publicado de reserva efectiva; no mostrar falsa urgencia o plazo ficticio.
4. Consultar tiempos y tarifa estimados por departamento reutilizando `/api/v1/fulfillment/options`; no confundir con checkout.
5. Ofrecer guía libre y camino de solicitud/soporte mediante `#/connect`.
6. Mantener cumplimiento de decisiones M01, M02, M03 y M07, marca MR עדולם, interfaz responsive, y métricas confiables.

## 3. Alcance por iteración
### Fase 1 — web (este PR)
- Refactor localizado de `productView()` en `web/storefront/index.html` y `assets/product-detail.css`.
- Galería con imágenes existentes, miniaturas accesibles, fallback gráfico local si el catálogo no contiene fotos.
- Selector de color y talla por `variants[]` sin coerción; mostrar agotamiento sin crear escasez artificial.
- Guardar `{id,variantId,q}` en carrito; agrupar por producto+variante; actualizar cantidad y retiro por línea.
- Compatibilidad con carrito histórico: para una sola variante validada, usarla; si existen varias y falta selección, obligar a revisarla antes de checkout.
- Emplear precio de variante para estimaciones visuales; servidor siempre determina Order/Checkout.
- Mostrar guía general gratuita; no fingir tabla de medidas de un SKU.
- Estimación de envío por departamento con estados loading/confirmed-quote-needed/error; ninguna llamada desde ficha confirma orden ni modifica `mrDeliveryQuote` de checkout.
- «Opiniones verificadas no habilitadas» sin reseñas sintéticas.
- `checkout_start` emitido solo al entrar en la ruta con carrito válido; no disparado por cada render.

### Fase 2 — refinamiento SDD
- Instrumentar `product_view` y exposición de experimentos solo si el contrato de `public_events` es migrado y auditado; no agregar nombres de evento fuera de allowlist actual.
- Obtener e integrar `observedAt`/TTL/frescura de disponibilidad mediante cambio compatible de API; contemplar omnicanal y reservas concurrentes.
- Auditar política fiscal ISV, alcance regional, WCAG completo, carga de imágenes y preferencias de comunicación.
- Implementar fotos y medidas de artículos reales bajo procesos de contenido; incorporar reseñas verificadas solo con infraestructura y gobernanza específicas.

### Fase 3 — mobile (explícitamente al final)
- Reutilizar decisiones y contratos en `apps/mobile/` tras estabilizar web/SDD. No se modifica la app en este PR.

## 4. Fuera de alcance
- Datos de demostración en producción (no incluir precios o inventario inventados).
- Reseñas, estrellas, social proof, premios, certificados, temporizadores o frases «última oportunidad» sin datos reales.
- Pagos nuevos, modificación de Order/Payment, webhooks, facturación fiscal, CRM marketing, app móvil.
- Salto directo a `main` o Railway sin PR y comprobaciones de aceptación.

## 5. Principios de Cialdini y guardrails
- **Autoridad:** solo atributos constatados en API, condición si está publicada y transparencia de precio.
- **Reciprocidad:** consejos para elegir talla accesibles sin registro ni obligación.
- **Simpatía:** CTA de solicitud/soporte voluntario, sin fingir atención humana inmediata.
- **Escasez:** el catálogo expone `variants[].available`, calculado de inventario menos reservado; mostrar como cantidad informativa con advertencia de confirmación. No insinuar fecha de actualización específica que la API no entrega.
- **Prueba social:** estado «opiniones verificadas no habilitadas» en vez de estrellas ficticias.
- **Compromiso/unidad:** no usar compromiso forzado ni presión identitaria.

## 6. Contratos existentes y cambios web
| Campo / endpoint | Fuente | Uso/limitación |
|---|---|---|
| `GET /api/v1/products?status=active` | `services/catalog-api/index.ts` | `id,name,category,images,price,currency,defaultCondition,variants` |
| `variants[].id,size,color,price,currency,available` | API catalog | disponibilidad publicada por variante, no reserva ni garantía de frescura |
| `/api/v1/fulfillment/options?department=…` | fulfillment | `options[].etaMinDays,etaMaxDays,shippingMinor,currency,quoteRequired` |
| `POST /api/v1/orders` | Order / server | enviar `items:[{variantId,quantity}]`; mantener idempotencia |
| `POST /api/v1/checkouts` | Checkout / server | ningún monto de cliente; confirmar precio/moneda/estado servidor |
| `POST /api/v1/events` | public events | no nuevos nombres sin migración; no PII, tokens ni contactos |

Estado de carrito local: `{id: productLocalId, variantId: integer, q: integer}`.
Invariante: `validCartItem()` debe comprobar que variante existe en producto actual y `q <= available`, aunque Order vuelve a validar en backend.

## 7. Flujo principal
`catálogo → ficha → elegir color → elegir talla → consultar entrega opcional → agregar variante → carrito por variante → checkout → revisión → POST Order variantId → fulfillment → checkout autoritativo`.

- El botón de producto en tarjeta abre la ficha cuando hay varias variantes; no selecciona una talla a escondidas.
- Si existe una única variante inequívoca, el acceso rápido puede agregarla con stock suficiente.
- Un carrito antiguo con múltiples variantes y ninguna elegida se presenta como «Variante sin confirmar» y bloquea avanzar hasta selección válida.
- Una variante agotada puede explorarse para solicitar aviso, pero no añadirse al carrito.
- Consulta de entrega no condiciona al registro ni confirma disponibilidad.

## 8. Estados UX
- **Catálogo cargando:** esqueleto/estado de carga ya existente; no simular producto.
- **Sin producto:** no encontrado y CTA de catálogo.
- **Sin fotos:** monograma local y aviso «fotografía no publicada», sin fotos de terceros.
- **Sin variantes:** informar «consulta disponibilidad» y deshabilitar agregar.
- **Agotada:** opción visible y etiquetada, botón de agregar deshabilitado.
- **Cantidad mayor que stock:** bloquear y pedir actualizar.
- **Sin política/medidas:** no afirmar condiciones ni tallas inventadas.
- **Envío sin cobertura/quoteRequired:** cotización por confirmar; no inventar tarifa.
- **Envío error API:** mensaje recuperable sin alterar carrito.
- **Sin reseñas:** indicar servicio todavía no habilitado.
- **Checkout inválido:** bloquear con explicación y enlace al carrito.

## 9. Accesibilidad, rendimiento, privacidad y seguridad
- Labels asociados a selects; fieldsets/legends por talla y color; aria-pressed indica selección.
- Imágenes con alt desde catálogo; miniaturas con aria-label, teclado y foco nativo.
- Estados críticos mediante role=status/alert y live region sin timers manipulativos.
- CSS responsive 2 columnas desktop, 1 columna móvil; targets >=44px y focus styles globales.
- Respetar `prefers-reduced-motion`; no cambios al módulo 3D de corona.
- Escapar campos de API antes de interpolarlos en HTML; `productImageURL()` permite solo http/https.
- No agregar PII a analytics; requests en `#/connect` mantienen su consentimiento actual, separado de marketing.
- La ficha no persiste cotizaciones de entrega en el estado transaccional; estados intermedios no exponen secretos.
- Confirmar stock/importe en servidor; impedir pago por total editado en cliente.

## 10. QA y criterios de aceptación
- [ ] QA-PD-01: seleccionar talla M / negro y agregar → carrito y `resolveVariantId` conservan exactamente M/negro.
- [ ] QA-PD-02: talla agotada visible pero no agregable.
- [ ] QA-PD-03: selección múltiple de variantes del mismo producto produce líneas distintas.
- [ ] QA-PD-04: carrito antiguo sin variante y producto con varias variantes no avanza a pago.
- [ ] QA-PD-05: subtotal usa precio de variante, no precio mínimo del producto.
- [ ] QA-PD-06: ficha sin imágenes usa monograma; textos de API se escapan.
- [ ] QA-PD-07: `quoteRequired` muestra cotización pendiente, no promesa de entrega.
- [ ] QA-PD-08: guía accesible sin registro y ayuda conectada a solicitudes existentes.
- [ ] QA-PD-09: no aparecen reseñas, estrellas, certificaciones ni inventario ficticios.
- [ ] QA-PD-10: `checkout_start` se emite en entrada válida, no re-render.
- [ ] QA-PD-11: `npm test` storefront en CI y análisis de cambios sin regresiones.
- [ ] QA-PD-12: verificar tamaños 390,768,1440 px, teclado, contraste, network error y imágenes reales; screenshots de aceptación.

Esta tabla es la **meta de aceptación**: completar checkboxes solo con pruebas ejecutadas. Un PR abierto no demuestra que la tienda esté desplegada.

## 11. Métricas y evaluación
**KPI futuro:** pedidos confirmados / sesiones comerciales elegibles, únicamente si la atribución sesión→pedido es validada y privada.

Diagnósticos: clicks de «consultar» y carritos con `variantId` válido; no equivalen a ventas. Guardrails: errores de selección, stock conflict al crear Order, llamadas de soporte por talla errónea, cancelaciones/devoluciones, tiempo de respuesta móvil y accesibilidad. Sin baseline/experimento controlado, no reclamar uplift ni fijar mejora porcentual.

## 12. Implementación, validación y rollback
1. Implementar ficha/cart en rama desde `main`, sin desplegar.
2. Adjuntar pruebas automáticas y ejecutar smoke + design.
3. Probar variantes y checkout con catálogo real o fake API en CI.
4. Revisar PR: datos, lenguaje comercial, seguridad de HTML, UX y políticas de Honduras.
5. Tras aprobación, fusionar y supervisar despliegue; rollback vía revert si falla stock/cotización/cálculo visual.
6. Solo después planificar Fase 3 mobile.

## 13. Trazabilidad
- Fuente: `services/catalog-api/index.ts` y `web/storefront/index.html` en `main` al 2026-10-21.
- Políticas: `docs/specs/M01_CATALOG_INVENTORY_V2_AMENDMENT.md`, `M03_CHECKOUT_PAYMENTS_V1.md`, `M07_CUSTOMER_CRM_CORE_V1.md`, `INTENT_CTA_SYSTEM_V1.md`.
- Skill conceptual: PR #141; sin copiar texto extenso del libro original.
- Tracking de implementación: issue #142 y PR de ficha.
