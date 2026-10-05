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
| 9 | **El aprovisionamiento de usuarios en producción queda SIN DEFINIR.** | El primer administrador de cada academia se crea a mano. Cómo crear el resto de cuentas (alumnos, profesores) sin Functions, también sin definir. |

Además, en esta sesión se decidió el mecanismo de **reserva sin solapamientos**
(IDs deterministas + transacción). Ver §4.1.

### 0.1 Quién puede hacer qué (acceso por ahora)

**Decisión vigente: solo la academia administradora inicia sesión.** Todo lo
demás son fichas de datos, no cuentas de acceso. Los roles del enum siguen
existiendo para el futuro, pero hoy `profesor`, `alumno_adulto`, `alumno_menor`
y representante están **sin acceso por ahora**. Recepción queda **SIN DEFINIR**.

| Quién | ¿Inicia sesión? | Puede leer | Puede escribir |
| --- | --- | --- | --- |
| `administrador` | Sí | Todo su tenant (sedes, canchas, profesores, alumnos, clases, bloques, planes, cargos, pagos, notas de crédito, liquidaciones, miembros) | Todo su tenant |
| `profesor` | **No** (ficha) | Sólo su propia membresía (descubrimiento de tenants). Nada más | Nada |
| `alumno_adulto` | **No** (ficha) | Sólo su propia membresía | Nada |
| `alumno_menor` / representante | **No** (ficha) | Sólo su propia membresía | Nada |
| Recepción | **SIN DEFINIR** — no se crea | — | — |

El administrador abre clases (reserva), reprograma, cancela, registra asistencia
y cierra la clase, y más adelante marca el cobro como pagado. Los alumnos (o el
representante, en menores) **recibirán reportes de clase por email o Telegram**: no
inician sesión, y el envío es una capacidad futura sin implementar (§8).

La única lectura permitida a un no-admin es su propia membresía (arranque de
sesión y descubrimiento de tenants). Con eso la app muestra el aviso "Esta
cuenta no tiene acceso a esta academia" y **no vuelve a leer nada**.

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
| `rol` | string | `administrador` \| `profesor` \| `alumno_adulto` \| `alumno_menor`. **Hoy solo `administrador` tiene acceso**; el resto queda "sin acceso por ahora". **Decisión 6: no se agrega un rol "recepción"** — recepción es un `administrador` con permisos reducidos (*reparto exacto sin definir*). |
| `activo` | bool | |
| `nombre` | string | Denormalizado, para mostrar sin leer el perfil |
| `creadoEn` | Timestamp | |

> **Campos eliminados (login obsoleto):** `profesorId` y `alumnoId` en la
> membresía ya no se usan. Se pensaban para enlazar una cuenta con su ficha,
> pero como profesor y alumno **no inician sesión**, ese enlace es muerto. La
> ficha se referencia por id desde las clases (`profesorId`, `alumnos[]`), no
> desde la membresía. Si en el futuro se diera acceso a algún rol, se
> reincorporaría el vínculo explícitamente.

**Descubrimiento al iniciar sesión** (una sola consulta acotada):

```js
collectionGroup('miembros').where('uid', '==', uid)
```

**Justificación subcolección vs top-level:** se eligió subcolección para que las
reglas sean por subárbol y no haga falta `where('tenantId','==',...)` en cada
consulta. Como contrapartida, el descubrimiento de tenants requiere un
*collection group query* (una sola lectura acotada). El `uid` está duplicado
como campo justamente para poder hacer ese collection group.

---

## 2. Estructura organizativa

### `academias/{tenantId}/sedes/{sedeId}`

**Decisión 1: las sedes son live por tenant.** No existe un catálogo global de
sedes: cada academia define las suyas. Un tenant nuevo arranca sin sedes y las
carga por su cuenta.

| Campo | Tipo | Nota |
| --- | --- | --- |
| `nombre` | string | "Traki", "Boleíta", "Santa Rosa", "Capital" (tenant de ensayo) |
| `direccion` | string | *sin definir formato* |
| `activa` | bool | |
| `orden` | number | Para ordenar en la UI |

### `academias/{tenantId}/sedes/{sedeId}/canchas/{canchaId}`

Subcolección de la sede (naturalmente acotada por sede; hasta 5 por AGENTS.md
del negocio).

| Campo | Tipo | Nota |
| --- | --- | --- |
| `nombre` | string | "Cancha 1" … |
| `numero` | number | |
| `tipo` | string | `indoor` \| `outdoor` \| `otro` *sin definir catálogo* |
| `activa` | bool | |

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
| `profesorId` | string | |
| `fecha` | string | `"YYYY-MM-DD"` |
| `horaInicio` | string | `"HH:mm"` |
| `horaFin` | string | `"HH:mm"` |
| `tipo` | string | `fija` (recurrente) \| `variable` |
| `serieId` | string \| null | Une las clases fijas generadas de una serie |
| `categoria` | string \| null | Opcional. Una de `principiante`, `7a`, `6a`, `5a`, `4a`, `3a`, `2a`, `1a`. Se muestra como "Principiante", "7ª" … "1ª". Validado en `crearClase`/`reprogramarClase`; `null` si no se definió. |
| `cupo` | number | |
| `alumnos` | string[] | IDs de alumnos asignados. `crearClase`, `reprogramarClase` y `asignarAlumnos` los validan (existen, activos, sin duplicados, dentro del `cupo`). |
| `asistencias` | map[] | `[{alumnoId, estado, motivo, registradoPor, registradoEn}]`. `estado` ∈ `presente` \| `ausente_avisada` \| `ausente_sin_aviso`; `motivo` opcional. |
| `estado` | string | `reservada` → `pendiente_cobro` → `cobrada`; también `cancelada`. `ejecutada` sigue existiendo en el enum pero el cierre por asistencia va directo a `pendiente_cobro`. |
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

**Cierre por asistencia:** `registrarAsistencia` escribe `asistencias` y pasa la
clase a `pendiente_cobro` en una sola transacción. Requiere exactamente **una
entrada por alumno asignado** y solo acepta tres estados: `presente`,
`ausente_avisada` y `ausente_sin_aviso`, más un `motivo` opcional. El sistema no
recibe avisos: **el administrador decide** si la ausencia fue avisada. **La
ventana de aviso (horas) es un parámetro por academia y está SIN DEFINIR** (no se
hardcodea). **La generación del `cargo` del alumno y de la liquidación del
profesor NO forma parte de ese cierre** (ver §5 "Sin definir"), así que no se
ejecuta todavía. La regla de negocio de la ausencia justificada (clase de
recuperación vs nota de crédito) también está **sin definir**.

**Cobrar (o no) a los alumnos ausentes está SIN DEFINIR.** El código no crea
`cargos` ni toca el saldo de nadie al registrar la asistencia: la clase queda en
`pendiente_cobro` y el cobro es un paso posterior, manual, por definir.

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
  reprogramar o cancelar.*
- `pendiente_cobro`: **la asistencia ya quedó registrada** y la clase está
  cerrada para edición. `registrarAsistencia` salta directo aquí (no pasa por
  `ejecutada`). El `cargo` del alumno **no** se genera en este paso: queda sin
  definir (ver arriba y §5).
- `cobrada`: el pago asociado fue aprobado. *Sin definir.*
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

La granularidad es de **30 minutos** (la mitad del bloque de pádel más corto
que se vende).

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

1. Se calcula la lista de bloques: la duración debe ser **múltiplo de 30
   minutos** y la hora de inicio debe caer en la grilla (múltiplo de 30 desde
   medianoche); si no, la reserva se rechaza. Sin esa alineación una clase de
   19:15 bloquearía 19:15/19:45 y no chocaría con una que ocupa 18:00-19:30,
   aunque en la realidad se pisan. Con la grilla, `(horaFin - horaInicio) / 30`
   bloques de cancha **y** los mismos de profesor. Una clase de 90 minutos =
   3 + 3 = 6.
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

### `academias/{tenantId}/pagos/{pagoId}`

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

**Justificación de colecciones separadas:** `cargos`, `pagos` y `notasCredito`
crecen en el tiempo y se consultan por alumno/periodo/estado. Tenerlos como
colecciones permite acotar por esos campos e indexar. Meterlos como arrays
dentro de `alumnos` haría crecer el documento del alumno sin límite y obligaría
a leer toda la historia para mostrar el saldo.

**Saldo del alumno:** se calcula con agregaciones (`sum`) sobre `cargos` y
`pagos`, no se almacena un contador mutable (evita escrituras y contención por
el límite de ~1 escritura/segundo por documento). *Sin definir si se cachea un
saldo denormalizado.*

### Liquidación de profesores

Pago por hora: hacen falta las horas efectivamente dictadas.

- Opción A: calcular al vuelo desde `clases` ejecutadas del período (0 escrituras,
  muchas lecturas).
- Opción B: generar `academias/{tenantId}/liquidaciones/{liquidacionId}` al
  cerrar el mes, con detalle embebido.

**Sin definir.** Se deja fuera de Fase 0 (no se construye UI ni modelo final).

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

## 6. Índices compuestos

Declarados en `firestore.indexes.json`. Mínimos para las consultas previstas:

- `miembros` (collection group) por `uid` asc → descubrimiento de tenants.
- `clases`: `sedeId` + `fecha` + `horaInicio` (agenda por sede).
- `clases`: `profesorId` + `fecha` (agenda por profesor).
- `clases`: `estado` + `fecha`.
- `cargos`: `alumnoId` + `periodo` desc.
- `cargos`: `estado` + `periodo`.
- `pagos`: `estado` + `creadoEn` desc.
- `alumnos`: `activo` + `busquedaNombre` y `activo` + `busquedaApellido`
  (buscador por prefijo de nombre o apellido de `buscarAlumnos` y listado
  paginado de `listarAlumnos`).
- `profesores`: `activo` + `sedes` (array-contains) para `getProfesores({sedeId})`.

**Sin cambios en esta ronda.** Con `estado: "activos"`/`"inactivos"`, tanto
`listarAlumnos` (igualdad en `activo` + `orderBy` en `busquedaApellido`) como
`buscarAlumnos` (igualdad en `activo` + rango en `busquedaNombre`/`busquedaApellido`)
ya quedan cubiertos por los dos compuestos de `alumnos`. Con `estado: "todos"`
la consulta es de un solo campo y no necesita compuesto. En `profesores`, el
estado agrega o quita la igualdad sobre `activo`, y el índice existente
(`activo` + `sedes`) sigue aplicando. No se agregó ni se quitó ningún índice.

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
- **Facturación / cobros (todo sin definir):** tarifa por hora del profesor
  (`tarifaHoraCentavos` no se escribe), generación del `cargo` al cerrar la
  clase y a la liquidación del profesor, cobro o no de la clase cancelada y de
  los alumnos ausentes. `registrarAsistencia` solo deja la clase en
  `pendiente_cobro`; no crea cargos, notas de crédito, recuperaciones ni toca
  saldos.
- **Ventana de aviso (horas) de una ausencia:** parámetro por academia, hoy sin
  definir y sin hardcodear. El administrador decide si una ausencia fue
  "avisada"; no se implementan notificaciones.
- **Doble reserva de un alumno a la misma hora:** no se bloquea en la
  transacción ni se crean bloques de alumno. Queda como nota de diseño.
- Cuándo y cómo se habilita Cloud Storage para subir comprobantes (decisión 5:
  el MVP no los sube).
- Liquidación de profesores (cálculo) y su periodicidad.
- Saldo cacheado vs calculado.
- Aprovisionamiento de usuarios y asignación de roles sin Cloud Functions
  (decisión 9: el primer admin se crea a mano).
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
