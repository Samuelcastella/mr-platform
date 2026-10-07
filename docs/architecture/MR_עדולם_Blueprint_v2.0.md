<PARSED TEXT FOR PAGE: 1 / 8>
MR עדולם | Architecture & Operating Blueprint | v2.0
Documento vivo · SDD · Control de cambios obligatorio
עדולם MR
ARCHITECTURE & OPERATING BLUEPRINT
Documento maestro vivo · Versión 2.0 · 6 de octubre de 2026
NORTE DEL SISTEMA
MR עדולם es una marca escalable y una plataforma de comercio. La boutique física es el primer canal, no el límite 
del negocio. Toda decisión debe permitir crecer hacia productos propios, múltiples categorías, canales, ubicaciones, 
países y mercados.
Estado: APROBADO COMO BASE ARQUITECTÓNICA
<PARSED TEXT FOR PAGE: 2 / 8>
MR עדולם | Architecture & Operating Blueprint | v2.0
Documento vivo · SDD · Control de cambios obligatorio
0. Control documental
Campo Valor Estado Uso
Documento Architecture & Operating 
Blueprint V2.0 Fuente maestra
Metodología Spec-Driven Development 
(SDD) Activo Diseño e implementación
Ciclo de decisión Propuesto Aprobado → →
Implementado Activo Gobernanza
Alcance inicial Honduras + dirección 
remota desde EE. UU. Activo Operación
Abastecimiento Nacional e internacional, 
sin país único Activo Compras
1. Resumen ejecutivo
MR עדולם se construirá como un ecosistema de marca y comercio. El cliente verá una experiencia unificada, 
mientras el negocio operará sobre un núcleo común de datos, reglas y trazabilidad. La arquitectura separa 
canales de venta, capacidades operativas y datos para que la expansión no requiera reconstruir el sistema.
Boutique 
física →
Storefront 
web
→ Aplicación →
Marketpla
ces →
Nuevos 
mercados
2. Principios rectores
 Marca primero: la boutique es una operación inicial; MR עדולם es la entidad escalable.
 Un núcleo, múltiples canales: web, app, tienda física y marketplaces deben compartir datos y reglas.
 Producto ≠ proveedor: un producto puede comprarse a múltiples proveedores y en múltiples lotes.
 Documentar la visión completa e implementar por fases para evitar sobreingeniería.
 Multipaís, multimoneda y multiproveedor desde el modelo conceptual.
 Trazabilidad antes que memoria: decisiones, compras, costos, movimientos y fuentes deben quedar 
registradas.
 Las mejores prácticas de grandes operadores se estudian como patrones; no se copian ciegamente.
 Cada especificación debe ser legible por negocio, agentes y programadores.
3. Arquitectura de alto nivel
Canales →
Experienc
e Layer
→
Commerce 
Core
→ Operations →
Data & 
Intelligenc
e
Canales Boutique física · Web · App · Marketplaces · Venta 
internacional
Experience Layer Inicio · Catálogo · Búsqueda · Producto · Carrito · 
Checkout · Cuenta
<PARSED TEXT FOR PAGE: 3 / 8>
MR עדולם | Architecture & Operating Blueprint | v2.0
Documento vivo · SDD · Control de cambios obligatorio
Commerce Core Productos · Variantes · Precios · Inventario · Órdenes · 
Clientes · Promociones
Operations Compras · Proveedores · Logística · Producción · Control 
Center · Finanzas operativas
Data & Intelligence Market Intelligence · Sourcing · Analítica · Historial · 
Auditoría · KPIs
4. Evolución del producto y de la marca
Tercero →
Selecciona
do por MR
עדולם
→
White / 
Private 
Label
→
Producto 
propio →
Portafolio 
global
El sistema debe conservar la historia de cada producto incluso cuando cambie su estrategia comercial. La 
transición a marca propia será una decisión basada en demanda, margen, recurrencia de compra, calidad, 
capacidad de suministro y oportunidad de diferenciación.
5. Modelo de abastecimiento por lotes
Nece
sidad →
Búsq
ueda
→
Com
para
ción
→
Com
pra/
Lote
→
Rece
pción →
Inve
ntari
o
→
Vent
a →
Apre
ndiza
je
La operación actual compra de forma flexible según precio, calidad y disponibilidad. Por ello, el catálogo no 
debe fijar un proveedor único. Cada adquisición se registra como lote con proveedor, fecha, costo, moneda, 
cantidad, origen y evidencia.
Entidad Ejemplo de dato Por qué existe Relación Estado
Producto Blusa / cosmético / 
accesorio
Identidad comercial 
estable 1:N variantes Definido
Variante/SKU Talla, color, 
presentación Unidad vendible N:N lotes Definido
Proveedor Mayorista/
distribuidor/fabricante Fuente comercial 1:N lotes Definido
Lote de compra Costo y fecha concretos Historial real de 
abastecimiento N:1 proveedor Nuevo v2.0
Inventario Cantidad por ubicación Disponibilidad 
operativa SKU + ubicación Definido
Movimiento Entrada/salida/ajuste/
reserva
Auditoría de stock SKU + ubicación Definido
6. Market Intelligence & Sourcing
Este dominio convierte la investigación de mercado en una capacidad permanente. El estudio no será un PDF 
aislado: será una salida versionada de un sistema que conserva observaciones, fuentes y cambios.
Puerto → Cholom → San → Tegucig → Resto de → Exterior
<PARSED TEXT FOR PAGE: 4 / 8>
MR עדולם | Architecture & Operating Blueprint | v2.0
Documento vivo · SDD · Control de cambios obligatorio
Cortés a
Pedro 
Sula
alpa
Hondur
as
 Registro de tiendas, mayoristas, distribuidores, importadores, fabricantes y competidores.
 Observaciones de precio con fecha, moneda, ciudad, presentación y fuente.
 Condiciones de mayoreo/minoreo, mínimos de compra, disponibilidad y posibles descuentos.
 Evaluación de calidad mediante criterios definidos; no mezclar percepción con evidencia.
 Comparación de costo total, margen potencial, confiabilidad y capacidad de suministro.
 Historial temporal para comparar versiones del mercado y detectar cambios.
 Potencial de exportación para productos hondureños con demanda o diferenciación.
7. Comercio bidireccional
Exterior →
 / עדולם MR
Honduras
→ Cliente Honduras
Productor Honduras → MR עדולם → Cliente internacional
International Trade & Distribution queda previsto como dominio futuro: importación, exportación, costos 
logísticos, documentación, aranceles, cumplimiento y distribución. Su complejidad se implementará cuando el 
negocio la necesite.
8. Mapa modular v2.0
ID Dominio Responsabilidad Dependencias 
principales Estado
M01 Catálogo & Inventario
Productos, SKU, 
ubicaciones, stock, 
movimientos
Core Data IMPLEMENTADO 
PARCIAL
M02 Órdenes & Ventas Pedidos, estados, líneas, 
devoluciones M01, M03, M05 PROPUESTO
M03 Clientes Identidad, contactos, 
historial M02 PROPUESTO
M04 Logística & Entregas Despacho, entrega, 
seguimiento M02 PROPUESTO
M05 Pagos Cobros, conciliación, 
métodos M02 PROPUESTO
M06 Sourcing & Compras
Proveedores, 
cotizaciones, lotes, 
recepción
M01, M11 APROBADO
M07 Producción / Private 
Label
Especificaciones, 
fabricación, QC M01, M06 PREVISTO
M08 Control Center Administración y 
permisos M01-M07 APROBADO
M09 Storefront Web Experiencia pública e￾commerce
Commerce Core EN ESPECIFICACIÓN
M10 Aplicación Canal móvil futuro Commerce Core PREVISTO
M11 Market Intelligence Mercado, precios, 
fuentes, benchmarking M06, Analytics APROBADO
M12 International Trade Import/export y 
distribución M06, M04 PREVISTO
<PARSED TEXT FOR PAGE: 5 / 8>
MR עדולם | Architecture & Operating Blueprint | v2.0
Documento vivo · SDD · Control de cambios obligatorio
M13 Analytics & Decisioning KPIs, márgenes, alertas, 
oportunidades Todos PREVISTO
9. Storefront Web — límites arquitectónicos
 Inicio centrado en MR עדולם como marca paraguas, no en una categoría única.
 Catálogo preparado para categorías presentes y futuras.
 Búsqueda y filtros basados en datos del Commerce Core.
 Página de producto independiente del proveedor de compra.
 Carrito y checkout desacoplados del catálogo para evolucionar pagos y logística.
 Responsive y accesible desde el inicio.
 Estados vacíos y de disponibilidad reales; no presentar productos ficticios como inventario.
 Integración progresiva con catalog-api y PostgreSQL.
10. Control Center
Catál
ogo
→
Com
pras
→
Inve
ntari
o
→
Vent
as →
Clien
tes
→
Logís
tica →
Prod
ucció
n
→
Inteli
genci
a
El Control Center será la interfaz operativa privada. Debe aplicar permisos por rol y conservar auditoría. Su 
objetivo es que la operación pueda crecer a múltiples personas, tiendas y ubicaciones sin depender de 
conocimiento informal.
11. Datos y trazabilidad
REGLA DE ORO
Todo dato que pueda cambiar con el tiempo debe conservar contexto temporal y origen cuando sea relevante: 
quién/qué lo generó, cuándo, desde qué fuente y qué entidad afectó.
 IDs estables para entidades de negocio.
 SKU único para variantes vendibles.
 Moneda explícita en precios y costos.
 Ubicación explícita para inventario.
 Movimientos inmutables o auditables para explicar cambios de stock.
 Fuentes y fecha de observación para inteligencia de mercado.
 Estados de ciclo de vida para productos, proveedores, órdenes y especificaciones.
12. Gobernanza SDD y versionado
Idea →
Propu
esta
→
Especi
ficació
n
→
Aprob
ación →
Imple
menta
ción
→
Verific
ación →
Versió
n
<PARSED TEXT FOR PAGE: 6 / 8>
MR עדולם | Architecture & Operating Blueprint | v2.0
Documento vivo · SDD · Control de cambios obligatorio
Estado Significado Puede tratarse como realidad 
operativa
PROPUESTO Existe como idea o diseño 
preliminar No
APROBADO Decisión aceptada para el roadmap No, hasta implementarse
IMPLEMENTADO Existe en sistema/código/proceso Sí
VERIFICADO Implementado y comprobado Sí, referencia preferida
DEPRECADO Sustituido por una decisión 
posterior No para trabajo nuevo
13. Estado técnico verificado al corte documental
 Proyecto MR עדולם desplegado en Railway, entorno production.
 PostgreSQL desplegado con volumen persistente.
 catalog-api desplegado y reportado Online/SUCCESS por Railway.
 Esquema inicial incluye locations, suppliers, products, product_variants, inventory e inventory_movements.
 Rutas iniciales: salud y consulta de productos.
 Conexión GitHub prevista pero no declarada como conectada.
 Pendiente de verificación separada: prueba externa actual de /health después del último ajuste de conexión 
a PostgreSQL.
14. Roadmap por horizontes
Horizonte Objetivo Entregables Criterio de avance
H1 — Base Catálogo confiable + web 
inicial
M01, Web Spec, Storefront 
inicial
Productos e inventario 
consistentes
H2 — Operación Órdenes, clientes, pagos, 
entregas
M02-M05 + Control Center Venta digital operable
H3 — Abastecimiento Compras y mercado 
documentados M06 + M11 Decisiones de compra 
comparables
H4 — Marca propia Private label y producción M07 Trazabilidad de 
fabricación/QC
H5 — Expansión Mercados y comercio 
internacional M12 + M13 Operación 
multiubicación/multimercado
15. KPIs que la arquitectura debe habilitar
 Margen bruto por producto, variante, lote, proveedor y categoría.
 Rotación de inventario y días de stock.
 Quiebres de stock y reservas.
 Variación de costo de compra entre proveedores y periodos.
 Sell-through por lote/categoría.
 Conversión web y abandono de carrito.
 Tiempo de ciclo de orden y entrega.
 Desempeño de proveedor: precio, calidad, disponibilidad y cumplimiento.
 Participación de productos terceros vs. private label vs. propios.
<PARSED TEXT FOR PAGE: 7 / 8>
MR עדולם | Architecture & Operating Blueprint | v2.0
Documento vivo · SDD · Control de cambios obligatorio
 Potencial de sustitución: productos de terceros candidatos a marca propia.
16. Riesgos arquitectónicos y mitigaciones
Riesgo Impacto Mitigación
Sobrediseñar demasiado pronto Costo y lentitud Visión completa; implementación por 
fases.
Datos inconsistentes entre canales Errores de stock/precio Commerce Core como fuente común.
Amarrar producto a proveedor Pierde flexibilidad de compra Compras/lotes separados del catálogo.
Investigación sin evidencia Decisiones no reproducibles Fuente, fecha y nivel de confianza.
Confundir aprobado con implementado Falsa sensación de avance Estados documentales obligatorios.
Escalar sin permisos/auditoría Riesgo operativo Roles y trazabilidad en Control Center.
17. Registro de decisiones arquitectónicas (ADR)
ADR Decisión Motivo Estado Versión
ADR-001
MR עדולם es 
marca/plataforma, no 
solo boutique
Evitar límites de 
categoría/canal APROBADO 2.0
ADR-002 Separar Storefront y 
Control Center
Escala y seguridad 
operativa APROBADO 2.0
ADR-003 Commerce Core 
compartido Consistencia omnicanal APROBADO 2.0
ADR-004 Producto separado de 
proveedor y lote
Compra 
oportunista/multiprovee
dor
APROBADO 2.0
ADR-005
Market Intelligence 
como sistema 
permanente
Estudios versionables y 
reproducibles APROBADO 2.0
ADR-006 Comercio bidireccional 
previsto
Importar y exportar 
oportunidades APROBADO 2.0
ADR-007 עדולם solo en hebreo 
en el proyecto
Regla de identidad 
definida APROBADO 2.0
18. Artefactos derivados
 Web Specification v1.0 — arquitectura de información, UX/UI, componentes, datos e integración.
 Market Intelligence & Sourcing Spec v1.0 — entidades, criterios, fuentes, scoring, versionado y expansión 
geográfica.
 Catalog & Inventory Spec — actualización para incorporar lotes de compra y costo histórico.
 Control Center Spec — roles, permisos, workflows y auditoría.
 International Trade Spec — se activará cuando exista necesidad operativa real.
 Modelo financiero — costos, márgenes, compras, inventario, escenarios y expansión.
19. Definition of Done documental
 El documento distingue claramente visión, decisión aprobada e implementación real.
<PARSED TEXT FOR PAGE: 8 / 8>
MR עדולם | Architecture & Operating Blueprint | v2.0
Documento vivo · SDD · Control de cambios obligatorio
 Los diagramas y tablas explican el sistema sin depender de la conversación original.
 Un programador puede identificar módulos, dependencias, datos y próximos artefactos.
 Una persona de negocio puede entender modelo, evolución y prioridades.
 Las decisiones nuevas se agregan mediante versión/ADR, no sobrescribiendo silenciosamente el historial.
 Las afirmaciones operativas sensibles a cambios se vuelven a verificar antes de declararlas actuales.
20. Changelog
v2.0 — 2026-10-06
 Reestructura completa del documento v1.0.
 Se incorpora arquitectura por capas y mapa modular ampliado.
 Se formaliza abastecimiento multiproveedor por lotes.
 Se crea el dominio Market Intelligence & Sourcing.
 Se incorpora comercio bidireccional Honduras exterior. ↔
 Se formalizan estados documentales, ADR, roadmap, KPIs, riesgos y Definition of Done.
 Se separa explícitamente lo aprobado de lo implementado/verificado.
v1.0 — 2026-10-06 — Primera consolidación de visión y arquitectura.