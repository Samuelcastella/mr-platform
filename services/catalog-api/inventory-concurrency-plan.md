# Pruebas de concurrencia de inventario

Objetivo: simular 50 solicitudes simultáneas para una única unidad disponible en una base de datos de pruebas aislada.

Criterios de aceptación:
- Exactamente una reserva exitosa.
- Cuarenta y nueve rechazos por falta de existencias.
- Inventario físico igual a 1, reservado igual a 1 y disponible igual a 0.
- No se crean ventas con pagos pendientes ni se reactivan reservas vencidas.
- Liberaciones y movimientos Kardex idempotentes.

No ejecutar sobre producción.
