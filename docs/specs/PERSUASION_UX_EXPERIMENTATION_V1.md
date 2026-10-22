# MR עדולם — Persuasión ética, confianza y experimentación comercial v1

**Estado:** PROPOSED / SPEC ONLY — NO LIVE FEATURES SHIPPED
**Fecha:** 2026-10-21
**Método:** Spec-Driven Development
**Habilidad relacionada:** [SKILL-PERSUASION-001](../../skills/skill-persuasion-001/SKILL.md)
**Operación inicial:** Honduras, HNL, móvil, web + tienda física + WhatsApp

## 1. Objetivo y decisión
Diseñar una capa de decisión de compra que reduzca dudas, comunique evidencia real y permita medir si mejora los **pedidos confirmados**, no únicamente el clic. Usar los siete principios de Robert B. Cialdini como heurísticas, no como promesas de incremento de ventas. Preservar autonomía, accesibilidad, privacidad y precios completos.

**No se autoriza con esta especificación:** creación de reseñas simuladas, mensajería automatizada no consentida, modificaciones de precio de checkout, cambios de pago ni despliegue a producción.

## 2. Evidencia verificada en `main` al redactar

| Superficie / archivo | Evidencia revisada | Límite |
|---|---|---|
| `web/storefront/index.html` | Catálogo, favoritos locales, carrito, checkout, CTAs de solicitud y avisos | Algunos flujos contienen estados de demostración/prototipo; no asumir funnel enteramente instrumentado |
| `services/catalog-api/index.ts` | `GET /v1/products`, `POST /v1/events`, allowlist de cinco eventos | Ya devuelve `stock` por producto **y** `variants[]` con talla, color, `available` (inventario menos reservas); faltan timestamp/TTL explícitos y compra por variante en UI |
| `docs/specs/INTENT_CTA_SYSTEM_V1.md` | Intenciones `buy`, `notify`, `product_request`, `support`; tracking de consultas | Intención y evento NO equivalen a conversión/venta |
| `services/catalog-api/ai/salesAlgorithm.ts` | Puntuación candidata según similitud, coocurrencia y rango de precios | No se verificó integración en la experiencia de compra; no anunciarla como funcionalidad activa |
| `docs/specs/M07_CUSTOMER_CRM_CORE_V1.md` | Invitados, preferencias de marketing separadas | No enlazar identidades por contacto unilateralmente |
| `docs/specs/M03_CHECKOUT_PAYMENTS_V1.md` | Checkout authoritative en servidor, pagos offline pendientes | `checkout_start` no es venta pagada |
| `docs/design/STOREFRONT_COMMERCE_FIRST_V1.2.md` | Prioridad comercial y navegación móvil | Fotografías reales identificadas como trabajo pendiente |

Si un archivo, despliegue o API ha cambiado, revalidar antes de implementar. Esto es auditoría de código y documentos, **no** auditoría operacional en producción.

## 3. Matriz de oportunidades

| Principio | Propuesta | Dependencia de verdad | Fase |
|---|---|---|---|
| Reciprocidad | Asistente de tallas/uso y guía de compra sin obligación | Información real del catálogo y políticas | P0 |
| Compromiso/coherencia | Favoritos persistidos en dispositivo y continuidad de carrito | No crear Order hasta acción explícita | P1 |
| Prueba social | Opiniones verificadas + recuentos y filtros equilibrados | Pedido entregado o evidencia de compra, moderación neutral, consentimiento | P2 |
| Autoridad | Ficha técnica, materiales, procedencia y políticas visibles | Ficha de producto/proveedor y documentación validada | P0 |
| Simpatía | «Consultar por WhatsApp» con texto útil y consentimiento | Canal oficial vigente y traspaso humano claro | P0 |
| Escasez | «Quedan N en esta talla» solo con snapshot servidor por variante | Inventario actualizado, reservas y ventana de vigencia; si falta, omitir | P1 |
| Unidad | Historias de comunidad y contenido de clientes | Permisos de uso y afirmaciones comprobables | P2 |

## 4. Alcance y exclusiones por fase

### P0 — confianza y decisiones informadas (sin nueva tabla de reviews)
- Ficha de producto: precio final mostrado claramente en HNL, imágenes reales o fallback marcado, categoría, condición (nuevo/segunda mano), talla/color disponibles, cuidados y estado de entrega si se conoce.
- Mensaje de envío: distinguir **estimado** de compromiso de entrega, departamento seleccionado y eventual coste antes de confirmar.
- Asesoría gratuita: dudas sobre tallas y productos, no ligada a compra.
- WhatsApp: CTA manual y contextual; no mensajes publicitarios sin consentimiento.
- Módulo de «Por qué elegir este producto»: atributos demostrables, sin apelaciones a una «autoridad» ficticia.
- La página debe funcionar sin recomendaciones/experimentos cuando API o datos estén ausentes.

### P1 — inventario exacto, continuidad y medición
- **Extender, no duplicar, el contrato existente por variante:** `GET /v1/products` ya incluye `variants[].id`, `size`, `color`, `available` calculado desde inventario menos reservas. Añadir o definir una proyección de `productId`, `variantId`, `availableToSell`, `observedAt`, `expiresAt`/TTL y `availabilityStatus` donde haga falta; verificar concurrencia/actualización y un flujo de selección/compra por `variantId`. El campo agregado `stock` no basta para afirmaciones por talla.
- Mostrar escasez solo con umbral configurado y dato vigente; nunca a partir de métricas inventadas o `stock` desactualizado. Caducidad/error -> «Consulta disponibilidad».
- Favoritos/carrito conservan una **intención reversible**. Recuperación por WhatsApp solo si el cliente la solicitó y existe base/consentimiento válido.
- Experimentos A/B con feature flag e instrumentación minimizada; exposición real registrada una vez por sesión/variante de experimento.

### P2 — reseñas y comunidad con gobernanza
- Nuevo dominio independiente `Review`: `reviewId`, `productId`, `orderItemId` (uso interno), `rating`, `body`, `verificationStatus`, `moderationStatus`, `createdAt`.
- «Compra verificada» solo después de comprobar correspondencia de producto/pedido y estado comercial suficiente; preferir compra entregada. Sin PII pública ni ID de pedido expuesto.
- Política pública de moderación neutral: spam, insultos y contenido prohibido sí; reseñas negativas auténticas no se suprimen por calificación.
- Recuento cero -> «Aún no hay opiniones»; no mostrar estrellas en vacío.
- Publicación de testimonios/historias de clientes requiere autorización separada; incentivos (si existen) nunca condicionados a opinión positiva.
- Revisión legal específica de Honduras y jurisdicciones futuras antes de publicar promociones/reseñas.

## 5. Contratos de datos y límites técnicos
**No cambiar contratos existentes silenciosamente.** Registrar nueva versión, migración de base de datos y pruebas en PR independiente.

### Producto/disponibilidad
- El cálculo actual de `variants[].available` ya descuenta reservas (`SUM(quantity - reserved)`); revisar reglas de concurrencia y robustez para el valor realmente vendible, sin renombrar/doblar semánticas antes de migrar. Asegurar timestamp/TTL y coherencia con selección por variante.
- Snapshot lleva fuente y caducidad; mensajes de escasez son opcionales y se desactivan si no se puede garantizar veracidad.
- Atribuir estado al canal correcto (web/tienda/marketplace); no prometer disponibilidad omnicanal sin sincronización.
- Evitar «X personas lo están viendo» porque el sistema no dispone de medida confiable en tiempo real.

### Reseñas
- Endpoints propuestos (no existentes): `GET /v1/products/:id/reviews`, `POST /v1/reviews`, rutas internas moderadas con RBAC.
- Elegibilidad comprobada en servidor; rate limit, antispam, logs sin PII; gestión de privacidad y eliminación.
- Índices/medias reproducibles a partir de reseñas publicadas; documentar método y periodo.
- No filtrar por sentimiento para aparentar mejores valoraciones.

### Analítica y atribución
Actual: `POST /v1/events` acepta `page_view`, `cta_click`, `intent_submit`, `add_to_cart`, `checkout_start`, y `public_events` guarda `session_id`, `route`, `metadata`.

Cambios propuestos:
- Eventual `experiment_exposure` **requiere** migrar allowlist/check constraint y pruebas; no mandar evento nuevo antes de migrar.
- Para metadatos de pruebas, allowlist de claves estrictas: `experimentId`, `variant`, `placement`, `productId`; límites de longitud, sin teléfono, email, nombre, mensajes libres ni order tokens.
- Asignación A/B consistente por sesión anónima; 50/50 como punto de partida, con exclusión del personal y tráfico de test si es posible.
- En `web/storefront/index.html`, `checkoutView()` invoca `trackEvent('checkout_start',{})` en render; una re-renderización puede crear eventos duplicados. Corregir deduplicación y semántica **antes** de utilizar ese evento para KPI.
- Vincular pedidos confirmados a cohorte de experimento solo mediante mecanismos autorizados y mínimos; no inferir ingreso por `add_to_cart`.

## 6. Marco de medición y decisión

| Tipo | Métrica | Fórmula y requisito |
|---|---|---|
| Principal | Conversión a pedido confirmado | Pedidos confirmados atribuibles / sesiones elegibles asignadas; requiere atribución auditada entre sesión y Order |
| Diagnóstico 1 | Añadido al carrito | Sesiones elegibles con `add_to_cart` válido / sesiones expuestas al producto |
| Diagnóstico 2 | Entrada al checkout | Sesiones con checkout realmente iniciado y carrito no vacío / sesiones con carrito |
| Guardrail 1 | Cancelaciones/devoluciones | Pedidos cancelados o devueltos / pedidos comparables por cohorte, con ventana igual |
| Guardrail 2 | Confianza y accesibilidad | Reclamaciones por afirmación comercial, errores de UI y fallos WCAG, por cohorte y periodo |

No establecer metas de uplift hasta tener línea de base, tráfico, variación histórica y tamaño muestral. Segmentación básica: móvil/escritorio, nuevos/recurrentes solo si hay identificación legítima, categoría y departamento si es operacionalmente útil. Riesgo de confusión: estacionalidad, diferencias de inventario, categorías distintas, tráfico promocional, pagos COD/transferencia aún PENDING.

### Experimento inicial recomendado
- **Hipótesis:** aclarar en ficha los datos de producto, talla y envío disminuye dudas sin aumentar cancelaciones.
- **Control A:** ficha comercial actual. **Variante B:** bloque compacto «Disponibilidad, medidas y entrega» con información real.
- **Unidad:** sesión elegible; asignación 50/50 consistente, exposición únicamente cuando el bloque se visualiza.
- **Éxito:** efecto estimado sobre pedidos confirmados con intervalo de incertidumbre, siempre que la atribución ya esté validada. Si no lo está, usar solo diagnóstico provisional (carrito/solicitud), sin afirmar incremento de ventas.
- **Guardrails:** carga móvil, accesibilidad, dudas/reclamos de soporte, cancelaciones y devoluciones.
- **Regla de salida:** detener si aparecen afirmaciones falsas, degradación grave de UX, errores o vulneración de consentimiento.
- **No declarar ganador** por una diferencia de clics sin evaluación de incertidumbre/guardrails.

## 7. Criterios de aceptación verificables
1. Mensajes de escasez desaparecen ante datos ausentes, desactualizados, agregados o discrepantes; nunca se muestran cantidades por variante no comprobadas.
2. Un producto sin reseñas muestra estado vacío honesto, sin valoraciones generadas.
3. Reseñas auténticas negativas siguen visibles salvo moderación neutral justificada.
4. Beneficios o guías gratuitos se usan sin marketing opt-in ni compra obligatoria.
5. El rechazo de marketing no impide comprar como invitado.
6. Totales, impuestos, estados de pago y gastos de envío siguen siendo autoritativos del servidor.
7. Se evita doble contabilización de checkout al re-renderizar y las métricas reflejan denominadores auditablemente definidos.
8. Los eventos no almacenan PII ni tokens públicos/privados de pedidos.
9. Cualquier CTA por WhatsApp revela de forma clara canal y finalidad.
10. WCAG/mobile: orden de foco, labels, contraste, orientación, estados vacíos/error; rendimiento sin degradación material.
11. Pruebas unitarias de copy/stock, integración API/DB, humo storefront y validación manual de lenguaje comercial.
12. Resultado de experimento registrado con fechas, versiones, cohorte, volumen, guardrails y decisión de rollback o despliegue.

## 8. Dependencias y plan de entrega
- **Primero (propuesta presente):** aprobar skill, spec y criterios, sin tráfico experimental ni mutaciones de esquema.
- **PR implementación A:** mejoras de claridad de ficha, guía y CTA WhatsApp; pruebas y screenshot antes/después.
- **PR implementación B:** ampliar el contrato existente `variants[].available` con frescura/TTL y asegurar selección y reserva por variante, sin recrear lectura ya existente.
- **PR implementación C:** analítica correcta, consentimiento/privacidad, asignación de experimento y panel de resultados.
- **PR implementación D:** dominio de reseñas verificadas, herramientas de moderación y pilotos de comunidad.

**Responsables por definir:** operación de Honduras para verificar fichas/inventario, ingeniería para contratos, producto para experimentos, responsable legal para avisos y políticas.

## 9. Riesgos, hipótesis y trazabilidad
**Verificado:** archivos y contratos citados de `main` al 2026-10-21.
**Hipótesis:** la transparencia de ficha y disponibilidad puede reducir fricción; **no hay uplift demostrado**.
**Pendiente de comprobar:** estado real en producción, frescura/consistencia del inventario por variante publicado, permisos de fotografías, volúmenes de ventas y tráfico, canales reales de soporte, requisitos jurídicos hondureños actualizados.

### Fuentes
- Cialdini Institute, *Influence, New and Expanded*: https://cialdini.com/books/influence
- Cialdini Institute, siete principios: https://cialdini.com/principles
- Association for Psychological Science, entrevista con Cialdini: https://www.psychologicalscience.org/observer/universal-principles-of-influence
- FTC, informe sobre dark patterns (referencia comparativa, **no** ley hondureña): https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers
- FTC, regla de reseñas (referencia comparativa, **no** ley hondureña): https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers

No reproducir material extenso del libro; esta especificación representa interpretación/aplicación propia.
