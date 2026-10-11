---
name: skill-02
version: 0.2.0
status: authored-operational-draft
provenance: new-specification-not-verbatim-historical-original
---
# SKILL-02 — Fundamentos de negocio

> Documento operativo nuevo, redactado a partir de requisitos conocidos del proyecto MR עדולם. **No es una copia recuperada del documento histórico original**. Requiere revisión y aprobación antes de etiquetarse como estable.

## Propósito
Aplicar una metodología repetible de viabilidad y economía unitaria dentro de la plataforma y operación de MR עדולם, con evidencia y trazabilidad SDD.

## Cuándo activarla
Cuando una solicitud trate sobre viabilidad y economía unitaria. Leer primero `skills/README.md`, los requisitos vigentes del módulo y las fuentes relevantes. Coordinar con LOM para afirmaciones que requieren auditoría.

## Entradas obligatorias
ventas, costos de compra, flete, impuestos aplicables, comisiones, gastos fijos y variables. Identificar fecha, procedencia, responsables, restricciones y lagunas; solicitar los datos críticos faltantes antes de comprometer recursos.

## Procedimiento
1. Separar costo, precio y utilidad.
2. calcular margen bruto=(venta-costo)/venta y markup=(venta-costo)/costo.
3. modelar flujo de caja.
4. estimar punto de equilibrio=costos fijos/contribución unitaria.
5. elaborar escenarios y sensibilidad.

## Entregables
ficha de unit economics, escenarios, umbrales y decisiones. Cada entrega debe distinguir hechos verificados, supuestos, decisiones pendientes y criterios de aceptación.

## Control de calidad y seguridad
- No confundir ingresos con efectivo disponible ni margen con markup; validar tratamiento fiscal con especialista.
- Mantener trazabilidad entre requisito, evidencia, propuesta y resultado.
- Evitar cambios directos en producción o compromisos comerciales sin autorización.
- No inventar cifras, validaciones, precios, inventario ni cumplimiento normativo.
- Respetar el nombre de marca **MR עדולם** y el modelo multirrubro y multipaís.

## Criterios de aceptación
1. Entradas y fuentes identificadas.
2. Procedimiento ejecutado con resultados verificables.
3. Riesgos, supuestos y dependencias explícitos.
4. Entregable reproducible y revisable por otro agente.
5. Aprobación registrada cuando haya consecuencias económicas, legales o de producción.

## Versionado y recuperación histórica
Versión 0.2.0, ampliación operativa nueva. El documento histórico original permanece **pendiente de localizar y cotejar**. Si aparece, preservarlo como evidencia separada y comparar diferencias antes de reemplazar este texto.
