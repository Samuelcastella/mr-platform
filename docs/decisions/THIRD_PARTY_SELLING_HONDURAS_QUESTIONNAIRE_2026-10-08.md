# Cuestionario de decisiones — Venta propia + terceros en Honduras

**Proyecto:** MR עדולם  
**Fecha:** 2026-10-08  
**Estado:** INPUT REQUIRED / NO APROBADO  
**Propósito:** facilitar la conversación operativa con la persona que llevará la operación en Honduras antes de activar liquidaciones de terceros o comisiones de personal.

> Este documento no decide tasas, obligaciones fiscales, pagos ni contratos. Convierte las preguntas pendientes en decisiones verificables.

## 1. Modelo que ya está claro

La plataforma debe soportar dos casos distintos:

### A. Producto comprado por MR

MR compra el producto a un proveedor o tienda, lo incorpora a su inventario y luego lo revende.

- propietario económico después de la compra: MR;
- proveedor y vendedor final no se confunden;
- la venta al cliente se trata como venta propia de MR;
- no existe liquidación al proveedor por cada venta: la compra al proveedor ya fue una operación separada.

### B. Producto que sigue perteneciendo a un tercero

Una tienda, empresa o persona mantiene la propiedad económica del producto y permite que MR lo ofrezca en su catálogo.

- el tercero conserva atribución de Seller;
- debe existir un acuerdo identificable y versionado;
- la venta debe conservar el Seller/Agreement histórico;
- el pago al tercero, comisión de MR y tratamiento fiscal no se activan hasta que las reglas estén explícitamente aprobadas.

La plataforma ya distingue técnicamente estos casos.

---

# Parte I — Preguntas necesarias antes de activar ventas de terceros

Estas preguntas deben quedar respondidas antes de generar dinero a pagar a un tercero.

## 2. Quién controla el producto

Preguntar:

1. ¿El producto físico se queda en la tienda del tercero o se entrega previamente a MR?
2. Si se queda con el tercero, ¿quién confirma que todavía existe antes de aceptar el pedido?
3. ¿El tercero podrá actualizar su propio stock o alguien de MR lo actualizará?
4. ¿MR puede reservar una unidad cuando entra un pedido?
5. ¿Durante cuánto tiempo se considera reservada?
6. Si el tercero vende la misma unidad por otro canal, ¿cómo le avisa a MR?
7. ¿Quién responde cuando el catálogo dice que hay stock y en realidad no hay?

**Resultado que necesitamos documentar:** custodia física, fuente autoritativa de stock y responsable de diferencias.

## 3. Catálogo y aprobación

Preguntar:

1. ¿El tercero manda fotos, descripción, talla, color, SKU y precio, o MR prepara la ficha?
2. ¿Todo producto de tercero debe ser revisado por MR antes de publicarse?
3. ¿Qué productos o categorías no quieren aceptar?
4. ¿Quién es dueño/autorizado para usar las fotos y material del catálogo?
5. ¿Se puede retirar un producto inmediatamente o hay pedidos/reservas que deben respetarse?
6. ¿MR puede modificar título, descripción o fotografías para mantener un catálogo uniforme?

**Resultado:** reglas mínimas de onboarding y publicación.

## 4. Precio al cliente

Preguntar:

1. ¿Quién fija el precio público: el tercero, MR o ambos de común acuerdo?
2. ¿El tercero puede cambiar el precio cuando quiera?
3. ¿Un cambio de precio aplica solo a ventas futuras?
4. ¿MR puede hacer promociones o descuentos sin consultar?
5. Si MR aplica un descuento, ¿quién absorbe ese descuento?
6. ¿El tercero puede exigir un precio mínimo o un monto neto mínimo?

**Resultado:** autoridad de precio y tratamiento de descuentos.

## 5. Quién cobra

Preguntar:

1. Cuando el cliente compra un producto de tercero, ¿el dinero entra primero a MR?
2. ¿Habrá métodos donde el tercero cobre directamente?
3. Para transferencia bancaria, ¿a qué cuenta se paga?
4. Para pago contra entrega, ¿quién recibe físicamente el efectivo?
5. ¿Cuándo se considera que el dinero ya está realmente cobrado y conciliado?
6. ¿Qué pasa si el cliente paga pero después se revierte/falla el cobro?

**Resultado:** flujo de fondos y evidencia autoritativa de cobro.

## 6. Entrega y fulfillment

Preguntar:

1. ¿Quién prepara el paquete: MR o el tercero?
2. ¿Quién entrega al courier?
3. ¿Quién paga el envío hacia el cliente?
4. ¿El envío se cobra aparte al cliente?
5. Si un pedido tiene productos de MR y de dos terceros, ¿se envía en uno o varios paquetes?
6. ¿Quién responde por producto dañado, extraviado o faltante en tránsito?
7. ¿Quién elige el courier?

**Resultado:** responsable de fulfillment y asignación de costos/riesgos.

## 7. Cancelaciones y devoluciones

Preguntar:

1. ¿Hasta qué punto puede cancelar el cliente sin penalidad?
2. Si el producto ya fue entregado, ¿qué devoluciones se aceptan?
3. ¿A dónde regresa físicamente un producto de tercero?
4. ¿Quién inspecciona si puede volver a venderse?
5. ¿Quién absorbe una devolución atribuible a defecto del producto?
6. ¿Quién absorbe una devolución por cambio de opinión del cliente?
7. ¿Quién absorbe el envío de devolución?
8. Si ya se le pagó al tercero y luego hay una devolución, ¿se descuenta en una liquidación futura o se maneja manualmente?

**Resultado:** política de retorno y reversión económica.

## 8. Cuándo nace el derecho del tercero a cobrar

No preguntar primero “¿cada cuánto le pagamos?”; primero definir **cuándo una venta ya merece pago**.

Preguntar:

1. ¿Basta con que el cliente haya pagado?
2. ¿Debe además haberse entregado el producto?
3. ¿Debe esperarse a que la orden esté completamente cerrada?
4. ¿Quieren un período adicional para devoluciones/reclamos?
5. ¿El criterio cambia para efectivo contra entrega?
6. ¿Qué ocurre si el dinero todavía no está conciliado?
7. ¿Qué ocurre si existe una devolución o disputa abierta?

**Resultado:** settlement trigger y payment eligibility.

## 9. Cuánto recibe el tercero

Preguntar por cada tipo de acuerdo:

1. ¿El tercero recibe un monto fijo por unidad vendida?
2. ¿Recibe el precio de venta menos un porcentaje para MR?
3. ¿MR cobra una tarifa fija además del porcentaje?
4. ¿La comisión se calcula antes o después de descuentos?
5. ¿El envío entra o no en la base?
6. ¿Los fees de medios de pago los absorbe MR, el tercero o se prorratean?
7. ¿Puede haber condiciones diferentes por tienda, categoría o producto?

No necesitamos una tasa universal. El sistema puede manejar acuerdos distintos y versionados.

**Resultado:** commission basis + rate/fixed fee + allocation rules.

## 10. Frecuencia y forma de liquidación

Después de definir cuándo una venta es elegible, preguntar:

1. ¿Prefieren liquidaciones semanales, quincenales, mensuales o manuales?
2. ¿Quieren un mínimo de dinero acumulado antes de pagar?
3. ¿Cuántos días después de elegible puede pagarse?
4. ¿Cómo recibe el tercero el pago: transferencia, efectivo u otro medio?
5. ¿Quién aprueba la liquidación?
6. ¿Quién confirma que ya se pagó?
7. ¿Qué comprobante/referencia se guarda?

**Resultado:** calendario y control operativo. Esto no implica integrar banca automática.

## 11. Merma, pérdida y daño

Preguntar:

1. Si MR tiene físicamente el producto y se pierde, ¿quién asume el costo?
2. Si el tercero lo conserva y reporta pérdida, ¿cómo se corrige el stock?
3. Si el courier lo pierde, ¿quién presenta el reclamo?
4. ¿Se puede descontar una pérdida al tercero automáticamente?
5. ¿O todo descuento por merma debe pasar por aprobación y evidencia?

**Recomendación de control ya implementada:** ninguna discrepancia cruda de stock debe convertirse por sí sola en una deuda del tercero; primero debe existir un ajuste/aprobación gobernado.

## 12. Tratamiento fiscal — validar con profesional/SAR

Preguntar a la persona en Honduras qué documentos y asesoría ya tienen disponibles:

1. ¿Bajo qué RTN/entidad operará MR?
2. ¿Quién será vendedor/emisor fiscal cuando el producto pertenece a MR?
3. Cuando el producto sigue perteneciendo a un tercero, ¿quién debe emitir el documento fiscal al cliente según el acuerdo real?
4. ¿MR emitiría algún documento al tercero por su comisión/servicio?
5. ¿Qué tratamiento corresponde para descuentos, devoluciones y anulaciones?
6. ¿Qué autorización/CAI/rango vigente utilizará la operación?
7. ¿El contador o asesor fiscal puede confirmar estas respuestas por escrito?

**Resultado:** evidencia fiscal autoritativa. El sistema mantiene esta parte bloqueada hasta validación; no debe deducirse de ejemplos de Amazon, Temu o Alibaba.

---

# Parte II — Preguntas sobre el equipo de ventas de MR

Estas son M13 y pueden definirse de forma independiente a la liquidación del tercero.

## 13. Quién recibe crédito por una venta

Preguntar:

1. ¿Habrá vendedor principal por pedido?
2. ¿Puede haber una persona asistente?
3. ¿Qué pasa con una venta totalmente web sin asesor?
4. ¿Quién puede corregir el vendedor después de cerrar una venta?
5. ¿Qué evidencia se necesita para corregirlo?

La atribución de vendedor ya existe y conserva historial.

## 14. Cuándo se gana una comisión de personal

Preguntar:

1. ¿Al recibir el pago?
2. ¿Al entregar el pedido?
3. ¿Al completar/cerrar la orden?
4. ¿Qué pasa si después existe devolución?
5. ¿Se gana comisión en productos propiedad de terceros?
6. ¿Se gana igual en tienda, WhatsApp y web?
7. ¿Un asistente recibe algo o solo el vendedor principal?

**Resultado:** earning trigger + eligible roles/channels/commercial modes.

## 15. Cómo se calcula

Preguntar:

1. ¿Porcentaje de venta?
2. ¿Porcentaje sobre margen?
3. ¿Monto fijo por orden?
4. ¿Monto fijo por unidad?
5. ¿Cambia por categoría/producto/vendedor?
6. ¿Los descuentos reducen la base?
7. ¿El envío entra en la base?
8. ¿Existe un mínimo de margen para pagar comisión?

**Resultado:** CommissionRule versionada, no un porcentaje fijo escondido en código.

---

# Parte III — Puede definirse después

Estas preguntas son importantes, pero no tienen que bloquear una prueba inicial controlada si no existe aún automatización económica.

## 16. Marketplace más abierto

Más adelante:

- ¿los terceros se registrarán solos o solo por invitación?
- ¿podrán subir productos sin intervención de MR?
- ¿podrán manejar precios?
- ¿podrán manejar fulfillment?
- ¿tendrán dashboard propio de ventas/liquidaciones?
- ¿habrá puntuación/ranking de sellers?
- ¿se cobrarán planes, suscripciones o publicidad?

Actualmente marketplace self-service debe permanecer inactivo.

## 17. Analítica para decidir marca propia

Desde el principio conviene medir, sin necesidad de decidir políticas económicas:

- unidades vendidas por SKU/categoría;
- margen cuando sea producto propio;
- conversión de visitas a compra;
- tasa de agotamiento;
- cancelaciones;
- devoluciones;
- tiempo de entrega;
- demanda no satisfecha;
- productos solicitados que todavía no están en catálogo;
- repetición de compra.

El objetivo es poder identificar después qué producto/categoría merece inversión, compra directa y eventualmente marca propia.

---

# Parte IV — Formato corto para la conversación

Si el tiempo es limitado, obtener primero estas 12 respuestas:

1. ¿Dónde estará físicamente el producto de terceros?
2. ¿Quién mantiene el stock correcto?
3. ¿Quién fija el precio?
4. ¿Puede MR aplicar descuentos?
5. ¿A quién le paga el cliente?
6. ¿Quién prepara y despacha?
7. ¿Quién paga/absorbe envío y pérdidas?
8. ¿Cómo manejan devoluciones?
9. ¿En qué momento una venta ya merece que se le pague al tercero?
10. ¿Cómo se calcula cuánto recibe el tercero?
11. ¿Cada cuánto se liquida?
12. ¿Quién factura al cliente en el caso de producto que sigue perteneciendo al tercero, según el contador/asesor fiscal?

Con esas respuestas se puede diseñar la siguiente fase sin adivinar.

---

# Parte V — Registro de respuestas

Para cada respuesta registrar:

| Campo | Contenido |
|---|---|
| Decisión | Qué se acordó |
| Aplica a | MR-owned / tercero / ambos |
| Responsable | Persona/rol que ejecuta |
| Evidencia | Contrato, política, contador, SAR, operación real |
| Estado | PROPUESTA / VALIDAR / APROBADA / DESCARTADA |
| Fecha | Fecha de validación |
| Notas | Excepciones o casos especiales |

## Regla de implementación

Solo una decisión marcada **APROBADA** puede convertirse en una regla económica activa.

Información que esté solamente “en conversación”, “por investigar” o “validar” puede alimentar diseño y readiness, pero no debe activar automáticamente settlement, CommissionAccrual, payout ni tratamiento fiscal.
