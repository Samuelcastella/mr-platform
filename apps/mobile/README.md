# MR עדולם — Mobile

Esqueleto móvil de MR עדולם en Expo/React Native.

## Estado

- Expo SDK 57 estable.
- React Native 0.86.
- Icono iOS/Android y adaptive icon conectados desde el pack de marca existente.
- Splash configurado con `expo-splash-screen`.
- Catálogo conectado a `catalog-api /v1/products?status=active`.
- Detalle de producto y selección exacta de variante.
- Carrito móvil en memoria con límite por disponibilidad visible.
- Creación nativa de reservas de Order con `channel=APP` e idempotencia.
- Continuación por WhatsApp configurable o storefront; checkout/pago nativo queda para una fase posterior.

## Requisitos

- Node.js 22.13 o superior.
- npm.

Expo SDK 57 requiere Node 22.13.x como mínimo:
https://docs.expo.dev/versions/latest/

## Ejecutar

```bash
cd apps/mobile
npm install
npm start
```

Para Android/iOS:

```bash
npm run android
npm run ios
```

## Configuración pública

Copia `.env.example` a `.env.local` si necesitas apuntar a otro entorno.

```env
EXPO_PUBLIC_API_BASE_URL=https://...
EXPO_PUBLIC_STOREFRONT_URL=https://...
EXPO_PUBLIC_WHATSAPP_URL=https://wa.me/...
```

Las variables `EXPO_PUBLIC_*` se empaquetan en la app. Nunca deben contener secretos.

## Splash

La configuración usa el plugin recomendado `expo-splash-screen`. Expo recomienda validar el splash real con un preview/production build, no con Expo Go.

Referencia:
https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/

## Assets

Los archivos en `apps/mobile/assets/` son copias exactas de los assets canónicos de `brand/app/`. El pack de marca sigue siendo la fuente visual principal.
