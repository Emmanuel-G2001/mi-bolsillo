# Libro de operaciones de metas de ahorro

Estado: diseño aprobado e implementación local autorizada. Base: PR #3 integrado. La política histórica aprobada es la reexpresión desde la fecha económica original. La reserva de la meta limita las operaciones, sin introducir un control de liquidez global. La conciliación de casos reales requiere aprobación independiente.

## Proyección contable

| Operación | Progreso | Reserva legítima | Disponible | Ingresos/gastos |
| --- | --- | --- | --- | --- |
| Ahorro previo al crear | Sube | Igual | Igual | Iguales |
| Aporte | Sube | Sube | Baja | Iguales |
| Liberación | Baja | Baja | Sube | Iguales |
| Transferencia | Baja en origen y sube en destino | Igual globalmente | Igual | Iguales |
| Archivo/restauración | Igual | Igual | Igual | Iguales |

El progreso distingue ahorro inicial, reserva legítima y componente legado sin verificar. Solo la reserva verificada puede salir de la meta. El legado conserva el efecto contable vigente hasta la verificación. Una meta nueva con inicial de 2.000.000 y aportes de 300.000 progresa 2.300.000 y permite operar como máximo sobre 300.000.

Balance mensual = ingresos − gastos. Disponible = neto acumulado vigente − aportes + liberaciones + ajustes de disponible aprobados, a fecha civil de Bogotá. Separar aportes brutos del período, liberaciones y reserva neta. El ahorro inicial jamás es ahorro generado en el período. CSV sigue representando únicamente movimientos. Inicio, Analítica, PDF y XLSX deben aplicar la misma proyección por usuario y corte. En reportes, un ajuste histórico se identifica como tal. Usar centavos exactos en dominio y contratos, con decimales PostgreSQL y strings en JSON.

## Modelo aditivo propuesto

- `savings_goals`: `initial_amount` decimal nullable para legado no clasificado, `archived_at` nullable y estado de procedencia si se necesita distinguir casos parciales. Añadir unicidad de `(user_id,id)` para las referencias compuestas. Conservar `current_amount` como proyección transaccional durante el despliegue.
- `savings_goal_operations`: diario de solo anexado, con propietario, UUID de operación, clase, monto decimal exacto, metas origen/destino, motivo acotado, fecha civil Bogotá calculada en servidor, instante de registro, versión del contrato y referencia a operación o aporte original cuando corresponda. La evidencia y autorización histórica se guardan con acceso restringido, fuera de las respuestas de usuario.
- Unicidad por propietario y UUID. La misma clave y carga normalizada devuelve el resultado original, incluyendo después de efectos posteriores. Una carga diferente con la misma clave devuelve 409. Guardar los datos mínimos del resultado para repetirlo. Restricciones por tipo para montos positivos, extremos válidos y origen distinto de destino. FK compuestas por propietario, protección de historia contra borrado e índices por usuario/fecha, meta/instante e identificadores originales. Una clasificación activa por aporte mediante una clave única y transición auditable.
- Mantener el importe legado original y su vínculo. La proyección comparte una fuente coherente entre Inicio y Analítica, con contribuciones antiguas y operaciones nuevas sin doble conteo. Conservar la transacción de lectura de PDF/XLSX. Mantener el bloqueo 409 de metas con cualquier historial, incluso si la reserva neta llega a cero.
- Impedir que el rol de aplicación edite, borre o trunque el diario y revisar las cascadas antes de activarlo. Validar que el aporte original corresponda a la misma meta, incluso entre metas de un propietario. Aplicar unicidad al efecto de una reversión completa por operación original, aunque se presenten distintos UUID. Una operación de conciliación solo puede partir de un expediente autorizado, separado de la API habitual.

## Escrituras, reversión y contrato

Orden de bloqueo fijo: propietario cuando proceda, metas por ID ascendente, y claves de operación según el contrato. Leer y validar bajo esos bloqueos la capacidad de destino, estado y reserva operable. Un fallo antes de confirmar deja intactos diario y proyecciones. Autenticar por sesión, usar el mismo propietario en cada extremo y responder 404 como para una meta inexistente. Nunca operar sobre legados no verificados. Evitar telemetría con motivos, importes o datos de evidencia. Paginar historial por orden estable con acceso del propietario.

Liberar todo o parte con motivo y confirmación. Transferir conserva la procedencia de la reserva y aumenta el destino sin modificar efectivo global. Archivo/restauración no cambian cifras. Propuesta para archivadas: historial de solo lectura y restauración; resto de mutaciones bloqueadas hasta restaurar. Borrado físico queda limitado a metas sin historia financiera ni operativa.

Reversión por asiento compensatorio enlazado, idempotente y atómico; nunca borrar o editar asientos. Si operaciones posteriores consumieron la reserva o la reversión infringiría un límite, detenerse para revisión, sin cascadas automáticas. Si se aprueba prohibir un disponible global negativo en aportes, el bloqueo de una meta es insuficiente: todos los escritores que alteran disponible deben coordinarse por propietario. Mantener como propuesta independiente del requisito de reserva no negativa.

## Caso histórico individual

El preflight `scripts/savings-initial-contribution-preflight.sql` acota propietario, meta y corte real de la versión antigua. Primer aporte, igualdad de fechas o montos e incluso hora coincidente son indicios. Usar copia autorizada o sesión autorizada de solo lectura, y mantener salida confidencial. Si hay más de un candidato plausible o falta evidencia, detenerse.

1. Obtener confirmación del usuario y evidencia independiente para un identificador exacto. Registrar corte, zona, IDs, importes y hash/versión de la evidencia en un expediente restringido. Tomar respaldo verificable y una instantánea de cifras por períodos relevantes.
2. Tras aprobación del esquema, del tratamiento contable y de la escritura real, bloquear las filas, revalidar propietario, meta, vínculo, importe, fecha, evidencia y ausencia de clasificación activa. Abortar ante divergencias.
3. Anexar una clasificación trazable que reconoce ahorro inicial y excluye el falso aporte de la proyección aprobada. Conservar su fila original, los aportes legítimos y el progreso. No crear ingresos, gastos ni movimiento CSV.
4. Conciliar en Inicio, Analítica, PDF y XLSX por períodos afectados y conservar la evidencia. Para revertir, anexar la operación inversa y comprobar los mismos cortes. Detenerse si la reversión entra en conflicto con operaciones derivadas.

La política aprobada reexpresa desde la fecha original. Conservar evidencia de las cifras anteriores en el expediente y regenerar los reportes afectados. No se hizo diagnóstico real.

Ejemplo de 100,00 registrados por error en enero y revisados en marzo: la reexpresión elimina el débito desde enero y no abona en marzo. El ajuste al corte conserva el efecto de caja de enero y aplica +100,00 en marzo como ajuste separado. Distinguir el ahorro publicado originalmente del corregido. Combinar ambos mecanismos abonaría dos veces. La reversión usa el mismo mecanismo y corte con efecto opuesto.

Propuesta de control: mantener una proyección transaccional de clasificación vigente por propietario y aporte, separada del diario inmutable. La reversión cierra la clasificación activa. Una nueva clasificación exige nueva evidencia aprobada. Verificar la secuencia corregir, revertir y volver a clasificar, y que dos reversiones concurrentes solo produzcan un efecto.

## Criterios SDD

- SM-01. Inicial 500,00 al crear: progreso 500,00, disponible e ingresos/gastos iguales. Aporte 120,00: progreso 620,00, reserva 120,00 y disponible −120,00.
- SM-02. Liberación parcial de 40,00: progreso 580,00, reserva 80,00, disponible +40,00. Liberar 80,01 falla sin escritura. Liberar 80,00 deja reserva cero y progreso inicial 500,00.
- SM-03. Transferencia parcial y total entre metas propias mantiene disponible, balance y CSV. Origen igual, destino ajeno, lleno o con capacidad insuficiente rechazan sin cambios. Exactitud al centavo.
- SM-04. Archivo y restauración conservan fondos, progreso e historia. Verificar política de archivadas y 409 de borrado con historia aun con reserva cero.
- SM-05. Repetición concurrente de llave registra un solo efecto. Misma llave con carga distinta devuelve 409. Dos operaciones concurrentes nunca producen reserva negativa. Probar aporte, liberación, transferencia inversa, borrado y rollback inyectado.
- SM-06. Legado ambiguo produce solo diagnóstico. Caso confirmado mantiene progreso y aportes legítimos; la reversión devuelve las proyecciones previas. Probar duplicados, evidencia desactualizada y bloqueo por fondos ya reasignados.
- SM-07. Dos usuarios: sesión como única identidad, ausencia de fuga de historial o metas destino. Interfaz con teclado, móvil, estados de error y confirmación, sin modificar Inicio ni pestañas.
- SM-08. Inicio, Analítica, PDF y XLSX concilian centavos y fechas. CSV conserva movimientos y balance mensual. Probar cambio de mes en Bogotá, fechas civiles XLSX y períodos cerrados.

## Entrega incremental y rollback

1. Aprobar decisiones contables, contratos y DDL aditivo. Crear migraciones revisables y probar en PostgreSQL desechable antes de autorizar cualquier aplicación persistente. Comparar proyecciones sin eventos nuevos y clasificar por procedencia verificable; sin backfill heurístico.
2. Backend implementa diario, bloqueos, idempotencia y API bajo activación controlada. Integrar después la proyección compartida en dashboard, analítica y reportes. Antes de aceptar eventos nuevos, retirar escritores antiguos que puedan saltarse las reglas.
3. Frontend agrega acciones y un historial dentro de las tarjetas de Metas, sin mover el dashboard. Mostrar origen y reserva operable, selector de destinos propios, confirmación con antes/después, carga y errores accesibles. Archivo visible en vista de metas archivadas y opción Restaurar.
4. QA ejecuta unitarias, PostgreSQL aislado con dos usuarios y las regresiones visuales y de informes en Chrome. Code Reviewer y Security validan antes de proponer PR.
5. Para rollback antes de emitir eventos, mantener las adiciones inactivas. Después de emitir eventos, bloquear las escrituras nuevas y mantener lecturas compatibles con el diario; volver al cálculo anterior perdería sus efectos. Restauración requiere reconciliación y un plan aprobado, preservando registros.

La autorización de migraciones se limita a PostgreSQL local con datos sintéticos. La aplicación persistente, la publicación y toda conciliación real requieren autorización independiente. La publicación futura partirá de main con PR #3 ya integrado.

## Implementación y validación local

- La migración `drizzle/0004_savings_goal_ledger.sql` crea el diario y añade los campos de metas. El diario protege vínculos y reversiones, y rechaza UPDATE, DELETE y TRUNCATE mediante un trigger. Revisar los permisos efectivos y restringir inserciones directas antes de un despliegue persistente.
- `POST /api/finance/goals` exige un UUID por operación. El PATCH anterior de aportes conserva su validación y respuesta, y ahora exige `Idempotency-Key` con un UUID válido. Los reintentos reutilizan la clave previa. El diálogo conserva la clave pendiente en la misma pestaña mediante una huella, sin guardar motivo ni importe legibles.
- El cierre conserva una meta de solo lectura y exige reserva cero y procedencia resuelta. La restauración corresponde a metas archivadas. Los aportes anteriores al diario se muestran paginados y mantienen su efecto vigente. No existe aún una operación de adopción para volver operables los aportes históricos legítimos.
- Para pruebas, aprovisionar PostgreSQL 16 desechable en loopback con la base `mi_bolsillo_qa` y definir `DATABASE_URL` hacia esa base. Desde la raíz ejecutar `pnpm exec drizzle-kit migrate`, `node --import tsx scripts/savings-goal-ledger-postgres-check.ts`, `node --import tsx scripts/financial-consistency-postgres-check.ts` y `node --import tsx scripts/security-isolation-check.ts`. Los dos primeros scripts de integración conservan fixtures inmutables hasta que se descarte la base.
- La suite de regresión usa Node 22 y `node --import tsx --test scripts/*.test.ts`. Validar también `pnpm exec tsc --noEmit --incremental false`, `pnpm lint` y `pnpm build`. La migración se ensayó con una base vacía y con una meta y aporte sintéticos preexistentes.
- El [procedimiento individual](conciliacion-individual-metas.md) es independiente de las operaciones de usuario y requiere autorización específica.
