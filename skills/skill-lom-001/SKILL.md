---
name: skill-lom-001
version: 1.0.0
description: Auditoría de proyectos basada en evidencias, grafos de relaciones y trazabilidad, inspirada en las estructuras narrativas de Mark Lombardi.
---
# SKILL-LOM-001 — Auditoría, Investigación y Trazabilidad

## Propósito
Auditar MR עדולם con una cadena verificable: fuente → afirmación → nodo → relación → evidencia → hallazgo → acción → verificación.

## Reglas obligatorias
1. Empezar con auditoría de solo lectura. No alterar código, producción, datos ni infraestructura.
2. Separar hecho verificado, declaración, inferencia, hipótesis y dato no comprobado.
3. No convertir correlaciones o relaciones gráficas en pruebas de causalidad.
4. Cada hallazgo incluye identificador, fecha, alcance, evidencia reproducible, impacto, probabilidad, confianza y estado.
5. No almacenar secretos, credenciales ni datos personales en el repositorio.
6. Un hash acredita integridad de la captura, no veracidad de la fuente.
7. La corrección se propone mediante PR separado y se cierra solo tras pruebas de regresión.

## Proceso
1. Delimitar alcance, entorno, periodo y preguntas de auditoría.
2. Registrar fuentes con URI, fecha, autor, versión, método de captura y hash si aplica.
3. Crear nodos únicos para requisitos, decisiones, servicios, despliegues, pruebas y actores.
4. Crear relaciones tipadas: IMPLEMENTS, DEPENDS_ON, TESTED_BY, DEPLOYED_TO, CONTRADICTS, SUPPORTED_BY.
5. Contrastar especificaciones con código, CI, configuración y operación real.
6. Registrar hallazgos; clasificar riesgo por impacto × probabilidad, independiente de confianza.
7. Documentar remediación, responsable y prueba de cierre.

## Versionado
SemVer. PATCH: correcciones compatibles; MINOR: capacidades nuevas compatibles; MAJOR: cambios incompatibles. Actualizar VERSION y CHANGELOG en cada versión.

## Primera auditoría
Ver docs/audit/lom/initial-audit-2026-10-11.md. Ningún resultado documental prueba por sí mismo el estado real de producción.
