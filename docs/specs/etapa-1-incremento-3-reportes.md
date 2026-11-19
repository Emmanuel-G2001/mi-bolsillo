# Etapa 1 · Incremento 3 · Reportes PDF y XLSX

**Estado · Implementación autorizada** en `feat/financial-intelligence`. Cubre E1-R01–E1-R05.

## Objetivo y alcance

Como usuario autenticado, quiero descargar los resultados de la selección aplicada en Analítica para consultar un informe imprimible y trabajar con sus importes en una hoja de cálculo. Ambos formatos permiten conciliar el detalle, el conteo y los totales del período.

I3 añade dos acciones en Analítica y un endpoint privado. Los rangos, filtros, indicadores y consultas reutilizan I2 con su comportamiento vigente. I1, incluido el resumen mensual y el CSV, queda fuera de I3. Se excluyen las vistas previas independientes, los indicadores nuevos, los cambios de esquema o datos históricos, las nuevas instalaciones y los cambios de dependencias. Se usan **PDFKit 0.20.2** y **ExcelJS 4.4.0**, ya instalados. Se usan fuentes locales y las bibliotecas desde el runtime Node.js del servidor. Se excluyen workers, colas y otros cambios de arquitectura sin autorización.

## Selección y coherencia de los datos

- Aplicar la selección efectiva de I2. El rango civil admite entre uno y doce meses inclusivos de `0100-01` a `9999-12`, con inicio de fecha inclusivo y fin exclusivo. Los tipos y categorías conservan la semántica y los valores predeterminados de I2. La categoría inexistente y la categoría ajena devuelven el mismo error genérico.
- Resolver la identidad desde la sesión en servidor. Leer la categoría seleccionada, el detalle y las métricas con una única transacción PostgreSQL explícita de solo lectura `REPEATABLE READ`. El lector analítico reutilizado recibe la transacción. Cada consulta limita los datos al propietario y toda categoría relacionada se resuelve por ID y propietario. Cerrar la transacción antes de generar el archivo. Las peticiones separadas de I2 y del reporte pueden reflejar instantáneas distintas.
- Incluir fecha civil, tipo, categoría, descripción e importe en COP. Ordenar por fecha descendente e ID descendente como desempate interno. Aplicar al detalle los mismos predicados de propietario, fecha, tipo y categoría que a los totales del rango. Excluir notas, identificadores internos e identidad. Comparar ingresos, gastos y neto calculados en centavos exactos de todo el detalle con los de la serie filtrada y descartar la operación si hay divergencia. El conteo corresponde al detalle completo.
- Conservar la semántica de I2 para apertura, serie, comparación y distribución. La comparación puede incluir meses externos al rango y su porcentaje queda ausente si la base es cero. La distribución se identifica por tipo y alcance. Los aportes, el saldo disponible y su apertura histórica conservan su alcance global. Un filtro sin movimientos conserva las métricas globales que correspondan.

## Formatos

### PDF

Generar un informe A4 en español y con texto seleccionable. Incluir Mi Bolsillo, período, filtros efectivos, fecha de generación en Bogotá, COP, conteo y cifras destacadas. Distinguir el neto del rango de los indicadores globales. Incluir gráficos de evolución mensual y distribución por categoría con sus datos tabulados, comparación cuando corresponda y tabla completa de movimientos. Cualquier conclusión descriptiva se limita a cifras del informe.

Mantener el detalle legible con importes alineados, texto largo en varias líneas, encabezados repetidos, y pie «Página n de N». Verificar localmente que Helvetica con WinAnsi representa tildes, ñ, diéresis y signos españoles. Para caracteres fuera de la cobertura y controles no aptos para el documento, preservar el carácter mediante un recurso local disponible compatible o emitir una representación visible y determinista. Los fixtures verifican que no se pierden caracteres silenciosamente. El PDF carece de enlaces, acciones, formularios, scripts y adjuntos incrustados.

### XLSX

Crear cuatro hojas visibles en este orden, incluso si el rango está vacío.

| Hoja | Contenido |
| --- | --- |
| Resumen | Período, fecha de generación en Bogotá, filtros, COP, conteo y totales filtrados, apertura, ahorro y disponible globales, comparación y leyenda monetaria. |
| Movimientos | Detalle ordenado, encabezado fijo y autofiltro. Fechas civiles como texto ISO `YYYY-MM-DD`, incluidas las anteriores a 1900. |
| Categorías | Tipo distribuido, categoría, importe, participación y total según I2. |
| Evolución mensual | Mes, ingresos, gastos, neto, ahorro y disponible. Identifica como globales el ahorro y el disponible. |

Para todo importe, conservar el texto decimal canónico con dos decimales, punto y signo cuando corresponda. Emitir además un número con dos decimales si los centavos absolutos son como máximo `999999999999999` y el valor numérico vuelve al texto canónico al redondear a dos decimales. Para extremos, dejar vacía la celda numérica. La leyenda explica que Excel puede omitir celdas vacías al sumar y redondear sumas en coma flotante, y que el texto canónico conserva los importes oficiales del servidor. La participación y los porcentajes conservan el redondeo de I2. Almacenar texto de usuario como celdas de texto literal, incluidas cadenas con apariencia de fórmula o URL. Representar controles no aptos de modo visible y determinista. El archivo carece de fórmulas, macros, acciones y enlaces o relaciones externas.

## Descarga y capacidad

- `GET /api/finance/reports/analytics` admite `format=pdf|xlsx` obligatorio exactamente una vez, y `startMonth`, `endMonth`, `type`, `category` conforme a I2. Una clave repetida o ajena al contrato devuelve `400`.
- Rechazar `Sec-Fetch-Site: cross-site` con `403` antes de autenticación y consultas. Sin esa cabecera se exige la misma sesión. La ruta no habilita CORS. Todas las respuestas del GET incluyen `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` y `Referrer-Policy: no-referrer`.
- Un éxito `200` entrega `application/pdf` o `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` y `Content-Disposition: attachment; filename="mi-bolsillo-analitica-<inicio>-a-<fin>.<formato>"`. Meses y extensión proceden de datos validados. El archivo se entrega cuando está completo y dentro del tope.
- Los errores devuelven JSON `{ error: string }` genérico y carecen de adjunto. `400` identifica un formato o selección inválidos, `401` una sesión ausente, `403` un rechazo cruzado, `413` exceso de filas o bytes, `429` otro reporte activo del usuario, `503` saturación o agotamiento de plazo y `500` un fallo inesperado. Excluir identidad, filtros, datos financieros y detalles internos de errores y logs.
- Aceptar hasta **1 000 filas y 8 MiB para PDF**, y hasta **10 000 filas y 16 MiB para XLSX**. La consulta de detalle usa a lo sumo el máximo más uno y rechaza el exceso antes de agregados costosos. Aplicar un tope de salida antes de transferir el adjunto. Cualquier exceso o fallo durante la preparación descarta todos los bytes.
- Acotar lectura y renderizado con plazos y admisión local a la instancia, compartida entre formatos. Una petición activa por usuario y hasta dos en la instancia, sin cola. Liberar el cupo cuando cesa el trabajo. El plan de implementación fija valores y mecanismos compatibles con el pool y los renderizadores existentes. Un timeout de espera por sí solo no cuenta como cancelación efectiva. Medir historial extenso, textos largos y volumen al límite. La coordinación entre instancias y el control perimetral quedan fuera de I3.

## Interacción

Mostrar «Descargar PDF» y «Descargar XLSX» en Analítica cuando haya un resultado válido, incluido un resultado vacío. Capturar los filtros aplicados al activar la acción. Los cambios de borrador carecen de efecto. Permitir una descarga en preparación, anunciar progreso y errores de forma accesible y permitir reintentar con la selección vigente. Validar estado y MIME antes de entregar el archivo al navegador, usar el nombre acordado y liberar el URL temporal. Cancelar o descartar la respuesta obsoleta al cambiar la selección aplicada, cambiar la revisión financiera o desmontar el componente. Operar ambos controles desde teclado y en ancho móvil.

## Criterios de aceptación

| ID | Resultado observable | Vínculo |
| --- | --- | --- |
| I3-01 | Ambos formatos usan los filtros efectivos de I2. Casos de mes, trimestre, año, febrero bisiesto, cambio de año, extremos civiles, filtros combinados, categoría ausente, y claves inválidas, repetidas o desconocidas. | E1-R01, E1-R05 |
| I3-02 | Las filas, conteo y totales del detalle concilian en centavos. Una escritura confirmada entre lecturas del mismo reporte conserva la instantánea. Para datos estables, la serie coincide con I2. Cubrir comparación externa, base cero, saldo negativo y ahorro y apertura globales. | E1-R02, E1-R03 |
| I3-03 | PDF con metadatos funcionales, gráficos y tablas coherentes, y detalle completo multipágina. Verificar orden, encabezados, pies, primera y última fila, texto largo, español y representación visible de caracteres que Helvetica/WinAnsi no cubre. Un rango vacío informa conteo y totales filtrados cero. | E1-R03, E1-R05 |
| I3-04 | Cuatro hojas con nombres y orden acordados. Al reabrir el XLSX, comprobar que las fechas de Movimientos son texto ISO `YYYY-MM-DD` en día bisiesto y cambio de mes, con `DateStyle` ISO, SQL y German en PostgreSQL. Inspeccionar tipos, autofiltro, texto literal y soportes monetarios para un centavo, ambos signos, máximo seguro, máximo más un centavo y grandes agregados. Probar también rangos vacíos. | E1-R02, E1-R03 |
| I3-05 | Una solicitud cruzada devuelve 403. Una solicitud sin sesión devuelve 401. Dos cuentas sintéticas con categorías homónimas conservan aislamiento de filas, etiquetas, aportes y agregados. Los errores de filtro ajeno e inexistente coinciden. Verificar privacidad, caché y respuestas de error sin adjunto. | E1-R04 |
| I3-06 | En cada formato se acepta el tope exacto de filas y bytes y se rechaza el exceso sin archivo parcial. Verificar fallo de generación, saturación, plazo y recuperación de cupos después del cese del trabajo. | E1-R05 |
| I3-07 | Los dos controles funcionan por teclado y en móvil, anuncian generación y permiten reintento. Adjuntan el formato y nombre acordados para la selección aplicada, incluso con cero filas. Ignoran resultados obsoletos. I1 e I2 conservan sus contratos. | E1-R01, E1-R03, E1-R04 |

## Verificación y entrega

### Plan técnico de implementación

La ruta Node.js valida formato y filtros, resuelve la sesión y admite la generación. El servicio carga y concilia el modelo en PostgreSQL. El renderizador recibe exclusivamente ese modelo y entrega el binario completo a la ruta. Los renderizadores y los módulos de acceso a datos permanecen en el servidor. El navegador usa el contrato HTTP de Descarga y capacidad y la selección del resultado válido.

- El servicio de I2 conserva su entrada y su resultado. Extraer un lector con `tx` obligatorio y compartir con el detalle de I3 los predicados de propietario, relación de categoría, tipo y rango civil. I3 valida el filtro de categoría consultando solo su ID y propietario, sin cargar el catálogo de opciones de I2. El modelo de exportación proyecta nombres y cifras, prescinde de IDs internos y usa el catálogo de I2 exclusivamente en el flujo interactivo. El detalle se limita antes de consultar agregados y se concilia con el conjunto de puntos del rango, con montos en centavos.
- Fijar un plazo de 15 segundos desde la admisión y un `statement_timeout` local de hasta 2 segundos por sentencia en la lectura de I3. PostgreSQL 16 acota la ejecución de cada sentencia. Comprobar cancelación o expiración al adquirir conexión, antes y después de consultar y periódicamente durante el renderizado. Responder 503 si expira el plazo. Si alguna fase de la biblioteca o del pool sigue activa al vencer, el cupo permanece ocupado hasta que termine. El límite de filas y la longitud máxima del esquema acotan el modelo y el trabajo síncrono de composición.
- Medir la salida mientras se emite si la biblioteca lo permite. ExcelJS dispone de escritura incremental, cuya finalización puede seguir activa tras rechazar el resultado. Si se genera el ZIP completo en memoria, medir la salida antes de responder y registrar el volumen máximo observado. Evitar temporales, procesos auxiliares y cambios al pool global. Verificar con el build externo la resolución de PDFKit y sus recursos locales de Helvetica.
- El cliente construye `URLSearchParams` desde los filtros efectivos del resultado y añade el formato. Debe confirmar estado 200 y MIME acordado antes de crear el archivo. El nombre sigue la plantilla contractual y puede construirse a partir de la captura validada. Un token por descarga y los identificadores de consulta y revisión protegen el estado tras cada operación asíncrona. El estado de error de I3 permite reintentar la descarga sin alterar los resultados de I2.

| Tarea | Prioridad y complejidad | Predecesora | Responsable y archivos | Criterios |
| --- | --- | --- | --- | --- |
| T1 · Modelo y lectura coherente | P0, alta | SDD y plan | Backend · existente `features/finance/analytics/analytics.service.ts`; nuevos `features/finance/reports/report.types.ts` y `report.service.ts` | I3-01, I3-02, I3-05, I3-06 |
| T2 · PDF y XLSX | P0, alta | Contrato del modelo de T1 | Backend · nuevos `features/finance/reports/report.pdf.ts`, `report.xlsx.ts` y `report-text.ts` si ambos reutilizan la transformación de texto | I3-03, I3-04, I3-06 |
| T3 · API y presupuesto | P0, alta | Contrato de T1, integración T2 | Backend · nuevos `app/api/finance/reports/analytics/route.ts`, `features/finance/reports/report.schema.ts` y `report-limits.ts` | I3-01, I3-05, I3-06 |
| T4 · Acciones de descarga | P0, media | Contrato HTTP de I3 | Frontend · existentes `app/dashboard/financial-analytics.tsx` y `app/dashboard/financial-analytics.module.css` | I3-07 |
| T5 · Pruebas | P0, media | T1–T4 | QA · nuevo `scripts/financial-intelligence-reports.test.ts` | I3-01–I3-07 y regresiones I1/I2 |
| T6 · Revisiones | P0, media | T5 | Code Reviewer y Security · revisión de T1–T5. Cada corrección corresponde al propietario del archivo. Security añade el resultado de la auditoría en este documento. | I3-01–I3-07 |

Backend y Frontend pueden trabajar en paralelo desde el contrato fijado. QA verifica el parser y el modelo sin base de datos, la admisión y los límites exactos, el PDF generado y el XLSX releído con ExcelJS. Code Reviewer y Security revisan en paralelo, y los propietarios corrigen en secuencia cuando coincida un archivo. La transacción bajo escrituras concurrentes y el alcance efectivo de la cancelación en PostgreSQL se comprueban en la integración externa.

Usar `node:test` y la convención `scripts/*.test.ts`. Desde la raíz con Node 22 ejecutar `node --import tsx --test scripts/*.test.ts`, `pnpm exec tsc --noEmit` y `pnpm lint`. Añadir fixtures sintéticos de validación, conciliación, límites y renderizado que comprueben PDF y XLSX con herramientas disponibles y sin nuevas instalaciones. Registrar resultados y límites de la cobertura.

Para I3-04, ejecutar `node --import tsx scripts/financial-consistency-postgres-check.ts` con `DATABASE_URL` apuntando a la base desechable local `mi_bolsillo_qa`, con la estructura existente ya disponible. La prueba configura `DateStyle` en la misma transacción que lee los movimientos, genera el archivo y reabre las celdas de Movimientos para verificar las fechas y el aislamiento.

La verificación final local aprobó 33 pruebas, 10 de I3, y TypeScript. ESLint terminó con una advertencia preexistente en `app/dashboard/dashboard-client.tsx:308`. La suite comprueba filtros, conciliación, Helvetica/WinAnsi, paginación, tipos y escapes OOXML, topes exactos, admisión y aborto del renderizado. Los fixtures de volumen generaron un PDF de 420 170 bytes con 1 000 filas y un XLSX de 274 094 bytes con 10 000 filas. Un fixture adicional con texto largo y una categoría por fila generó 970 911 y 3 928 004 bytes, respectivamente. Los tamaños observados corresponden a esos datos sintéticos.

La validación de entrega usa HTTP y Chrome con PostgreSQL local y cuentas sintéticas, `pnpm build` y lectura independiente del PDF con la herramienta nativa de macOS. El entorno local de prueba debe tener la estructura disponible, con `DATABASE_URL` y `AUTH_SECRET` sintéticos. Los resultados de la repetición tras actualizar Next.js figuran en el cierre de la Etapa 1.

Security revisa defensivamente el uso alcanzable de los avisos de `/tmp/mibolsillo-i3-audit.json`, incluido el aviso moderado de `uuid` transitivo vía ExcelJS y los avisos existentes de Next y Zod. Registrar la evidencia y distinguir uso alcanzable, no alcanzable y no determinado. Las versiones instaladas, el lockfile y los overrides quedan fuera de esa revisión documental.

### Revisión defensiva de seguridad

La revisión de I3-01, I3-02 y I3-04–I3-07 cubrió la sesión, los filtros, las consultas, el límite de concurrencia, la preparación y entrega de binarios y su consumo en Analítica. `app/api/finance/reports/analytics/route.ts` rechaza solicitudes cruzadas antes de autenticar, usa la identidad de `lib/auth/current-user.ts` y mantiene errores genéricos. El parser valida las cinco claves. `features/finance/analytics/analytics.service.ts` restringe movimientos, categorías y aportes al propietario. `features/finance/reports/report.service.ts` usa una sola instantánea de lectura y libera la transacción antes de generar los archivos. Las celdas de texto se escriben como cadenas literales y PDFKit recibe texto y formas con fuentes locales. El cliente valida la respuesta y descarta descargas obsoletas.

Se corrigió una colisión entre la política de referencia global y la del handler mediante una regla posterior de ruta exacta en `next.config.ts`. Por inspección de la versión instalada, el enrutador aplica las reglas de cabeceras en orden y el envío conserva el valor ya presente. La regla específica aplica `no-referrer` también en errores. El método HEAD explícito devuelve 405 privado sin ejecutar la generación y evita la delegación automática de Next al GET. La integración HTTP local comprobó estas cabeceras y métodos.

#### Avisos del informe local previo a la corrección

El archivo registra 19 avisos, 3 críticos, 5 altos, 10 moderados y 1 bajo. La siguiente clasificación se basa en inspección del código, las configuraciones del repositorio y las bibliotecas instaladas. La severidad del informe se conserva aunque I3 no recorra la función afectada.

| Paquete y avisos | Uso alcanzable según evidencia local |
| --- | --- |
| `uuid` 8.3.2 vía ExcelJS · GHSA-w5hq-g745-h8pq (moderado) | La ruta afectada requiere v3, v5 o v6 con un búfer de salida. En el código de ExcelJS 4.4.0, `lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js` importa v4 y lo llama sin búfer para identificadores de formato condicional. El escritor de I3 tampoco genera formato condicional. La función afectada queda fuera del flujo de exportación. |
| Next 16.3.5 · GHSA-vcvr-r3jv-pc5j y GHSA-f87g-xv8r-7p7x | I3 usa PDFKit para generar el PDF desde datos estructurados. En el repositorio no se observaron llamadas a `ImageResponse` ni rutas especiales de imagen de metadatos que cumplan las precondiciones de estos avisos. |
| Next · GHSA-3w37-wq28-93x7, GHSA-h694-7cp9-m8p3, GHSA-673q-mjm6-r5xr, GHSA-mfr8-8qww-v76h y GHSA-vc7v-qv4w-wrv8 | I3 entrega su binario desde un handler privado y dinámico. En la aplicación revisada no aparecen `use cache`, `unstable_cache`, Draft Mode ni `cacheComponents` habilitado. El binario del reporte no pasa por las funciones de caché que requieren estos avisos. |
| Next · GHSA-4jqv-mc3x-m676 y GHSA-mcj8-r9mp-w47p | El GET I3 depende de la petición y la sesión, y devuelve `private, no-store`. Las rutas de página y mecanismos de caché preexistentes de Next son superficies separadas. La exposición efectiva allí queda sin determinar y depende del enrutamiento, el despliegue y el comportamiento HTTP. |
| Next · GHSA-39w2-rjm5-chcv | La versión instalada habilita MCP en la configuración predeterminada del servidor de desarrollo. Su alcance sobre una instancia de desarrollo depende de que se ejecute y sea accesible. I3 no usa esta superficie. |
| Next · GHSA-cjq9-62q9-8jv4 y GHSA-2464-fhr4-w9xw, y sharp 0.35.4 · GHSA-wq5f-xc86-pv6w | `/_next/image` es una superficie del framework separada de I3. El optimizador instalado aplica patrones antes de procesar la entrada y la configuración usa valores predeterminados con patrones remotos vacíos y SVG deshabilitado. No se encontró uso de `next/image` en la aplicación ni uso de imágenes o SVG en I3. Se mantiene como no determinada la explotabilidad de la superficie del optimizador presente. |
| Next · GHSA-p3m5-59mp-jv5r | Superficie preexistente alcanzable. Inicio de sesión, registro y cierre de sesión declaran acciones de servidor. La descarga I3 usa una ruta GET. La revisión verifica la presencia de las acciones, sin reproducir el fallo ni medir su impacto. |
| Zod 4.6.5 · GHSA-mrhx-c7xc-m3w5 | I3 requiere valores escalares, usa un objeto fijo para tipo y categoría, y calcula un arreglo de meses con longitud validada de hasta doce elementos. No se observaron esquemas de colecciones restringidas que consuman datos del usuario en las rutas de la aplicación revisadas. El informe también registra instancias transitivas del proceso de lint. |
| esbuild 0.18.20 · GHSA-67mh-4wv8-2f99 | La cadena pasa por herramientas de Drizzle. El código I3 no ejecuta el servidor de desarrollo propio de esbuild ni acepta solicitudes en él. No se determinó exposición para otros usos locales de esa herramienta. |
| source-map-js 1.2.1 · GHSA-68fv-2mgg-jv7q | El informe lo ubica vía PostCSS en Next y Tailwind. Los filtros, el detalle y los binarios de I3 no son mapas de código fuente. No se determinó exposición en otros procesos de compilación o herramientas. |
| minimatch 10.2.6 · GHSA-g3hv-75wg-m249 | Los caminos detectados son herramientas de ESLint y TypeScript. El GET de I3 no acepta ni construye patrones glob con datos externos. |

La suite final incluye diez pruebas de I3. Cubren selección estricta, conciliación, salida literal en PDF y XLSX, límites, cupos y aborto local. La integración externa verificó las cabeceras efectivas, el aislamiento con dos cuentas, la categoría ajena, la escritura concurrente durante el reporte y el rechazo 429 con recuperación del cupo. Se comprobó el rechazo cruzado 403 y el rechazo de HEAD 405. No se probó la espera del pool hasta agotar el plazo ni la admisión distribuida.

El control de cupos actúa después de resolver la sesión y se aplica por instancia. Las solicitudes pueden esperar al pool compartido durante la resolución de identidad. Si vence el plazo durante la generación o la espera de PostgreSQL, el cupo sigue ocupado hasta que cese el trabajo.

### Cierre de la Etapa 1

Next.js y `eslint-config-next` quedaron en 16.4.5. Next.js resuelve `sharp` 0.35.5. Zod directo y transitivo de lint quedaron en 4.6.7. Los consumidores de `source-map-js` afectados quedaron en 1.2.2. La auditoría del nuevo lockfile reportó tres avisos moderados y cero altos o críticos. El filtro de producción conservó únicamente el moderado de `uuid`.

| Aviso residual | Aplicabilidad observada |
| --- | --- |
| [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) · `uuid` 8.3.2 | ExcelJS llama v4 sin búfer, fuera de las funciones y condiciones del aviso. |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) · `esbuild` 0.18.20 | Cadena de desarrollo de Drizzle Kit. El flujo de aplicación y compilación verificado no usa el servidor de esbuild afectado. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) · `minimatch` 10.2.6 | Cadena de lint y TypeScript. La aplicación no entrega globs del usuario a esa cadena. |

Pasaron TypeScript, lint con una advertencia preexistente, Webpack, Turbopack, 33 pruebas unitarias y las comprobaciones de PostgreSQL sintético. La integración I3-04 reabrió el XLSX y comparó las fechas civiles para `ISO, MDY`, `SQL, DMY` y `German, DMY`. En Chrome pasaron las tres regresiones, incluidas descargas CSV, PDF y XLSX, registro, inicio y cierre de sesión. La lectura programática volvió a verificar PDF y OOXML, límites, precisión y conciliación. El XLSX no se abrió en Microsoft Excel y el plan de carga multiinstancia queda pendiente.
