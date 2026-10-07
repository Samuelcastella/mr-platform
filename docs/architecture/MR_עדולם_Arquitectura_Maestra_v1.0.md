<PARSED TEXT FOR PAGE: 1 / 4>
עדולם MR
Arquitectura Maestra
Versión 1.0 · Base estratégica, comercial y tecnológica · 6 de octubre de 2026
1. Propósito
MR עדולם se define como una marca escalable y una plataforma de comercio, no 
como el nombre de una sola tienda. La boutique física es la primera operación 
comercial. La arquitectura debe permitir crecer hacia múltiples categorías, canales, 
ubicaciones, países, proveedores y líneas de producto sin reconstruir el núcleo.
2. Visión de evolución
 Fase 1 — Boutique física + web: comercialización de productos de terceros con 
catálogo e inventario centralizados.
 Fase 2 — Omnicanal: aplicación, pedidos, pagos, entregas y sincronización entre 
tienda física y canales digitales.
 Fase 3 — Curaduría y marca privada: selección de productos, compra en blanco / 
white label y personalización MR עדולם.
 Fase 4 — Producto propio: diseño, especificaciones, fabricación, control de calidad 
y trazabilidad de productos MR עדולם.
 Fase 5 — Expansión: múltiples categorías, tiendas, bodegas, mercados, países, 
proveedores y canales de venta.
3. Principios de arquitectura
 Construir pequeño sin construir limitado.
 Un solo núcleo de datos para tienda física, web, app y futuros canales.
 Separar experiencia del cliente (Storefront) de operación interna (Control Center).
 Diseñar multipaís, multiproveedor y multimoneda desde la base.
 Mantener trazabilidad de producto, proveedor, fabricante, origen, costos, 
inventario y movimientos.
 Aplicar Spec-Driven Development (SDD): cada módulo nace de una especificación 
documentada y versionada.
 Usar prácticas de empresas de gran escala como referencia, adaptadas a la etapa y
recursos de MR עדולם.
<PARSED TEXT FOR PAGE: 2 / 4>
4. Arquitectura del ecosistema
4.1 Storefront
Capa pública para clientes: inicio, descubrimiento, catálogo, categorías, búsqueda, 
producto, carrito, checkout, cuenta, pedidos y experiencia omnicanal. La identidad 
debe presentar MR עדולם como marca paraguas y no como una boutique limitada a 
un nicho.
4.2 MR עדולם Control Center
Capa privada de administración: catálogo, inventario, compras, proveedores, 
fabricantes, producción, precios, ventas, pedidos, clientes, logística, costos, 
ubicaciones, permisos y analítica.
4.3 Commerce Core
Núcleo compartido que mantiene las reglas y datos del negocio. Web, aplicación, 
tienda física y futuros marketplaces deben consumir el mismo modelo para evitar 
duplicación e inconsistencias.
5. Modelo de producto
Cada producto deberá poder evolucionar sin perder su historia. Tipos previstos:
 Producto de tercero — marca y producto externos vendidos por MR עדולם.
 Producto seleccionado por MR עדולם — producto externo incorporado bajo 
criterio curatorial de la marca.
 Private / white label — producto fabricado por un tercero y comercializado bajo 
identidad MR עדולם.
 Producto propio — diseñado, especificado y gestionado como propiedad de MR
.עדולם
El modelo conservará relaciones con variantes/SKU, precios y monedas, proveedor, 
fabricante, país de origen, costos, imágenes, ubicaciones, existencias, reservas y 
movimientos de inventario.
6. Alcance internacional
Honduras es la base inicial de la operación física y Estados Unidos participa en 
dirección y supervisión. El abastecimiento puede incluir China, pero la arquitectura 
queda explícitamente abierta a fabricantes, proveedores y oportunidades de 
cualquier país.
<PARSED TEXT FOR PAGE: 3 / 4>
7. Referencias de mejores prácticas
Referencia Principios a estudiar/adaptar
Amazon Catálogo escalable, búsqueda, 
marketplace, fulfillment, 
recomendaciones y operación basada en
datos.
Alibaba Sourcing global, proveedores, 
fabricantes, negociación, MOQ y 
relaciones B2B.
Walmart Omnicanalidad, tienda física + digital, 
inventario por ubicación y distribución.
Walgreens Gestión de categorías, operación de 
tienda y experiencia omnicanal.
Estas compañías se utilizan como referencias de patrones y prácticas; MR עדולם
tendrá arquitectura, identidad y decisiones propias.
8. Estado técnico actual
 Railway: proyecto MR עדולם en entorno production.
 PostgreSQL: servicio operativo con almacenamiento persistente.
 catalog-api: servicio desplegado y Online.
 Módulo 01 en desarrollo: Catálogo e Inventario.
 Modelo inicial: locations, suppliers, products, product_variants, inventory e 
inventory_movements.
 API inicial: ruta de salud y consulta de productos.
 GitHub: integración prevista; conexión pendiente.
9. Mapa de módulos
Código Módulo Estado
M01 Catálogo e Inventario Activo
M02 Órdenes y Ventas Planificado
M03 Clientes Planificado
M04 Entregas y Logística Planificado
M05 Pagos Planificado
M06 Proveedores y Compras Planificado
M07 Producción / Marca 
Privada
Preparado 
arquitectónicamente
M08 Control Center Planificado
M09 Storefront Web Siguiente frente
M10 Aplicación Futuro
<PARSED TEXT FOR PAGE: 4 / 4>
10. Decisiones no negociables
 La palabra עדולם se presenta únicamente en hebreo en materiales del proyecto.
 MR עדולם debe mantenerse como marca amplia y escalable, sin quedar asociada 
permanentemente a una categoría.
 La arquitectura no se limitará a China ni a un único país de abastecimiento.
 Las nuevas funciones deben integrarse al núcleo común y evitar silos por canal.
 Cada módulo relevante deberá quedar documentado y versionado.
11. Próximo documento
Especificación Web v1.0: arquitectura de información, navegación, páginas, 
componentes, experiencia responsive, integración con catalog-api, estados de 
catálogo, estrategia de marca y criterios de escalabilidad.
12. Registro de versión
v1.0 — 2026-10-06 — Documento maestro inicial consolidado a partir de las decisiones
vigentes del proyecto.