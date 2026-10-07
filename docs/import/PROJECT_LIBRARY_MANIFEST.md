# MR עדולם — Project Library Import Manifest

Repository: `Samuelcastella/mr-platform`  
Library snapshot: 2026-10-07  
Boutique library files discovered: **54**

This is the migration ledger for the files currently visible under `/Boutique` in the Project Library.

## Status legend

- **Imported exact text** — original UTF-8 source was committed to GitHub.
- **Content extracted** — the original DOCX remains binary, but its readable content was committed as Markdown for version control.
- **Binary original pending** — exact binary bytes remain preserved in the Project Library; the current connector path cannot hand those raw bytes directly to GitHub without altering/reconstructing them.

| Library file | MIME type | Size | Git status |
|---|---|---:|---|
| 4DE433C7-B240-4E4A-8F20-E33E6D815246.png | image/png | 395936 | Binary original pending |
| A3610F56-7209-495D-B341-1BB31ED3F2C8(1).jpeg | image/jpeg | 503747 | Binary original pending |
| A3610F56-7209-495D-B341-1BB31ED3F2C8(2).jpeg | image/jpeg | 503747 | Binary original pending |
| A3610F56-7209-495D-B341-1BB31ED3F2C8.jpeg | image/jpeg | 503747 | Binary original pending |
| boutique-project-foundation-v0.1.zip | application/zip | 5484 | Binary original pending |
| boutique-project-foundation-v0.2.zip | application/zip | 12270 | Binary original pending |
| boutique-project-foundation-v0.3.zip | application/zip | 13965 | Binary original pending |
| boutique-project-foundation-v0.4.zip | application/zip | 16988 | Binary original pending |
| chart-1(1).png | image/png | 121058 | Binary original pending |
| chart-1(2).png | image/png | 99300 | Binary original pending |
| chart-1.png | image/png | 1764806 | Binary original pending |
| Collage UI de MR Adulam.png | image/png | 1621445 | Binary original pending |
| crown_approved_clean.png | image/png | 1024641 | Binary original pending |
| crown_approved_transparent.png | image/png | 1168928 | Binary original pending |
| crown_asset.png | image/png | 56515 | Binary original pending |
| crown_crop_try.png | image/png | 83379 | Binary original pending |
| crown_exact_crop.png | image/png | 83819 | Binary original pending |
| crown_exact_transparent.png | image/png | 85859 | Binary original pending |
| crown_exact_transparent2.png | image/png | 85349 | Binary original pending |
| crown_raw.png | image/png | 83269 | Binary original pending |
| crown_ref.png | image/png | 92165 | Binary original pending |
| crown_transparent.png | image/png | 87074 | Binary original pending |
| Elegante tienda MR en dorado y negro.png | image/png | 2411641 | Binary original pending |
| Emblema Real Dorado con Corona y Monograma MR.png | image/png | 2684463 | Binary original pending |
| Identidad de Lujo MR Adulam.png | image/png | 2644509 | Binary original pending |
| index.html | text/html | 5311 | Imported exact text → `web/legacy/index.html` |
| Lumière Boutique: Moda Sin Fronteras.png | image/png | 1562619 | Binary original pending |
| Mockup integral de tienda online elegante.png | image/png | 1840959 | Binary original pending |
| mono_asset.png | image/png | 56768 | Binary original pending |
| mono_crop_try.png | image/png | 85081 | Binary original pending |
| mono_exact_crop.png | image/png | 87115 | Binary original pending |
| mono_exact_transparent.png | image/png | 88458 | Binary original pending |
| mono_exact_transparent2.png | image/png | 87929 | Binary original pending |
| mono_exact_transparent3.png | image/png | 75774 | Binary original pending |
| mono_raw.png | image/png | 99306 | Binary original pending |
| mono_ref.png | image/png | 92607 | Binary original pending |
| monogram_exact_clean.png | image/png | 78872 | Binary original pending |
| monogram_original_transparent.png | image/png | 94324 | Binary original pending |
| monogram_transparent.png | image/png | 105690 | Binary original pending |
| mr_adulam_app_mvp.tar.gz | application/x-tar | 5219 | Binary original pending |
| mr_adulam_site_preview.zip | application/zip | 2009 | Binary original pending |
| MR_Adulam_Skill_Web_Design.md | text/markdown | 5228 | Imported exact text → `docs/skills/MR_Adulam_Skill_Web_Design.md` |
| MR_עדולם_Arquitectura_Maestra_v1.0.docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | 39622 | Content extracted → `docs/architecture/MR_עדולם_Arquitectura_Maestra_v1.0.md` |
| MR_עדולם_Blueprint_v2.0.docx | application/vnd.openxmlformats-officedocument.wordprocessingml.document | 46064 | Content extracted → `docs/architecture/MR_עדולם_Blueprint_v2.0.md` |
| Página moderna de ecommerce RM עדולם.png | image/png | 1871830 | Binary original pending |
| README.md | text/markdown | 1582 | Imported exact text → `README.md` |
| rm-adulam-home-v1.zip | application/zip | 12838 | Binary original pending |
| rm-adulam-storefront-v0.2.zip | application/zip | 23172 | Binary original pending |
| RM-ADULAM-Storefront-v0.3(1).zip | application/zip | 26084 | Binary original pending |
| RM-ADULAM-Storefront-v0.3-REDOWNLOAD.zip | application/zip | 26084 | Binary original pending |
| rm-adulam-storefront-v0.3.zip | application/zip | 26084 | Binary original pending |
| SKILL-12-RM-Web-Architecture-Design.zip | application/zip | 11039 | Binary original pending |
| SKILL.md | text/markdown | 8345 | Imported exact text → `docs/skills/SKILL.md` |
| Tablero de Identidad de Lujo MR Adalam.png | image/png | 2103532 | Binary original pending |

## Additional project knowledge imported

- `docs/research/Resumen_Ejecutivo.md` — full readable research report from the Project Library root.

## Migration policy

GitHub is the source of truth for code and diff-friendly documentation. We do **not** silently re-encode, recompress, or regenerate binary originals and pretend they are the same file. Pending binaries stay traceable here until an exact raw-byte transfer path is available.
