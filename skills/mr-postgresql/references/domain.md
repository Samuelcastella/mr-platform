# Contratos de dominio de MR

Usar estos contratos como propuestas de diseño hasta contrastarlos con código y especificaciones vigentes. No crear todas las tablas por defecto.

## Catálogo e inventario

- Separar producto de SKU/variante, talla, color y condición nueva/usada. Definir unicidad de SKU según alcance real de tienda o vendedor.
- Para segunda mano admitir existencias unitarias y condición por pieza.
- Modelar existencias por SKU y ubicación, movimientos de Kardex y reservas con expiración. Definir si `on_hand` incluye reservas; por ejemplo disponible = on_hand - reserved.
- Impedir cantidades negativas y reservas mayores que existencias mediante CHECK cuando aplique a una fila. Para invariantes entre filas usar transacción y estrategia de bloqueo, no CHECK con subconsultas.
- Reservar con UPDATE condicional atómico o SELECT FOR UPDATE y validación dentro de la misma transacción. Ordenar bloqueos de varios SKU consistentemente. Comprobar filas afectadas y abortar todo el pedido si falta un artículo.
- Confirmar, liberar, expirar y devolver reservas una sola vez con transiciones condicionales e idempotencia. Descontar existencias y liberar reserva en la misma transacción.
- Conservar movimientos auditables; corregir con movimientos compensatorios. Probar conciliación entre saldo y Kardex y ventas omnicanal.

## Pedidos, cobros y envíos

- Separar Order y Shipment; admitir varios envíos si la operación lo necesita. Guardar líneas con snapshot de descripción, SKU, precio, impuesto y descuento.
- Separar estado de pedido, pago y envío; validar transiciones y registrar eventos de courier con identificador externo único por proveedor/cuenta.
- Procesar webhooks duplicados y fuera de orden sin duplicar cobros, inventario o notificaciones. Verificar autenticidad con las reglas del proveedor antes de persistir el evento como confiable.
- Definir claves de idempotencia no nulas, alcance y hash canónico de solicitud. Misma clave y mismo contenido devuelve resultado anterior; contenido distinto produce conflicto. Persistir resultado y efecto comercial atómicamente cuando corresponda.
- Proteger datos de cada vendedor/organización si el producto es multitienda. No añadir multitenancy por suposición. Si se usa RLS, probar con el rol real de aplicación y contexto por transacción; propietarios y BYPASSRLS pueden eludir políticas.
- Mantener alcance comercial: transferencias conciliadas, COD y proveedores de pago. No convertir el diseño en una billetera o emisor regulado por iniciativa propia.

## Importes y facturación

- Elegir numeric(p,s) con límites explícitos o unidades menores enteras y conversión probada. Serializar numeric sin perder precisión en JavaScript; probar el adaptador.
- Mantener HNL como moneda comercial de referencia, sin mezclar importes de distintas monedas. Definir redondeo por línea y pedido, devoluciones parciales y envío absorbido.
- Tratar tasas fiscales y requisitos CAI como parámetros y reglas que se verifican con fuentes vigentes antes de implementación fiscal, no como asesoría legal de esta skill.
- Para correlativos fiscales serializar asignación por rango/documento y proteger unicidad, límites y vencimiento. Una secuencia PostgreSQL puede dejar huecos y no se revierte con ROLLBACK; no prometer numeración fiscal continua con nextval.
- Conservar referencias históricas; preferir desactivación de productos a borrar artículos vinculados a pedidos.

## Reportes

Respetar el contrato confirmado de ventas/exportación e inventario. Evitar contar una orden varias veces al unir líneas, pagos y envíos. Definir granularidad, devoluciones, descuentos, fechas de negocio y zona horaria antes de agregar. Indexar después de medir consultas representativas.
