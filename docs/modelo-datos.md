# Modelo de datos propuesto (Firestore)

Todo cuelga de una raíz por tenant:

```
academias/{tenantId}/...
```

El aislamiento entre academias es por subárbol. Las Security Rules
(`firestore.rules`) validan, en cada operación, que el usuario sea **miembro
activo** de `academias/{tenantId}` y que su **rol** alcance para la acción.

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
| `rol` | string | `administrador` \| `profesor` \| `alumno_adulto` \| `alumno_menor`. **Decisión 6: no se agrega un rol "recepción"** — recepción es un `administrador` con permisos reducidos (*reparto exacto sin definir*). |
| `activo` | bool | |
| `nombre` | string | Denormalizado, para mostrar sin leer el perfil |
| `profesorId` | string \| null | Si `rol == profesor` |
| `alumnoId` | string \| null | Si `rol` es alumno |
| `creadoEn` | Timestamp | |

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
| `uid` | string \| null | Usuario de Auth si tiene login |
| `nombre` | string | |
| `email` | string | |
| `telefono` | string | |
| `tarifaHoraCentavos` | number | Pago por hora |
| `sedes` | string[] | IDs de sedes donde trabaja |
| `activo` | bool | |

### `academias/{tenantId}/alumnos/{alumnoId}`

| Campo | Tipo | Nota |
| --- | --- | --- |
| `tipo` | string | `adulto` \| `menor` |
| `nombre` | string | |
| `documento` | string | *sin definir tipo/validación* |
| `email` | string | |
| `telefono` | string | |
| `tutor` | map \| null | Solo `menor`: `{nombre, documento, telefono, email, parentesco}` |
| `sedes` | string[] | Sedes donde toma clases |
| `nivel` | string | *sin definir catálogo* |
| `activo` | bool | |
| `notas` | string | |

**Alumno Menor:** se modela como un documento `alumnos` (no una cuenta de Auth)
más un `tutor`. Si el tutor necesita login, es un `miembro` con rol
`alumno_menor` enlazado por `alumnoId`. *Sin definir si el tutor gestiona varios
menores.*

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
| `alumnos` | string[] | IDs de alumnos |
| `asistencias` | map[] | `[{alumnoId, estado, motivo, registradoPor, registradoEn}]` |
| `estado` | string | `reservada` → `ejecutada` → `pendiente_cobro` → `cobrada`; también `cancelada` |
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
con `cupo <= 1` se muestra como **Individual** y con `cupo >= 2` como
**Grupal**. El título del bloque es `Modalidad · Categoría` (solo modalidad si
`categoria` es `null`). No confundir con `tipo` (`fija` | `variable`).

**Cierre por asistencia:** `registrarAsistencia` escribe `asistencias` y pasa la
clase a `pendiente_cobro` en una sola transacción. La generación del `cargo`
del alumno y de la liquidación del profesor **no** está documentada como parte
de ese cierre (ver §5 "Sin definir"), así que no se ejecuta todavía. La regla de
negocio de la ausencia justificada (clase de recuperación vs nota de crédito)
también está **sin definir**: `asistencias` solo guarda `presente`/`ausente` y
un `motivo` opcional.

**No solapamiento:** es una regla de **negocio** y se valida en la capa de
escritura (`src/firebase/db.js`), porque Firestore no tiene constraints únicos
ni condiciones de rango. El mecanismo elegido es la colección `bloques` con IDs
deterministas dentro de una transacción. Ver §4.1.

### Estados de la clase

```
reservada ──(asistencia)──▶ ejecutada ──▶ pendiente_cobro ──▶ cobrada
    │
    └──▶ cancelada
```

- `reservada`: creada, todavía no pasó.
- `ejecutada`: se registró asistencia (Presente/Ausente con motivo).
- `pendiente_cobro`: se generó el cargo (automático o manual).
- `cobrada`: el pago asociado fue aprobado.
- `cancelada`: no se dictó. *Sin definir si una cancelada genera cargo o no.*

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

## 6. Índices compuestos

Declarados en `firestore.indexes.json`. Mínimos para las consultas previstas:

- `miembros` (collection group) por `uid` asc → descubrimiento de tenants.
- `clases`: `sedeId` + `fecha` + `horaInicio` (agenda por sede).
- `clases`: `profesorId` + `fecha` (agenda por profesor).
- `clases`: `estado` + `fecha`.
- `cargos`: `alumnoId` + `periodo` desc.
- `cargos`: `estado` + `periodo`.
- `pagos`: `estado` + `creadoEn` desc.
- `alumnos`: `activo` + `nombre`.

Cada consulta nueva que se agregue a `db.js` debe traer su índice antes de
publicarse.

`bloques` **no** necesita ningún índice: se accede siempre por ID.

---

## 7. Lo que queda "sin definir"

- Multimoneda por academia.
- Catálogo de métodos de pago, niveles de alumno y tipos de cancha.
- **Reparto exacto de permisos entre `administrador` y "recepción"** (decisión 6:
  recepción es un admin reducido, pero *qué* quita todavía no está escrito).
- Generación y cobro de una clase cancelada.
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
