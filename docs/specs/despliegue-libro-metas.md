# Despliegue y recuperación del libro de metas

Procedimiento para una ventana futura sujeta a autorización. El PR no autoriza merge, despliegue, conexión a producción ni migración. La rama excluye las vistas previas de Vercel. Antes de autorizar el merge, verificar también si la integración de Git activa un despliegue de main y coordinar la ventana.

## Orden obligatorio

1. **Preparar y congelar escritores.** Identificar la versión de aplicación y el destino aprobados sin registrar credenciales. Preparar el artefacto nuevo. Pausar tráfico que pueda escribir en metas y drenar solicitudes, procesos antiguos y tareas en segundo plano. Mantener el acceso restringido hasta validar el cambio.
2. **Respaldar.** Tomar snapshot coherente y registrar el punto de recuperación y la fecha. Restaurar el respaldo en una base aislada, comprobar su integridad y estimar tiempos de restauración. Verificar retención y permisos.
3. **Preflight.** Confirmar que las entradas del historial Drizzle coinciden con 0000–0003 y que no hay 0004 parcial ni divergencias con el esquema esperado. En la copia, probar 0004 con los datos restaurados autorizados. Medir tamaño de savings_goals/savings_contributions y costos de sus índices y bloqueos. Verificar restricciones, privilegios de migración y que el rol de aplicación no pueda desactivar triggers o alterar el esquema. Registrar recuentos y proyecciones de referencia en un expediente restringido. Cualquier diferencia, respaldo no recuperable o bloqueo fuera de la ventana detiene la ejecución.
4. **Aplicar primero el esquema.** Con un solo operador, desde el artefacto exacto revisado, configurar DATABASE_URL únicamente para el destino aprobado y ejecutar `pnpm exec drizzle-kit migrate`. Usar límites de espera de bloqueos acordados y observar tiempos y errores. No pegar SQL por partes ni manipular el historial de Drizzle. En caso de duda, comprobar estado y finalización antes de reintentar.
5. **Validar la migración con escrituras aún pausadas.** Confirmar que se registró exactamente 0004, que existen columnas, restricciones, índices y triggers, que el diario está vacío y que las metas/aportes existentes y las cifras base coinciden. 0004 solo añade DDL. No hace backfill, DELETE ni reclasificación. Verificar la regla operativa de solo anexado en la copia de ensayo.
6. **Activar luego el código nuevo.** Retirar escritores antiguos, activar la versión nueva y validar Inicio, Analítica, Reportes y las rutas con la configuración aprobada. Probar mutaciones con datos sintéticos en el entorno aislado. Reabrir tráfico tras conformidad del operador y monitorear errores de escritura, referencia, bloques, latencia y diferencias de proyección.

## Compatibilidad y riesgos

El historial se consulta, con el rol autorizado, mediante `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;`. Comparar las fechas con `drizzle/meta/_journal.json` y cada hash con el SHA-256 del SQL del artefacto. Si el historial está en otro esquema o falta, confirmar la configuración activa antes de ejecutar. El respaldo debe cubrir metadatos de Drizzle, tablas financieras e historial. Registrar la retención y el destino de restauración sin exponer datos ni credenciales.

| Combinación | Resultado |
| --- | --- |
| Código anterior y esquema anterior | Comportamiento vigente. |
| Código anterior y 0004, diario aún vacío | Las adiciones son compatibles con las consultas y escrituras antiguas iniciales. Evitar escritores mixtos: las altas y aportes antiguos pierden procedencia y escriben fuera del diario. |
| Código nuevo y esquema anterior | Incompatible. Las consultas y escrituras requieren las columnas y el diario. |
| Código anterior y 0004 después de registrar operaciones | Inseguro. Las lecturas antiguas omiten eventos y pueden mostrar saldos incorrectos. El borrado antiguo desconoce vínculos del diario. |

La migración toma bloqueos al añadir restricciones e índices a tablas existentes. Medir en copia representativa. La inmovilidad del diario y las referencias por propietario protegen la historia. Separar el rol migrador del rol de aplicación, revisar permisos efectivos e impedir escrituras directas por fuera del servicio. El PATCH de abonos exige ahora Idempotency-Key; identificar clientes previos antes de reabrir tráfico. Los aportes legados sin clasificar permanecen fuera de la reserva operable.

Antes de producción, ensayar una pausa de escrituras desde infraestructura y disponer de un artefacto de recuperación con lecturas del diario. La aplicación carece de un interruptor de escrituras propio. Una cuenta con asientos puede quedar protegida contra un borrado en cascada por las referencias del diario. Definir el procedimiento de retención y borrado de cuentas antes de activar el cambio.

## Recuperación

- **Error antes de confirmar 0004:** mantener escrituras pausadas, comprobar el estado real del esquema y del historial. Si hubo rollback íntegro, subsanar la causa y repetir en copia. Si el estado es incierto, comparar contra respaldo y restablecer en un destino aislado antes de decidir recuperación. Nunca marcar manualmente una migración como aplicada.
- **0004 confirmada, diario vacío:** si falla el código nuevo, conservar el esquema aditivo, comprobar que el diario sigue vacío y evaluar volver temporalmente al código anterior mientras se corrige el fallo. Mantener la pausa de escritores de metas para evitar legado nuevo.
- **Diario con operaciones:** desactivar escrituras de metas y mantener una versión que lea el diario. Corregir hacia adelante o diseñar recuperación y conciliación con preservación y replay verificable de operaciones confirmadas. Restaurar un respaldo anterior sobre el destino activo podría perder operaciones y requiere autorización separada. No borrar el diario ni volver a una versión que lo ignore.

La conciliación individual queda fuera de esta ventana. Seguir el [procedimiento y lista de evidencias](conciliacion-individual-metas.md) únicamente con autorización específica.
