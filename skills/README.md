# Catálogo maestro de skills — MR עדולם

Estado: inventario inicial de habilidades identificadas en conversaciones anteriores. **No equivale a instalación de todas las skills**. Cada una requiere recuperar su SKILL.md original, validar dependencias y versionado antes de activarse.

| Skill | Identificación | Estado |
|---|---|---|
| SKILL-01 | Curaduría, negocio, inventario, tendencias, narrativa y métricas | Especificación original por recuperar |
| SKILL-02 a SKILL-06 | Conjunto inicial de habilidades (nombres y textos completos por recuperar) | Pendientes de identificación documental |
| SKILL-07 | Triangulación internacional Honduras–EE. UU.–China y otros orígenes | Especificación original por recuperar |
| Negociación | Proveedores, compras y acuerdos | Numeración y especificación por recuperar |
| UI Design | Sistema de interfaz | Numeración y especificación por recuperar |
| UX Design | Experiencia de usuario | Numeración y especificación por recuperar |
| Web Design | Diseño web responsive, accesible y escalable | Documento previo por recuperar |
| SKILL-11 | C++ Tricks & Techniques | Especificación original por recuperar |
| SKILL-12 | MR עדולם Web Architecture & Design | Paquete v1.0.0 previo por recuperar y validar |
| SKILL-LOM-001 | Auditoría, investigación y trazabilidad | v1.0.0 incorporada en este PR |

## Reglas de integración
- Fuente canónica: `skills/<skill-id>/SKILL.md`; mantener `VERSION` y `CHANGELOG.md`.
- No asignar números definitivos ni inventar instrucciones ausentes.
- Recuperar artefactos originales, contrastar con arquitectura vigente y validar cada skill antes de declararla instalada.
- `AGENTS.md` y `CLAUDE.md` apuntan a este índice; no duplicar las especificaciones.
- Proteger secretos, datos personales y producción. Integrar por PR y pruebas.
