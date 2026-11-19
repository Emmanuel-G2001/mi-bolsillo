# Metas de ahorro y organización del dashboard

## Corrección aprobada · metas nuevas

Al crear una meta, la aplicación guardaba el progreso declarado y registraba ese mismo importe como aporte. Inicio y Analítica restaban la segunda escritura del disponible. El ahorro declarado al crear una meta representa dinero ya reservado y no es un ingreso, un gasto ni una transferencia del mes.

| Criterio | Resultado verificable |
| --- | --- |
| MA-01 | Una meta de 100,00 con 12,34 previos muestra 12,34 de progreso. Crear la meta no agrega aportes ni modifica disponible, saldo del período o ahorro del mes. El importe inicial conserva el tope de la meta. |
| MA-02 | Un aporte posterior de 5,67 aumenta el progreso a 18,01, suma 5,67 al ahorro del período y resta exactamente 5,67 al disponible. Se aplican el bloqueo por meta, la transacción y el tope existentes. |
| MA-03 | Otra persona no puede aportar ni borrar la meta. Al borrar una meta nueva se revierten únicamente sus aportes registrados, según el comportamiento actual. El ahorro previo no aumenta el disponible al borrar. |
| MA-04 | El formulario muestra «Dinero que ya tienes ahorrado» y explica su efecto. Los contratos HTTP y las filas históricas se conservan. |
| MA-05 | El CSV sigue representando movimientos. El dashboard, Analítica, PDF y XLSX excluyen el progreso inicial nuevo en las métricas de flujo porque usan aportes registrados. |

## Diseño contable para aprobación

- **Balance del período** = ingresos registrados menos gastos registrados. Se concilia con el CSV. Un saldo inicial no es ingreso y un traslado interno a ahorro no es gasto.
- **Disponible al cierre** = saldo disponible declarado a la fecha de apertura más movimientos netos posteriores a ese corte, menos aportes financiados con el disponible, más devoluciones efectivas al disponible. Mientras no exista saldo de apertura, se conserva el cálculo actual. Definir el corte civil Bogotá y una regla de inclusión inequívoca para las operaciones del mismo día antes de persistir el dato.
- **Ahorro del período** = aportes netos del período según el flujo registrado. **Progreso vigente** = monto previamente reservado más aportes aplicados a la meta, con su tope. Un saldo de ahorro total incluiría lo reservado al inicio, sujeto a evitar asignar el mismo dinero a varias metas. Sumar progresos no prueba por sí solo cuánto dinero tiene la persona.
- Para una primera versión del saldo inicial de usuario, proponer un importe disponible por propietario y fecha de vigencia, separado conceptualmente del dinero ya reservado. Aclarar si se admite sobregiro, cómo editar o corregir el inicio y qué presentar en reportes anteriores al corte. Aplicar aislamiento por propietario, importes exactos y una política de revisiones auditable. Mostrar el componente de apertura por separado en Inicio, Analítica, PDF y XLSX. El CSV de movimientos conserva su contrato.
- La eliminación actual borra los aportes asociados y recalcula períodos que los incluían. Si se requiere conservar historia, diseñar una devolución fechada en un flujo aparte. Ese cambio altera los resultados históricos y requiere aprobación.

### Históricos · preflight propuesto

Preparar un inventario de solo lectura antes de proponer escrituras. Un primer aporte cercano a la creación, incluso si coincide en fecha o monto, es solo un candidato. La base no guarda el origen y los aportes posteriores legítimos pueden coincidir. Clasificar con evidencia disponible y revisión del propietario, conservar indecisos y estimar por mes el impacto en disponible, ahorro y reportes. Si se aprueba reconciliar, diseñar clasificación o ajuste trazable e idempotente, respaldo y conciliación previa/posterior. Mantener el progreso de cada meta y documentar efectos sobre el borrado y los reportes. No se consultó ni cambió información histórica para esta entrega.

## Navegación por pestañas · propuesta pendiente de aprobación

| Criterio | Resultado verificable |
| --- | --- |
| PT-01 | **Inicio** conserva disponible, ingresos y gastos, presupuesto, metas, distribución básica, movimientos recientes y el botón Nuevo movimiento. |
| PT-02 | **Analítica** reúne gráficos, comparativas, distribución detallada e indicadores con sus propios filtros. |
| PT-03 | **Reportes** reúne CSV mensual, PDF y Excel. Muestra el período y los filtros confirmados de la descarga y conserva los estados de generación, error y confirmación. |
| PT-04 | El CSV toma el mes de Inicio como valor inicial y permite elegir otro sin cambiar Inicio. Analítica mantiene un rango independiente. Cambiar de pestaña conserva los valores. Reportes puede adoptar filtros confirmados de Analítica de forma explícita. |
| PT-05 | Colores morados, fondos claros y tarjetas actuales. Navegación con foco visible, acceso por teclado y etiquetas accesibles en escritorio y móvil. |

Propuesta de implementación: mantener el estado del mes en el contenedor del dashboard y el estado analítico separado. Extraer los controles de exportación de sus componentes actuales para montar la sección Reportes de forma independiente. Reutilizar los endpoints y conservar su autorización, límites y descarte de respuestas tardías. Verificar tabulación, foco, navegación móvil y persistencia al cambiar de sección. No se modificará la navegación antes de revisar esta propuesta.

Orden técnico tras aprobación:

1. Frontend define la navegación en `app/dashboard/dashboard-client.tsx`, con enlaces de sección y estado activo accesible. El mes permanece en ese contenedor.
2. Frontend separa los controles de descarga hoy ubicados en `monthly-insights.tsx` y `financial-analytics.tsx`. Reportes conserva una selección explícita de mes o rango, según formato. Backend revisa que el uso de los endpoints coincida con sus contratos.
3. QA comprueba enlace directo, recarga y Atrás, foco con teclado, ancho móvil, persistencia de filtros, descarte de respuestas tardías y descargas. Code Reviewer y Security revisan aislamiento y regresiones.
