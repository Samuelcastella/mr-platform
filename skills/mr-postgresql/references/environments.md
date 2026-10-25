# Entornos, conexiones y seguridad

| Entorno | Datos y aislamiento | Comprobación |
|---|---|---|
| Local | Base propia con fixtures DEMO | Arranque y migraciones reproducibles |
| Desarrollo | Base y credenciales independientes | Integración entre módulos |
| Test / CI | Instancia efímera por job o base exclusiva | Migraciones reales y pruebas automatizadas |
| Preview | Instancia/base exclusiva por rama | Aislamiento y caducidad de recursos |
| Staging | Topología similar a producción, datos sintéticos o autorizados anonimizados | Ensayo de despliegue y recuperación |
| Producción | Datos reales, roles mínimos, respaldo verificado | Cambios trazables y monitoreo |

Compartir servidor no equivale a aislamiento de recursos. Un schema por test solo es suficiente si search_path, extensiones, secuencias y permisos están controlados; preferir base/instancia independiente para pruebas de infraestructura. No deducir el entorno del nombre de la base o de APP_ENV solamente.

## Configuración

- Inventariar variables existentes; usar DATABASE_URL como convención solo si el proyecto la usa. Guardar secretos en el gestor del entorno, no en ejemplos con valores reales.
- Registrar un manifiesto sin secretos con entorno, servicio/proyecto, host esperado, base, rol y versión. Compararlo con la conexión real antes de mutaciones. Identificar explícitamente réplicas de lectura.
- Separar rol propietario/migrador del rol de aplicación y rol de reportes. Aplicar GRANT mínimos a schemas, tablas y secuencias; configurar privilegios por defecto para el rol creador efectivo. No dar superuser al runtime.
- Fijar search_path seguro, revisar permisos CREATE y evitar SECURITY DEFINER sin necesidad y revisión explícita.
- Usar TLS y verificación de certificado/hostname en conexiones remotas según el cliente y proveedor. No solucionar errores desactivando verificación.
- Presupuestar conexiones sumando réplicas de API, workers, jobs y migrador; reservar capacidad operativa. Configurar pool y timeouts según carga medida.
- Comprobar compatibilidad del pooler con prepared statements, locks de sesión y estado de sesión. No asumir persistencia de sesión con transaction pooling.
- Fijar versión mayor compatible entre test y producción; pin de imagen/patch según política y revisión de seguridad. No usar latest en CI reproducible.

## CI y promoción

1. Levantar PostgreSQL efímero y esperar readiness real con plazo máximo.
2. Aplicar migraciones con el ejecutor real y ejecutar fixtures DEMO.
3. Ejecutar pruebas de contratos SQL/API, concurrencia y permisos con roles correspondientes.
4. Crear esquema de la versión anterior y comprobar ruta de actualización con datos representativos.
5. Guardar resultados redactados; eliminar recursos efímeros al finalizar incluso ante error.
6. Promover el mismo artefacto probado, con configuración y secretos propios de cada entorno.

Para Railway u otro proveedor, inspeccionar primero servicios, configuración y capacidades reales. Usar la skill del proveedor al operar infraestructura; no inventar backups, PITR, entornos existentes ni acceso al proyecto.
