# Railway — inventario (proyecto «MR עדולם»)

- Proyecto: `b468db33-8dc5-43b7-a8aa-bced44ee80e5` · entorno `production`: `0be5feeb-f9b0-4f21-9c5d-b1a33e9c42a5`

| Servicio | ID | Origen | Estado |
|---|---|---|---|
| `storefront` | `ac9a59db-2277-42fc-900d-65e9f33411e5` | GitHub `Samuelcastella/mr-platform`, rama `main`, root `web/storefront` (Railpack, `npm start`); variable `CATALOG_API_URL` → catalog-api | Activo |
| `catalog-api` | `a84c7ffa-dfdd-4bac-a7df-dff0ea43478d` | GitHub `Samuelcastella/mr-platform`, rama `main`, root `services/catalog-api` (`bun run index.ts`); conserva las variables `PG*` | Activo |
| `Postgres` | `6b467a0d-6dc3-409a-bdb6-50482d92907c` | Plantilla Postgres | Activo |
| `storefront-preview` | `9de528ca-014b-4436-aa5a-bd320b0bda4e` | Function Bun (HTML incrustado) | **Apagado** (sin despliegue activo); sustituido por `storefront` |

## Pendientes

1. Borrar el servicio `storefront-preview` (apagado y reemplazado). Irreversible: lo hace el propietario en el panel de Railway.
2. **[PENDIENTE]** Dominio `mr-adulam.com`: agregado en Railway pero sin registrar ni verificar; ver issue con etiqueta `pendiente`.
3. La base de datos del catálogo está vacía: el storefront muestra productos de demostración hasta que `/v1/products?status=active` devuelva datos.
4. Postgres: sin proxy TCP público (verificado 2026-10-07).
