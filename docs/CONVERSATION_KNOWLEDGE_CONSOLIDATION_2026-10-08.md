# MR עדולם — Consolidación de conocimiento de conversaciones

**Status:** CONVERSATION-DERIVED KNOWLEDGE INPUT
**Consolidation date:** 2026-10-08
**Scope:** Conversaciones recientes del proyecto, decisiones explícitas del usuario, investigación comercial acumulada y requisitos operativos derivados.
**Authority rule:** Este documento no convierte automáticamente una conversación en requisito aprobado. Clasifica el contenido para que pueda alimentar research, roadmap, SPECs e implementación mediante SDD.

## 1. Propósito

Durante las conversaciones del proyecto se añadió una cantidad sustancial de información sobre mercado hondureño, categorías comerciales, competidores, crédito, logística, canales digitales, inventario, personal, pérdidas, auditoría y diseño del Control Center.

El objetivo es evitar que ese conocimiento quede aislado en chats y convertirlo en una entrada durable y versionada para MR עדולם.

Regla de tratamiento:

- **Evidence / research note:** información investigada o mencionada en conversaciones; puede requerir revalidación.
- **Decision:** decisión explícita adoptada para MR עדולם.
- **Requirement:** capacidad que se desprende de una decisión aprobada o del operating model.
- **Implementation fact:** algo verificado en repositorio, Railway o producción.
- **Hypothesis:** propuesta útil todavía no aprobada.
- **Superseded / historical:** contenido antiguo conservado como antecedente, no como norma vigente.

## 2. Normalización de identidad y nombres

### Decision

- La marca es **MR עדולם**.
- **עדולם debe aparecer únicamente en hebreo**.
- “Boutique” es el nombre del espacio/proyecto conversacional, no el nombre comercial.
- Variantes como “MR Adolán”, “MR Adulam” o similares se consideran transliteraciones históricas o errores de conversación, no naming vigente.
- MR עדולם no debe definirse únicamente como boutique; la boutique física es el primer canal operativo y entorno de aprendizaje.

### Historical inconsistencies detected

Existen artefactos antiguos que usan “MR Adulam OS” y referencias de arquitectura temprana con nomenclatura anterior. También se detectó al menos una referencia errónea a Nicaragua en documentación histórica. Esas piezas no deben reescribirse silenciosamente; deben versionarse, anotarse o ser superseded cuando se actualicen.

## 3. Decisiones estratégicas confirmadas

### 3.1 Modelo comercial híbrido

MR עדולם operará con una mezcla de:

- inventario propio;
- productos de terceros;
- consignación o comisión cuando aplique;
- marcas asociadas;
- futura capacidad marketplace;
- segunda mano como línea potencial ya contemplada por la arquitectura.

Cada SKU o variante vendible debe poder asociarse con:

- propietario económico del inventario;
- proveedor o seller;
- modalidad comercial;
- costo;
- precio;
- comisión o margen;
- regla de liquidación;
- responsabilidad por devoluciones;
- responsabilidad por merma;
- ubicación y disponibilidad.

### 3.2 No partir de cero

- El proyecto ya tiene sitio web, servicios desplegados, base de datos y Control Center.
- No se debe reconstruir lo que ya funciona.
- Toda propuesta nueva debe compararse contra **Baseline V0**.
- El trabajo futuro debe cerrar gaps explícitos entre producción y la visión aprobada.

### 3.3 Omnicanalidad

MR עדולם debe poder operar con varios canales conectados a la misma autoridad comercial:

- tienda física;
- storefront web;
- teléfono;
- WhatsApp;
- redes sociales;
- catálogo digital;
- futura app móvil;
- futura venta marketplace.

Regla derivada: **muchos canales, una sola autoridad de catálogo, inventario, pedido y pago**.

### 3.4 Alcance geográfico y sourcing

- Honduras es el mercado inicial.
- La coordinación puede ocurrir desde Estados Unidos.
- El sourcing puede provenir de Honduras, Estados Unidos, China u otros países.
- No debe hardcodearse una sola procedencia.
- La arquitectura debe permitir evolución internacional sin imponer complejidad prematura al MVP.

## 4. Operating reality consolidada

Las conversaciones y la memoria existente describen una operación física que ya maneja o contempla:

- ropa;
- accesorios personales;
- cosméticos;
- productos de higiene;
- ropa interior y relacionados;
- pedidos por teléfono;
- venta presencial;
- efectivo;
- transferencia bancaria;
- retiro en tienda;
- entrega a domicilio;
- lista existente de productos.

La nueva investigación amplía el campo de análisis a categorías y oportunidades que no deben interpretarse automáticamente como surtido de lanzamiento.

## 5. Segmentación de clientes y categorías investigadas

### Evidence / research notes

Se analizaron o exploraron:

- adultos, dama y caballero;
- jóvenes y jovencitas;
- niñas, niños y bebés;
- adulto mayor;
- clientes de ropa deportiva;
- clientes de calzado artesanal;
- compradores de electrodomésticos y línea blanca;
- compradores de muebles y decoración;
- compradores sensibles a facilidades de crédito.

### Commercial implication

La plataforma debe soportar categorías flexibles y atributos por producto sin asumir que todo el negocio será moda. El lanzamiento comercial puede seguir enfocado.

### Pending decision

Todavía no está cerrada la selección de:

- segmento primario de lanzamiento;
- categorías iniciales exactas;
- arquitectura de surtido por temporada;
- posicionamiento final de precio;
- profundidad de inventario por categoría.

## 6. Ecosistema de moda y diseño hondureño investigado

### Evidence / research notes

En conversaciones se identificaron, entre otros:

- SASS Boutique;
- Pinkett Boutique;
- Franchesca's Boutique;
- Sisterly Boutique;
- ORIBELA;
- Kai Honduras;
- Tirso Rubio / Betón Brut;
- Cangorella;
- Elwin Sport;
- Valuna;
- Boro;
- Palma by Valeria Osorio;
- La Boutique del Artesano;
- Morena Perpetua;
- Gladys González;
- Marysabel Medina;
- Luis Flores.

Estas referencias se usaron para explorar moda ejecutiva, gala, casual, playa, activewear, calzado artesanal, ropa clásica, diseño personalizado, alta costura, productos de autor, marcas locales y comercialización por catálogo digital.

### Validation rule

La presencia, ubicación, catálogo, precios y condiciones comerciales de cada actor son datos externos y dinámicos. Deben revalidarse antes de usarse para contratos, benchmarking cuantitativo o decisiones de inversión.

## 7. Retail, cadenas y benchmarking

### Evidence / research notes

Se analizaron cadenas y comercios relevantes del mercado hondureño, incluyendo:

- Diunsa;
- Lady Lee;
- Tiendas Mendels;
- Siman;
- Carrión;
- Walmart;
- Jetstereo.

Los ejes conversados incluyen surtido, categorías, e-commerce, crédito, entrega, presencia física, métodos de compra, amplitud de marcas y facilidad de pago.

### Strategic implication

MR עדולם no debe competir únicamente por amplitud de catálogo o precio contra cadenas grandes. La hipótesis estratégica más consistente es competir por:

- curaduría;
- experiencia digital;
- atención asistida;
- inventario confiable;
- cercanía local;
- flexibilidad de canales;
- integración progresiva de terceros.

## 8. Electrodomésticos y línea blanca

Se investigaron categorías de refrigeración, lavandería, estufas, climatización, pequeños electrodomésticos, cocina y cuidado del hogar, con referencias a Lady Lee, Diunsa y Jetstereo.

No existe decisión de entrada inmediata. La investigación se conserva como evidencia de expansión multicategoría y de la importancia de crédito, despacho, garantía y logística de productos voluminosos.

## 9. Muebles y decoración

Se revisó oferta de sala, entretenimiento, dormitorio, camas y colchones, comedor, cocina y almacenamiento.

Si esta categoría se activa en el futuro, el fulfillment deberá contemplar dimensiones, peso, tarifas especiales, ventanas de entrega, posibles servicios asociados, daños en tránsito y logística inversa más costosa.

No es requisito inmediato del Commerce Core.

## 10. Ropa infantil y familias

Se exploraron ropa para bebés, mamelucos, sets, pijamería, calzado infantil, accesorios, maternidad y cuidado relacionado.

También se exploró crédito para compras infantiles mediante opciones como CrediDiunsa, Credilee y Crédito Mendels.

La arquitectura de catálogo debe soportar tallas, edades, variantes, sets y categorías familiares. Infantil no está aprobado como segmento inicial.

## 11. Moda juvenil y ocasiones

Se investigaron graduaciones, gala juvenil, ropa de playa, estética urbana, boho / oversize, activewear y calzado artesanal contemporáneo.

Para moda, variantes exactas, disponibilidad y contenido visual son capacidades críticas. La plataforma debería facilitar colecciones, temporadas, ocasiones y filtros por estilo sin rigidizar la taxonomía.

## 12. Adulto mayor y moda adaptativa

No se identificó en conversaciones una oferta hondureña claramente consolidada y exclusiva de moda adaptativa para tercera edad.

Se exploraron como alternativas cortes clásicos, prendas cómodas, colores neutros, ropa holgada y calzado cómodo.

Puede existir oportunidad comercial, pero requiere investigación específica de demanda, ergonomía y accesibilidad.

## 13. Deportes y activewear

Elwin Sport fue analizado como referencia local, junto con cadenas de artículos deportivos.

Para marcas locales se discutieron e-commerce propio, redes sociales, WhatsApp, alianzas, retail y catálogos digitales.

Esto refuerza la necesidad de soportar marcas de terceros y colecciones especializadas.

## 14. Canales digitales y comercialización

### Evidence / research notes

En boutiques y emprendimientos se observó o discutió uso de:

- WhatsApp;
- Instagram y redes sociales;
- tienda web propia;
- catálogo digital;
- venta presencial;
- atención personalizada;
- enlaces compartibles;
- coordinación manual de pago y entrega.

### Decision / requirement impact

WhatsApp debe tratarse como canal comercial real, con capacidad futura de transportar contexto de producto, variante, cliente, cotización, pedido y estado.

No debe quedar reducido a un botón genérico de contacto.

## 15. Estrategias de catálogos digitales

Se discutieron catálogos en HNL, fichas visuales, CTA a WhatsApp, disponibilidad visible, colecciones, promociones, distribución de enlaces, atención de vendedores y catálogo propio.

Storefront y herramientas asistidas deben poder compartir productos o colecciones con contexto consistente y disponibilidad autoritativa.

## 16. Crédito y financiamiento

### Evidence / research notes

Se exploraron:

- Credilee;
- CrediDiunsa;
- Crédito Mendels.

Los ejes de evaluación fueron requisitos, plazos, facilidad de solicitud, experiencia en línea, cuotas y accesibilidad.

### Architecture decision

El crédito digital no debe bloquear el Commerce Core ni mezclarse prematuramente con el ledger financiero.

Cuando se apruebe, debe modelarse como capability separada o integración mediante adapter.

Las condiciones exactas son dinámicas y requieren verificación actual antes de presentarlas al cliente o codificarlas.

## 17. Pagos

### Confirmed direction

Métodos Honduras-first:

- efectivo;
- transferencia bancaria;
- Cash on Delivery;
- futuros proveedores digitales mediante adapters.

Se discutieron pasarelas, conciliación, comprobantes, pagos parciales, reembolsos y separación entre pedido y pago.

### Requirement

Order status y payment status deben ser independientes.

El sistema debe soportar uno o varios pagos por pedido, pago pendiente, confirmación manual de transferencia, reembolso, conciliación, evidencia e idempotencia.

## 18. Logística y envíos

Se exploraron tarifas planas, tarifas por zona, couriers locales, entrega urbana e interurbana, Cargo Expreso, Sompopo Express, seguimiento, home delivery y costo visible de entrega.

Pinkett Boutique fue mencionada con una tarifa plana de L 110 como ejemplo histórico de estructura logística. Debe revalidarse antes de usarla como benchmark.

M04 debe contemplar pickup, delivery, zonas, costo, courier, guía, intentos, prueba de entrega, falla, devolución a origen y separación entre COD cobrado y COD conciliado.

## 19. Software, ERP, POS y ecosistema tecnológico local

Se investigaron KODDIX, Zafra Cloud y otras soluciones ERP / POS / facturación, incluyendo catálogo, inventario, contabilidad, facturación fiscal y CAI.

Estas soluciones son benchmark e integración potencial, no reemplazo automático del Commerce Core.

MR עדולם debe conservar autoridad sobre sus dominios comerciales y evaluar integraciones solo donde aporten valor operacional o fiscal.

## 20. Cumplimiento fiscal Honduras

Las conversaciones reforzaron SAR, CAI, facturación, rangos, vencimientos, control operativo del CAI y alertas.

Regla vigente: **ninguna regla fiscal o legal debe codificarse como verdad sin validación actual**.

La investigación fiscal y M05 siguen siendo los artefactos principales.

## 21. Inventario y Kardex

Kardex es el ledger operativo de movimientos de inventario.

Debe registrar, según aplique:

- entradas;
- salidas;
- reservas;
- liberaciones;
- devoluciones;
- ajustes;
- transferencias;
- mermas;
- recepción;
- correcciones autorizadas.

El stock no debe modificarse mediante edición silenciosa.

Debe distinguirse stock físico, reservado, bloqueado, disponible y, cuando se implemente procurement avanzado, en tránsito.

Toda modificación relevante debe tener usuario, timestamp, motivo, referencia, evidencia cuando corresponda y aprobación si supera reglas de riesgo.

## 22. Ajustes de inventario y aprobación

Se diseñó conceptualmente un módulo de **Ajustes de Inventario y Auditoría de Kardex** para bajas por merma, correcciones, diferencias de conteo, daño, robo, pérdida logística y destrucción autorizada.

Debe soportar aprobación de supervisor según tipo, valor, cantidad y nivel de riesgo.

## 23. Robos, mermas y shrinkage

Se identificaron vectores como robo interno, alteración de conteos, extracción en tránsito, pérdida logística, fraude con comprobantes, diferencias de inventario y manipulación de devoluciones.

Implicaciones:

- audit log inmutable;
- segregación de funciones;
- reason codes;
- evidencia;
- aprobación;
- reconciliación;
- bandeja de excepciones;
- reporting de shrinkage.

## 24. Personal, roles y comisiones

Se discutieron vendedores, bodega, cajeros, administradores, supervisores, compras, auditoría y proveedores externos.

También se solicitó un módulo de comisiones por vendedor.

La comisión debe poder depender de venta cerrada, categoría, margen, vendedor, canal, devoluciones, cancelaciones y periodo de liquidación.

Las comisiones deben revertirse o ajustarse cuando la venta deje de ser económicamente válida.

## 25. Control Center

El target conversacional incluye:

- dashboard;
- catálogo;
- productos;
- inventario;
- Kardex;
- pedidos;
- clientes;
- proveedores;
- compras;
- pagos;
- conciliación;
- fulfillment;
- entregas;
- devoluciones;
- personal;
- roles;
- comisiones;
- aprobaciones;
- auditoría;
- configuración;
- Health Desk.

### Implementation fact

La auditoría del 2026-10-08 confirmó que el Control Center desplegado ya tiene superficies reales para varias de estas áreas y debe evolucionarse, no reemplazarse.

## 26. Health Desk y troubleshooting

Se propuso monitorear webhooks, CAI / rango fiscal, reservas, colas, integraciones, fallos operativos, excepciones y servicios críticos.

También se desarrollaron escenarios de troubleshooting para reservas bloqueadas, overselling, stock incorrecto, fallos de workers, inconsistencias de pago, webhooks, CAI y colas.

Las excepciones deben ser first-class operational objects o, como mínimo, visibles en una bandeja de incidentes.

## 27. Proveedores, sourcing y procurement

Se discutieron marcas locales, proveedores hondureños, sourcing internacional, compra, consignación, catálogo de terceros, condiciones comerciales, órdenes de compra, recepción, control de calidad, costos totales y stock en tránsito.

Modelo futuro:

supplier → commercial agreement → purchase / consignment → receipt → inventory ownership → sale → settlement / margin.

M08 sigue siendo el artefacto principal.

## 28. Marketplace y productos de terceros

### Confirmed decision

El modelo híbrido es una decisión explícita, no solo una posibilidad.

La activación de marketplace self-service sigue posterior al Commerce Core.

Conceptos necesarios para futuro:

- seller / supplier identity;
- inventory owner;
- product owner;
- commission rule;
- cost basis;
- settlement rule;
- seller statement;
- return allocation;
- discount allocation;
- fee allocation;
- liability for shrinkage;
- seller reporting;
- approval / onboarding.

Soportar el modelo híbrido en datos no significa activar inmediatamente un marketplace abierto.

## 29. Liquidaciones a terceros

Cuando MR עדולם venda producto de terceros, debe poder determinar venta bruta, descuentos, impuestos, devolución, costo o monto base, comisión MR, cargos aplicables, neto del proveedor y estado de liquidación.

Estados conceptuales conversados:

- OPEN;
- CALCULATED;
- APPROVED;
- PAID.

Estas reglas deben formalizarse en una SPEC futura antes de implementación financiera completa.

## 30. Devoluciones y postventa

Una devolución puede afectar pedido, pago, reembolso, inventario, Kardex, comisión, liquidación de proveedor y clasificación física del artículo.

Un artículo devuelto no debe regresar automáticamente a disponible sin inspección cuando el tipo de producto lo requiera.

M09 sigue siendo el artefacto de referencia.

## 31. Precios, costos y márgenes

Se discutieron estrategias de precio y margen para vestuario y otras categorías.

La plataforma debe poder almacenar y analizar costo, precio, descuento, margen bruto, comisión, costo logístico, impacto de devolución, margen por SKU, categoría y proveedor.

No hay todavía una política única de markup o margen aprobada para todas las categorías.

## 32. KPIs reforzados por las conversaciones

- ventas brutas y netas;
- margen bruto;
- margen por SKU / categoría / proveedor;
- ticket promedio;
- rotación;
- días de inventario;
- precisión de inventario;
- stockout;
- shrinkage;
- tasa de devolución;
- tasa de cancelación;
- conversión por canal;
- conversión asistida por WhatsApp;
- tiempo de preparación;
- tiempo de entrega;
- pedidos atrasados;
- desempeño de proveedor;
- comisión generada;
- liquidaciones pendientes.

## 33. Experiencia y UX

La investigación reforzó dashboards por rol, mobile-first, imágenes de producto, estados visibles, búsqueda y filtros, confirmación para operaciones críticas, feedback inmediato, navegación por trabajo operativo y simplicidad para el cliente aunque la operación interna sea compleja.

## 34. Tecnologías y arquitectura: tratamiento de investigación histórica

Conversaciones y documentos tempranos mencionaron React / Vue, Node / Python, Redis, Kafka, CQRS, event sourcing, offline-first, microservicios y Kubernetes.

Estas referencias son investigación arquitectónica, **no decisiones actuales automáticas**.

La autoridad vigente es la arquitectura implementada y los documentos actuales: Railway, Bun donde ya existe, Postgres, storefront, catalog-api, Control Center y SPECs versionadas.

No debe introducirse infraestructura adicional solo porque aparezca en una comparación de mercado.

## 35. Estado de plataforma verificado el 2026-10-08

### Implementation facts

En Railway se verificó:

- proyecto MR עדולם;
- entorno production;
- servicio storefront;
- servicio catalog-api;
- servicio control-center;
- servicio Postgres;
- servicio storefront-preview;
- bucket project-documents;
- bucket MRImages en estado staged-create al momento de la revisión.

Los despliegues principales consultados estaban en SUCCESS.

El bucket MRImages tenía cambios staged y no fue aplicado durante la auditoría.

### Storefront

- conectado a Samuelcastella/mr-platform;
- rama main;
- root web/storefront;
- healthcheck /ready;
- usa CATALOG_API_URL.

### Catalog API

- conectado al mismo repositorio;
- root services/catalog-api;
- healthcheck /health;
- usa Postgres;
- tracing activo.

### Control Center

La inspección confirmó UI y flujo ya existente para catálogo, pedidos, clientes, proveedores, compras, fulfillment y devoluciones, además de autenticación y portal de proveedor.

### Repository

El repositorio ya contiene arquitectura, research, roadmap, specs M01–M10, ops, brand, storefront, mobile shell y API.

## 36. Gaps y prioridades después de la consolidación

La nueva información **no cambia** la secuencia central:

1. catálogo autoritativo;
2. variantes y stock autoritativos;
3. pedidos server-side;
4. reservas e idempotencia;
5. checkout server-side;
6. efectivo / transferencia / COD;
7. fulfillment y entrega local;
8. identidad, roles y auditoría;
9. fiscal validado;
10. marketplace / liquidaciones / integraciones avanzadas.

La consolidación amplía especialmente requisitos futuros de modelo híbrido, sellers, comisiones, liquidaciones, shrinkage, approvals, Health Desk, crédito separado, benchmarking por categoría, catálogo multicategoría, logística diferenciada y omnicanalidad asistida.

## 37. Mapeo hacia SPECs existentes

| Knowledge area | Primary artifact |
|---|---|
| Catálogo, SKU, variantes, stock, Kardex | M01_CATALOG_INVENTORY_V1 |
| Pedidos, reservas, idempotencia | M02_ORDERS_RESERVATIONS_V1 |
| Checkout, efectivo, transferencia, COD | M03_CHECKOUT_PAYMENTS_V1 |
| Entrega, courier, intentos, COD logístico | M04_FULFILLMENT_LOGISTICS_V1 |
| SAR, CAI, facturación Honduras | M05_FISCAL_HONDURAS_V1 |
| Roles, permisos, seguridad, auditoría | M06_IDENTITY_ROLES_SECURITY_V1 |
| Clientes y relación comercial | M07_CUSTOMER_CRM_CORE_V1 |
| Proveedores, sourcing, compras | M08_SUPPLIERS_PROCUREMENT_CORE_V1 |
| Devoluciones y postventa | M09_RETURNS_AFTER_SALES_V1 |
| Mobile | M10_* |
| Intentos y colas operativas | CONTROL_CENTER_INTENT_QUEUE_V1 |
| CTAs y handoff comercial | INTENT_CTA_SYSTEM_V1 |

### Future specs suggested by conversation evidence

No crear todavía sin SDD approval, pero la evidencia sugiere eventualmente:

- Marketplace / Seller Ownership & Settlement;
- Commissions & Staff Incentives;
- Inventory Adjustments / Shrinkage Approval;
- Operational Health Desk;
- Credit Provider Adapter;
- Pricing & Promotion Rules.

## 38. Información que requiere revalidación externa

Antes de convertirse en requisito contractual, pantalla pública o regla de negocio, debe verificarse:

- direcciones y horarios de boutiques;
- precios y surtidos;
- tarifas de envío;
- condiciones de crédito;
- requisitos financieros;
- disponibilidad de proveedores;
- términos de plataformas externas;
- funcionalidades vigentes de KODDIX / Zafra;
- reglas SAR / CAI / ISV;
- cobertura de couriers;
- promociones;
- métodos de pago ofrecidos por competidores.

## 39. Decisiones todavía pendientes

No se debe inventar respuesta para:

- cliente primario de lanzamiento;
- surtido exacto de lanzamiento;
- política de margen por categoría;
- política final de devoluciones;
- duración de reservas;
- reglas de comisiones a vendedores;
- regla de liquidación a terceros;
- onboarding de sellers;
- condiciones de crédito propias;
- cobertura logística inicial;
- alcance exacto del marketplace;
- fecha de activación de mobile app;
- priorización de categorías no moda.

## 40. Reglas para futuras conversaciones

1. No preguntar al usuario por información que pueda obtenerse del repo, Railway o artefactos existentes.
2. No asumir que una idea de conversación ya está implementada.
3. No confundir research con decisión.
4. No crear un roadmap paralelo si ya existe uno vigente.
5. Antes de proponer una feature, mapearla a un gap, SPEC o issue.
6. Si nueva información contradice una decisión previa, registrar la contradicción y supersede explícitamente.
7. La marca siempre se escribe **MR עדולם**.
8. “Boutique” puede describir el canal físico o el espacio conversacional, pero no sustituye el nombre comercial.
9. Las fuentes de mercado dinámicas deben revalidarse cuando la decisión dependa de ellas.
10. El proyecto debe preservar trazabilidad desde evidencia hasta producción.

## 41. Conclusión

Las conversaciones recientes no requieren reiniciar MR עדולם. Requieren enriquecer su base de conocimiento y ampliar la trazabilidad entre estrategia, operaciones y SPECs.

La nueva información fortalece una visión de MR עדולם como comercio omnicanal Honduras-first, plataforma híbrida de inventario propio y terceros, sistema con inventario y Kardex autoritativos, operación con proveedores y compras, experiencia asistida por WhatsApp, pagos adaptados al mercado local, logística auditable, Control Center orientado a excepciones, roles y aprobaciones, y futura evolución a marketplace sin comprometer el Commerce Core.

Este documento debe usarse como **input consolidado** para futuras actualizaciones de research, roadmap y SPECs, no como sustituto de esos artefactos.
