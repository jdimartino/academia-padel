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
| `rol` | string | `administrador` \| `profesor` \| `alumno_adulto` \| `alumno_menor` |
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
| `cupo` | number | |
| `alumnos` | string[] | IDs de alumnos |
| `asistencias` | map[] | `[{alumnoId, estado, motivo, registradoPor, registradoEn}]` |
| `estado` | string | `reservada` → `ejecutada` → `pendiente_cobro` → `cobrada`; también `cancelada` |
| `sedeNombre` | string | Denormalizado |
| `profesorNombre` | string | Denormalizado |
| `alumnoNombres` | string[] | Denormalizado (solo UI) |
| `creadoPor` | string | uid |
| `creadoEn` | Timestamp | |

**Asistencia embebida, no subcolección.** Justificación de costo: leer la clase
es **1 lectura** y ya trae la asistencia de todos los alumnos. Como subcolección
habría que leer N documentos de asistencia por clase. El documento no se acerca
al 1 MiB (pocos alumnos por clase). *Si en el futuro se necesitan consultas de
"asistencia por alumno" a través de clases, habría que evaluar una colección
aparte o un collection group; queda marcado.*

**No solapamiento:** es una regla de **negocio** que hay que validar en la capa
de escritura (`db.js`) porque Firestore no tiene constraints únicos por rango.
Estrategia propuesta (a definir en fase 1): antes de crear la clase, consultar
`clases` de la sede+cancha+profesor en esa fecha con `where`/`limit` y comparar
rangos horarios. Para las series fijas, validar la serie completa. **Sin
definir** si el chequeo será transaccional ni cómo manejar carreras (dos
recepcionistas a la vez).

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
| `referencia` | string | |
| `comprobante` | map \| null | **Sin definir**: sin Storage no hay dónde subir el archivo |
| `estado` | string | `en_revision` \| `aprobado` \| `rechazado` |
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

---

## 7. Lo que queda "sin definir"

- Multimoneda por academia.
- Catálogo de métodos de pago, niveles de alumno y tipos de cancha.
- Validación de solapamiento (transaccionalidad y carreras).
- Generación y cobro de una clase cancelada.
- Cómo subir comprobantes sin Cloud Storage.
- Liquidación de profesores (cálculo) y su periodicidad.
- Saldo cacheado vs calculado.
- Roles: ¿`administrador` y `recepción` separados?
- Provisioning de usuarios y asignación de roles sin Cloud Functions.
- Reglas de negocio de las series fijas (¿cuántas hacia adelante se generan?,
  ¿qué pasa al editar una serie?).
