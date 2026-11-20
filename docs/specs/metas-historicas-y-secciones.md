# Metas históricas, eliminación y secciones del dashboard

## Alcance aprobado

- MH-01. El ahorro inicial de una meta nueva aumenta su progreso. No crea movimientos, aportes del período ni cambios de saldo.
- MH-02. Eliminar una meta propia sin aportes registrados elimina únicamente la meta. El disponible, el balance, los ingresos, los gastos y el ahorro por período permanecen iguales.
- MH-03. Si existe cualquier aporte vinculado, el borrado devuelve 409 y conserva meta, progreso e historial. La misma regla protege aportes legítimos y filas históricas ambiguas. Una meta ajena o inexistente devuelve 404. Los aportes y el borrado se serializan mediante el bloqueo de la meta.
- MH-04. El preflight es de solo lectura y acotado por propietario, meta y corte de versión. Sus coincidencias son candidatas a verificación. No modifica registros.
- DS-01. Inicio mantiene el contenido y el orden originales, incluyendo formularios y acciones. Solo se desplazan la analítica avanzada y las exportaciones.
- DS-02. Analítica conserva sus filtros. Reportes ofrece controles propios para CSV mensual y PDF/XLSX por rango. Los filtros no modifican el mes de Inicio.
- DS-03. Las secciones tienen enlaces directos, conservan el mes, funcionan con recarga y Atrás/Adelante y son operables con teclado en escritorio y móvil.

## Diagnóstico histórico

La implementación antigua añadía el ahorro previo a la meta y generaba un aporte indistinguible en su estructura de un aporte posterior. Ambos registros podían compartir el instante de creación en la misma transacción. La fecha civil de Bogotá y el corte verificable del despliegue acotan candidatos. El tipo de timestamp difiere entre tablas y exige conocer la zona de la sesión que escribió el dato. Fechas, montos y orden por sí solos no prueban el origen. El caso real queda sin clasificar hasta disponer de una copia autorizada y evidencia de la persona o del evento original.

Ejecutar `scripts/savings-initial-contribution-preflight.sql` en una copia autorizada con `psql` y las variables `owner_id`, `goal_id`, `legacy_ended_at` y `legacy_session_timezone`. El corte se toma del último escritor de la versión antigua con su offset, no del merge en Git. Si se desconoce la zona histórica, pasar una cadena vacía y revisar los indicios débiles manualmente. La salida incluye identificadores internos e importes y se conserva con acceso restringido. Las variables acotan la consulta y el operador debe verificar la autorización del caso.

Conciliación propuesta. Registrar en un expediente restringido el identificador del aporte, evidencia, aprobación, importe exacto y efecto por período. Usar un ajuste auditable enlazado al registro original, con identificador único y operación inversa, tras aprobar el modelo de datos. Antes y después comparar progreso, aportes legítimos, disponible, ahorro del período y reportes. Una corrección confirmada retira el débito inicial del flujo sin cambiar el progreso ni acreditar ingresos. Conservar los registros originales y las filas indecisas.

## Destino de aportes pendientes de autorización

| Opción | Contabilidad y auditoría |
| --- | --- |
| Liberar | Registrar un evento fechado que devuelve solo aportes legítimos al disponible, fuera de ingresos y gastos. Mantener los aportes del pasado. |
| Transferir | Reasignar la reserva a otra meta propia con evento auditado, bloqueo de ambas metas en orden estable y validación de capacidad. El disponible global no cambia. |
| Archivar | Conservar tanto la reserva como sus vínculos y ocultar la meta de las activas. Definir reactivación y representación en informes. |

Las tres opciones requieren definir persistencia y reglas de auditoría. No se elige un destino por defecto. Ejemplo: progreso 2.300.000 COP, compuesto por 2.000.000 previos y 300.000 en aportes. La API impide el borrado y conserva ambas cantidades hasta que exista una opción autorizada. Los 2.000.000 nunca se convierten en ingreso ni en devolución del disponible.

## Evidencia local

- PostgreSQL sintético verificó el alta, los centavos, el aislamiento, el borrado sin vínculos, la conservación de aportes y la carrera entre aportar y borrar. El preflight excluyó aportes posteriores al corte verificable y filas de otro propietario en tablas temporales.
- Chrome verificó la API y el aviso del borrado protegido, la conservación del mes al recargar, Atrás y Adelante, navegación por teclado y móvil, actualización del catálogo y cancelación de una descarga al cambiar de sección.
- Las regresiones de los tres incrementos incluyeron descargas CSV, PDF y XLSX. La lectura programática verificó paginación, fechas, límites, detalle y conciliación.
- Pasaron TypeScript, build y 33 pruebas unitarias. ESLint registró una advertencia preexistente. La comparación visual con el inicio de la rama conserva las tarjetas, paleta, tipografía y acciones rápidas móviles. El cambio visible en Inicio es la navegación superior y el traslado de las descargas a Reportes.
