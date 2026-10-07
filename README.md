# RM עדולם — Storefront v0.3

Demo navegable y persistente del ecosistema web siguiendo SKILL-12.

## Pantallas

- `#/` — Home
- `#/catalog` — Catálogo con búsqueda y filtros
- `#/product/p1` — Ficha de producto
- `#/cart` — Carrito persistente
- `#/checkout` — Checkout demo que crea pedidos
- `#/account` — Cuenta
- `#/orders` — Pedidos persistentes
- `#/marketplace` — Marketplace + P2P
- `#/admin` — Control Center con datos simulados

## Backend simulado

Esta versión añade una capa de datos local que funciona sin servidor:

- carrito persistente con `localStorage`
- pedidos persistentes
- checkout demo que genera ID de pedido
- inventario simulado por ubicación
- proveedores simulados de varios países
- publicaciones Marketplace/P2P
- KPIs administrativos derivados de esos datos

Nada de esto realiza cobros ni representa datos comerciales reales.

## Ejecutar

```bash
npm install
npm run dev
```

## Construir

```bash
npm run build
```

## Estado

- Estructura del proyecto: generada.
- Navegación SPA: implementada.
- Persistencia local demo: implementada.
- Flujo producto → carrito → checkout → pedido → panel: implementado.
- Backend real/API/base de datos: todavía no implementado.
- Compilación React/Vite: requiere instalar las dependencias del `package.json`.

## Próxima etapa

1. Reemplazar `demoStore` por una API real.
2. Añadir base de datos.
3. Autenticación y roles.
4. Inventario multiubicación real.
5. Proveedores y órdenes de compra.
6. Pagos reales.
7. Logística.
8. Marketplace/P2P transaccional.