# Auditoría, roadmap y plan técnico de Mi Bolsillo

Estado: propuesta de Fase 0. Rama local: `feat/financial-intelligence`, basada en `origin/main` en `cad67cd` (PR #1 integrado).

## Inventario verificado

| Área | Capacidad actual | Brecha |
| --- | --- | --- |
| Identidad y acceso | Registro e inicio de sesión por credenciales, hash bcrypt, sesión de servidor, proxy que protege el panel y eventos de control de frecuencia. La ruta financiera resuelve al propietario desde la sesión. | La búsqueda de identidad por correo requiere reevaluación si se introduce reasignación del correo. Antes de añadir exportaciones se deben verificar límites, caché y manejo de errores. |
| Movimientos y categorías | Alta, edición y borrado, ingresos/gastos, fecha civil, categoría y filtros de propiedad en el servicio. Escritura y resolución de categoría en una transacción, con bloqueo por propietario y tipo. | Sin reglas recurrentes, búsqueda avanzada, cuentas, tarjetas ni reportes multirrango. El esquema aún no impone unicidad de categorías. |
| Panel financiero | Consulta de un mes, saldo anterior, ingresos, egresos, ahorro de metas, balance, presupuesto, distribución de gastos y metas. Carga, fallo y reintento, y control de respuestas desordenadas. | Sin comparación entre meses, series, indicadores nuevos ni filtro de categoría aplicado a analítica. El cliente concentra estado, mutaciones, vistas y formularios. |
| Presupuesto | Un presupuesto general por período en la lógica del servicio. Los guardados se serializan por propietario. | Sigue pendiente `UNIQUE (user_id, year, month)`. Duplicados previos se leen con desempate determinista y bloquean el guardado. Sin presupuestos por categoría ni alertas. |
| Metas | Creación, aportes parciales, progreso y borrado. Saldo y asiento atómicos, con bloqueo de meta. | La columna de fecha objetivo existe, pero el flujo actual no la usa. Faltan ritmo requerido, proyecciones y simulación. |
| Datos y API | Tablas de usuarios, categorías, movimientos, metas, aportes, presupuestos y eventos de frecuencia. `/api/finance` tiene GET, POST, PATCH y DELETE. | Sin endpoints de reportes/descargas, cuentas/deudas, calendario, proyecciones ni PWA. Las relaciones existentes no sustituyen los filtros de propietario en las consultas. |
| Pruebas | Pruebas monetarias, de formato/UI, de PostgreSQL y de aislamiento en `scripts/`. Los scripts dependen de Node y de un PostgreSQL local aislado cuando corresponde. | Hace falta cobertura reproducible de endpoints analíticos, reconciliación de exportaciones y E2E de los nuevos flujos. |

Referencias: `db/schema.ts`, `drizzle/meta/_journal.json`, `auth.ts`, `auth.config.ts`, `proxy.ts`, `lib/auth/current-user.ts`, `app/api/finance/route.ts`, `features/finance/`, `app/dashboard/`, `scripts/`.

## Roadmap

| Etapa | Prioridad y complejidad | Dependencias | Datos y migraciones previstas |
| --- | --- | --- | --- |
| 0. Auditoría | P0 · media | Base y PR financiero verificados | Inventario de esquema y diseño de preflight de presupuestos. Ninguna ejecución en esta fase. |
| 1. Inteligencia financiera | P1 · media para dashboard, alta para exportaciones | Definiciones de métricas, filtros y límites. Los formatos comparten fuente y contrato. | Sin cambios de esquema para el primer incremento. Proponer índices solo tras medir consultas y solicitar aprobación. |
| 2. Automatización y presupuestos | P1 · alta | Períodos, centavos e identidad. Definir ejecutor, idempotencia, días inexistentes y canales de aviso. | Tablas aditivas para reglas y ocurrencias, alertas y presupuesto por categoría. Restricciones de idempotencia y unicidad con preflight. Revisar por separado la unicidad general pendiente. |
| 3. Cuentas, tarjetas y deudas | P2 · alta | Definir clasificación de transferencias, doble contabilización e impacto en reportes y movimientos existentes. | Modelos aditivos de cuentas, transferencias, deudas, cargos y pagos. Toda asignación de movimientos históricos requiere decisión explícita. |
| 4. Ahorro y proyecciones | P2 · alta | Metas actuales, recurrencias, obligaciones y reglas de saldo. Separar reales, programados y estimados. | Evaluar uso de fecha objetivo existente y persistencia de preferencias. Evitar guardar proyecciones que puedan calcularse con datos vigentes. |
| 5. Experiencia y PWA | P2 · media/alta | Mantener accesibilidad y responsive desde Etapa 1. PWA depende de decidir política de caché y sesión. | Búsqueda puede requerir índices medidos. PWA cachea recursos públicos solamente y excluye rutas autenticadas y exportaciones. |

## Plan de implementación de Etapa 1

| Tarea | Responsable y archivos previstos | Dependencia y criterio |
| --- | --- | --- |
| E1-T01 Períodos y contrato analítico | Backend en `features/finance/analytics/period.ts`, `analytics.schema.ts` y `analytics.types.ts`. Reusar calendario y dinero actuales. | Decisiones sobre horizonte y filtros. E1-D01 a D05, E1-R01. |
| E1-T02 Servicio de series | Backend en `features/finance/analytics/analytics.service.ts` y nuevo `app/api/finance/analytics/route.ts`. Agrupar por período y propietario con consultas parametrizadas; separar movimientos y aportes antes de combinarlos. | T01. E1-D01 a D05, E1-R04. |
| E1-T03 Vista de inteligencia | Frontend en componentes nuevos bajo `app/dashboard/`; integrar en `dashboard-client.tsx` en un cambio de un solo responsable. Usar gráficos accesibles de barras/líneas y reutilizar distribución y patrones de carga existentes. | Contrato T01. Puede hacerse con fixtures en paralelo con T02. E1-D01 a D06. |
| E1-T04 Consulta de reportes | Backend en `features/finance/reports/` y nuevo `app/api/finance/reports/route.ts`. Compartir selección y lógica de totales con los exportadores. Frontend añade la vista en `app/dashboard/reports/` si se confirma la navegación. | T01, definiciones de rangos y filtros. E1-R01, R02, R04, R05. |
| E1-T05 Exportaciones por formato | Backend en `features/finance/reports/` y nuevo `app/api/finance/reports/export/route.ts`. Entregar CSV primero. Excel y PDF quedan sujetos a revisión técnica y aprobación de dependencias si fueran necesarias. | T04 y política de límites. E1-R02 a R05. |
| E1-T06 Evidencia y revisión | QA en pruebas nuevas específicas bajo `scripts/` y reportes de navegador. Code Reviewer y Security revisan el diff y evidencias del incremento sin editar archivos ajenos. | Por incremento, antes del siguiente. D01 a D06, R01 a R05. |

Los archivos son previsiones de trabajo, no cambios aprobados individualmente. Los Route Handlers actuales quedan como referencia de autenticación y errores; los contratos existentes se preservan.

### Contratos propuestos

- Los GET nuevos reciben filtros validados. Analítica usa período ancla, horizonte y categoría opcional. Reportes usa granularidad o rango, categoría y tipo con combinaciones explícitas. Validar parámetros repetidos antes de convertirlos a objeto y acotar los años para que el límite exclusivo sea representable. El propietario se deriva de la sesión. Propuesta de respuestas: `401` sin sesión y `400` ante filtros inválidos. Una categoría no disponible no revela si pertenece a otra persona.
- Analítica devuelve períodos normalizados, series, unidades y métricas exactas. Reportes devuelve filtro efectivo, detalles o paginación y totales de todo el conjunto. Exportación aplica el mismo filtro completo, hasta el límite aprobado. La UI distingue total general, total filtrado y suma de la página cuando aplique.
- Para formatos nuevos, el servidor fija `Cache-Control: private, no-store`, MIME, `nosniff` y nombre seguro. Los importes se mantienen exactos hasta la salida. Validar los campos de texto no confiables, evitar recursos externos y limitar rango, filas, bytes, tiempo y concurrencia. Detectar el exceso antes de emitir bytes y mantener disponible el resumen. Asociar la descarga con la selección en el momento de iniciarla.

### Seguridad y verificación

- Riesgos principales: fuga entre propietarios por joins y agregaciones, descarga cacheada, fórmulas en celdas de texto, exportaciones de alto costo, consultas sin índices adecuados, valores grandes y fotografías incompatibles entre totales y detalle. Mitigar con ámbito por sesión en todas las consultas, proyección de campos mínima, lectura coherente, filtros parametrizados, límites medidos y tratamiento seguro de archivos.
- QA prepara dos cuentas sintéticas, categorías homónimas y fechas en límites de períodos. Contrasta las vistas con SQL y compara reporte/archivos por filas y centavos. Incluye negativos de sesión, propietario, rangos y límites, texto con comillas/Unicode, demora/reintentos, móvil y teclado.
- Ejecutar lint, TypeScript, build, unitarias, integración local y navegador. Registrar evidencias por identificador SDD. Revisar costo y volumen en fixtures sintéticos antes de sugerir índices. No simular resultados de producción.
- Para `UNIQUE (user_id, year, month)`, preparar preflight de solo lectura de conteos. Si hay duplicados, detenerse y solicitar política de conciliación. Si no hay, coordinar pausa de escritores, repetir bajo bloqueo y verificar restricción antes de habilitar `ON CONFLICT`. Este trabajo exige aprobación y se mantiene independiente de T01–T05.

### Primer incremento para aprobación

1. **1A · Resumen mensual y CSV.** Implementar el subconjunto mensual de T01, T02, T04 y T05, con integración mínima de T03 y las comprobaciones T06. Ingresos, gastos y conteo comparten el conjunto elegible con la exportación de todos los movimientos del mes. El CSV usa orden por fecha e ID. Antes de programar, confirmar columnas, notas, dialecto, años admitidos, límites y respuesta de exceso. Este incremento se plantea con el esquema y dependencias actuales.
2. **1B · Comparativas y reportes ampliados.** Completar visualizaciones, indicadores, filtros y períodos trimestrales/anuales tras aprobar las definiciones, el alcance del filtro de categoría y el horizonte. Distinguir categorías ausentes de una categoría real llamada «Otros». Verificar que la analítica se refresque tras mutaciones en el mismo mes.
3. **1C · Excel y PDF.** Revisar formatos, precisión y paginación. Evaluar y solicitar aprobación de dependencias si hacen falta. Ejecutar T06 y obtener las revisiones de cada incremento antes de continuar.

## Plan aprobado del Incremento 1 — Resumen mensual y CSV

### Solución y arquitectura

Dos Route Handlers GET añaden el resumen mensual de movimientos y su exportación. Un módulo de dominio comparte la validación del mes y el predicado por propietario y fecha civil. Un componente del panel consume ambos endpoints mediante el selector y el ciclo de actualización existentes. El plan aplica I1-01 a I1-09 de la especificación aprobada.

Cada ruta obtiene la identidad mediante `getCurrentUser()` antes de procesar el mes y pasa su ID al servicio. El servicio usa Drizzle con parámetros y compara la columna PostgreSQL `date` directamente contra los dos límites civiles. El resumen agrega en PostgreSQL con `numeric` y conserva el valor exacto al formatear con `toMoneyCents` y `formatMoneyCents`. La exportación usa un `LEFT JOIN` de categoría condicionado por ID y propietario para conservar un movimiento cuya categoría falte o sea ajena. Se excluyen los aportes a metas de ambas consultas. Cada GET refleja su propia lectura.

### Contrato Backend–Frontend

| Aspecto | Contrato |
| --- | --- |
| Consulta de ambos endpoints | Un solo parámetro `month` obligatorio con forma exacta `YYYY-MM`, entre `0100-01` y `9999-12`, ambos incluidos. Los otros parámetros carecen de efecto. El primer día se incluye y el primer día del mes siguiente se excluye. Diciembre de 9999 usa el límite interno `10000-01-01`, representable como `date` en PostgreSQL. El año mínimo coincide con el primer año que admite la validación de fechas de movimiento existente. |
| Resumen exitoso | `GET /api/finance/insights?month=YYYY-MM` devuelve `200` JSON con `{month,income,expense,balance,movementCount}`. El mes coincide con la solicitud. Importes en strings con punto, dos decimales, sin separador de miles, signo negativo solo cuando corresponda. Conteo numérico entero. El balance es ingreso menos gasto. En vacío, importes `"0.00"` y conteo `0`. |
| Descarga exitosa | `GET /api/finance/reports/export?month=YYYY-MM` devuelve `200`, `Content-Type: text/csv; charset=utf-8` y `Content-Disposition: attachment; filename="mi-bolsillo-YYYY-MM.csv"`. UTF-8 con BOM, delimitador punto y coma, terminadores CRLF incluido el último registro. Encabezado `Fecha;Tipo;Categoría;Descripción;Importe`. Fecha `YYYY-MM-DD`, tipo literal `income` o `expense`, categoría vacía si falta o es ajena, importe con coma y dos decimales sin miles. Orden por fecha y después ID, ambos descendentes. El mes vacío devuelve el encabezado. |
| Texto CSV y límite | Escapar separadores, comillas y saltos de línea dentro de los campos entrecomillados, duplicando comillas internas. Ante un carácter inicial de fórmula (`=`, `+`, `-`, `@` o formas de ancho completo), incluidos prefijos de espacios o controles, o un tabulador/CR/LF inicial, anteponer apóstrofo al texto original de categoría o descripción antes del escape. La consulta de detalle usa `LIMIT 10001`. Hasta 10 000 filas se exportan y, al detectar 10 001, se responde con error JSON antes de generar el archivo. |
| Errores | `401 {"error":"Unauthorized"}` sin sesión. `400 {"error":"Mes inválido."}` por mes ausente, repetido o inválido. Solo en exportación, `413 {"error":"El mes supera el límite de 10 000 movimientos para exportar."}`. `500 {"error":"No fue posible consultar el resumen mensual."}` o `500 {"error":"No fue posible exportar los movimientos del mes."}` ante fallos internos. Los errores carecen de adjunto y de detalles internos. |
| Encabezados | En todos los resultados de los dos handlers usar `Cache-Control: private, no-store` y `X-Content-Type-Options: nosniff`. |
| Integración del panel | Reusar la solicitud del mes activo y su ID monotónico, con invalidación inmediata y guardia antes de aplicar datos, error o carga. Tras cada mutación exitosa, solicitar de nuevo el mes vigente. Ofrecer reintento y estado vacío accesibles. El botón de exportar captura el mes de su activación, solicita la ruta con sesión y descarga el archivo solo tras éxito, mostrando el error en el panel si falla. |

### Tareas y orden

| ID | Prioridad y complejidad | Predecesora | Responsable y archivos exclusivos | Criterios |
| --- | --- | --- | --- | --- |
| I1-T01 | P0, media | Contrato fijado | Backend. Módulos nuevos de validación/período, consulta y CSV bajo `features/finance/`, y rutas nuevas `app/api/finance/insights/route.ts` y `app/api/finance/reports/export/route.ts`. Reutilizar los módulos existentes como dependencias de lectura. | I1-01 a I1-06, I1-09 |
| I1-T02 | P0, media | Contrato fijado | Frontend. `app/dashboard/dashboard-client.tsx` y componente nuevo `app/dashboard/monthly-insights.tsx`. | I1-07 a I1-09 |
| I1-T03 | P0, media | I1-T01 e I1-T02 | QA. Pruebas `*.test.ts` nuevas bajo `scripts/`. | I1-01 a I1-09 |
| I1-T04 | P0, media | I1-T03 | Code Reviewer y Security. Inspección, sin archivos asignados. Cada corrección vuelve a su responsable. | I1-01 a I1-09 |

I1-T01 e I1-T02 se ejecutan en paralelo. Los perfiles de revisión reciben el código integrado y la evidencia de QA. API financiera actual, esquema, migraciones y dependencias quedan fuera de las tareas.

### Pruebas, seguridad y evidencia

- QA usa `node:test` y archivos `scripts/*.test.ts`. Ejecuta desde la raíz `node --import tsx --test scripts/*.test.ts`, `pnpm exec tsc --noEmit` y `pnpm lint`, con Node 22 y las dependencias del repositorio instaladas. Las unitarias deben cubrir, según el módulo, límites civiles, exactitud incluyendo agregados grandes y balance negativo, dialecto, neutralización y frontera de 10 000/10 001. Esta fase no escribe en PostgreSQL.
- El coordinador externo verifica por HTTP contra el fixture PostgreSQL dos sesiones, aislamiento de movimientos y categorías, argumentos de identidad, estados y encabezados, aportes excluidos, límites de fecha, filas y conciliación con centavos exactos. En Chrome verifica cambio rápido de mes, mutaciones que conservan la selección, fallo/reintento, descarga y error visible, teclado y móvil.
- Riesgos a revisar son un join que exponga categorías ajenas, conversiones monetarias a punto flotante, fórmulas tras prefijos invisibles y carreras de solicitudes. Una escritura entre resumen y descarga puede cambiar el resultado. El tope limita filas recuperadas y tamaño del CSV, mientras que el costo de la consulta sigue sujeto a verificación con el fixture. No hay bloqueos de planificación.
