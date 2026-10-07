# MR עדולם

Plataforma comercial de MR עדולם (Honduras): storefront web, API de catálogo y sistema de marca.

## Estructura

| Ruta | Qué es | Despliegue |
|---|---|---|
| `web/storefront/` | Storefront SPA (HTML + JS sin build) con corona 3D en three.js | Railway `storefront` ← rama `main`, root `web/storefront`, `npm start` |
| `services/catalog-api/` | API de catálogo (Bun + Postgres): `/health`, `/v1/products` | Railway `catalog-api` (hoy como *Function* con este mismo código) |
| `brand/` | Pack de marca: SVG/PNG (tinta, crema, oro), iconos y splash de app, original y pipeline | — |
| `web/legacy/` | Dashboard operativo antiguo (HTML estático) | no desplegado |
| `docs/` | Arquitectura, blueprint, investigación, skills y manifiesto de importación | — |

## Producción (Railway, proyecto «MR עדולם», entorno `production`)

- Storefront: https://storefront-production-e7b5.up.railway.app/
- Catalog API: https://catalog-api-production-cc18.up.railway.app/
- Postgres: servicio `Postgres` (credenciales solo en variables de Railway; nunca en el repo).

Inventario completo y pendientes en [`docs/ops/RAILWAY.md`](docs/ops/RAILWAY.md).

## Flujo

1. Cambios en una rama → PR a `main`.
2. Al fusionar, Railway despliega `storefront` automáticamente.
3. `catalog-api` aún se despliega pegando `services/catalog-api/index.ts` en la Function; ver pendientes.

## Desarrollo local

```bash
cd web/storefront && npm start   # http://localhost:3000
```

## Calidad

- `cd web/storefront && npm test`: prueba de humo (rutas, assets, manifest PWA, compresión, ETag, cabeceras, path traversal, sintaxis del script). Corre en CI (GitHub Actions) en cada PR y push a `main`.
- Servidor: gzip/brotli, ETag, cabeceras de seguridad y CSP, solo GET/HEAD, assets confinados a `/assets`.
- SEO y compartir: meta description, Open Graph/Twitter card (`og-image.jpg`), `robots.txt`. Las URLs absolutas de OG apuntan al dominio de Railway; actualizar al activar el dominio propio.
- Instalable (PWA): `manifest.webmanifest` con iconos 192/512 y maskable.

## Marca

- Nombre visible: **MR עדולם**; עדולם solo en hebreo, sin transliteración latina.
- Logo, corona, monograma y wordmark en `brand/svg` y `brand/png`; iconos de app en `brand/app`.
- La corona 3D del hero se arrastra para girar (doble clic = giro completo); si WebGL falla, se muestra la imagen plana.
