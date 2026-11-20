# Conciliación individual de ahorro inicial histórico

Aplicar exclusivamente al caso aprobado. La implementación local no ha consultado a la persona afectada ni clasificado sus datos.

1. Obtener autorización para consultar una copia restringida o una conexión de solo lectura, y confirmar el propietario y la meta mediante los canales autorizados. Establecer el corte real del último escritor antiguo con offset y su zona de sesión. No usar un merge como sustituto de esa fecha.
2. Ejecutar `scripts/savings-initial-contribution-preflight.sql` con `psql` y las variables `owner_id`, `goal_id`, `legacy_ended_at` y `legacy_session_timezone`. Registrar candidatos e importes en acceso restringido. Si el corte, el propietario, el vínculo o el origen no se pueden probar, o si hay candidatos múltiples, detenerse. Un primer aporte o coincidencia de fecha, monto o instante no confirma el origen.
3. Incorporar confirmación explícita de la persona y evidencia adicional para un identificador exacto. Guardar constancia de aprobación de escritura, expediente, operador autorizado, referencia y SHA-256 de evidencia, propietario, meta, aporte, centavos, fecha económica, fecha de detección y respaldo verificable. Capturar cifras antes de la corrección por mes de Bogotá.
4. Solo con aprobación de la operación y del entorno, un operador autorizado usa el servicio de servidor `writeGoalOperation` como conciliación restringida, con `kind: "reclassify"`, IDs exactos, monto esperado y UUID idempotente, fecha económica esperada según el caso y metadatos aprobados. El servicio verifica propiedad, vínculo, importe, estado y clasificación activa dentro de la transacción. La fecha económica se deriva del aporte preservado. Si difiere del expediente, abortar la operación. Este procedimiento no usa un endpoint HTTP público.
5. Verificar después que el registro fuente y el progreso permanecen intactos. El disponible se corrige desde el mes original, el falso aporte deja de figurar en ahorro neto, los aportes legítimos permanecen y no aparece un ingreso. Conciliar Inicio, Analítica, PDF y XLSX desde el período de origen y comprobar que CSV conserva sus movimientos.
6. Si se autoriza revertir, usar el servicio interno con un nuevo UUID, la referencia a la clasificación y un expediente autorizado. La reversión restaura el efecto desde la fecha original. Conservar ambos eventos y conciliar de nuevo. Un reintento usa el mismo UUID. No borrar ni actualizar las filas del diario.

Conservar expediente, respaldo y versiones anteriores de los reportes en un canal restringido. Las evidencias de ejecución en código y PR deben contener únicamente datos sintéticos.

## Evidencias necesarias antes de identificar el registro

- Identificador exacto de propietario y de meta, verificados por un canal autorizado. Identificar el ID de cada aporte candidato y su vínculo fuente.
- Fecha de creación de la meta, fecha económica Bogotá, instante de escritura original y zona de la sesión antigua si está disponible. Acreditar el último escritor de la versión antigua mediante evidencia de despliegue con offset explícito.
- Importe al centavo, progreso al alta y progreso actual. Conservar referencia del alta original, historial de aportes legítimos posteriores y fuente que distinga el dinero que ya existía.
- Confirmación explícita de la persona sobre el monto, origen y meta. Adjuntar un soporte independiente, por ejemplo el evento de alta conservado o evidencia contemporánea que vincule el monto a esa operación. Fechas, montos o posición por sí solos son insuficientes.
- Expediente con respaldo verificable, consulta de solo lectura, proyecciones por período, referencia y hash SHA-256 de evidencia, operador autorizado y aprobación específica de escritura. Si la evidencia no individualiza un candidato sin contradicciones, detenerse.
