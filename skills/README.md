# Catálogo maestro de habilidades — MR עדולם

Reconstrucción operativa a partir de contexto histórico recuperado el 2026-10-11. Los textos de las skills marcadas como reconstruidas **no son copias verificadas de los documentos originales**. Versión 0.1.0 de reconstrucción, pendiente de cotejo con originales; no confundir con versiones históricas declaradas.

| Identificador | Habilidad | Estado |
|---|---|---|
| 01 | [Criterio Curatorial](skill-01/SKILL.md) | Borrador reconstruido; original pendiente |
| 02 | [Fundamentos de Negocio](skill-02/SKILL.md) | Borrador reconstruido; original pendiente |
| 03 | [Gestión de Inventario](skill-03/SKILL.md) | Borrador reconstruido; original pendiente |
| 04 | [Análisis de Tendencias](skill-04/SKILL.md) | Borrador reconstruido; original pendiente |
| 05 | [Storytelling de Marca](skill-05/SKILL.md) | Borrador reconstruido; original pendiente |
| 06 | [Métricas y Toma de Decisiones](skill-06/SKILL.md) | Borrador reconstruido; original pendiente |
| 07 | [Triangulación Internacional](skill-07/SKILL.md) | Borrador reconstruido; original pendiente |
| 08 | [Negociación](skill-08/SKILL.md) | Borrador reconstruido; original pendiente |
| 09 | [UI Design](skill-09/SKILL.md) | Borrador reconstruido; original pendiente |
| 10 | [UX Design](skill-10/SKILL.md) | Borrador reconstruido; original pendiente |
| 11 | [C++ Tricks & Techniques](skill-11/SKILL.md) | Borrador reconstruido; original pendiente |
| 12 | [Web Architecture & Design](skill-12/SKILL.md) | Texto original restaurado; paquete ZIP complementario pendiente |
| web-design | [Web Design](web-design/SKILL.md) | Texto original restaurado |
| LOM-001 | [Auditoría LOM](skill-lom-001/SKILL.md) | v1.0.0 incorporada en PR |

## Política
No confundir reconstrucción con recuperación literal; cotejar documentos originales antes de promover a estable. Cada skill deberá incorporar VERSION, CHANGELOG, ejemplos y pruebas verificables antes de declararse instalada. AGENTS.md y CLAUDE.md enlazan a este índice.

## Originales localizados y cotejo (2026-10-11)

- **Web Design:** original íntegro en [`docs/skills/MR_Adulam_Skill_Web_Design.md`](../docs/skills/MR_Adulam_Skill_Web_Design.md), importado como texto exacto según manifiesto. Copia completa restaurada en `skills/web-design/SKILL.md`; el documento histórico permanece en `docs/skills/`.
- **SKILL-12:** original íntegro `SKILL.md` en [`docs/skills/SKILL.md`](../docs/skills/SKILL.md), con versión declarada 1.0.0. La copia restaurada conserva `RM עדולם` en partes, en conflicto con la regla vigente `MR עדולם`; conservar original y documentar corrección por versión, no reescribir su historia.
- **SKILL-12 paquete ZIP:** `SKILL-12-RM-Web-Architecture-Design.zip` aparece en [`docs/import/PROJECT_LIBRARY_MANIFEST.md`](../docs/import/PROJECT_LIBRARY_MANIFEST.md) como binario pendiente; no afirmar que sus archivos complementarios estén recuperados.
- **LOM:** paquete original `SKILL.md` disponible como adjunto de conversación; versión 1.0.0. Verificar diferencias frente a la versión de GitHub antes de considerarlos idénticos.
- **SKILL-01, 02 y 03:** aún no se han verificado textos originales íntegros accesibles para importación.
- **Otras skills:** no se ha localizado un original íntegro verificable; mantener borradores diferenciados.

**Regla de precedencia:** preservar originales íntegros como fuentes históricas, y producir nuevas versiones normalizadas en lugar de sobreescribirlos. Nunca presentar un borrador reconstruido como copia exacta.

## Verificación del paquete ZIP — 2026-10-11

La biblioteca del proyecto contiene `/Boutique/SKILL-12-RM-Web-Architecture-Design.zip` (11.039 bytes). Se intentó materializar el archivo original, pero el sistema devolvió: `This Project file does not have an authorized raw-byte materialization path.` Por tanto, **el ZIP no está recuperado ni publicado**; se necesita acceso autorizado al binario para cotejar `references/`, `templates/` y `checklists/`. Los dos documentos de texto originales sí están restaurados en `skills/skill-12/SKILL.md` y `skills/web-design/SKILL.md` dentro de esta rama.
