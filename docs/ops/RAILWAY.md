# Railway — inventario (proyecto «MR עדולם»)

- Proyecto: `b468db33-8dc5-43b7-a8aa-bced44ee80e5` · entorno `production`: `0be5feeb-f9b0-4f21-9c5d-b1a33e9c42a5`

| Servicio | ID | Origen | Estado |
|---|---|---|---|
| `storefront` | `ac9a59db-2277-42fc-900d-65e9f33411e5` | GitHub `Samuelcastella/mr-platform`, rama `main`, root `web/storefront` (Railpack, `npm start`) | Activo |
| `catalog-api` | `a84c7ffa-dfdd-4bac-a7df-dff0ea43478d` | Function Bun 1.4.0 (código en `services/catalog-api/index.ts`) | Activo |
| `Postgres` | `6b467a0d-6dc3-409a-bdb6-50482d92907c` | Plantilla Postgres | Activo |
| `storefront-preview` | `9de528ca-014b-4436-aa5a-bd320b0bda4e` | Function Bun (HTML incrustado) | **Apagado** (sin despliegue activo); sustituido por `storefront` |

## Pendientes

1. Eliminar el servicio `storefront-preview` (apagado, reemplazado). Acción irreversible: decisión del propietario.
2. Pasar `catalog-api` de Function a servicio desde repo (root `services/catalog-api`); requiere copiar las variables `PG*` y revisar la conexión.
3. Conectar el storefront a `catalog-api` (hoy el catálogo del storefront es de demostración local).
4. Dominio propio para el storefront.
5. Confirmar que Postgres no esté expuesto con proxy TCP público.
