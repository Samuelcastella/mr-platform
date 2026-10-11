# Crédito — comparador y simulador (entrega incremental)

## Implementado en la rama de trabajo
- `credit-calculator.ts`: amortización en HNL con tasa nominal anual, prima y cargos mensuales.
- `credit-routes.ts`: `POST /v1/credit/simulate` conectado en `index.ts`, con validación de JSON.
- `credit-comparator.ts`: comparación por costo total solo cuando las condiciones tienen fuente y fecha de verificación.
- Pruebas unitarias y de contrato en `*.test.ts`.

Ejemplo de solicitud:
```json
{"amount":15000,"downPayment":0,"annualRate":24,"months":12,"monthlyFee":0}
```

El resultado es **ilustrativo** y no constituye aprobación, cotización contractual ni asesoramiento crediticio. La tasa nominal anual no equivale a la tasa efectiva; para comparaciones comerciales finales hay que integrar comisiones, seguros, cargos iniciales, impuestos y fechas de pago.

## Ejecutar pruebas
`cd services/catalog-api && bun test credit-calculator.test.ts credit-routes.test.ts credit-comparator.test.ts`

## Pendientes
- Ejecutar pruebas en CI; verificar manejo de redondeo y límites de centavos.
- Crear persistencia PostgreSQL de proveedores, planes y fuentes verificadas, con historial de vigencia.
- Exponer planes verificables mediante API y conectar la interfaz del storefront.
- Implementar cálculo de tasa efectiva y desglose completo de cargos.
- Añadir protección contra abuso, observabilidad y políticas de datos antes de aceptar solicitudes personales.
- Validar el flujo de despliegue Railway; no publicar cambios hasta revisar el PR.
