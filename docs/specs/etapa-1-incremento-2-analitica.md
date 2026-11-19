# Etapa 1 · Incremento 2 · Analítica financiera

## Objetivo y alcance

Como titular de mi cuenta, quiero explorar la evolución de mis finanzas por período, tipo y categoría, comparar el cierre con el mes anterior e identificar qué categorías explican el importe seleccionado. Quiero consultar los mismos importes con gráficos o tablas y mantener mi selección al operar en el panel.

El incremento comprende un GET privado y una sección de analítica del dashboard. Conserva los flujos y contratos del Incremento 1, el esquema y las rutas existentes. Quedan excluidos los reportes ampliados, indicadores adicionales, dependencias nuevas y operaciones de base de datos, instalaciones, migraciones o producción durante esta implementación.

## Reglas de negocio

- El período usa meses civiles de `America/Bogota`, ambos inclusive, de uno a doce meses. Las columnas de movimientos y aportes representan fechas civiles. Cada consulta incluye el primer día y excluye el primer día posterior al período.
- Los filtros de tipo y categoría afectan ingresos, gastos y balance neto. El ahorro son los aportes registrados a metas durante cada mes. El saldo disponible incluye todo el historial de ingresos menos gastos menos aportes. La apertura se calcula con todas las fechas previas al inicio. Ahorro y saldo disponible prescinden de los filtros de tipo y categoría.
- La comparación enfrenta el mes final con su predecesor calendario. Para cada métrica comparada, la diferencia es el valor final menos el anterior. El porcentaje es la diferencia multiplicada por 100 y dividida por el valor absoluto anterior. Con base cero se devuelve `null` y se explica en la vista.
- La distribución presenta gastos para `all` o `expense` e ingresos para `income`. Se concilia contra el total de esa población bajo los filtros activos. Una categoría real conserva su identidad y nombre aunque se llame «Otros». La FK de categoría usa `ON DELETE SET NULL`. Una transacción originalmente sin categoría y otra cuya categoría se borró tienen la misma representación persistida. La interfaz usa una etiqueta que reconoce ambas posibilidades, «Sin categoría o eliminada», y evita atribuir un historial individual. Una relación no resoluble por propietario jamás aporta el nombre ajeno.

## Criterios de aceptación

| ID | Resultado verificable |
| --- | --- |
| I2-01 | `GET /api/finance/analytics` acepta `startMonth` y `endMonth` como `YYYY-MM`, `type` igual a `all`, `income` o `expense`, y `category` igual a `all`, `uncategorized` o un ID canónico válido de una categoría propia. Rechaza meses ausentes, inválidos o invertidos, rangos de más de doce meses, parámetros de filtro duplicados y valores inválidos. Enero, febrero bisiesto y el cambio de año incluyen los movimientos de cada mes exactamente una vez. |
| I2-02 | La identidad se deriva de la sesión antes de la consulta. Sin sesión el GET devuelve `401`. Categorías ajenas e inexistentes producen el mismo error genérico de filtro. Todas las filas, relaciones y agregaciones aplican propietario. Éxitos y errores incluyen `Cache-Control: private, no-store`. Los errores omiten datos financieros, identidades ajenas y detalles internos. |
| I2-03 | La serie incluye un punto por mes en orden ascendente, con ceros cuando faltan importes. Ingresos, gastos y neto reflejan ambos filtros. Ahorro y saldo global son idénticos al variar tipo y categoría. El saldo de cada mes deriva de la apertura más ingresos globales menos gastos globales menos aportes hasta ese mes. La vista etiqueta explícitamente el alcance global. |
| I2-04 | La comparación usa el mes calendario anterior al mes final aunque esté fuera del rango, con los mismos filtros por métrica. Expone valores de ambos meses, diferencia exacta y porcentaje según la fórmula definida. Se verifican base anterior negativa, base cero y cambio de año. |
| I2-05 | Los grupos de distribución respetan tipo, categoría y período, y sus importes suman el total de la población seleccionada. Los porcentajes usan ese total antes de redondear. El ranking ordena por importe exacto descendente y desempata por clave estable. El grupo sin categoría resoluble se distingue de una categoría real «Otros». |
| I2-06 | Las agregaciones de movimientos y aportes usan SQL parametrizado, sin multiplicar importes por joins. Propiedad de filtros, puntos, apertura, comparación y distribución reflejan una instantánea coherente por respuesta. Los importes se manipulan como enteros exactos en centavos y las razones usan `BigInt`. La respuesta serializa importes y porcentajes como strings decimales, sin pérdida en centavos ni agregados por encima del entero seguro de JavaScript. |
| I2-07 | Los presets de seis y doce meses parten del mes activo como referencia inicial. La sección permite personalizar y restaurar su período y seleccionar filtros. Estas operaciones conservan el mes, resumen y descarga del dashboard y el período analítico elegido se mantiene ante cambios del mes activo. |
| I2-08 | Los gráficos responsive son legibles y sus valores están disponibles en una alternativa tabular operable por teclado. Se pueden usar los filtros y reintentar por teclado. La vista presenta estados de carga, vacío y error, y permite reintentar con la selección vigente. Un vacío de movimientos filtrados conserva ahorro y saldo global cuando existen. |
| I2-09 | Las mutaciones exitosas existentes refrescan la analítica para su selección vigente aunque el mes del dashboard no cambie. Cambiar filtros, reintentar, refrescar o desmontar aborta las solicitudes superadas. Una guarda de ID impide que una respuesta superada cambie datos, carga o error. |
| I2-10 | El Incremento 1 conserva sus rutas, componentes y comportamiento. QA ejecuta unitarias, TypeScript y lint con herramientas existentes. Compilación, HTTP con PostgreSQL sintético y Chrome corresponden al coordinador externo. |

## Supuestos y decisiones de contrato para Planner

Se suman los aportes que sigan persistidos, igual que en el dashboard. Al borrar una meta mediante la aplicación, el servicio elimina también sus aportes y los saldos históricos recalculados reflejan ese borrado. Una fila de aporte que siga persistida con la referencia a meta nula conserva su efecto. La API puede presentar `uncategorized` como categoría sin relación resoluble por dueño sin revelar relaciones defectuosas. El rango máximo reduce el número de puntos, aunque la apertura lee el historial previo. Los casos sensibles son propiedad de categorías, redondeo porcentual, coherencia bajo escrituras y respuestas tardías.

Planner fijará el esquema JSON, la escala y el redondeo de porcentajes, los límites representables de mes, los errores y los estados para un total de distribución cero. También concretará si los presets quedan anclados al mes inicial capturado o al fin analítico seleccionado al volver a aplicarlos, siempre sin modificar el dashboard.

## Plan técnico del Incremento 2

### Solución, arquitectura y decisiones

El nuevo Route Handler GET autentica con `getCurrentUser()`, valida los parámetros y delega al servicio analítico. El servicio consulta categorías, agregados mensuales, apertura y distribución en una transacción PostgreSQL de solo lectura y aislamiento `repeatable read` o en una única sentencia equivalente. Los movimientos y aportes se agregan por separado. Las lecturas se limitan al propietario y el join de categorías exige la coincidencia de ID y propietario. Usar parámetros Drizzle para valores de entrada. Una FK de categoría irresoluble pertenece al grupo `uncategorized`. Solo los aportes que siguen persistidos tienen efecto en el disponible.

Usar límites civiles semiabiertos sobre `date`. Aceptar desde `0100-01` hasta `9999-12`, como I1. Admitir internamente `0099-12` para comparar enero de 0100 y `10000-01-01` como límite exclusivo de diciembre de 9999. No derivar meses de horas UTC ni de la configuración horaria del navegador. Calcular importes con `BigInt` en centavos desde los agregados SQL exactos, y reusar el formateo monetario existente. Para porcentajes, escalar a centésimas de punto porcentual y redondear al más cercano, con empates alejándose de cero. El ranking de distribución compara centavos exactos antes de formatear.

### Contrato Backend–Frontend

`GET /api/finance/analytics?startMonth=YYYY-MM&endMonth=YYYY-MM&type=all&category=all`. Los meses son obligatorios. Omitir tipo o categoría equivale a `all`. Rechazar duplicados de los cuatro filtros y valores fuera de contrato. Un ID de categoría usa decimal canónico positivo dentro de `int4` de PostgreSQL, sin signos, espacios ni ceros iniciales. Parámetros ajenos al contrato carecen de efecto. La validación de pertenencia y el catálogo usan la misma instantánea.

La interfaz compartida vive en `features/finance/analytics/analytics.types.ts`, importada como tipo por Frontend. Los alias de mes y decimal son strings. Los campos de los mapas de métricas son `income`, `expense`, `net`, `savings` y `available`.

```ts
export type AnalyticsType = "all" | "income" | "expense";
export type AnalyticsFilters = {
  startMonth: string;
  endMonth: string;
  type: AnalyticsType;
  category: string;
};
export type AnalyticsMetrics<T> = {
  income: T;
  expense: T;
  net: T;
  savings: T;
  available: T;
};
export type AnalyticsPoint = { month: string } & AnalyticsMetrics<string>;
export type AnalyticsResponse = {
  filters: AnalyticsFilters;
  categories: { id: string; name: string; type: "income" | "expense" }[];
  openingAvailable: string;
  hasFilteredMovements: boolean;
  series: AnalyticsPoint[];
  comparison: {
    current: AnalyticsPoint;
    previous: AnalyticsPoint;
    difference: AnalyticsMetrics<string>;
    percent: AnalyticsMetrics<string | null>;
  };
  distribution: {
    type: "income" | "expense";
    total: string;
    groups: { category: string; name: string; amount: string; percent: string }[];
  };
};
```

- Importes y porcentajes usan punto y dos decimales. No se devuelve `BigInt` crudo ni se convierte un valor monetario a `number`. `categories` devuelve el catálogo propio completo, ordenado por ID ascendente, incluso si el período está vacío. `hasFilteredMovements` indica existencia en el rango antes de elegir el tipo de distribución.
- `openingAvailable` es el saldo global al cierre del mes anterior al inicio. Cada punto acumula ingresos globales menos gastos globales menos aportes desde esa apertura. La comparación trae las cinco métricas y aplica la regla de filtros de cada una. Para un rango de un mes, el disponible de `comparison.previous` es exactamente la apertura, mientras que los otros valores previos se consultan en el mes anterior. Base anterior cero produce `null`. Mostrar que el porcentaje divide por el valor absoluto anterior y que no se calcula con base cero.
- La distribución usa ID de categoría como string o clave `uncategorized`, con etiqueta «Sin categoría o eliminada». Desempatar por ID numérico ascendente con el grupo sin categoría al final en caso de empate. Un total cero devuelve `"0.00"` y grupos vacíos. Los porcentajes se redondean por grupo y pueden sumar ligeramente más o menos de 100.
- Toda respuesta del handler usa `Cache-Control: private, no-store` y `X-Content-Type-Options: nosniff`. Sin sesión, `401 {"error":"Unauthorized"}`. Parámetros inválidos, categoría inexistente o ajena, `400 {"error":"Filtros de analítica inválidos."}`. Fallo interno, `500 {"error":"No fue posible consultar la analítica financiera."}`.

### Integración y refresco

Montar un componente de analítica hermano de `MonthlyInsights`. Capturar una vez el mes activo como referencia de presets y restauración. El estado inicial muestra seis meses y ambos filtros en `all`. Restaurar recupera esa selección, y aplicar un preset conserva tipo y categoría. Al llegar al mínimo representable, acortar el preset hasta enero de 0100. Los controles jamás llaman al selector del dashboard ni al reintento de I1. La vista conserva el catálogo de la última respuesta vigente mientras recarga y ofrece `all` y `uncategorized` antes del primer resultado.

El dashboard pasa un token de mutación y una función estable para comprobar que sigue vigente. Incrementar su ref de forma sincrónica al completar con éxito cada uno de los seis flujos de mutación existentes, publicar después el token con estado y conservar en paralelo la llamada actual a `requestFinance()`. La navegación mensual y los reintentos de I1 no lo incrementan. Analítica usa su propio ID monotónico e invalida al aplicar filtros, restaurar, elegir preset o reintentar. Tanto el ID como el token y la señal de abortado se verifican antes de publicar resultado o error, incluso después de leer el cuerpo. Cancelar el GET anterior al reemplazarlo y al desmontar. Etiquetar el resultado con la identidad de la solicitud para que la carga siga a la selección vigente.

### Tareas, orden y responsables

| Tarea | Prioridad y complejidad | Predecesora | Responsable y archivos | Criterios |
| --- | --- | --- | --- | --- |
| I2-T01 Contrato, validación, servicio y endpoint | P0, alta | Contrato anterior | Backend. Archivos nuevos bajo `features/finance/analytics/`, incluidos `analytics.types.ts`, y `app/api/finance/analytics/route.ts`. | I2-01 a I2-06, I2-10 |
| I2-T02 Controles, visualización y refresco | P0, alta | Contrato anterior | Frontend. Componentes y estilos nuevos bajo `app/dashboard/` y enlace mínimo en `app/dashboard/dashboard-client.tsx`. | I2-03 a I2-05, I2-07 a I2-10 |
| I2-T03 Regresión y evidencia | P0, media | I2-T01, I2-T02 | QA. Pruebas nuevas específicas bajo `scripts/`. | I2-01 a I2-10 |
| I2-T04 Revisión técnica | P0, media | I2-T03 | Code Reviewer. Revisión independiente y hallazgos por archivo. | I2-01 a I2-10 |
| I2-T05 Revisión defensiva | P0, media | I2-T03 | Security. Revisión independiente de propiedad, parametrización, caché, errores y concurrencia. | I2-01, I2-02, I2-06, I2-09, I2-10 |

Backend y Frontend pueden trabajar en paralelo con este contrato. Los tipos compartidos son propiedad de Backend. Las dos revisiones pueden trabajar en paralelo tras QA. Cada corrección vuelve al propietario del archivo y QA repite los criterios afectados y las verificaciones locales.

### Evidencia y riesgos

QA usa `node:test` con archivos `scripts/*.test.ts`, Node 22 y las dependencias presentes. Ejecuta desde la raíz `node --import tsx --test scripts/*.test.ts`, `pnpm exec tsc --noEmit` y `pnpm lint`. Cubrir extremos civiles, duplicados, intervalos de 1/12/13 meses, porcentajes con base negativa y cero, agregado superior al entero seguro, desempate y categoría real «Otros», comparación fuera del rango, reconciliación de apertura y filtro en series. Revisar el cableado de refresco y vigencia frente a respuestas desordenadas.

El coordinador externo ejecuta build, HTTP con PostgreSQL sintético y Chrome. Contrasta dos sesiones, pertenencia de categorías, respuesta ante sesión ausente, errores, caché y protección de nombres ante relaciones defectuosas. Concilia por centavos el efecto de borrar una meta mediante la aplicación y comprueba por separado que un aporte persistido con referencia nula sigue incluido. En Chrome verifica teclado, viewport móvil, cambios rápidos, error y reintento, mutación con filtros vigentes y regresión de resumen y CSV de I1. El costo dominante puede ser la lectura del historial para la apertura. La revisión de rendimiento con datos sintéticos queda para esa verificación externa. No se requieren cambios de esquema ni dependencias.
