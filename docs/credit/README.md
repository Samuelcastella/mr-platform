# Crédito — comparador y simulador (primera entrega)

El cálculo de amortización se implementa en `services/catalog-api/credit-calculator.ts`.
Utiliza cuota fija sobre saldo insoluto, redondeo a centavos por período y ajuste final de capital.
La tasa de entrada es nominal anual, expresada como porcentaje. No equivale a una tasa efectiva anual.

## Contrato propuesto
`POST /v1/credit/simulate` con `{amount,downPayment,annualRate,months,monthlyFee?}`.
Respuesta: `currency, financed, downPayment, monthlyPaymentEstimate, totalInterest, totalFees, totalPayable, schedule`.

**Importante:** el endpoint aún no está conectado a `index.ts`. La primera entrega mantiene
el cálculo independiente para permitir revisión y pruebas sin modificar producción.

## Comparador pendiente
Crear tabla de proveedores y planes con fuente, fecha de verificación, vigencia, límites,
costos y requisitos. Nunca publicar tasas o condiciones no verificadas como ofertas reales.
Comparar costo total y tasa efectiva (incluyendo seguros y comisiones), no solo cuotas.
Agregar consentimiento y controles de privacidad antes de almacenar solicitudes de clientes.

## Pruebas
`cd services/catalog-api && bun test credit-calculator.test.ts`.
Pendiente: validación de API, persistencia PostgreSQL, interfaz del storefront y CI.
