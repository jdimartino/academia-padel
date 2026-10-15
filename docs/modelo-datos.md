# Modelo de datos propuesto (Firestore)

Todo cuelga de una raíz por tenant:

```
academias/{tenantId}/...
```

El aislamiento entre academias es por subárbol. Las Security Rules
(`firestore.rules`) validan, en cada operación, que el usuario sea
**administrador activo** de `academias/{tenantId}`. **Por ahora solo el
administrador inicia sesión y opera**; profesor, alumno adulto, alumno menor y
representante son fichas del modelo, no usuarios con acceso (ver §0.1).

> El enum de roles se conserva tal cual para el futuro, pero hoy **profesor,
> alumno adulto, alumno menor y representante quedan "sin acceso por ahora"**. Recepción
> sigue SIN DEFINIR y no se crea como rol.

Convenciones:

- IDs generados por Firestore (`addDoc`) salvo los que conviene fijar
  (`tenantId`, `uid`).
- Fechas como `Timestamp`. El día de una clase también se guarda en `fecha`
  (`"YYYY-MM-DD"`, string) para poder filtrar por rango fácil y sin zona horaria
  ambigua; la hora va en `horaInicio`/`horaFin` (`"HH:mm"`).
- Dinero como entero en la unidad mínima (`montoCentavos`) + `moneda`, para
  evitar errores de punto flotante. *Sin definir todavía si se permite más de
  una moneda por academia.*
- Campos `creadoPor`, `creadoEn`, `actualizadoEn` en documentos mutables.
- Nada se borra físicamente si está referenciado: se marca `anulado`/`activo`.

---

## 0. Decisiones tomadas (2026-10-02)

Estas decisiones quedaron cerradas. No se re-debaten sin evidencia nueva.

| # | Decisión | Consecuencia en el modelo / en la infraestructura |
| --- | --- | --- |
| 1 | **Las sedes son live por tenant**: `academias/{tenantId}/sedes/{sedeId}`. | Cada academia define las suyas. No hay catálogo global de sedes. Las canchas siguen siendo subcolección de la sede. |
| 2 | **Una sola app React multi-tenant**, con el tenant resuelto por ruta (`/{academia}/...`). | El slug del documento del tenant es la clave de ruta. Un solo bundle, un solo `index.html`. |
| 3 | **Un solo sitio de Hosting** para todos los tenants. | El tenant se distingue por ruta, no por subdominio. Un solo certificado y una sola cuota de Hosting. |
| 4 | **Blaze se habilita más adelante**, cuando hagan falta Functions/Brevo, y con alerta de presupuesto. **Hoy no está habilitado.** | Todo lo de Fase 1 corre en el plan sin costo. Blaze es un trámite futuro, con su alerta de presupuesto como requisito. |
| 5 | **Comprobantes de pago en el MVP**: se guarda `referencia`, `montoCentavos`, `fecha` y `estado: "en_revision"`. Sin imagen. | Sin Cloud Storage no hay dónde subir el archivo. El campo `comprobante` queda `null`; el flujo de carga de imagen se activa cuando se habilite Storage. |
| 6 | **"Recepción" no es un rol nuevo**: es un administrador con permisos reducidos. | El enum de roles **no** crece: sigue siendo `administrador` \| `profesor` \| `alumno_adulto` \| `alumno_menor`. **El reparto exacto de permisos entre administración y recepción queda SIN DEFINIR.** |
| 7 | **Las reglas se quedan con `get()`** contra el documento de membresía. | Cada operación paga ~1 lectura adicional por la regla. Se acepta. Migrar a custom claims se pospone hasta que existan Functions/Admin SDK. |
| 8 | **`@firebase/rules-unit-testing` como devDependency.** | Los permisos por tenant y por rol se prueban de verdad contra el emulador, no a ojo. |
| 9 | **Aprovisionamiento del PROFESOR sin Functions** (Fase 7). El primer administrador se crea a mano; el admin crea las cuentas de profesor desde la app con una instancia secundaria de Auth y un documento `usuarios`. | El resto de cuentas (alumnos, representantes) sigue SIN DEFINIR. |

Además, en esta sesión se decidió el mecanismo de **reserva sin solapamientos**
(IDs deterministas + transacción). Ver §4.1.

### 0.1 Quién puede hacer qué (acceso por ahora)

**Decisión vigente: el administrador y el profesor inician sesión.** El resto
son fichas de datos, no cuentas de acceso. El admin entra por `miembros`; el
profesor, por `usuarios` (Fase 7) y solo a la pantalla de asistencia de sus
clases. `alumno_adulto`, `alumno_menor` y representante están **sin acceso por
ahora**. Recepción queda **SIN DEFINIR**.

| Quién | ¿Inicia sesión? | Puede leer | Puede escribir |
| --- | --- | --- | --- |
| `administrador` | Sí (`miembros`) | Todo su tenant (sedes, canchas, profesores, alumnos, clases, bloques, planes, cargos, pagos, notas de crédito, liquidaciones, miembros, usuarios) | Todo su tenant |
| `profesor` | Sí (`usuarios`, Fase 7) | **Solo sus propias clases** (`profesorId` == el de su acceso), su propio documento `usuarios` y su propia membresía si la tuviera. Nada de cobros, fichas de alumnos, parámetros ni otras colecciones de administrador | **Solo `asistenciaProfesor`** en sus clases ABIERTAS (`reservada`), sin tocar ningún otro campo |
| `alumno_adulto` | **No** (ficha) | Sólo su propia membresía | Nada |
| `alumno_menor` / representante | **No** (ficha) | Sólo su propia membresía | Nada |
| Recepción | **SIN DEFINIR** — no se crea | — | — |

El administrador abre clases (reserva), reprograma, cancela, registra asistencia
y cierra la clase, y más adelante marca el cobro como pagado. El profesor
**solo** carga la asistencia desde el móvil; el cierre (cobro y pago al
profesor) sigue siendo del admin. Los alumnos (o el representante, en menores)
**recibirán reportes de clase por email o Telegram**: no inician sesión, y el
envío es una capacidad futura sin implementar (§8).

La única lectura permitida a un no-admin sin acceso es su propia membresía
(arranque de sesión y descubrimiento de tenants). Con eso la app muestra el
aviso "Esta cuenta no tiene acceso a esta academia" y **no vuelve a leer nada**.
Un profesor **no tiene membresía**: descubre su academia con
`collectionGroup('usuarios')` (ver §1).

---

## 1. Colecciones raíz

### `academias/{tenantId}` (documento)

El tenant.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `nombre` | string | Nombre comercial de la academia |
| `slug` | string | Identificador legible para rutas/subdominio |
| `estado` | string | `activa` \| `suspendida` (suscripción al SaaS) |
| `plan` | string | `basico` \| `pro` … *sin definir* |
| `zonaHoraria` | string | p. ej. `America/Caracas` |
| `moneda` | string | p. ej. `USD` \| `VES` *sin definir multimoneda* |
| `creadoEn` | Timestamp | |

### `academias/{tenantId}/miembros/{uid}` (documento)

Une un usuario de Auth con un tenant y su rol. **Es la llave de autorización de
todo el sistema** (las reglas lo leen).

| Campo | Tipo | Nota |
| --- | --- | --- |
| `uid` | string | Igual a `request.auth.uid` (para el collection group) |
| `rol` | string | `administrador` \| `profesor` \| `alumno_adulto` \| `alumno_menor`. **Hoy solo `administrador` tiene acceso real**; alumno adulto/menor y representante quedan "sin acceso" (usuarios negativos de prueba). El **profesor NO usa esta membresía para su acceso**: el login del profesor vive en `usuarios/{uid}` (Fase 7); `miembros` con rol `profesor` se conserva solo por compatibilidad. **Decisión 6: no se agrega un rol "recepción"** — recepción es un `administrador` con permisos reducidos (*reparto exacto sin definir*). |
| `activo` | bool | |
| `nombre` | string | Denormalizado, para mostrar sin leer el perfil |
| `email` | string \| null | Opcional. Copia del email de Auth, útil para listar administradores sin leer Auth |
| `creadoEn` | Timestamp | |
| `actualizadoPor` | string \| null | uid del admin que cambió `activo` (opcional) |
| `actualizadoEn` | Timestamp \| null | Cuándo se cambió `activo` (opcional) |

**Escritura de membresías (Fase 7 — módulo Administradores):** solo un
`administrador` activo escribe membresías, y **nunca la propia**
(`request.auth.uid != uid`, para que un admin no se degrade ni se desactive a sí
mismo y no se pueda dejar el tenant sin administradores). La forma del documento
se valida con `membresiaValida` (claves permitidas, `uid == path`, rol del enum,
`activo` booleano). El alta que crea la cuenta de Auth pasa por
`crearAccesoAdmin` en `db.js` (la contraseña nunca se escribe en Firestore). La
lectura sigue siendo: admin ve todas las membresías del tenant, cualquiera ve la
suya.

> **Campos eliminados (login obsoleto):** `profesorId` y `alumnoId` en la
> membresía ya no se usan. La ficha se referencia por id desde las clases
> (`profesorId`, `alumnos[]`), no desde la membresía. El único vínculo
> `cuenta → ficha` vigente es el de profesor, y vive en `usuarios` (Fase 7).

**Descubrimiento al iniciar sesión** (una sola consulta acotada):

```js
collectionGroup('miembros').where('uid', '==', uid)
```

**Justificación subcolección vs top-level:** se eligió subcolección para que las
reglas sean por subárbol y no haga falta `where('tenantId','==',...)` en cada
consulta. Como contrapartida, el descubrimiento de tenants requiere un
*collection group query* (una sola lectura acotada). El `uid` está duplicado
como campo justamente para poder hacer ese collection group.

### `academias/{tenantId}/usuarios/{uid}` (documento, Fase 7)

Acceso de login de un **profesor**. Es **independiente de `miembros`**:
`miembros` sigue siendo la fuente del administrador y el profesor NO aparece
ahí. El documento enlaza la cuenta de Auth con la ficha de profesor y habilita
la asistencia desde el móvil. El admin lo crea/desactiva; el profesor solo lee
el suyo.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `uid` | string | Igual a `request.auth.uid` (y al id del documento; para el collection group) |
| `rol` | string | Siempre `profesor` (el único rol de esta colección) |
| `profesorId` | string | Debe apuntar a una ficha `profesores/{profesorId}` que EXISTA (lo valida la regla) |
| `email` | string | Copia del email de Auth |
| `activo` | bool | Desactivar = quitar el acceso sin borrar la cuenta |
| `creadoEn` | Timestamp | |
| `actualizadoPor` | string \| null | uid del admin que cambió `activo` |
| `actualizadoEn` | Timestamp \| null | |

**Descubrimiento del profesor al iniciar sesión** (una sola consulta acotada,
sin `miembros`):

```js
collectionGroup('usuarios').where('uid', '==', uid).where('activo', '==', true)
```

La regla comodín `match /{path=**}/usuarios/{uid}` solo permite listar el
documento PROPIO y activo. Un profesor **no puede** leer las colecciones de
administrador (alumnos, cobros, parámetros, etc.) porque no tiene `miembros`.

**Aprovisionamiento sin Functions:** el admin crea la cuenta de Auth con una
**instancia secundaria** de Firebase (`src/firebase/authProfesor.js`), de modo
que su propia sesión no se reemplaza. La contraseña temporal **nunca** se
guarda ni se loguea; el admin la comparte y el profesor la cambia. La cuenta de
Auth y el documento `usuarios` se crean juntos desde
`crearAccesoProfesor` (la capa de datos inyecta el `crearCuenta`).

---

## 2. Estructura organizativa

### `academias/{tenantId}/sedes/{sedeId}`

**Decisión 1: las sedes son live por tenant.** No existe un catálogo global de
sedes: cada academia define las suyas. Un tenant nuevo arranca sin sedes y las
carga por su cuenta.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `nombre` | string | "Traki" (5 canchas), "UNE" (2), "Santa Rosa" (4) y "Capital" (4) (tenant de ensayo). Requerido, normalizado y único en el tenant (sin distinguir caja, espacios de más ni acentos) |
| `direccion` | string | *sin definir formato* |
| `activa` | bool | |
| `orden` | number | Para ordenar en la UI |
| `horario` | map | Horario **por día de la semana**: claves `'0'` (lunes) … `'6'` (domingo), el mismo índice que `diaSemana` de `src/lib/fechas.js`. Cada día es `null` (cerrado) o `{apertura, cierre}` en **MINUTOS** desde medianoche, múltiplos de `MINUTOS_BLOQUE` (30), dentro de 0-1440 y con `cierre > apertura` (7:30 → 450). Si falta (sedes viejas) o está corrupto, `horarioDeSede` cae al default **07:00-23:00 los 7 días**. El formato VIEJO (un solo `{apertura, cierre}` en horas enteras 0-24) se sigue LEYENDO y se expande a los 7 días, pero al ESCRIBIR se exige el formato por día |
| `tarifas` | map | **Fase 3.** Precio por hora de cada perfil de cobro en ESTA sede: `{ <perfilId>: <cents> }` (entero de centavos entre 0 y `LIMITE_TARIFA_CENTS`). Una clave AUSENTE = "sin tarifa para ese perfil en esta sede". Lo escribe `setTarifasSede` (reemplaza el mapa completo) y lo valida `validarTarifas` contra los perfiles REALES de la academia. Si falta, la sede no sugiere precios (el admin carga el monto a mano) |

`horarioDeSede(sede)` devuelve el mapa de los 7 días y
`horarioDelDia(fecha, horarioSemanal)` la franja del día de esa fecha (o `null`
si la sede está cerrada), con la fecha interpretada en hora LOCAL (nunca
`toISOString()`).

`setSedeHorario(db, tenant, sedeId, semana)` valida el formato y rechaza el
cambio si deja fuera a alguna clase FUTURA no cancelada, comparando **cada clase
con el horario de su día** y en minutos (mensaje con la cantidad). Un día que
queda cerrado deja fuera a todas sus clases.

Las sedes **nunca se borran**: se desactivan (`activa: false`) y se reactivan.
Desactivar se rechaza si la sede tiene clases pendientes (no canceladas y cuyo
fin todavía no pasó); desactivada, la sede desaparece de la agenda y no admite
reservas nuevas ni reprogramaciones HACIA ella. Funciones: `crearSede`,
`renombrarSede`, `desactivarSede`, `reactivarSede` y, para la pantalla,
`listarSedes` (incluye las inactivas). Solo lo escribe el administrador (ver
firestore.rules).

### `academias/{tenantId}/sedes/{sedeId}/canchas/{canchaId}`

Subcolección de la sede (naturalmente acotada por sede; hasta 5 por AGENTS.md
del negocio).

| Campo | Tipo | Nota |
| --- | --- | --- |
| `nombre` | string | "Cancha 1" … Requerido, recortado, único en la sede (case-insensitive) y máx. 100 |
| `numero` | number | |
| `tipo` | string | `indoor` \| `outdoor` \| `otro` *sin definir catálogo* |
| `activa` | bool | Si falta, la cancha cuenta como activa (fallback). Solo el admin la escribe |

Las canchas **nunca se borran**: se desactivan (`activa: false`). Desactivada, la
cancha no admite reservas nuevas ni reprogramaciones HACIA ella; las clases que
ya la usan quedan intactas. Funciones: `crearCancha`, `renombrarCancha`,
`cambiarActivaCancha` y, para la pantalla, `listarCanchas` (incluye inactivas).

**Alternativa descartada:** guardar las canchas como array dentro de la sede.
Se descarta porque la reserva cruza cancha + fecha y conviene poder indexarlas;
y porque una cancha puede necesitar más campos (tarifas, tipo, estado).

---

## 3. Personas

### `academias/{tenantId}/profesores/{profesorId}`

| Campo | Tipo | Nota |
| --- | --- | --- |
| `nombre` | string | Requerido, recortado, máx. 200 |
| `apellidos` | string | Requerido, recortado, máx. 200 |
| `telefono` | string \| null | Opcional, máx. 30. Sin validación de formato |
| `email` | string \| null | Dato de contacto (futuro canal de avisos, §8), no credencial. Máx. 200 |
| `documento` | map \| null | Opcional: `{tipo: "cedula"\|"pasaporte", numero}`. Van los dos o ninguno; el número máx. 30 y sin validación de formato |
| `tarifaHoraCentavos` | number | **SIN DEFINIR / sin implementar.** La tarifa por hora es de facturación; `crearProfesor` no la escribe y el seed tampoco. |
| `sedes` | string[] | IDs de las sedes donde dicta. Solo esas sedes lo pueden asignar a una clase |
| `notas` | string | Opcional, máx. 1000 |
| `activo` | bool | |

Fichas creadas por `crearProfesor` / `actualizarProfesor` (soft delete con
`activo:false`). `getProfesores(db, tenant, {sedeId, estado, limite})`: con
`estado: "activos"` (default) devuelve solo los activos, con `"inactivos"` solo
los inactivos y con `"todos"` no filtra por activo; con `sedeId`, solo los
asignados a esa sede (`sedes` array-contains). `limite` es 200 por defecto y
tope duro. El orden es del lado del cliente: apellidos y después nombre (el
catálogo de profesores es chico). Mismo criterio en §6.

> **Campo eliminado (login obsoleto):** el antiguo `uid` (usuario de Auth del
> profesor) se quitó. El profesor es una ficha, no una cuenta.

### `academias/{tenantId}/alumnos/{alumnoId}`

| Campo | Tipo | Nota |
| --- | --- | --- |
| `tipo` | string | `adulto` \| `menor`. Lo elige el administrador; no hay fecha de nacimiento |
| `nombre` | string | Requerido, recortado, máx. 200 |
| `apellidos` | string | Requerido, recortado, máx. 200 |
| `busquedaNombre` | string | `"nombre apellidos"` en minúsculas y sin tildes (ni la tilde de la ñ). Lo escribe `db.js` al crear/editar. Campo del buscador por prefijo (`buscarAlumnos`, §6) |
| `busquedaApellido` | string | `"apellidos nombre"` normalizado igual que el anterior. Segundo campo del buscador y **clave de orden del listado** (`listarAlumnos`, §6) |
| `documento` | map \| null | Opcional: `{tipo: "cedula"\|"pasaporte", numero}`. Van los dos o ninguno; el número máx. 30 y sin validación de formato |
| `email` | string \| null | Dato de contacto (admin-only), máx. 200 |
| `telefono` | string \| null | Dato de contacto (admin-only), máx. 30 |
| `contactoEmergencia` | map \| null | Opcional: `{nombre, telefono}`. Van los dos o ninguno |
| `representante` | map \| null | Solo `menor` (requerido): `{nombre*, apellidos*, email?, telefono?}`. Los avisos van al representante |
| `fechaIngreso` | string | `"YYYY-MM-DD"`. Default: la fecha **local** de hoy (partes locales, nunca `toISOString()`) |
| `nivel` | string \| null | Opcional. Mismos 8 ids que `clase.categoria` (`principiante`, `7a`…`1a`), validado en `crearAlumno`/`actualizarAlumno`. Las etiquetas que ve el usuario se centralizan en `src/lib/agenda.js` (`etiquetaCategoria`) |
| `avisosActivos` | bool | Opt-in a recibir reportes. Default `true` al crear. |
| `activo` | bool | Soft delete: **nunca se borra físicamente**, se marca `false`. |
| `notas` | string | Opcional, máx. 1000 |
| `creadoPor` / `creadoEn` / `actualizadoEn` | | |

Los datos de contacto son **solo del administrador**: `firestore.rules` niega
lectura y escritura de `alumnos` a todo el que no sea administrador activo del
tenant.

**Ventana de aviso de ausencias: SIN DEFINIR.** Es un parámetro por academia y
no se hardcodea en el código.

**Alumno Menor:** se modela como un documento `alumnos` (no una cuenta de Auth)
más un `representante`. **El representante tampoco inicia sesión por ahora**: es
el contacto del menor (ver §8), enlazado al `alumno` por el mapa
`representante`. *Si en el futuro se le diera acceso, sería un `miembro` con rol
`alumno_menor`; hoy está sin acceso.*
*Sin definir si el representante gestiona varios menores.*

Fichas creadas/actualizadas por `crearAlumno` / `actualizarAlumno`; `getAlumno`
lee una y `buscarAlumnos` busca por nombre o apellido (mínimo 2 letras;
10 resultados por defecto, tope 50). `listarAlumnos` es el listado paginado de
la pantalla de Alumnos. Detalle de las tres en §6.

La reactivación es un `actualizarAlumno` con `activo: true` (el soft delete no
se revierte de otra forma): la ficha inactiva se abre igual en el sheet y el
toggle "Activo" la vuelve a habilitar.

> **Dato derivado:** `busquedaNombre` / `busquedaApellido` se escriben al crear o
> editar. Si cambia la normalización (por ejemplo, al empezar a plegar tildes),
> las fichas viejas conservan el valor anterior hasta que se vuelvan a guardar.

---

## 4. Reservas y asistencia

### `academias/{tenantId}/clases/{claseId}`

El corazón del sistema. Una clase cruza sede + cancha + profesor + fecha + hora
sin solapamientos.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `sedeId` | string | |
| `canchaId` | string | |
| `canchaNombre` | string \| null | Denormalizado (Fase 7). Lo escriben `crearClase`/`reprogramarClase` desde la ficha de la cancha. Necesario porque el profesor **no puede leer** `sedes`/`canchas`. |
| `profesorId` | string | |
| `fecha` | string | `"YYYY-MM-DD"` |
| `horaInicio` | string | `"HH:mm"` |
| `horaFin` | string | `"HH:mm"` |
| `tipo` | string | `fija` (recurrente) \| `variable` |
| `serieId` | string \| null | Une las clases fijas generadas de una serie |
| `categoria` | string \| null | Opcional. Una de `principiante`, `7a`, `6a`, `5a`, `4a`, `3a`, `2a`, `1a`. Se muestra como "Principiante", "7ª" … "1ª". Validado en `crearClase`/`reprogramarClase`; `null` si no se definió. |
| `categoriaGrupo` | string \| null | Opcional y **distinta** de `categoria` (el nivel): `infantil` \| `junior` \| `adulto`, o `null`. Validada en `crearClase`/`reprogramarClase` (y en firestore.rules); se muestra en la reserva y en el detalle de la clase. Todavía no afecta precios. |
| `cupo` | number | |
| `alumnos` | string[] | IDs de alumnos asignados. `crearClase`, `reprogramarClase` y `asignarAlumnos` los validan (existen, activos, sin duplicados, dentro del `cupo`). |
| `cobro` | map \| null | **Fase 3. SNAPSHOT** del precio acordado al reservar: `{perfilCobroId, modo, tarifaHoraCents, montoEstandarCents, montoCents, ajustado, motivoAjuste}` (montos en centavos). `montoCents` es el que se cobra; `montoEstandarCents` el sugerido por la tarifa y `ajustado` marca si se cambió a mano (con `motivoAjuste` ∈ `descuento`\|`cortesia`\|`acuerdo`\|`otro`). Cambios posteriores de tarifas **no** lo tocan. `null` = clase sin precio. Lo valida `validarCobro` en `crearClase`/`reprogramarClase` y `cobroValido` en firestore.rules |
| `asistencias` | map[] | `[{alumnoId, estado, motivo, registradoPor, registradoEn}]`. `estado` ∈ `presente` \| `ausente_avisada` \| `ausente_sin_aviso`; `motivo` opcional. |
| `asistenciaProfesor` | map \| null | **Fase 7. Asistencia que carga el profesor** desde el móvil en una clase ABIERTA: `{porAlumno: {alumnoId: estado}, registradoPor, registradoEn}`. `estado` ∈ `presente` \| `ausente_con_aviso` \| `ausente_sin_aviso` (enum PROPIO). Las reglas solo validan forma (mapa acotado, `registradoPor` == uid, timestamp); los VALORES del enum no se pueden validar en reglas y se validan en `db.js` + `src/lib/profesores.js`. Al cerrar, `cerrarClase` precarga `asistencias` desde acá (mapeando `ausente_con_aviso` → `ausente_avisada`) y sella `confirmadoPorProfesorId`. |
| `confirmadoPorProfesorId` | string \| null | **Fase 7.** `profesorId` que confirmó la asistencia desde el móvil, escrito por `cerrarClase` cuando la clase la cargó su profesor. |
| `estado` | string | `reservada` → `pendiente_cobro` → `cobrada`; también `cancelada`. `cerrarClase` (Fase 4) deja la clase en `pendiente_cobro`. `ejecutada` sigue existiendo en el enum pero ningún flujo la escribe. |
| `facturada` | bool | **Fase 4.** `true` si el cierre generó cobro (o quedó como cortesía facturada); `false` si se cerró con `seFactura: false` (fuerza mayor). `anularCierre` la pone en `false`. |
| `sedeNombre` | string | Denormalizado |
| `profesorNombre` | string | Denormalizado |
| `alumnoNombres` | string[] | Denormalizado (solo UI) |
| `bloques` | string[] | IDs de los bloques de 30 min que ocupa (§4.1). Los escribe y borra `db.js` en la misma transacción que la clase. |
| `creadoPor` | string | uid |
| `creadoEn` | Timestamp | |

**Asistencia embebida, no subcolección.** Justificación de costo: leer la clase
es **1 lectura** y ya trae la asistencia de todos los alumnos. Como subcolección
habría que leer N documentos de asistencia por clase. El documento no se acerca
al 1 MiB (pocos alumnos por clase). *Si en el futuro se necesitan consultas de
"asistencia por alumno" a través de clases, habría que evaluar una colección
aparte o un collection group; queda marcado.*

**Modalidad derivada del cupo:** no se guarda un campo `modalidad`. Una clase
con `cupo <= 1` se muestra como **Individual** (máximo 1 alumno) y con
`cupo >= 2` como **Grupal** (el cupo es el campo `cupo` de la clase; el valor por
defecto al crear, si no se especifica, es **4**). El título del bloque es
`Modalidad · Categoría` (solo modalidad si `categoria` es `null`). No confundir
con `tipo` (`fija` | `variable`).

**Asignación de alumnos:** la lista se guarda en `alumnos` y los nombres en
`alumnoNombres` (denormalizado). Se valida en la misma transacción: todos los IDs
existen, están `activo:true`, no hay duplicados y la cantidad no supera el
`cupo`. `asignarAlumnos` reemplaza la lista completa y solo se permite mientras
la clase está `reservada` (no en una clase ya cerrada). Los `bloques` son solo de
cancha y profesor: **no hay bloqueo por alumno**. Que un alumno quede en dos
clases a la misma hora **no se bloquea** y no se crean bloques de alumno; queda
como **nota de diseño**, sin resolver.

**Cierre de la clase (Fase 4):** `cerrarClase` escribe `asistencias`, el
SNAPSHOT final de `cobro` (por si se editó el monto al cerrar), los `cargos` de
los alumnos y el pago del profesor (`pagosProfesor`), todo en **una sola
transacción**, y deja la clase en `pendiente_cobro` con `facturada: true|false`.
Requiere exactamente **una entrada por alumno asignado** y solo acepta tres
estados: `presente`, `ausente_avisada` y `ausente_sin_aviso`, más un `motivo`
opcional. El sistema no recibe avisos: **el administrador decide** si la
ausencia fue avisada. **La ventana de aviso (horas) es un parámetro por
academia** (`avisoAusenciaHoras`; no se hardcodea en este flujo).

`registrarAsistencia` se conserva como atajo histórico: es `cerrarClase` con
`seFactura: false`, así que registra la asistencia y cierra la clase **sin**
generar cargos ni pago (fuerza mayor / casos viejos). Ver §5.3.

**El cobro (o no) de los alumnos ausentes ya está definido (Fase 4):** una
ausencia sin aviso genera un cargo `falta_sin_aviso` con el
`porcentajeFaltaSinAviso` % de la parte del alumno; una ausencia avisada no
genera cargo (su parte la absorbe la academia o se reparte entre los presentes
según `repartoAusenciaAvisada`). La **regla de negocio de la recuperación
(clase de recuperación vs nota de crédito)** y los planes mensuales siguen
**sin definir** (Fase 5).

**Precio de la clase (Fase 3):** al reservar/reprogramar se guarda un SNAPSHOT en
`cobro` (ver §5.2). Es solo el precio acordado: al reservar **no** genera
`cargos` ni movimientos. Al cerrar la clase (Fase 4, §5.3) `cerrarClase` usa ese
snapshot (o un monto manual) para generar los cargos y el pago al profesor.

**No solapamiento:** es una regla de **negocio** y se valida en la capa de
escritura (`src/firebase/db.js`), porque Firestore no tiene constraints únicos
ni condiciones de rango. El mecanismo elegido es la colección `bloques` con IDs
deterministas dentro de una transacción. Ver §4.1.

### Estados de la clase

```
reservada ──(asistencia)──▶ pendiente_cobro ──▶ cobrada
    │
    └──▶ cancelada
```

- `reservada`: creada, todavía no pasó. *Único estado en el que se puede
  reprogramar, cancelar o asignar alumnos.*
- `pendiente_cobro`: la clase ya se cerró (`cerrarClase`, Fase 4): asistencia
  registrada y `cargos`/pago al profesor generados (o ninguno, si
  `facturada: false`). `anularCierre` la devuelve a `reservada`.
- `cobrada`: la clase ya no tiene nada por cobrar: todos sus `cargos` y su pago
  al profesor están `pagado`/`anulado` (o no existen). La resuelven
  `marcarCargoPagado`/`marcarPagoProfesorPagado` y, si el cierre no produce nada
  (todo cubierto por crédito y sin pago), `cerrarClase` la deja así directo
  (Fase 5, §5.3/§5.4). `anularCierre` la devuelve a `reservada` si nada está
  `pagado`.
- `cancelada`: no se dictó. *Sin definir si una cancelada genera cargo o no.*

`ejecutada` permanece en el enum de `src/lib/agenda.js` por compatibilidad, pero
hoy ningún flujo la escribe.

---

## 4.1 Reserva sin solapamientos (`bloques`)

Firestore no tiene índices únicos ni condiciones de rango: no se puede pedir
"guardar esto solo si no choca con otra clase". La forma barata y determinista de
conseguir exclusividad es **materializar la ocupación como documentos con ID
predecible**: si el documento existe, el horario está ocupado.

### Ruta propuesta

```
academias/{tenantId}/bloques/{bloqueId}
```

**Justificación frente al modelo existente:**

- Se podría colgar de `sedes/{sedeId}` (las canchas ya son subcolección de la
  sede), pero **los bloques de profesor no cuelgan de ninguna sede**: un
  profesor trabaja en varias. Anidar bajo la sede obligaría a duplicar su
  bloqueo en cada sede donde trabaja, y a decidir cuál de las copias manda.
  Un solo namespace de IDs por tenant evita ese problema.
- Tampoco cuelga de `canchas/{canchaId}`: el bloque es de una fecha y hora, no
  de la cancha.
- Sí cuelga de `academias/{tenantId}`, igual que todo lo demás: las reglas siguen
  siendo por subárbol y ninguna consulta necesita `where('tenantId','==',...)`.
- Es una colección **derivada**: la fuente de verdad es `clases`. Si se pierde,
  se regenera desde las clases (cada clase guarda los IDs de sus bloques).
- No hace falta ningún índice compuesto: los bloques se leen **por ID**, con
  `doc()`/`getDoc()`. Lo único que se consulta por campo es la agenda, que ya
  usa `clases`.

### ID determinista

La granularidad es de **`MINUTOS_BLOQUE = 30`** minutos (la mitad del bloque de
pádel más corto que se vende).

- **Cancha:** `{sedeId}_{canchaId}_{YYYY-MM-DD}_{HHmm}`
  (p. ej. `traki_c1_2026-10-03_1800`).
- **Profesor:** `prof_{profesorId}_{YYYY-MM-DD}_{HHmm}`
  (p. ej. `prof_p1_2026-10-03_1800`).

`YYYY-MM-DD` y `HHmm` siempre con ceros a la izquierda (`1800`, no `800`), para
que el orden lexicográfico del ID coincida con el orden horario y los IDs de dos
clases contiguas no se confundan.

El prefijo `prof_` no es decorativo: garantiza que el namespace del profesor
sea disjunto del de las canchas, aunque existieran ids de sede/cancha que
empiezan por `prof`. El ID **no se parsea nunca** — todos los campos van
duplicados en el documento para poder consultar —, así que un `_` dentro de un
id de sede o cancha no rompe nada.

### Documento `bloques/{bloqueId}`

| Campo | Tipo | Nota |
| --- | --- | --- |
| `tipo` | string | `cancha` \| `profesor` |
| `sedeId` | string \| null | `null` si `tipo == profesor` |
| `canchaId` | string \| null | `null` si `tipo == profesor` |
| `profesorId` | string \| null | `null` si `tipo == cancha` |
| `fecha` | string | `"YYYY-MM-DD"` |
| `horaInicio` | string | `"HH:mm"` del bloque |
| `minutoInicio` | number | Minutos desde medianoche. Permite comparar rangos en memoria y ordenar sin parsear `"HH:mm"`. |
| `claseId` | string | Clase que ocupa el bloque |
| `creadoPor` | string | uid |
| `creadoEn` | Timestamp | |

Y en `clases/{claseId}` se agrega:

| Campo | Tipo | Nota |
| --- | --- | --- |
| `bloques` | string[] | IDs de los bloques que ocupa la clase (cancha + profesor). Permite cancelar sin recalcular ni volver a consultar `clases`. |

### Crear una clase (una sola transacción)

1. Se calcula la lista de bloques: la duración debe estar en
   **`DURACIONES_VALIDAS = [60, 90, 120]`** minutos y la hora de inicio debe
   caer en la grilla (**múltiplo de `MINUTOS_BLOQUE` (30) desde medianoche**);
   si no, la reserva se rechaza. Sin esa alineación una clase de 19:15
   bloquearía 19:15/19:45 y no chocaría con una que ocupa 18:00-19:30, aunque en
   la realidad se pisan. Con la grilla, `(horaFin - horaInicio) / 30` bloques de
   cancha **y** los mismos de profesor. Una clase de 90 minutos = 3 + 3 = 6.
2. `runTransaction`:
   - **Todas las lecturas primero** (Firestore exige que en una transacción no
     se lea después de escribir). Se hace `get()` de los 6 documentos por ID.
   - Si **existe cualquiera**, se aborta y se devuelve el bloque en conflicto.
   - Si no existe ninguno: se escribe la clase y después los 6 bloques.
3. Dos recepcionistas reservando el mismo horario a la vez: ambos leen "no
   existe", ambos intentan escribir, y el control de concurrencia optimista de
   Firestore hace que **uno solo** gane: la transacción del perdedor se aborta
   porque uno de los documentos que leyó cambió, se reintenta, ahora ve el
   bloque existente y aborta con `SolapamientoError`. Como la escritura usa
   `set()` (la API transaccional del SDK web no tiene `create()`), la
   exclusividad no depende del tipo de escritura sino de haber leído los bloques
   dentro de la misma transacción.

### Cancelar una clase (una sola transacción)

Se lee la clase, se pone `estado: "cancelada"` y se borran todos sus bloques en
la misma transacción. Los IDs se toman del campo `clases.bloques`, así que no
hay que recalcularlos (una clase editada no puede quedar con bloques viejos).

### Reprogramar una clase (una sola transacción)

`reprogramarClase` recalcula los bloques con los datos nuevos, lee los bloques
nuevos, aborta si alguno lo ocupa **otra** clase, borra los viejos que ya no se
usan, escribe los nuevos y actualiza la clase. Un bloque nuevo que ya pertenece
a esta misma clase no es conflicto: mover una clase sobre sus propios huecos es
válido (si no, se chocaría consigo misma).

### Costo dentro del free tier

Cuota sin costo: **20.000 escrituras/día**, **20.000 borrados/día**,
**50.000 lecturas/día**.

| Operación | Escrituras | Borrados | Lecturas de dato |
| --- | --- | --- | --- |
| Crear clase de 90 min | 1 (clase) + 6 (bloques) = **7** | 0 | 0 en el caso normal (los bloques no existen: no hay documento que leer); 6 en el peor caso |
| Cancelar clase de 90 min | 1 (clase) | **6** (bloques) | 1 (la clase) |

- **~2.800 clases de 90 minutos creadas por día** agotarían las escrituras
  gratuitas. Un tenant real de academias está muy por debajo de eso.
- Los bloques no se consultan por campo, así que **no agregan índices** ni
  lecturas a las pantallas de agenda.
- **Cuidado con las lecturas de las reglas (decisión 7):** cada escritura de
  bloque vuelve a ejecutar `esAdmin()`, que hace un `get()` de la membresía. Una
  reserva de 90 minutos son ~7 lecturas de reglas. Con 50.000 lecturas/día
  alcanza para miles de reservas diarias, y sigue siendo el argumento a favor
  de custom claims cuando exista Admin SDK.
- Almacenamiento: ~150 bytes por bloque. 1 GiB de cuota alcanzan para del orden
  de un millón de bloques.

---

## 5. Facturación y cobros

### `academias/{tenantId}/planes/{planId}` (cuotas mensuales recurrentes)

| Campo | Tipo | Nota |
| --- | --- | --- |
| `nombre` | string | p. ej. "Mensual 2 clases/semana" |
| `alumnoId` | string | |
| `montoCentavos` | number | |
| `periodicidad` | string | `mensual` |
| `diaCobro` | number | Día del mes *sin definir* |
| `activo` | bool | |

### `academias/{tenantId}/cargos/{cargoId}` (cuentas por cobrar)

> **Actualizado en Fase 4:** la forma vigente de un cargo (generado al cerrar la
> clase) está en **§5.3**. La tabla de abajo es el borrador original
> (`montoCentavos`/`moneda`/`periodo`), que se descartó. Se conserva como
> referencia histórica.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `alumnoId` | string | |
| `alumnoNombre` | string | Denormalizado |
| `concepto` | string | `clase` \| `mensualidad` \| `otro` |
| `claseId` | string \| null | Si `concepto == clase` |
| `planId` | string \| null | Si `concepto == mensualidad` |
| `periodo` | string | `"YYYY-MM"` para agrupar |
| `montoCentavos` | number | |
| `moneda` | string | |
| `estado` | string | `pendiente` \| `pagado` \| `anulado` |
| `anuladoPor` | string \| null | uid |
| `creadoEn` | Timestamp | |

### `academias/{tenantId}/pagos/{pagoId}` — OBSOLETA / NO PLANIFICADA

> **Obsoleta.** El **único modelo de pago** es el cargo (`cargos`) con
> `estado`/`metodoPago` (§5.3 y §5.4). Esta colección (`en_revision`/`aprobado`,
> con `cargoIds`) **no se usa ni se va a implementar**; se conserva la tabla por
> compatibilidad de datos existentes y el `match` de reglas.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `alumnoId` | string | |
| `cargoIds` | string[] | Cargos cubiertos |
| `montoCentavos` | number | |
| `metodo` | string | *sin definir catálogo* |
| `referencia` | string | Referencia de la transferencia / pago |
| `fechaPago` | Timestamp | Fecha declarada por quien paga |
| `comprobante` | map \| null | **Decisión 5**: sin Storage no hay dónde subir el archivo. En el MVP queda siempre `null` y no se captura imagen. |
| `estado` | string | `en_revision` \| `aprobado` \| `rechazado`. El alta siempre arranca en `en_revision`. |
| `motivoRechazo` | string \| null | |
| `revisadoPor` | string \| null | uid |
| `creadoEn` / `revisadoEn` | Timestamp | |

### `academias/{tenantId}/notasCredito/{notaId}`

| Campo | Tipo | Nota |
| --- | --- | --- |
| `cargoId` | string | |
| `alumnoId` | string | |
| `montoCentavos` | number | |
| `motivo` | string | |
| `creadoPor` | string | uid |
| `creadoEn` | Timestamp | |

**Justificación de colecciones separadas:** `cargos` y `notasCredito` crecen en
el tiempo y se consultan por alumno/periodo/estado. Tenerlos como colecciones
permite acotar por esos campos e indexar. Meterlos como arrays dentro de
`alumnos` haría crecer el documento del alumno sin límite y obligaría a leer toda
la historia para mostrar el saldo.

**Saldo del alumno:** se calcula con agregaciones (`sum`) sobre `cargos`, no se
almacena un contador mutable (evita escrituras y contención por el límite de
~1 escritura/segundo por documento). *Sin definir si se cachea un saldo
denormalizado.*

### Liquidación de profesores — OBSOLETA / NO PLANIFICADA

> **Obsoleta.** Hoy el pago al profesor es por clase, en `pagosProfesor` (§5.3).
> La liquidación mensual en `academias/{tenantId}/liquidaciones/{liquidacionId}`
> queda **no planificada**; se conservan la tabla y el `match` de reglas por
> compatibilidad.

Pago por hora: hacen falta las horas efectivamente dictadas.

- Opción A: calcular al vuelo desde `clases` ejecutadas del período (0 escrituras,
  muchas lecturas).
- Opción B: generar `academias/{tenantId}/liquidaciones/{liquidacionId}` al
  cerrar el mes, con detalle embebido.

**Sin definir / no planificada.** No se construye UI ni modelo final.

---

## 5.1 Listado, búsqueda y paginación de fichas

Tres funciones de `db.js` cubren las pantallas de Alumnos y Profesores. Todas
están acotadas por tenant y por límite; ninguna puede traer la colección entera.

### `listarAlumnos(db, tenantId, { estado, limite, despues })`

Listado paginado de la pantalla de Alumnos. Devuelve `{ alumnos, siguiente }`.

- `estado`: `"activos"` (default) | `"inactivos"` | `"todos"`. Cualquier otro
  valor cae en `"activos"`. Con `"activos"`/`"inactivos"` la consulta lleva
  `where('activo','==',true|false)`; con `"todos"` no lleva condición de activo
  (alcanza el índice de un solo campo).
- `limite`: tamaño de página, **100 por defecto y tope duro** (se recorta con
  `Math.min`).
- `despues`: cursor de la llamada anterior (`null` en la primera). La consulta
  es `orderBy('busquedaApellido')` + `startAfter(despues)`.
- **Orden accent-insensitive por apellido.** Firestore ordena strings por bytes
  UTF-8, así que `Ávila` o `Ñáñez` se irían al final si el campo llevara tildes.
  Por eso `busquedaApellido` se guarda plegado (minúsculas, sin tildes y con la
  ñ como `n`): el orden por bytes coincide con el alfabético. El desempate
  dentro del mismo apellido es por el nombre, que ya viene en el mismo campo
  (`"apellidos nombre"`).
- **Cursor.** Se pide `limite + 1` documentos: si llegan `limite + 1` hay más
  páginas, se recorta la lista a `limite` y el documento `limite + 1` se
  devuelve como cursor. No se reescribe ni se inventa un `orderBy` por id: el
  cursor es el `DocumentSnapshot` de Firestore.
- **Costo:** `limite + 1` lecturas por página. Una visita a la pantalla son 100
  lecturas de arranque, más 100 por cada "Cargar más".

### `buscarAlumnos(db, tenantId, texto, { estado, limite })`

Buscador por prefijo de nombre O de apellido (`>=` / `<=` sobre
`busquedaNombre` y `busquedaApellido`, en paralelo y sin duplicados).

- Mínimo 2 letras normalizadas (si no, devuelve `[]` sin leer nada).
- `limite`: 10 por defecto, **tope 50**. Los llamadores históricos (selector de
  alumnos de la reserva) siguen con el default de 10 activos.
- `estado`: igual que en `listarAlumnos`. La pantalla de Alumnos usa 30 y
  avisa "Hay mas resultados" cuando llega justo al tope.
- El texto se normaliza igual que los campos, así que buscar `munoz` encuentra
  a `Muñoz` y buscar `nunez` encuentra a `Núñez`.

### `getProfesores(db, tenantId, { sedeId, estado, limite })`

Lista de la pantalla de Profesores. Sin paginación: el catálogo es chico.

- `limite`: 200 por defecto y tope duro.
- `estado`: `"activos"` (default) | `"inactivos"` | `"todos"`.
- `sedeId`: `sedes` array-contains, se conserva con cualquier estado.
- El orden es **client-side**: `apellidos` y después `nombre`.

---

## 5.2 Configuración de cobros (Fase 3)

Fase 3 es **configuración**: se guardan perfiles de cobro, tarifas por sede y
parámetros de negocio, y se **sugiere** un precio al reservar. **No** se generan
cargos, pagos, créditos ni liquidaciones (eso sigue sin definir, ver §7). Todo el
dinero se guarda en **enteros de centavos de USD** (`src/lib/dinero.js`); nunca
hay floats guardados.

### `academias/{tenantId}/perfilesCobro/{perfilId}`

| Campo | Tipo | Nota |
| --- | --- | --- |
| `nombre` | string | Requerido, normalizado y único en el tenant (sin distinguir caja, espacios ni acentos), máx. 100 |
| `personas` | number \| null | 1..4 o `null` (= cualquiera, p. ej. Corporativo). Es la cantidad que "encaja" con el `cupo` de una clase |
| `modo` | string | `total` \| `por_persona`. Con `por_persona` el monto se multiplica por la cantidad de alumnos |
| `activo` | bool | Soft delete: **nunca se borran**, se desactivan |
| `orden` | number | Orden de presentación; si falta se asigna el siguiente entero |

Los **defaults** (`PERFILES_COBRO_DEFAULT` en `src/lib/cobros.js`) tienen `id`
FIJO para que el seed escriba las tarifas por sede apuntándolos y la app los
reconozca: `individual` (1), `pareja` (2), `tres` (3), `cuatro` (4),
`corporativo` (`null`) y `especial` (`null`). Funciones: `listarPerfilesCobro`
(incluye inactivos; acotada por tenant y `limit(50)`), `crearPerfilCobro`,
`actualizarPerfilCobro` y `cambiarActivaPerfilCobro` (soft delete). Solo las
escribe el administrador.

### `academias/{tenantId}/config/parametros` (documento único)

Parámetros de negocio de la academia. Un solo documento; si falta o está
incompleto, `leerParametros` rellena campo por campo con `PARAMETROS_DEFAULT`.

| Campo | Tipo | Default | Nota |
| --- | --- | --- | --- |
| `avisoAusenciaHoras` | number | `24` | 0..168. Ventana de aviso de una ausencia |
| `porcentajeFaltaSinAviso` | number | `50` | 0..100. % a cobrar por una ausencia sin aviso |
| `pagoProfesor` | map | `{modo:'por_hora', montoCents:1500}` | `modo` ∈ `por_hora`\|`por_clase`; `montoCents` entero >= 0 |
| `descuentoHermanosPct` | number | `10` | 0..100 |
| `duracionesPermitidas` | number[] | `[60,90,120]` | Lista no vacía, sin repetidos, ascendente, múltiplos de 30 entre 60 y 240. **Fuente de verdad de las duraciones de una clase** (`bloquesDeClase`) |
| `vencimientoCreditoDias` | number \| null | `null` | `null` = no vence; si no, 1..365 |
| `alertaCobro` | map | `{dias:2, referencia:'clase'}` | `dias` 0..30; `referencia` ∈ `clase`\|`vencimiento` |
| `restringirCategoriaPorFranja` | bool | `false` | *Sin implementar todavía* |
| `repartoAusenciaAvisada` | string | `absorbe_academia` | **Fase 4.** `absorbe_academia` \| `reparte_entre_presentes`. Solo importa en modo `total`: si un alumno avisó su ausencia, su parte se la queda la academia o se reparte entre los presentes |
| `pagoProfesorSiTodosFaltanSinAviso` | string | `completo` | **Fase 4.** `completo` \| `proporcional_cobrado` \| `nada`. Qué se le paga al profesor cuando NADIE asistió y hubo al menos una falta sin aviso |
| `faltaSinAvisoConCredito` | string | `descuenta_completo` | **Fase 5.** `descuenta_proporcional` \| `descuenta_completo` \| `cobra_aparte`. Qué hace una falta sin aviso cuando el alumno tiene crédito: descuenta el `porcentajeFaltaSinAviso` % de los minutos de la clase (half-up), descuenta la clase completa o genera el cargo normal |
| `creditoRequierePago` | bool | `true` | **Fase 5.** `true` = el crédito solo sirve cuando la `mensualidad` de ese lote está `pagado`; `false` = sirve apenas se crea el lote. Por defecto el crédito es usable **solo después** de pagar el cargo de mensualidad |

Funciones: `getParametros` (1 lectura, tolerante), `validarParametros`
(obligatoria antes de escribir; completa con defaults y rechaza campos/rangos
inválidos) y `setParametros` (cambios parciales que se mezclan sobre los
actuales). Solo el administrador escribe.

### `academias/{tenantId}/config/tasas` (documento único, Fase 6)

Tasa de referencia **BCV** para mostrar equivalencias: **Bs por USD** y **Bs por
EUR**. Es informativa — **no mueve dinero**: todos los montos siguen en centavos
de USD. La app la actualiza sola desde una API pública (con caché y respaldo) y
el admin puede fijarla a mano.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `bsPorUsd` | number | Bs por 1 USD. > 0 y <= 100000000 |
| `bsPorEur` | number | Bs por 1 EUR. > 0 y <= 100000000 |
| `fecha` | string \| null | `"YYYY-MM-DD"` de la tasa BCV, o `null` en una tasa manual |
| `fuente` | string | `api` \| `manual` |
| `actualizadoPor` | string \| null | uid del admin (o `null` si la guardó la app) |
| `actualizadoEn` | Timestamp | Sello de la última escritura |

Funciones: `getTasas` (1 lectura, `null` si falta o está corrupto),
`validarTasas`/`leerTasasDoc` y `setTasas`. Solo el administrador lee y escribe;
el documento no se borra. La conversión pura vive en `src/lib/tasas.js`.

### Precio de una clase (`clase.cobro`)

Al reservar o reprogramar, el formulario **sugiere** el monto:

`sugerirPrecioCents({tarifaHoraCents, duracionMin, modo, cantidadAlumnos})` =
`tarifaHoraCents × duracionMin / 60`, multiplicado por `cantidadAlumnos` cuando
el modo es `por_persona` (redondeo half-up a centavos). Devuelve `null` si no
hay tarifa para ese perfil en esa sede (el admin carga el monto a mano).

El resultado se guarda como SNAPSHOT en `clase.cobro` (campos en §4). Al
reprogramar, `recalcularCobro(cobroActual, sugerido)` actualiza el monto si la
clase no fue ajustada a mano, y si lo fue conserva el monto y el motivo pero
refresca `montoEstandarCents`. `validarCobro` es la validación de tipos/enums/
montos del snapshot; `cobroValido` la repite en firestore.rules. **Nada de esto
mueve dinero**: es el precio acordado, a la espera de la fase de cargos.

---

## 5.3 Cierre de clases y cobros (Fase 4)

Cerrar una clase (`cerrarClase`) genera, en **una sola transacción**, la
asistencia, el snapshot final de `cobro`, los `cargos` de los alumnos y el pago
al profesor (`pagosProfesor`). Todo el cálculo vive puro en
`src/lib/cobros.js` (`calcularCierre`) y la capa de datos solo valida y persiste.

### `academias/{tenantId}/cargos/{cargoId}` (Fase 4)

`cargoId` es **determinista**: `${claseId}_${alumnoId}`. Un reintento reescribe
el mismo documento, así que nunca se duplica.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `claseId` | string | |
| `alumnoId` | string | |
| `alumnoNombre` | string | Denormalizado |
| `sedeId` | string \| null | `null` en un cargo de `mensualidad` |
| `fecha` | string | `"YYYY-MM-DD"` de la clase (o de la compra); filtro de los listados |
| `concepto` | string | `clase` \| `falta_sin_aviso` \| `mensualidad` \| `otro`. En `mensualidad` (Fase 5) `claseId: null` y `creditoId` obligatorio |
| `creditoId` | string \| null | Solo `mensualidad`: lote que paga este cargo |
| `planId` / `planNombre` | string \| null | Solo `mensualidad`: plan denormalizado |
| `montoCents` | number | Entero de centavos >= 0. Los cargos de 0 no se crean |
| `estado` | string | `pendiente` \| `pagado` \| `anulado` |
| `pagadoEn` | Timestamp \| null | |
| `metodoPago` | string \| null | `efectivo` \| `zelle` \| `pago_movil` \| `transferencia` \| `otro` |
| `creadoEn` | Timestamp | |

> Este esquema **reemplaza** al borrador previo de `cargos`
> (`montoCentavos`/`moneda`/`periodo`/`anuladoPor`). El `periodo` se descartó:
> cada cargo es de una clase (o de una mensualidad) y se filtra por `sedeId` +
> `fecha`; el cargo con `estado`/`metodoPago` es el **único modelo de pago**
> (Fase 5, §5.4). Los índices compuestos se ajustaron en consecuencia (§6).

### `academias/{tenantId}/pagosProfesor/{pagoId}` (Fase 4)

`pagoId` es **determinista**: `${claseId}`. **No** es la colección `pagos`
(obsoleta/no planificada) ni `liquidaciones` (tampoco planificada).

| Campo | Tipo | Nota |
| --- | --- | --- |
| `claseId` | string | También es el id del documento |
| `profesorId` | string | |
| `profesorNombre` | string \| null | Denormalizado |
| `sedeId` | string | |
| `fecha` | string | `"YYYY-MM-DD"` de la clase |
| `montoCents` | number | Entero >= 0. Si da 0, **no se crea** el pago |
| `base` | map | `{modo: por_hora\|por_clase, minutos}` del cálculo base |
| `estado` | string | `pendiente` \| `pagado` \| `anulado` |
| `pagadoEn` | Timestamp \| null | |
| `metodoPago` | string \| null | Mismo catálogo que un cargo |

### Reglas del cálculo (`calcularCierre`)

- **Monto de la clase:** `cobro.montoCents`. Si el modo es `por_persona` y no
  fue ajustado, se recalcula `tarifaHoraCents × duración / 60` **por alumno**
  (half-up, con los alumnos reales); si fue ajustado, `montoCents` es el total.
  Sin `cobro`, el cierre exige un monto manual (que queda `ajustado: true`).
- **Reparto:** modo `total` → partes iguales entre los asignados (el resto de
  centavos va a los primeros, para sumar exacto); `por_persona` → la parte de
  cada uno.
- `presente` → cargo `clase` por su parte. `ausente_sin_aviso` → cargo
  `falta_sin_aviso` con `porcentajeFaltaSinAviso` % (half-up). `ausente_avisada`
  → sin cargo; con `repartoAusenciaAvisada = reparte_entre_presentes` (solo modo
  `total`) su parte se reparte entre los presentes.
- **Cortesía** (monto 0 con motivo `cortesia`): no registra nada para alumnos.
- **Pago al profesor:** base = `pagoProfesor.montoCents × duración / 60`
  (`por_hora`) o el monto (`por_clase`). Completo si al menos uno vino (también
  en cortesía). Si nadie vino y hubo faltas sin aviso, según
  `pagoProfesorSiTodosFaltanSinAviso`. Si todos avisaron, 0.
- `seFactura: false` → sin cargos ni pago, la clase queda `facturada: false`.

### Funciones de `db.js`

`cerrarClase`, `marcarCargoPagado(cargoId, {metodoPago})`,
`marcarPagoProfesorPagado(pagoId, {metodoPago})` (pago **completo**; los
parciales quedan fuera de alcance), `anularCierre(claseId)` (solo si nada está
`pagado`: marca `anulado` y devuelve la clase a `reservada`),
`listarCargosPendientes` y `listarPagosProfesorPendientes` (filtran por sede y
rango de fechas, página de 50, tope 100) y `getCierreDeClase` para el detalle.

### Estado de la clase tras el cierre

```
reservada ──(cerrarClase)──▶ pendiente_cobro ──(marcar pagado)──▶ cobrada
    ▲                              │                              │
    └──────(anularCierre)──────────┴──────────────────────────────┘
```

`cerrarClase` deja la clase **`cobrada`** de una vez cuando el cierre no produce
nada por cobrar (por ejemplo, todo cubierto por crédito y sin pago al profesor).
Si no, queda `pendiente_cobro` y pasa a `cobrada` cuando **todos** sus cargos y
su pago están `pagado`/`anulado` (o no existen): lo resuelve
`marcarCargoPagado` / `marcarPagoProfesorPagado` sin consultas dentro de la
transacción, con los IDs deterministas.

`anularCierre` se permite en `pendiente_cobro` o `cobrada` mientras **nada** esté
`pagado`; revierte los movimientos de crédito (devuelve los minutos a sus lotes),
anula cargos y pago, y deja la clase en `reservada` para cerrarla de nuevo (los
IDs deterministas se reescriben).

---

## 5.4 Mensualidades y créditos (Fase 5)

Un alumno puede pagar por adelantado un plan de horas (`planesAlumno`) y consumir
esas horas al cerrar la clase. Todo se guarda como **lotes de crédito**
(`creditos`) con **movimientos** deterministas (`movimientosCredito`) y un cargo
de `mensualidad`. El vencimiento es **perezoso** (no hay Functions ni jobs): un
lote se evalúa al leerlo y al consumirlo.

### `academias/{tenantId}/planesAlumno/{planId}`

| Campo | Tipo | Nota |
| --- | --- | --- |
| `alumnoId` | string | |
| `nombre` | string | Requerido, recortado, máx. 100 |
| `frecuencia` | string | `semanal` \| `mensual` |
| `minutosIncluidos` | number | Entero > 0 y múltiplo de `MINUTOS_BLOQUE` (30) |
| `precioCents` | number | Entero de centavos > 0 (el precio de la mensualidad) |
| `descuentoHermanos` | bool | **Solo alumnos menores**: descuenta `descuentoHermanosPct` % del precio |
| `activo` | bool | Un alumno puede tener **como mucho un plan activo** |
| `creadoEn` / `actualizadoEn` / `actualizadoPor` | | |

Funciones: `crearPlanAlumno`, `actualizarPlanAlumno`, `desactivarPlanAlumno`
(soft delete: NUNCA se borran), `getPlanActivo` y `listarPlanesAlumno`.

### `academias/{tenantId}/creditos/{creditoId}`

Un lote por compra/renovación.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `alumnoId` | string | |
| `planId` | string | Plan activo al comprar |
| `minutosComprados` | number | Entero > 0 |
| `minutosUsados` | number | Entero >= 0 |
| `inicio` | string | `"YYYY-MM-DD"` de la compra |
| `venceEn` | string \| null | `null` = no vence; si no, `inicio` + `vencimientoCreditoDias`. El día de vencimiento TODAVÍA sirve (`fecha > venceEn` = vencido) |
| `cargoId` | string | Cargo de `mensualidad` de este lote |
| `estado` | string | `activo` \| `agotado` \| `vencido` \| `anulado` (el vencimiento se calcula igual) |
| `creadoEn` | Timestamp | |

`comprarCredito(alumnoId)` crea el lote **y** su cargo de `mensualidad` en una
sola transacción. `anularCredito(creditoId)` solo se permite si
`minutosUsados == 0` y el cargo no está `pagado`; marca el lote y el cargo
`anulado`. `getCreditoAlumno(alumnoId, fecha)` devuelve los lotes usables en
orden **FIFO** (por `venceEn` ascendente, los que no vencen al final, y después
`inicio`), el total disponible y los vencidos; respeta `creditoRequierePago`.
Por defecto (`creditoRequierePago: true`) el crédito es usable **solo después**
de pagar el cargo de `mensualidad` del lote: hasta entonces el lote queda
`bloqueado`.

### `academias/{tenantId}/movimientosCredito/{${claseId}_${alumnoId}}`

El consumo de crédito de una clase. ID **determinista**, así que un reintento
reescribe el mismo documento y nunca duplica. Se revierten (SIN borrar) al
anular el cierre.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `claseId` | string | |
| `alumnoId` | string | |
| `minutos` | number | Entero >= 0 |
| `asignaciones` | map[] | `[{creditoId, minutos}]`, en orden FIFO |
| `motivo` | string | `clase` \| `falta_sin_aviso` |
| `creadoEn` | Timestamp | |

### Cargo de `mensualidad`

Reutiliza la forma del cargo de Fase 4, con `claseId: null`, `sedeId: null`,
`concepto: 'mensualidad'` y `creditoId` (más `planId`/`planNombre`
denormalizados). El monto es `precioCents` menos `descuentoHermanosPct` % cuando
el plan tiene `descuentoHermanos` (half-up). El pago al profesor **no cambia**
por el crédito.

### Consumo al cerrar la clase

Antes de crear el cargo de cada alumno (`previsualizarCreditoAlumno` es la misma
regla pura que usa la UI):

- **`presente`** con crédito suficiente → descuenta los minutos de la clase
  (FIFO entre lotes), escribe el movimiento y **no** crea cargo.
- **`presente`** sin crédito suficiente → cargo normal + advertencia
  `credito_insuficiente` (sin consumo parcial).
- **`ausente_sin_aviso`** → según `faltaSinAvisoConCredito`: descuenta los
  minutos (proporcional o completo) si alcanza; si no, cae al cargo normal;
  `cobra_aparte` = siempre cargo normal.
- **`ausente_avisada`** o `seFactura: false` → sin descuento.

Las lecturas de lotes se hacen FUERA de la transacción (el SDK web no admite
queries dentro) y se revalidan con `tx.get`: si los minutos cambiaron entre la
pre-lectura y el commit, se cae limpiamente al cargo normal.

> El **cargo con `estado`/`metodoPago`** es el **único modelo de pago**. Las
> colecciones antiguas `pagos` (`en_revision`/`aprobado`) y `liquidaciones` se
> marcan **obsoletas / no planificadas**: se conservan los match de reglas por
> compatibilidad de datos, pero no se construye UI ni flujo nuevo sobre ellas.

---

## 5.5 Reportes (Parte B)

Pantalla **solo-administrador** (`/:academia/reportes`, entrada "Reportes" en el
menú). No crea colecciones nuevas: lee datos existentes con consultas acotadas
por rango de fechas (por defecto, el mes en curso) y con tope. El profesor no
tiene membresía y las reglas le niegan toda lectura, así que los informes quedan
fuera de su alcance sin ampliar permisos.

**Arquitectura.** La agregación es pura y vive en `src/lib/reportes.js`
(`INFORMES` es el catálogo de los 15 informes; cada uno expone `construir`,
`fuentes` y `filtros`). La lectura de datos vive en `db.js`
(`listarClasesPorRango`, `listarCargosPorRango`, `listarCargosDeAlumno`,
`listarPagosProfesorPorRango`, `listarPlanes`, `listarCreditos`,
`listarAlumnosReporte`). La vista es una sola (`src/components/ReportView.jsx`)
para todos: encabezado imprimible, tarjetas de resumen, tabla con totales y barra
de exportación.

**Exportación.** PDF con `window.print()` + `@media print` (nombre de la
academia, título, filtros, fecha/hora, tasa BCV; sin navegación ni botones);
WhatsApp con `https://wa.me/?text=` (o `wa.me/<58...>?text=` cuando el informe
apunta a una persona, con el teléfono normalizado a `58...`) y "Compartir" vía
`navigator.share` cuando exista; CSV compatible con Excel (BOM UTF-8, separador
`;`, importes como números en USD). Los importes se muestran en USD con su
equivalente en Bs/EUR según la tasa BCV vigente; el monto guardado nunca cambia.

| # | Informe | Fuente |
|---|---------|--------|
| 1 | Clases agendadas | `clases` (abiertas, fecha ≥ hoy) + `sedes` |
| 2 | Clases realizadas | `clases` (cerradas; cuenta presentes/avisaron/sin aviso) |
| 3 | Ocupación de canchas | `clases` + `sedes`/`canchas` (minutos reservados ÷ minutos abiertos del horario) |
| 4 | Agenda semanal por profesor | `clases` + `sedes` |
| 5 | Listado de alumnos | `alumnos` |
| 6 | Planes y crédito | `planesAlumno` + `creditos` + `alumnos` |
| 7 | Alumnos inactivos | `alumnos` + `clases` (sin clase en los últimos N días, N por defecto 30) |
| 8 | Estado de cuenta del alumno | `cargos` del alumno (WhatsApp al representante o al alumno) |
| 9 | Listado de profesores | `profesores` |
| 10 | Horas y pago por profesor | `clases` + `pagosProfesor` |
| 11 | Cuentas por cobrar | `cargos` pendientes con antigüedad 0-7 / 8-30 / >30 días |
| 12 | Cobros recibidos | `cargos` pagados + `clases.cobro` (por sede y perfil) |
| 13 | Pagos a profesores | `pagosProfesor` (pendientes y pagados) |
| 14 | Faltas, cortesías y descuentos | `clases.cobro` (ajustes) + `cargos` de falta |
| 15 | Resumen del mes | `clases` + `cargos` + `pagosProfesor` |

## 6. Índices compuestos

Declarados en `firestore.indexes.json`. Mínimos para las consultas previstas:

- `miembros` (collection group) por `uid` asc → descubrimiento de tenants.
- `usuarios` (collection group) por `uid` asc + `activo` asc → descubrimiento
  del acceso del profesor (Fase 7).
- `clases`: `sedeId` + `fecha` + `horaInicio` (agenda por sede).
- `clases`: `profesorId` + `fecha` (agenda por profesor).
- `clases`: `estado` + `fecha`.
- `cargos`: `estado` + `fecha` y `estado` + `sedeId` + `fecha` (Fase 4:
  `listarCargosPendientes`).
- `pagosProfesor`: `estado` + `fecha` y `estado` + `sedeId` + `fecha` (Fase 4:
  `listarPagosProfesorPendientes`). Los cargos de una clase se leen por
  `claseId` (índice de un solo campo) y el pago por ID.
- `pagos`: `estado` + `creadoEn` desc.
- `alumnos`: `activo` + `busquedaNombre` y `activo` + `busquedaApellido`
  (buscador por prefijo de nombre o apellido de `buscarAlumnos` y listado
  paginado de `listarAlumnos`).
- `profesores`: `activo` + `sedes` (array-contains) para `getProfesores({sedeId})`.
- `planesAlumno`: `alumnoId` + `activo` (Fase 5: `getPlanActivo`). Los lotes de
  `creditos` se leen por `alumnoId` y los `movimientosCredito` por `claseId`
  (índices de un solo campo).
- `clases`: `sedeId` + `profesorId` + `fecha` (Parte B: informes que filtran por
  sede y profesor a la vez, p. ej. clases agendadas).
- `cargos`: `alumnoId` + `fecha` (Parte B: estado de cuenta del alumno, que ordena
  los cargos del alumno por fecha).

**Fase 4:** se reemplazaron los dos compuestos viejos de `cargos`
(`alumnoId`/`periodo`, `estado`/`periodo`) por los de `estado`+`fecha` y
`estado`+`sedeId`+`fecha`, y se agregaron los equivalentes de `pagosProfesor`.
**Fase 5** agregó `planesAlumno: alumnoId + activo`; el resto de los índices no
cambió. El de `pagos` (`estado`+`creadoEn`) se conserva por compatibilidad aunque
esa colección quedó obsoleta.

> El **emulador no enforcea índices**: que los tests pasen no prueba que el
> índice exista. La lista de arriba es la referencia para el deploy real.

Cada consulta nueva que se agregue a `db.js` debe traer su índice antes de
publicarse.

`bloques` **no** necesita ningún índice: se accede siempre por ID.

---

## 7. Lo que queda "sin definir"

- Multimoneda por academia.
- Catálogo de métodos de pago, niveles de alumno y tipos de cancha.
- **Reparto exacto de permisos entre `administrador` y "recepción"** (decisión 6:
  recepción es un admin reducido, pero *qué* quita todavía no está escrito).
- **Facturación / cobros:** la **configuración** (perfiles, tarifas por sede,
  parámetros y el snapshot de precio: §5.2), el **cierre con cargos y pago al
  profesor** (Fase 4: §5.3) y las **mensualidades con crédito** (Fase 5: §5.4) ya
  están. Siguen **sin definir**: el cobro de los alumnos con comprobante (la
  colección `pagos` con `en_revision`/`aprobado`, **obsoleta/no planificada**), la
  **liquidación** mensual del profesor (hoy el pago es por clase en
  `pagosProfesor`; `liquidaciones` también obsoleta), y si una clase `cancelada`
  genera cargo o no. `tarifaHoraCentavos` de la ficha del profesor sigue sin
  escribirse (el pago sale de `config/parametros.pagoProfesor`).
- **Ventana de aviso (horas) de una ausencia:** ya es un parámetro por academia
  (`config/parametros.avisoAusenciaHoras`, §5.2) y `porcentajeFaltaSinAviso`
  guarda el % a cobrar. El **consumo de crédito** por falta sin aviso ya está
  implementado (`faltaSinAvisoConCredito`, §5.4); lo que sigue **sin definir** es
  la recuperación (clase de recuperación vs nota de crédito) y no se implementan
  notificaciones. El administrador decide si una ausencia fue "avisada".
- **Doble reserva de un alumno a la misma hora:** no se bloquea en la
  transacción ni se crean bloques de alumno. Queda como nota de diseño.
- Cuándo y cómo se habilita Cloud Storage para subir comprobantes (decisión 5:
  el MVP no los sube).
- Liquidación de profesores (cálculo) y su periodicidad.
- Saldo cacheado vs calculado.
- Aprovisionamiento del resto de cuentas (alumnos, representantes) y asignación
  de roles sin Cloud Functions (decisión 9: el admin y los profesores ya están).
- Reglas de negocio de las series fijas (¿cuántas hacia adelante se generan?,
  ¿qué pasa al editar una serie?, ¿cómo se reservan los bloques de toda la
  serie?). Las clases `fija` con `serieId` existen en el modelo pero **no se
  implementan** el bloqueo por bloques.
- Cuándo se migra de `get()` en las reglas a custom claims (decisión 7:
  pospuesto hasta que exista Admin SDK).
- Cuándo se habilita Blaze y con qué alerta de presupuesto (decisión 4).

---

## 8. Notificaciones a alumnos (futuro, sin implementar)

> **TODO ESTA SECCIÓN ES UNA PROPUESTA, NO UNA DECISIÓN.** Nada de esto está en
> el seed ni en ninguna validación, y no se implementa todavía. Alumnos y
> representantes **no inician sesión**: reciben avisos, no operan el sistema.

### Campos propuestos

Opcionales, en la ficha del alumno (`alumnos/{alumnoId}`) y en el mapa `representante`
de los menores. Para un menor, el contacto es el del representante, no el del chico.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `email` | string \| null | Canal base. Ya existe en la ficha; se reutiliza. |
| `telegramChatId` | string \| null | Se completa cuando el alumno/representante vincula el bot |
| `canalPreferido` | string \| null | `"email"` \| `"telegram"` \| `null` |
| `avisosActivos` | boolean | Opt-in explícito a recibir reportes |

### Restricción de Telegram

Un bot de Telegram **no puede escribirle a un usuario que no haya pulsado
Start**. Por eso el vínculo no puede ser automático: hace falta un enlace de un
solo uso `t.me/<bot>?start=<token>` que el alumno/representante abre, y un **webhook del
lado del servidor** que reciba el `chatId` y lo guarde en la ficha. Email es el
canal base; Telegram es **opcional por alumno**.

### Envío (sin implementar)

El envío debe correr del lado del servidor (las claves no pueden vivir en el
cliente). Planificado: **Cloud Functions v2 + Brevo**, con la API key como
**secret de Firebase**, igual que en `tenistac-amistosos`, cuando se habilite
Blaze. **No es parte de esta fase** y no se escribe ningún código de envío, bot
ni Function ahora.

### Contenido, disparador y frecuencia

**Sin definir.** No se especifica qué dice el reporte, qué evento lo dispara
(cierre de clase, cobro, resumen semanal) ni cada cuánto se manda.
