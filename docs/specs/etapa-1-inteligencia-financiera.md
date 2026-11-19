# SDD de la Etapa 1 — Inteligencia financiera

Estado: propuesta para revisión. Base verificada: `origin/main` en `cad67cd`.

## Objetivo y alcance

Consultar la evolución financiera y descargar informes reconciliables con los movimientos propios. Se amplía el panel existente de Mi Bolsillo y se preservan sus flujos de transacciones, metas y presupuesto. Esta etapa trabaja con registros reales del usuario autenticado. Las recurrencias, cuentas, transferencias y proyecciones se especificarán en etapas posteriores.

### Historias

- Como usuario, quiero comparar ingresos, gastos y saldos para entender la evolución de mis finanzas.
- Como usuario, quiero acotar la vista a un período y una categoría para identificar de dónde proviene el gasto.
- Como usuario, quiero consultar y exportar un informe del mismo conjunto de movimientos para reconciliar cifras fuera de la aplicación.

## Dashboard avanzado

| ID | Criterio de aceptación |
| --- | --- |
| E1-D01 | Con movimientos en dos meses, el panel presenta ingresos y gastos de cada mes y su comparación. Los gráficos de barras y su alternativa textual exponen las mismas cifras. El mes seleccionado y los meses mostrados se identifican sin depender del color. |
| E1-D02 | La serie de balance y ahorro coincide con fixtures que contienen movimientos y aportes a metas. Se distingue el neto ingresos menos gastos, el ahorro aportado y el saldo disponible. Las líneas y su alternativa textual exponen los mismos valores. |
| E1-D03 | La distribución y el ranking de gasto concilian con los gastos del período. Los movimientos sin categoría quedan visibles como grupo y un empate se ordena de forma estable. |
| E1-D04 | Los indicadores de variación mensual, capacidad de ahorro y gasto promedio aplican las definiciones aprobadas. Con denominador cero se muestra un estado explícito y nunca `Infinity` ni `NaN`. Un período sin datos se diferencia de un fallo de carga. |
| E1-D05 | Cambiar período o categoría actualiza únicamente las métricas que el filtro gobierna. Un alta, edición o borrado exitoso también refresca la analítica de la selección vigente, aunque el mes no cambie. En cambios rápidos, una respuesta anterior no sobrescribe los datos, el error o la carga de la selección vigente. Un fallo permite reintentar la selección actual. |
| E1-D06 | Gráficos, filtros y alternativa textual se pueden consultar con teclado, a ancho móvil y sin distinguir colores. Los estados relevantes de carga y error se anuncian con semántica accesible. |

## Reportes y exportaciones

| ID | Criterio de aceptación |
| --- | --- |
| E1-R01 | El usuario puede consultar un reporte mensual, trimestral o anual. Los casos de enero, cambio de año y febrero bisiesto incluyen cada movimiento en un solo período. Las combinaciones de filtros de fecha, categoría y tipo coinciden con los movimientos esperados de los fixtures. |
| E1-R02 | El detalle, el conteo y los totales de ingresos, gastos y neto corresponden a una misma consulta lógica y filtros. La suma de importes del detalle reconcilia exactamente con esos totales, incluso con centavos y valores grandes. |
| E1-R03 | CSV, Excel y PDF reproducen el conjunto filtrado, los totales, la moneda y el período. CSV preserva separadores, comillas, saltos de línea y Unicode sin convertir texto del usuario en fórmulas. Excel conserva la exactitud verificable y PDF permite consultar detalle y totales sin truncarlos. |
| E1-R04 | Cada consulta y descarga exige sesión. Una categoría ajena, ausente o manipulada no expone datos ni información sobre otro usuario. Las respuestas y los errores no se almacenan en caché compartida ni incluyen datos sensibles en telemetría. |
| E1-R05 | Los rangos inválidos o excesivos se rechazan de forma clara. Los límites aprobados para cada exportación se comprueban antes de transferir el archivo y ningún resultado parcial se presenta como completo. Una consulta válida vacía muestra conteo cero y totales reconciliables. |

## Reglas compartidas y casos límite

- Identidad desde sesión en servidor. Validación Zod de período, rango, categoría y tipo. El servidor aplica el propietario a la consulta y a las relaciones. Las consultas de detalle y totales comparten el filtro y la instantánea cuando se devuelven juntas.
- Moneda COP con centavos exactos. Reutilizar el código de aritmética actual. En contratos nuevos se proponen strings decimales canónicos para agregados. Los contratos existentes conservan sus campos y tipos. El cliente no convierte a coma flotante para cálculos ni formateo monetario exacto.
- Períodos de calendario calculados en función de fechas civiles y del período por defecto en Bogotá. Usar inicio inclusivo y fin exclusivo. Las aportaciones a metas no se convierten en movimientos de ingresos o gastos.
- Casos mínimos: dos usuarios con categorías homónimas, ausencia de categoría, datos vacíos, montos de un centavo, agregados por encima del entero seguro, saldo negativo, base porcentual cero, fin de mes y cambio de año. Una descarga debe reflejar la instantánea disponible al solicitarla. Si hubo escrituras desde la vista previa, puede cambiar el conjunto.

## Decisiones para aprobación

1. **Indicadores.** Propuesta: capacidad de ahorro como `(ingresos − gastos) / ingresos`, sin valor cuando no hay ingresos. Definir el denominador del gasto promedio (días del período, días transcurridos o días con movimientos). Confirmar cómo presentar aportes y saldo disponible en una vista filtrada por categoría.
2. **Horizonte y cambios.** Confirmar cuántos meses se muestran por defecto y el máximo de comparación. Propuesta: cambio respecto al mes calendario anterior, con indicador sin base si su valor es cero. Confirmar tratamiento de una base negativa y de períodos parciales.
3. **Reportes y exportaciones.** Aprobar columnas, filtros y límites de rango/filas, convención de CSV y representación exacta en Excel cuando el formato numérico no pueda conservar el importe. Seleccionar una solución de Excel y PDF después de justificar su mantenimiento, licencia, tamaño y seguridad. Solicitar aprobación antes de añadir dependencias.
4. **Históricos.** La unicidad mensual de presupuestos requiere un preflight autorizado y una decisión para duplicados. Los reportes de movimientos y el primer incremento del panel pueden trabajar sin modificar esa tabla.

## Evidencia de aceptación

Pruebas unitarias para fechas, fórmulas y precisión. Integración en PostgreSQL local con dos propietarios y datos sintéticos. Pruebas de API y archivos exportados que comparen detalle, filtros y totales. Navegador para gráficos, accesibilidad básica y respuestas en desorden. QA, Code Reviewer y Security revisan cada incremento financiero antes de declararlo completo.

## Incremento 1 aprobado — Resumen mensual y CSV

El Incremento 1 entrega el resumen de un mes y la descarga CSV de su detalle desde el panel. Como usuario autenticado, quiero conocer ingresos, gastos, balance y cantidad de movimientos del mes que seleccioné, y poder conciliar esas cifras con los movimientos descargados para ese mes.

Las comparativas, gráficos nuevos, indicadores derivados, filtros por categoría o tipo, períodos trimestrales o anuales, Excel y PDF quedan para incrementos posteriores. El alcance mantiene los contratos actuales de la API y excluye dependencias nuevas, migraciones, cambios de datos históricos y operaciones en producción.

### Contrato funcional y criterios de aceptación

| ID | Criterio de aceptación |
| --- | --- |
| I1-01 | `GET /api/finance/insights?month=YYYY-MM` devuelve `{month,income,expense,balance,movementCount}`. El mes conserva el formato solicitado. Los importes son strings decimales canónicos, con punto y dos decimales, sin separador de miles ni exponente. El balance equivale a ingresos menos gastos. El conteo es un número entero. Un mes vacío devuelve `"0.00"` en los tres importes y `0` en el conteo. Los montos de un centavo, agregados por encima del entero seguro y saldos negativos conservan su valor exacto. |
| I1-02 | El resumen y `GET /api/finance/reports/export?month=YYYY-MM` aplican el mismo criterio de selección, con un único mes civil validado y propietario obtenido en el servidor desde la sesión. Se incluye el primer día y se excluye el primer día del mes siguiente según el calendario de Bogotá. Se verifican febrero bisiesto, el cambio diciembre–enero y movimientos en ambos límites. Las aportaciones a metas quedan fuera. Con datos estables, las filas y sumas del CSV reconcilian por tipo, centavo y conteo con el resumen. |
| I1-03 | Ambos endpoints rechazan solicitudes sin sesión y meses ausentes, duplicados, inválidos o fuera del rango admitido. Las identidades aportadas por el cliente carecen de efecto en la autorización. Dos usuarios con movimientos y categorías homónimas solo reciben datos de su propio usuario. Una categoría ausente o ajena jamás aporta su nombre a la respuesta. Las respuestas de éxito y error aplican `Cache-Control: private, no-store` y los errores omiten detalles internos y financieros. |
| I1-04 | Un CSV exitoso se descarga como `mi-bolsillo-YYYY-MM.csv`, en UTF-8 con BOM, punto y coma y terminadores CRLF. El encabezado contiene únicamente `Fecha;Tipo;Categoría;Descripción;Importe` en ese orden. Las fechas son civiles, las filas se ordenan por fecha descendente y luego ID descendente, y los importes tienen coma decimal y exactamente dos decimales. El archivo carece de IDs y notas. Con un mes vacío se devuelve un CSV con encabezado y sin filas de datos. |
| I1-05 | El CSV preserva Unicode y el contenido de celdas con separadores, comillas y saltos de línea mediante escape CSV. Los campos de texto controlados por el usuario se neutralizan frente a fórmulas de hojas de cálculo, incluso con espacios o caracteres de control iniciales. La neutralización se aplica al texto y los importes siguen siendo valores decimales. |
| I1-06 | Se permite exportar exactamente 10 000 filas. La consulta solicita como máximo 10 001 para detectar exceso. Si hay más de 10 000, el servidor devuelve un error explícito sin adjunto y sin contenido CSV, y el resumen mensual sigue disponible. |
| I1-07 | El panel consulta el mes seleccionado, distingue carga, vacío y error, y permite reintentar. Tras una mutación exitosa, refresca el resumen del mes vigente incluso cuando la selección no cambia. El identificador de solicitud evita que una respuesta anterior cambie datos, error o carga del mes vigente. El estado es legible y operable con teclado y a ancho móvil. |
| I1-08 | La descarga se solicita con la sesión del usuario y el mes activo al iniciarla. Una respuesta de error muestra un mensaje visible y accesible y no inicia una descarga. Una respuesta exitosa descarga el CSV del mes solicitado. Las solicitudes independientes reflejan los datos disponibles al ejecutarse, por lo que una escritura intermedia puede cambiar las cifras. |
| I1-09 | Las rutas y flujos financieros existentes conservan su contrato. QA añade pruebas unitarias bajo `scripts/` y registra sus resultados, TypeScript y ESLint. El coordinador externo ejecuta las pruebas con el fixture PostgreSQL y la integración en Chrome. La fase de QA local evita escribir en la base de datos. |

### Decisiones de implementación para el plan técnico

Fijar el rango de años con un límite exclusivo representable y especificar códigos y cuerpos de error, valores de tipo y representación de categoría ausente. Se propone usar los estados de autenticación y validación de la API existente. La representación de la categoría ausente debe mantener el aislamiento aun si una relación histórica apunta a otro propietario.

La fecha de la transacción ya se guarda como fecha civil. Ambos endpoints aplican el mismo filtro de propietario y período sobre ese valor. El plan debe prever comprobaciones sintéticas con dos propietarios, confirmación del límite con 10 000 y 10 001 filas, y concurrencia de solicitudes en Chrome.
