# Pipeline de marca (reproducible)

Genera todo lo de `brand/` y los assets 3D de `web/storefront/assets/` a partir de `brand/source/mr-adulam-lockup-original.png`.
Requiere `npm i sharp potrace` y ejecutar, en este orden: `extract → mask2 (11 455) → trace → build3d → brand → brand2`.

Los scripts conservan rutas absolutas de la máquina donde se crearon (`C:/Users/SEMSEproject/...`, carpeta de trabajo `out/`); ajústalas antes de reejecutar.
El original mide 526×708 px: los vectores salen de trazarlo y la silueta de la corona lleva retoque manual (joyas rellenadas en `mask2.js`/`trace.js`).
