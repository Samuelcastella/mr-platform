---
name: rm-web-architecture-design
description: Diseñar, construir, revisar y evolucionar la plataforma web de RM עדולם como un ecosistema de comercio digital escalable. Usar para arquitectura web, UX, UI, e-commerce, catálogo, producto, búsqueda, carrito, checkout, cuenta, administración, internacionalización, integraciones y handoff a otros agentes o desarrolladores.
version: 1.0.0
code: SKILL-12
---

# SKILL-12 — RM עדולם Web Architecture & Design

## 1. Propósito

Esta skill define cómo diseñar, construir, revisar y evolucionar la plataforma web de **RM עדולם**.

Debe permitir que cualquier agente, diseñador, desarrollador o equipo pueda trabajar sobre la plataforma sin depender de una conversación previa y sin perder decisiones de marca, arquitectura, UX, UI, e-commerce o escalabilidad.

La plataforma NO debe construirse como una tienda limitada a una sola categoría. Debe funcionar como una base comercial extensible para múltiples categorías, proveedores, países, monedas, idiomas, canales e integraciones.

## 2. Regla de marca innegociable

- Nombre visible de la marca: **RM עדולם**.
- La palabra **עדולם** se escribe únicamente en hebreo.
- No utilizar una transliteración latina de עדולם en interfaces, documentación visible, prompts, ejemplos o contenido de marca.
- La identidad no debe quedar asociada exclusivamente a moda, cosméticos, ropa u otra categoría.
- No utilizar slogans que encasillen la marca en un solo nicho.

## 3. Filosofía de diseño

Inspirarse en patrones de comercio electrónico maduros sin copiar identidades visuales, layouts propietarios ni activos de terceros.

Fuentes de criterio:
- Amazon: búsqueda, descubrimiento, ficha de producto, confianza, recomendaciones y conversión.
- Alibaba: catálogo amplio, filtros, proveedores, variantes comerciales, escalabilidad y futura capacidad B2B.
- Walmart: simplicidad operativa, promociones claras, disponibilidad, entrega y experiencia omnicanal.
- RM עדולם: identidad propia, reglas de marca, contexto comercial y estrategia de largo plazo.

Regla: tomar el principio, no copiar la apariencia.

## 4. Principios obligatorios

1. Mobile-first.
2. Responsive por diseño, no por parche.
3. Componentes reutilizables.
4. Separación clara de dominios y capas.
5. Accesibilidad WCAG como criterio de aceptación.
6. Rendimiento web medible.
7. SEO técnico desde la arquitectura.
8. Internacionalización preparada desde el modelo de datos.
9. Integraciones desacopladas mediante interfaces/adapters.
10. Datos reales diferenciados de placeholders.
11. Cero dark patterns.
12. Seguridad y privacidad por diseño.
13. Observabilidad y analítica preparada.
14. Spec-Driven Development obligatorio para módulos relevantes.

## 5. Arquitectura por capas

Diseñar y evaluar la solución por estas capas:

1. Brand System
2. Design Tokens
3. UI Components
4. Page Composition
5. UX Flows
6. Frontend Application
7. Backend/API
8. Domain Services
9. Persistence/Data
10. Integrations
11. Admin/Operations
12. Analytics/Observability

No mezclar lógica de inventario, pedidos, pagos o logística directamente dentro de componentes visuales.

## 6. Dominios de negocio mínimos

- Catálogo
- Productos
- Categorías
- Colecciones
- Precios
- Promociones
- Inventario
- Clientes
- Direcciones
- Carrito
- Checkout
- Pedidos
- Pagos
- Entregas
- Proveedores
- Contenido
- Usuarios administrativos
- Roles y permisos

Preparar extensión futura para:
- Marketplace
- Vendedores externos
- Afiliados
- B2B
- Multi-país
- Multi-moneda
- Multi-idioma
- Impuestos por jurisdicción
- Logística internacional
- Aplicaciones móviles

## 7. Páginas y módulos iniciales

- Home
- Búsqueda
- Catálogo
- Categoría
- Colección
- Producto
- Carrito
- Checkout
- Cuenta
- Direcciones
- Pedidos
- Seguimiento
- Contacto/Soporte
- Nosotros
- Administración

Consultar `references/page-blueprints.md` para composición y estados.

## 8. Sistema de componentes

Todo componente deberá tener:
- propósito,
- variantes,
- estados,
- datos de entrada,
- comportamiento responsive,
- accesibilidad,
- loading,
- empty state,
- error state,
- analytics events cuando aplique.

Componentes base:
- Header
- Navigation / Mega Menu
- Search
- Hero
- Category Card
- Product Card
- Product Gallery
- Price Block
- Badge
- Variant Selector
- Quantity Selector
- Availability
- Promotion
- Recommendation Rail
- Cart Item
- Checkout Step
- Address Card
- Payment Method
- Delivery Option
- Order Status
- Breadcrumbs
- Filters
- Sort
- Pagination / Infinite Loading
- Drawer
- Modal
- Toast
- Form Fields

Consultar `references/component-system.md`.

## 9. Flujo SDD obligatorio

Para cada módulo importante:

1. Contexto
2. Objetivo
3. Problema
4. Alcance
5. Fuera de alcance
6. Requisitos funcionales
7. Requisitos no funcionales
8. Estados y casos límite
9. Datos y contratos
10. Componentes
11. Flujos UX
12. Criterios de aceptación
13. Implementación
14. Pruebas
15. Validación visual
16. Métricas
17. Documentación de decisiones

Usar `templates/module-spec.md`.

## 10. Reglas de implementación

- No inventar productos, precios, direcciones, políticas, teléfonos, inventario, reviews ni métodos de pago reales.
- Los datos ficticios deben marcarse claramente como placeholder/demo.
- No codificar categorías como lista permanente.
- No codificar países, monedas o proveedores como restricciones arquitectónicas.
- No acoplar la UI a un proveedor de pagos específico.
- No acoplar logística a una sola empresa.
- No implementar integraciones simuladas como si estuvieran activas.
- Evitar dependencias innecesarias.
- Documentar decisiones estructurales relevantes.

## 11. Reglas de UX

- Priorizar claridad, confianza y velocidad de decisión.
- Búsqueda accesible desde cualquier pantalla comercial importante.
- Los filtros deben ser comprensibles, reversibles y preservar contexto.
- Las fichas de producto deben responder rápidamente: qué es, cuánto cuesta, qué variantes existen, si está disponible y cómo se entrega.
- El checkout debe reducir fricción sin ocultar información.
- Evitar urgencia ficticia, stock falso, timers engañosos, opt-outs ocultos o patrones manipulativos.

## 12. Reglas de UI

- Crear sistema de tokens para color, tipografía, espacio, radios, elevación, motion y breakpoints.
- Mantener consistencia en densidad y jerarquía.
- El diseño debe ser reconocible como RM עדולם, no como una copia visual de Amazon, Alibaba o Walmart.
- Mantener contraste accesible.
- Diseñar estados hover, focus, active, disabled, selected, loading, success, warning y error.
- Las interfaces administrativas pueden tener mayor densidad que el storefront, pero deben compartir fundamentos del sistema.

## 13. Internacionalización

La operación inicial puede comenzar en Honduras, pero la arquitectura debe permitir:
- países múltiples,
- monedas múltiples,
- idiomas múltiples,
- impuestos configurables,
- proveedores internacionales,
- reglas de entrega por región,
- unidades y formatos locales,
- zonas horarias.

Los proveedores pueden provenir de múltiples países.

## 14. Handoff

Cuando otro agente o persona tome el proyecto:
1. Leer esta skill.
2. Leer `references/brand-rules.md`.
3. Leer la especificación del módulo correspondiente.
4. Revisar decisiones existentes antes de proponer cambios.
5. No romper contratos o componentes sin documentar migración.
6. Entregar decisiones, criterios de aceptación, código y evidencia de validación.

## 15. Definición de terminado

Un módulo no está terminado solo porque “se ve bien”.

Debe:
- cumplir requisitos funcionales,
- pasar criterios de aceptación,
- funcionar en móvil y desktop,
- cubrir estados vacíos/error/loading,
- ser accesible,
- no introducir regresiones obvias,
- tener rendimiento razonable,
- manejar datos reales o placeholders identificados,
- mantener coherencia de marca,
- documentar decisiones relevantes.

Usar `checklists/definition-of-done.md`.

## 16. Orden recomendado de trabajo

1. Fundamentos de marca y tokens
2. Shell global
3. Home
4. Catálogo y búsqueda
5. Producto
6. Carrito
7. Checkout
8. Cuenta y pedidos
9. Administración
10. Integraciones
11. Internacionalización avanzada
12. Marketplace/B2B cuando el negocio lo requiera