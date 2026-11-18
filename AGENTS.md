<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Guía de Mi Bolsillo

## Arquitectura y convenciones

- `app/` contiene las rutas de Next.js App Router, las vistas, las acciones de autenticación y la API financiera en `app/api/finance/route.ts`. El panel está en `app/dashboard/`.
- `features/auth/` y `features/finance/` contienen esquemas Zod y servicios de dominio. Los servicios financieros cubren el panel, las transacciones, los presupuestos y las metas de ahorro.
- `auth.ts`, `auth.config.ts` y `proxy.ts` configuran la autenticación y la protección de rutas. `lib/auth/` resuelve la identidad desde la sesión y `lib/security/` contiene el control de frecuencia de solicitudes.
- `db/` contiene la conexión y el esquema de Drizzle para PostgreSQL. `drizzle/` contiene las migraciones y sus metadatos. `docker-compose.yml` define el PostgreSQL local.
- `scripts/` contiene utilidades, incluida la verificación de aislamiento por usuario. `public/` contiene los recursos estáticos.

Usa TypeScript, ESLint y las convenciones de formato, nombres y estructura de los archivos vecinos. Reutiliza los esquemas y servicios existentes cuando correspondan.

## Desarrollo, pruebas y PR

- Ejecuta desde la raíz `pnpm dev` para desarrollo, `pnpm lint` para lint, `pnpm build` para compilar y `pnpm start` para servir la compilación. La conexión a PostgreSQL requiere `DATABASE_URL` y la autenticación requiere `AUTH_SECRET`.
- El repositorio carece de un comando general `test`. Para verificar el aislamiento, usa `pnpm exec tsx scripts/security-isolation-check.ts` con `DATABASE_URL` apuntando a PostgreSQL local y las migraciones aplicadas. El script exige una base local.
- Añade pruebas de regresión para cambios de comportamiento cuando exista un mecanismo adecuado. Al incorporar pruebas, documenta el framework, la convención de nombres y el comando de la suite completa. Registra el umbral de cobertura si el proyecto adopta uno.
- Documenta los requisitos previos, los comandos exactos y las variables de entorno al introducir nuevos flujos de desarrollo o prueba. Verifica los comandos nuevos desde un checkout limpio.
- Usa resúmenes de commit breves y descriptivos. El historial usa `feat:` para funcionalidades. En los PR, describe qué cambió y cómo lo verificaste, enlaza los issues relacionados cuando existan e incluye capturas para cambios visibles de interfaz.

## Protección de datos financieros

- Obtén la identidad del usuario autenticado desde la sesión en el servidor antes de consultar o modificar datos financieros. Usa esa identidad para autorizar la operación e ignora cualquier identidad suministrada por el cliente.
- Restringe por usuario las lecturas, agregaciones y escrituras. Verifica que los recursos asociados, como categorías y metas, pertenezcan al mismo usuario.
- Valida las entradas en el servidor con los esquemas de dominio antes de usarlas para consultar o persistir datos.
- Mantén los secretos y las credenciales en el servidor. Limita las respuestas a los datos necesarios y omite secretos, datos financieros sensibles y detalles internos en logs, mensajes de error y evidencias de pruebas. Usa datos sintéticos en las verificaciones locales.

## Coordinador principal y flujo SDD

El agente principal actúa como Coordinador. Recibe las solicitudes, delimita el alcance e identifica riesgos y dependencias. Cuando haya especialistas disponibles, delega con alcance, archivos asignados y entregables claros. Si la sesión carece de especialistas, aplica el flujo en secuencia.

1. **Especificación.** Antes de implementar una funcionalidad importante, prepara una especificación SDD (Spec-Driven Development) en `docs/specs/` con alcance, exclusiones, supuestos, casos límite y criterios de aceptación verificables. Aplica el flujo completo a cambios relevantes en comportamiento financiero, autenticación, API, datos o flujos principales. Para ajustes menores, registra un criterio de aceptación en la tarea.
2. **Aprobación.** Confirma el alcance y los criterios acordados antes de implementar. Identifica los supuestos y consulta las dudas que cambien el alcance o la entrega. Pide aprobación explícita antes de cambios destructivos o de alto impacto.
3. **Planificación.** Desglosa la especificación en tareas vinculadas a sus criterios, ordénalas por dependencia y acuerda los contratos compartidos. Asigna un responsable por archivo. Si dos agentes necesitan editar el mismo archivo, secuencia las ediciones.
4. **Implementación.** Antes de editar código, el Coordinador verifica Git y crea o valida la rama de trabajo según las reglas de abajo. Mantén toda la implementación de Backend y Frontend en esa rama. Ejecuta las tareas según sus dependencias y respeta los requisitos acordados. Trabaja en paralelo cuando las tareas sean independientes y tengan archivos asignados distintos.
5. **QA.** Ejecuta las verificaciones pertinentes y vincula su evidencia con los criterios de aceptación. Reporta una prueba como aprobada únicamente si se ejecutó y su resultado lo confirma. Identifica las pruebas no ejecutadas, fallidas o bloqueadas.
6. **Revisión de código.** Revisa la corrección, la mantenibilidad y los riesgos de regresión. El Coordinador asigna las correcciones y verifica los criterios afectados.
7. **Seguridad.** Revisa amenazas y permisos durante la planificación cuando el cambio afecte a la autenticación, los datos sensibles o las dependencias. Antes de entregar, revisa los controles afectados en la implementación y verifica el aislamiento por usuario cuando corresponda.
8. **Entrega.** Antes de cerrar la tarea, el Coordinador ejecuta las verificaciones disponibles y solicita revisión a QA, Code Reviewer y Security cuando corresponda. Contrasta los resultados con los criterios de aceptación, consolida los hallazgos y propone commits pequeños, organizados y descriptivos. Informa qué se completó, qué evidencia lo verifica, qué sigue pendiente, qué rama creó o reutilizó y cuál es el estado de Git.

### Gestión de ramas Git

- Antes de implementar, verifica la rama activa, el estado de Git y los cambios locales preparados para commit, sin preparar y sin seguimiento. Comprueba qué commits locales contiene `main` y si incorpora la última versión de su rama remota, cuando exista.
- Crea y activa automáticamente una rama específica para cada funcionalidad o corrección. Usa `feat/nombre-funcionalidad`, `fix/nombre-correccion`, `refactor/nombre-cambio` o `chore/nombre-tarea`, según corresponda. Para la corrección de consistencia financiera, usa `fix/financial-consistency`.
- Parte de `main` actualizado siempre que puedas hacerlo sin sobrescribir ni perder cambios locales. Si hay trabajo sin commit, consérvalo y comprueba que crear o activar la rama no lo traslade accidentalmente. Usa un árbol de trabajo separado cuando permita aislar el trabajo de forma segura. Si la base o la propiedad de los cambios son ambiguas, escala la decisión antes de iniciar la implementación.
- Si la rama ya existe, verifica su base, commits, estado y uso en otros árboles de trabajo. Reutilízala solo si corresponde a la misma tarea y es seguro hacerlo.
- Trabaja siempre en la rama asignada durante la implementación. Nunca implementes directamente en `main`. No ejecutes `git reset --hard` ni `git clean -fd`, ni sobrescribas cambios existentes.
- Pide autorización explícita del usuario antes de crear commits, hacer push, merge o rebase, o abrir un pull request.

### Roles previstos

| Rol | Responsabilidad |
| --- | --- |
| `sdd` | Redactar la especificación y los criterios de aceptación. |
| `planner` | Descomponer el trabajo, ordenar las tareas, mapear dependencias y proponer responsables por archivo. |
| `backend` | Implementar la lógica de servidor, las API y la persistencia. |
| `frontend` | Implementar la interfaz y sus flujos de interacción. |
| `qa` | Diseñar y ejecutar pruebas, y reportar evidencia por criterio de aceptación. |
| `code_reviewer` | Revisar corrección, mantenibilidad y riesgos de regresión. |
| `security` | Revisar amenazas, permisos, aislamiento por usuario, datos sensibles y dependencias. |

Los siete roles quedan reservados para una etapa posterior de configuración.
