---
name: skill-03
version: 0.2.0
status: authored-operational-draft
provenance: new-specification-not-verbatim-historical-original
---
# SKILL-03 — Gestión de inventario

> Documento operativo nuevo, redactado a partir de requisitos conocidos del proyecto MR עדולם. **No es una copia recuperada del documento histórico original**. Requiere revisión y aprobación antes de etiquetarse como estable.

## Propósito
Aplicar una metodología repetible de existencias y trazabilidad omnicanal dentro de la plataforma y operación de MR עדולם, con evidencia y trazabilidad SDD.

## Cuándo activarla
Cuando una solicitud trate sobre existencias y trazabilidad omnicanal. Leer primero `skills/README.md`, los requisitos vigentes del módulo y las fuentes relevantes. Coordinar con LOM para afirmaciones que requieren auditoría.

## Entradas obligatorias
SKU, variante, ubicación, lote, movimientos, reservas y conteos. Identificar fecha, procedencia, responsables, restricciones y lagunas; solicitar los datos críticos faltantes antes de comprometer recursos.

## Procedimiento
1. Identificar variante única.
2. registrar recepción y costo de lote.
3. llevar kardex inmutable.
4. reservar al iniciar pedido.
5. conciliar conteos.
6. calcular rotación, cobertura y punto de reposición.
7. investigar diferencias.

## Entregables
reporte de inventario por ubicación, movimientos, discrepancias y plan de reposición. Cada entrega debe distinguir hechos verificados, supuestos, decisiones pendientes y criterios de aceptación.

## Control de calidad y seguridad
- No permitir disponibilidad negativa sin excepción aprobada; movimientos reversibles por contrapartida, no borrado.
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
