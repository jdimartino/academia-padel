/*
 * CAPA ÚNICA DE ACCESO A DATOS
 * ----------------------------
 * Todo acceso a Firestore debe pasar por este archivo.
 * Ninguna página, componente o servicio puede importar `firebase/firestore`
 * directamente: si hace falta una consulta nueva, se agrega acá.
 *
 * Cada función recibe la instancia de Firestore como PRIMER argumento. Así el
 * mismo código corre en la app (instancia de `src/firebase/config.js`) y en los
 * tests contra el emulador, sin duplicar lógica de negocio.
 *
 * Reglas obligatorias (multi-tenant):
 * - Datos enraizados en academias/{tenantId}/... — siempre acotar por tenant.
 * - Toda consulta debe estar acotada: por tenant, por sede (venueId) y por
 *   rango de fechas, con límite y paginación. Nada de getDocs() sin where().
 * - Preferir lecturas puntuales (getDoc/getDocs). Los listeners en vivo
 *   (onSnapshot) solo cuando la pantalla realmente necesite datos en vivo.
 * - Escribir primero los índices compuestos en firestore.indexes.json.
 */

import {
  Timestamp,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { CATEGORIAS } from '../lib/agenda.js'

/** Granularidad de la ocupación: 30 minutos. Ver docs/modelo-datos.md §4.1. */
export const MINUTOS_BLOQUE = 30

/** Categorías válidas de una clase. Ver docs/modelo-datos.md §4. */
export { CATEGORIAS }

/** Estados en los que la clase ya está cerrada y no admite más asistencia. */
const ESTADOS_CERRADOS = ['pendiente_cobro', 'cobrada', 'cancelada']

/** Cupo máximo de una clase según el modelo de datos (docs/modelo-datos.md §4). */
export const CUPO_MAXIMO = 4

/**
 * Estados de asistencia admitidos. Los tres distinguen si la ausencia fue
 * avisada: el sistema no recibe avisos, así que lo decide el administrador. La
 * ventana de aviso (horas) es un parámetro por academia SIN DEFINIR: no se
 * hardcodea. Ver docs/modelo-datos.md §4.
 */
export const ESTADOS_ASISTENCIA = ['presente', 'ausente_avisada', 'ausente_sin_aviso']

/** Tipos de ficha de alumno. */
export const TIPOS_ALUMNO = ['adulto', 'menor']

/** Tipos de documento admitidos. El tipo y el número van juntos o ninguno. */
export const TIPOS_DOCUMENTO = ['cedula', 'pasaporte']

/**
 * Topes de longitud de los textos de una ficha (después de recortar).
 * Ver docs/modelo-datos.md §3.
 */
export const LIMITES_FICHA = {
  nombre: 200,
  apellidos: 200,
  email: 200,
  telefono: 30,
  documentoNumero: 30,
  notas: 1000,
}

function validarCategoria(categoria) {
  if (categoria != null && !CATEGORIAS.includes(categoria)) {
    throw new ClaseInvalidaError(
      `Categoría inválida "${categoria}". Permitidas: ${CATEGORIAS.join(', ')}`,
    )
  }
}

/**
 * Valida que el cupo sea un entero entre 1 y CUPO_MAXIMO (4).
 * Rechaza strings numéricos, decimales, 0 y valores fuera de rango.
 * Acepta `undefined`/`null` (usa el default 4 quien llame).
 */
function validarCupo(cupo) {
  if (cupo === undefined || cupo === null) return
  if (typeof cupo !== 'number' || !Number.isInteger(cupo)) {
    throw new ClaseInvalidaError(
      `cupo debe ser un entero (recibido ${JSON.stringify(cupo)})`,
    )
  }
  if (cupo < 1 || cupo > CUPO_MAXIMO) {
    throw new ClaseInvalidaError(
      `cupo debe estar entre 1 y ${CUPO_MAXIMO} (recibido ${cupo})`,
    )
  }
}

/**
 * Normaliza un texto para buscarlo por prefijo: sin tildes, minúsculas y con
 * los espacios colapsados. Se usa para escribir los campos `busquedaNombre` y
 * `busquedaApellido` y para consultarlos (ver `buscarAlumnos`).
 */
export function normalizarBusqueda(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Campos normalizados del buscador de alumnos:
 * - `busquedaNombre`   = "nombre apellidos"
 * - `busquedaApellido` = "apellidos nombre"
 *
 * Con dos consultas de prefijo, `buscarAlumnos` encuentra tanto por nombre
 * como por apellido. Los espacios de más no generan ruido: se colapsan.
 */
export function camposBusqueda({ nombre, apellidos } = {}) {
  const n = normalizarBusqueda(nombre)
  const a = normalizarBusqueda(apellidos)
  return {
    busquedaNombre: [n, a].filter(Boolean).join(' '),
    busquedaApellido: [a, n].filter(Boolean).join(' '),
  }
}

/**
 * "Nombre Apellidos" de una ficha (alumno o profesor). Es la única forma de
 * armar el nombre para mostrar y para los nombres denormalizados de `clases`.
 */
export function nombreCompleto(ficha) {
  return [ficha?.nombre, ficha?.apellidos]
    .map((parte) => String(parte ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

const RE_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Error de negocio: el horario pedido ya está ocupado. */
export class SolapamientoError extends Error {
  constructor(bloque) {
    super(`El horario ya está ocupado (bloque ${bloque.id})`)
    this.name = 'SolapamientoError'
    this.bloque = bloque
  }
}

/** Error de negocio: los datos de la clase no sirven para bloquear bloques. */
export class ClaseInvalidaError extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'ClaseInvalidaError'
  }
}

/** Error de negocio: la ficha de alumno o profesor tiene datos inválidos. */
export class FichaInvalidaError extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'FichaInvalidaError'
  }
}

/* --------------------------------------------------------------------- */
/* Utilidades de tiempo (puras, sin Firestore)                             */
/* --------------------------------------------------------------------- */

/** "18:30" → 1110 (minutos desde medianoche). */
export function aMinutos(hhmm) {
  const match = RE_HHMM.exec(hhmm ?? '')
  if (!match) throw new ClaseInvalidaError(`Hora inválida "${hhmm}", se espera "HH:mm"`)
  return Number(match[1]) * 60 + Number(match[2])
}

/** 1110 → "18:30". */
export function aHoraHHmm(minutos) {
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0')
  const mm = String(minutos % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * Fecha de HOY en "YYYY-MM-DD" con partes LOCALES. Nunca se usa
 * `toISOString()`: pasaría a UTC y con Caracas (UTC-4) adelantaría el día.
 * `ahora` es inyectable para poder probarlo.
 */
export function fechaHoyLocal(ahora = new Date()) {
  const y = ahora.getFullYear()
  const m = String(ahora.getMonth() + 1).padStart(2, '0')
  const d = String(ahora.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function hhmmId(minutos) {
  return aHoraHHmm(minutos).replace(':', '')
}

function bloqueCanchaId({ sedeId, canchaId, fecha, minuto }) {
  return `${sedeId}_${canchaId}_${fecha}_${hhmmId(minuto)}`
}

function bloqueProfesorId({ profesorId, fecha, minuto }) {
  return `prof_${profesorId}_${fecha}_${hhmmId(minuto)}`
}

/**
 * Lista de bloques que ocupa una clase, en orden. Cada bloque trae su ID
 * determinista y los campos del documento. Función pura: no toca Firestore.
 * Se exporta para poder probar el cálculo sin base de datos.
 */
export function bloquesDeClase({ sedeId, canchaId, profesorId, fecha, horaInicio, horaFin }) {
  if (!RE_FECHA.test(fecha ?? '')) {
    throw new ClaseInvalidaError(`Fecha inválida "${fecha}", se espera "YYYY-MM-DD"`)
  }
  if (!sedeId) throw new ClaseInvalidaError('Falta sedeId')
  if (!canchaId) throw new ClaseInvalidaError('Falta canchaId')
  if (!profesorId) throw new ClaseInvalidaError('Falta profesorId')

  const inicio = aMinutos(horaInicio)
  const fin = aMinutos(horaFin)
  if (fin <= inicio) {
    throw new ClaseInvalidaError(`horaFin (${horaFin}) debe ser posterior a horaInicio (${horaInicio})`)
  }
  if (inicio % MINUTOS_BLOQUE !== 0) {
    // Sin esto, una clase que arranca a las 19:15 bloquearía bloques 19:15/19:45
    // y no chocaría con una que ocupa 18:00-19:30, aunque en la realidad se
    // pisan de 19:15 a 19:30.
    throw new ClaseInvalidaError(
      `horaInicio debe caer en un múltiplo de ${MINUTOS_BLOQUE} minutos (recibido "${horaInicio}")`,
    )
  }
  if ((fin - inicio) % MINUTOS_BLOQUE !== 0) {
    throw new ClaseInvalidaError(
      `La duración debe ser múltiplo de ${MINUTOS_BLOQUE} minutos (${horaInicio}-${horaFin})`,
    )
  }

  const bloques = []
  for (let minuto = inicio; minuto < fin; minuto += MINUTOS_BLOQUE) {
    const comun = { fecha, minutoInicio: minuto, horaInicio: aHoraHHmm(minuto) }
    bloques.push({
      id: bloqueCanchaId({ sedeId, canchaId, fecha, minuto }),
      data: { ...comun, tipo: 'cancha', sedeId, canchaId, profesorId: null },
    })
    bloques.push({
      id: bloqueProfesorId({ profesorId, fecha, minuto }),
      data: { ...comun, tipo: 'profesor', sedeId: null, canchaId: null, profesorId },
    })
  }
  return bloques
}

/**
 * Valida una lista de IDs de alumnos contra el cupo y las fichas ya leídas, y
 * devuelve la asignación normalizada (`alumnos` + `alumnoNombres` denormalizado).
 *
 * Función PURA (sin Firestore): la usan la transacción de `crearClase`,
 * `reprogramarClase` y `asignarAlumnos` con las fichas leídas dentro de la
 * transacción, y el seed con las fichas que acaba de escribir. Así el seed
 * asigna por el mismo camino que la app.
 *
 * Reglas: sin duplicados, todos existen, todos activos, cantidad <= cupo. Un
 * cupo <= 1 es Individual (ver docs/modelo-datos.md §4).
 */
export function resolverAsignacion(alumnoIds, alumnosPorId, cupo) {
  if (!Array.isArray(alumnoIds)) {
    throw new ClaseInvalidaError('alumnos debe ser un arreglo de IDs')
  }
  const limite = Number.isFinite(cupo) ? cupo : 0
  if (new Set(alumnoIds).size !== alumnoIds.length) {
    throw new ClaseInvalidaError('No se admiten alumnos duplicados en una clase')
  }
  if (alumnoIds.length > limite) {
    throw new ClaseInvalidaError(
      `La clase admite ${limite} alumno(s) (cupo) y se intentaron asignar ${alumnoIds.length}`,
    )
  }
  const alumnoNombres = alumnoIds.map((alumnoId) => {
    const ficha = alumnosPorId?.[alumnoId]
    if (!ficha) throw new ClaseInvalidaError(`El alumno ${alumnoId} no existe`)
    if (ficha.activo === false) {
      throw new ClaseInvalidaError(`El alumno ${alumnoId} no está activo`)
    }
    return nombreCompleto(ficha)
  })
  return { alumnos: [...alumnoIds], alumnoNombres }
}

/* --------------------------------------------------------------------- */
/* Referencias (internas)                                                  */
/* --------------------------------------------------------------------- */

const refClase = (db, tenantId, claseId) => doc(db, 'academias', tenantId, 'clases', claseId)
const refBloque = (db, tenantId, bloqueId) => doc(db, 'academias', tenantId, 'bloques', bloqueId)
const refAlumno = (db, tenantId, alumnoId) => doc(db, 'academias', tenantId, 'alumnos', alumnoId)
const refProfesor = (db, tenantId, profesorId) =>
  doc(db, 'academias', tenantId, 'profesores', profesorId)

/* --------------------------------------------------------------------- */
/* Lecturas                                                               */
/* --------------------------------------------------------------------- */

/**
 * Devuelve las academias (y el rol) del usuario. Una sola consulta acotada por
 * uid sobre el collection group `miembros`. Requiere el índice de
 * firestore.indexes.json.
 */
export async function getMisMembresias(db, uid) {
  const q = query(collectionGroup(db, 'miembros'), where('uid', '==', uid))
  const snap = await getDocs(q)
  return snap.docs.map((doc) => ({
    tenantId: doc.ref.parent.parent?.id ?? null,
    ...doc.data(),
  }))
}

/*
 * Sedes activas de una academia. Acotado por tenant + activa + limit.
 * El filtro `activa == true` va en la query para no desperdiciar lecturas
 * en sedes inactivas. Se ordena en el cliente por `orden` (evita depender
 * de un índice compuesto y de que el campo exista en todos los documentos).
 */
export async function getSedes(db, tenantId) {
  const q = query(
    collection(db, 'academias', tenantId, 'sedes'),
    where('activa', '==', true),
    limit(50),
  )
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        (a.orden ?? 0) - (b.orden ?? 0) ||
        String(a.nombre ?? '').localeCompare(String(b.nombre ?? '')),
    )
}

/** Canchas activas de una sede. Acotado por sede + activa + limit. Orden client-side por `numero`. */
export async function getCanchas(db, tenantId, sedeId) {
  const q = query(
    collection(db, 'academias', tenantId, 'sedes', sedeId, 'canchas'),
    where('activa', '==', true),
    limit(20),
  )
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        (a.numero ?? 0) - (b.numero ?? 0) ||
        String(a.nombre ?? '').localeCompare(String(b.nombre ?? '')),
    )
}

/**
 * Profesores activos de una academia. Con `{ sedeId }` devuelve solo los que
 * dictan en esa sede (`sedes` array-contains). Acotado por tenant + activo
 * (+ sede) + limit. Orden client-side por nombre completo.
 * Índice: `profesores: activo + sedes` (firestore.indexes.json).
 */
export async function getProfesores(db, tenantId, opciones = {}) {
  const { sedeId = null } = opciones
  const filtros = [where('activo', '==', true)]
  if (sedeId) filtros.push(where('sedes', 'array-contains', sedeId))
  const q = query(
    collection(db, 'academias', tenantId, 'profesores'),
    ...filtros,
    limit(50),
  )
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b)))
}

/* --------------------------------------------------------------------- */
/* Fichas: alumnos y profesores                                            */
/* --------------------------------------------------------------------- */

/*
 * Los alumnos y profesores son FICHAS (records), no cuentas: no inician sesión.
 * Los datos de contacto son solo del administrador (ver firestore.rules).
 * Los alumnos no se borran nunca físicamente: se marca `activo: false`.
 */

function validarNivel(nivel) {
  if (nivel != null && !CATEGORIAS.includes(nivel)) {
    throw new FichaInvalidaError(`Nivel inválido "${nivel}". Permitidos: ${CATEGORIAS.join(', ')}`)
  }
}

function validarTipoAlumno(tipo) {
  if (!TIPOS_ALUMNO.includes(tipo)) {
    throw new FichaInvalidaError(
      `Tipo de alumno inválido "${tipo}". Permitidos: ${TIPOS_ALUMNO.join(', ')}`,
    )
  }
}

/** Recorta un nombre requerido y falla con `mensajeVacio` si queda vacío. */
function exigirNombre(valor, mensajeVacio) {
  const texto = String(valor ?? '').trim()
  if (!texto) throw new FichaInvalidaError(mensajeVacio)
  if (texto.length > LIMITES_FICHA.nombre) {
    throw new FichaInvalidaError(
      `El nombre no puede superar ${LIMITES_FICHA.nombre} caracteres`,
    )
  }
  return texto
}

/** Texto opcional: se recorta, vacío queda `null` y tiene tope de largo. */
function textoOpcional(valor, campo, max) {
  if (valor === undefined || valor === null) return null
  const texto = String(valor).trim()
  if (!texto) return null
  if (texto.length > max) {
    throw new FichaInvalidaError(`El campo ${campo} no puede superar ${max} caracteres`)
  }
  return texto
}

/**
 * Documento opcional `{tipo, numero}`: van los dos o ninguno, el tipo sale del
 * enum y el número no se valida por formato (solo largo).
 */
function validarDocumento(documento) {
  if (documento === undefined || documento === null) return null
  const tipo = String(documento.tipo ?? '').trim()
  const numero = String(documento.numero ?? '').trim()
  if (!tipo && !numero) return null
  if (!tipo || !numero) {
    throw new FichaInvalidaError('Completa el tipo y el numero del documento')
  }
  if (!TIPOS_DOCUMENTO.includes(tipo)) {
    throw new FichaInvalidaError(
      `Tipo de documento inválido "${tipo}". Permitidos: ${TIPOS_DOCUMENTO.join(', ')}`,
    )
  }
  if (numero.length > LIMITES_FICHA.documentoNumero) {
    throw new FichaInvalidaError(
      `El numero del documento no puede superar ${LIMITES_FICHA.documentoNumero} caracteres`,
    )
  }
  return { tipo, numero }
}

/** Contacto de emergencia opcional: `{nombre, telefono}` van juntos o ninguno. */
function validarContactoEmergencia(contacto) {
  if (contacto === undefined || contacto === null) return null
  const nombre = textoOpcional(contacto.nombre, 'nombre del contacto', LIMITES_FICHA.nombre)
  const telefono = textoOpcional(
    contacto.telefono,
    'telefono del contacto',
    LIMITES_FICHA.telefono,
  )
  if (!nombre && !telefono) return null
  if (!nombre || !telefono) {
    throw new FichaInvalidaError('Completa el nombre y el telefono del contacto de emergencia')
  }
  return { nombre, telefono }
}

/** Representante (solo menores): nombre y apellidos son requeridos. */
function validarRepresentante(representante) {
  const rep = representante ?? {}
  return {
    nombre: exigirNombre(rep.nombre, 'El representante necesita un nombre'),
    apellidos: exigirNombre(rep.apellidos, 'El representante necesita apellidos'),
    email: textoOpcional(rep.email, 'email del representante', LIMITES_FICHA.email),
    telefono: textoOpcional(rep.telefono, 'telefono del representante', LIMITES_FICHA.telefono),
  }
}

/** Fecha "YYYY-MM-DD" opcional; si no viene, HOY con partes locales. */
function validarFechaIngreso(fecha, ahora = new Date()) {
  if (fecha === undefined || fecha === null || fecha === '') return fechaHoyLocal(ahora)
  const texto = String(fecha).trim()
  if (!RE_FECHA.test(texto)) {
    throw new FichaInvalidaError(
      `Fecha de ingreso inválida "${fecha}", se espera "YYYY-MM-DD"`,
    )
  }
  return texto
}

/**
 * Crea una ficha de alumno. Campos según docs/modelo-datos.md §3. `nombre` y
 * `apellidos` son obligatorios y recortados; para `tipo: "menor"` hace falta un
 * representante con nombre y apellidos (los avisos van al representante).
 * `fechaIngreso` arranca en la fecha local de hoy; `avisosActivos` en `true`.
 * Solo los campos del whitelist se escriben (el resto se ignora).
 */
export async function crearAlumno(db, tenantId, datos = {}, opciones = {}) {
  const { uid = null, now = new Date(), alumnoId = null } = opciones
  const tipo = datos.tipo ?? 'adulto'
  validarTipoAlumno(tipo)
  validarNivel(datos.nivel)
  const nombre = exigirNombre(datos.nombre, 'El alumno necesita un nombre')
  const apellidos = exigirNombre(datos.apellidos, 'El alumno necesita apellidos')
  const representante = tipo === 'menor' ? validarRepresentante(datos.representante) : null

  // Whitelist: solo los campos conocidos del modelo se persisten.
  const alumno = {
    tipo,
    nombre,
    apellidos,
    ...camposBusqueda({ nombre, apellidos }),
    nivel: datos.nivel ?? null,
    email: textoOpcional(datos.email, 'email', LIMITES_FICHA.email),
    telefono: textoOpcional(datos.telefono, 'telefono', LIMITES_FICHA.telefono),
    documento: validarDocumento(datos.documento),
    contactoEmergencia: validarContactoEmergencia(datos.contactoEmergencia),
    representante,
    fechaIngreso: validarFechaIngreso(datos.fechaIngreso, now),
    avisosActivos: datos.avisosActivos ?? true,
    activo: datos.activo ?? true,
    notas: textoOpcional(datos.notas, 'notas internas', LIMITES_FICHA.notas) ?? '',
    creadoPor: uid,
    creadoEn: Timestamp.fromDate(now),
  }

  const ref = alumnoId
    ? refAlumno(db, tenantId, alumnoId)
    : doc(collection(db, 'academias', tenantId, 'alumnos'))
  await setDoc(ref, alumno)
  return { alumnoId: ref.id }
}

/**
 * Actualiza una ficha de alumno (merge). Soft delete: `{ activo: false }`.
 * Recalcula los campos del buscador si cambia el nombre o los apellidos.
 * Solo los campos del whitelist se incluyen en la actualización.
 * Si el tipo resultante es "menor", el representante es obligatorio; si pasa a
 * "adulto", el representante se limpia.
 */
export async function actualizarAlumno(db, tenantId, alumnoId, cambios = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const ref = refAlumno(db, tenantId, alumnoId)
  const snap = await getDoc(ref)
  const actual = snap.exists() ? snap.data() : {}
  const efectivo = (campo) => (cambios[campo] !== undefined ? cambios[campo] : actual[campo])

  const tipoEfectivo = efectivo('tipo') ?? 'adulto'
  validarTipoAlumno(tipoEfectivo)
  validarNivel(cambios.nivel !== undefined ? cambios.nivel : actual.nivel)

  const update = {}
  if (cambios.tipo !== undefined) update.tipo = tipoEfectivo
  if (cambios.nombre !== undefined || cambios.apellidos !== undefined) {
    const nombre = exigirNombre(efectivo('nombre'), 'El alumno necesita un nombre')
    const apellidos = exigirNombre(efectivo('apellidos'), 'El alumno necesita apellidos')
    update.nombre = nombre
    update.apellidos = apellidos
    Object.assign(update, camposBusqueda({ nombre, apellidos }))
  }
  if (cambios.nivel !== undefined) update.nivel = cambios.nivel ?? null
  if (cambios.email !== undefined) {
    update.email = textoOpcional(cambios.email, 'email', LIMITES_FICHA.email)
  }
  if (cambios.telefono !== undefined) {
    update.telefono = textoOpcional(cambios.telefono, 'telefono', LIMITES_FICHA.telefono)
  }
  if (cambios.documento !== undefined) update.documento = validarDocumento(cambios.documento)
  if (cambios.contactoEmergencia !== undefined) {
    update.contactoEmergencia = validarContactoEmergencia(cambios.contactoEmergencia)
  }
  if (cambios.fechaIngreso !== undefined) {
    update.fechaIngreso = validarFechaIngreso(cambios.fechaIngreso, now)
  }
  if (cambios.avisosActivos !== undefined) update.avisosActivos = Boolean(cambios.avisosActivos)
  if (cambios.activo !== undefined) update.activo = Boolean(cambios.activo)
  if (cambios.notas !== undefined) {
    update.notas = textoOpcional(cambios.notas, 'notas internas', LIMITES_FICHA.notas) ?? ''
  }

  if (tipoEfectivo === 'menor') {
    // Un menor siempre necesita representante, aunque los cambios no lo traigan.
    if (cambios.representante !== undefined || cambios.tipo !== undefined) {
      update.representante = validarRepresentante(efectivo('representante'))
    } else if (actual.representante == null) {
      update.representante = validarRepresentante(null)
    }
  } else if (cambios.tipo !== undefined) {
    update.representante = null
  }

  update.actualizadoPor = uid
  update.actualizadoEn = Timestamp.fromDate(now)

  await updateDoc(ref, update)
  return { alumnoId }
}

/** Lee una ficha de alumno. 1 lectura. */
export async function getAlumno(db, tenantId, alumnoId) {
  const snap = await getDoc(refAlumno(db, tenantId, alumnoId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/**
 * Busca alumnos ACTIVOS por prefijo de nombre O de apellido, sin tildes ni
 * mayúsculas. Los campos normalizados son `busquedaNombre` ("nombre apellidos")
 * y `busquedaApellido` ("apellidos nombre"): corren dos consultas de prefijo en
 * paralelo, se mezclan sin duplicados y se cortan a `limite` (10 por defecto).
 * Exige al menos 2 letras para no barrer la colección. Acotado por tenant +
 * activo + límite. Índices: `alumnos: activo + busquedaNombre` y
 * `alumnos: activo + busquedaApellido` (firestore.indexes.json).
 */
export async function buscarAlumnos(db, tenantId, texto, opciones = {}) {
  const { limite = 10 } = opciones
  const prefijo = normalizarBusqueda(texto)
  if (prefijo.length < 2) return []

  const coleccion = collection(db, 'academias', tenantId, 'alumnos')
  const porCampo = (campo) =>
    query(
      coleccion,
      where('activo', '==', true),
      where(campo, '>=', prefijo),
      where(campo, '<=', `${prefijo}\uf8ff`),
      orderBy(campo),
      limit(limite),
    )

  const [porNombre, porApellido] = await Promise.all([
    getDocs(porCampo('busquedaNombre')),
    getDocs(porCampo('busquedaApellido')),
  ])

  const encontrados = new Map()
  for (const snap of [...porNombre.docs, ...porApellido.docs]) {
    if (encontrados.has(snap.id)) continue
    encontrados.set(snap.id, { id: snap.id, ...snap.data() })
    if (encontrados.size >= limite) break
  }
  return [...encontrados.values()]
}

/**
 * Crea una ficha de profesor. `nombre` y `apellidos` son obligatorios y
 * recortados. `sedes` es la lista de sedes donde dicta (solo esas clases lo
 * pueden asignar). La tarifa por hora queda SIN DEFINIR: no se escribe ningún
 * campo de tarifa (tampoco `tarifaHoraCentavos`).
 * Solo los campos del whitelist se persisten.
 */
export async function crearProfesor(db, tenantId, datos = {}, opciones = {}) {
  const { uid = null, now = new Date(), profesorId = null } = opciones
  const nombre = exigirNombre(datos.nombre, 'El profesor necesita un nombre')
  const apellidos = exigirNombre(datos.apellidos, 'El profesor necesita apellidos')

  // Whitelist: solo los campos conocidos del modelo se persisten.
  const profesor = {
    nombre,
    apellidos,
    telefono: textoOpcional(datos.telefono, 'telefono', LIMITES_FICHA.telefono),
    email: textoOpcional(datos.email, 'email', LIMITES_FICHA.email),
    documento: validarDocumento(datos.documento),
    sedes: Array.isArray(datos.sedes) ? [...datos.sedes] : [],
    notas: textoOpcional(datos.notas, 'notas internas', LIMITES_FICHA.notas) ?? '',
    activo: datos.activo ?? true,
    creadoPor: uid,
    creadoEn: Timestamp.fromDate(now),
  }

  const ref = profesorId
    ? refProfesor(db, tenantId, profesorId)
    : doc(collection(db, 'academias', tenantId, 'profesores'))
  await setDoc(ref, profesor)
  return { profesorId: ref.id }
}

/**
 * Actualiza una ficha de profesor (merge). Soft delete: `{ activo: false }`.
 * Solo los campos del whitelist se incluyen en la actualización.
 */
export async function actualizarProfesor(db, tenantId, profesorId, cambios = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const update = {}
  if (cambios.nombre !== undefined) {
    update.nombre = exigirNombre(cambios.nombre, 'El profesor necesita un nombre')
  }
  if (cambios.apellidos !== undefined) {
    update.apellidos = exigirNombre(cambios.apellidos, 'El profesor necesita apellidos')
  }
  if (cambios.telefono !== undefined) {
    update.telefono = textoOpcional(cambios.telefono, 'telefono', LIMITES_FICHA.telefono)
  }
  if (cambios.email !== undefined) {
    update.email = textoOpcional(cambios.email, 'email', LIMITES_FICHA.email)
  }
  if (cambios.documento !== undefined) update.documento = validarDocumento(cambios.documento)
  if (cambios.sedes !== undefined) update.sedes = Array.isArray(cambios.sedes) ? [...cambios.sedes] : []
  if (cambios.notas !== undefined) {
    update.notas = textoOpcional(cambios.notas, 'notas internas', LIMITES_FICHA.notas) ?? ''
  }
  if (cambios.activo !== undefined) update.activo = Boolean(cambios.activo)
  update.actualizadoPor = uid
  update.actualizadoEn = Timestamp.fromDate(now)
  await updateDoc(refProfesor(db, tenantId, profesorId), update)
  return { profesorId }
}

/**
 * Clases de una sede en UNA fecha, ordenadas por hora. Acotado por
 * tenant + sede + fecha (+ limit). Usa el índice compuesto
 * `clases: sedeId + fecha + horaInicio` de firestore.indexes.json.
 */
export async function getClasesDeSedePorFecha(db, tenantId, sedeId, fecha) {
  const q = query(
    collection(db, 'academias', tenantId, 'clases'),
    where('sedeId', '==', sedeId),
    where('fecha', '==', fecha),
    orderBy('horaInicio'),
    limit(200),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/* --------------------------------------------------------------------- */
/* Reserva sin solapamientos                                              */
/* --------------------------------------------------------------------- */

/**
 * Crea una clase y ocupa todos sus bloques de 30 minutos (cancha + profesor) en
 * UNA transacción. Si algún bloque ya existe, aborta con `SolapamientoError` y
 * no escribe nada.
 *
 * `datos` acepta los campos de `clases/{claseId}` (ver docs/modelo-datos.md §4).
 * Las series fijas (`tipo: 'fija'`) NO están implementadas: sin definir.
 */
export async function crearClase(db, tenantId, datos, opciones = {}) {
  const { uid = null, now = new Date(), claseId = null } = opciones

  if (datos.tipo && datos.tipo !== 'variable') {
    throw new ClaseInvalidaError(
      `Solo se admiten clases "variable"; las series fijas (tipo "${datos.tipo}") están sin definir`,
    )
  }
  validarCategoria(datos.categoria)
  validarCupo(datos.cupo)

  const bloques = bloquesDeClase(datos)
  const claseRef = claseId
    ? refClase(db, tenantId, claseId)
    : doc(collection(db, 'academias', tenantId, 'clases'))

  const cupo = datos.cupo ?? 4
  const alumnosIniciales = datos.alumnos ?? []

  // Referencias de sede, cancha y profesor para leer dentro de la transacción.
  const sedeRef = doc(db, 'academias', tenantId, 'sedes', datos.sedeId)
  const canchaRef = doc(db, 'academias', tenantId, 'sedes', datos.sedeId, 'canchas', datos.canchaId)
  const profRef = refProfesor(db, tenantId, datos.profesorId)

  await runTransaction(db, async (tx) => {
    // Todas las lecturas ANTES de cualquier escritura (requisito de las
    // transacciones de Firestore).

    // Leer sede, cancha y profesor para validar existencia y actividad,
    // y tomar los nombres denormalizados de los documentos.
    const [snapSede, snapCancha, snapProfesor] = await Promise.all([
      tx.get(sedeRef),
      tx.get(canchaRef),
      tx.get(profRef),
    ])
    if (!snapSede.exists() || snapSede.data().activa === false) {
      throw new ClaseInvalidaError(`La sede "${datos.sedeId}" no existe o no está activa`)
    }
    if (!snapCancha.exists() || snapCancha.data().activa === false) {
      throw new ClaseInvalidaError(`La cancha "${datos.canchaId}" no existe o no está activa en la sede "${datos.sedeId}"`)
    }
    if (!snapProfesor.exists() || snapProfesor.data().activo === false) {
      throw new ClaseInvalidaError(`El profesor "${datos.profesorId}" no existe o no está activo`)
    }
    if (!(snapProfesor.data().sedes ?? []).includes(datos.sedeId)) {
      throw new ClaseInvalidaError(
        `El profesor "${datos.profesorId}" no está asignado a la sede "${datos.sedeId}"`,
      )
    }

    const snapsBloque = await Promise.all(
      bloques.map((b) => tx.get(refBloque(db, tenantId, b.id))),
    )
    const ocupado = bloques.find((b, i) => snapsBloque[i].exists())
    if (ocupado) throw new SolapamientoError(ocupado)

    // Los alumnos se validan en la misma transacción: existen, activos, sin
    // duplicados y dentro del cupo. De ahí sale `alumnoNombres` denormalizado.
    const snapsAlumno = await Promise.all(
      alumnosIniciales.map((id) => tx.get(refAlumno(db, tenantId, id))),
    )
    const alumnosPorId = {}
    alumnosIniciales.forEach((id, i) => {
      if (snapsAlumno[i].exists()) alumnosPorId[id] = snapsAlumno[i].data()
    })
    const { alumnos, alumnoNombres } = resolverAsignacion(alumnosIniciales, alumnosPorId, cupo)

    const clase = {
      tipo: 'variable',
      serieId: null,
      estado: 'reservada',
      categoria: datos.categoria ?? null,
      asistencias: [],
      alumnos,
      alumnoNombres,
      cupo,
      sedeId: datos.sedeId,
      // Nombres tomados de los documentos, no del cliente.
      sedeNombre: snapSede.data().nombre ?? null,
      canchaId: datos.canchaId,
      profesorId: datos.profesorId,
      profesorNombre: nombreCompleto(snapProfesor.data()),
      fecha: datos.fecha,
      horaInicio: datos.horaInicio,
      horaFin: datos.horaFin,
      bloques: bloques.map((b) => b.id),
      creadoPor: uid,
      creadoEn: Timestamp.fromDate(now),
    }

    // tx.set() y no create(): la API transaccional del SDK web no tiene create().
    // No importa para la exclusividad — la transacción ya LEYÓ cada bloque, y
    // Firestore reintenta o aborta si alguno cambió entre la lectura y el commit,
    // así que nunca se pisa la reserva ajena.
    tx.set(claseRef, clase)
    for (const bloque of bloques) {
      tx.set(refBloque(db, tenantId, bloque.id), {
        ...bloque.data,
        claseId: claseRef.id,
        creadoPor: uid,
        creadoEn: Timestamp.fromDate(now),
      })
    }
  })

  return { claseId: claseRef.id, bloques: bloques.map((b) => b.id) }
}

/**
 * Cancela una clase y libera sus bloques en una sola transacción.
 *
 * - Solo cancela clases en estado "reservada". Si ya está cancelada, es
 *   un no-op (idempotencia para pantallas obsoletas/doble click).
 * - Antes de borrar cada bloque verifica que bloque.claseId === claseId
 *   para no destruir bloques que ya pertenecen a otra clase (escenario
 *   de cancelación + nueva reserva + cancelación de pantalla obsoleta).
 * - Guarda bloques: [] en la clase cancelada para dejar el campo limpio.
 */
export async function cancelarClase(db, tenantId, claseId, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const claseRef = refClase(db, tenantId, claseId)

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claseRef)
    if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
    const datos = snap.data()

    // No-op si ya está cancelada (idempotencia ante doble click o pantalla obsoleta).
    if (datos.estado === 'cancelada') return

    // Solo se puede cancelar una clase reservada.
    if (datos.estado !== 'reservada') {
      throw new ClaseInvalidaError(
        `Solo se puede cancelar una clase "reservada" (estado "${datos.estado}")`,
      )
    }

    // Leer cada bloque para verificar propiedad antes de borrar.
    const bloqueIds = datos.bloques ?? []
    const snapsBloques = await Promise.all(
      bloqueIds.map((id) => tx.get(refBloque(db, tenantId, id))),
    )

    tx.update(claseRef, {
      estado: 'cancelada',
      bloques: [],
      actualizadoPor: uid,
      actualizadoEn: Timestamp.fromDate(now),
    })
    bloqueIds.forEach((bloqueId, i) => {
      // Solo borrar si el bloque existe y todavía pertenece a esta clase.
      if (snapsBloques[i].exists() && snapsBloques[i].data().claseId === claseId) {
        tx.delete(refBloque(db, tenantId, bloqueId))
      }
    })
  })

  return { claseId, estado: 'cancelada' }
}

/**
 * Reprograma una clase en UNA transacción: libera los bloques viejos y ocupa
 * los nuevos, abortando si algún bloque nuevo ya lo ocupa OTRA clase. Los
 * bloques que ya son de la propia clase no cuentan como conflicto (mover una
 * clase sobre sus propios huecos es válido).
 *
 * `nuevoCambio` trae solo los campos a cambiar (fecha, horaInicio, horaFin,
 * canchaId, sedeId, profesorId, …). Los que no vengan se conservan.
 */
export async function reprogramarClase(db, tenantId, claseId, nuevoCambio = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const claseRef = refClase(db, tenantId, claseId)

  if (nuevoCambio.tipo && nuevoCambio.tipo !== 'variable') {
    throw new ClaseInvalidaError(
      `Solo se admiten clases "variable"; las series fijas (tipo "${nuevoCambio.tipo}") están sin definir`,
    )
  }
  validarCategoria(nuevoCambio.categoria)
  if (nuevoCambio.cupo !== undefined) validarCupo(nuevoCambio.cupo)

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claseRef)
    if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
    const datos = snap.data()

    // Solo se puede reprogramar una clase en estado "reservada".
    if (datos.estado !== 'reservada') {
      throw new ClaseInvalidaError(
        `Solo se puede reprogramar una clase "reservada" (estado "${datos.estado}")`,
      )
    }

    const campo = (clave, fallback) =>
      nuevoCambio[clave] !== undefined ? nuevoCambio[clave] : (datos[clave] ?? fallback)

    const futura = {
      sedeId: campo('sedeId'),
      canchaId: campo('canchaId'),
      profesorId: campo('profesorId'),
      fecha: campo('fecha'),
      horaInicio: campo('horaInicio'),
      horaFin: campo('horaFin'),
    }
    const bloquesNuevos = bloquesDeClase(futura)
    const bloquesViejos = datos.bloques ?? []

    // Todas las lecturas antes de cualquier escritura.
    const snaps = await Promise.all(
      bloquesNuevos.map((b) => tx.get(refBloque(db, tenantId, b.id))),
    )
    const snapsViejos = await Promise.all(
      bloquesViejos.map((id) => tx.get(refBloque(db, tenantId, id)))
    )
    const ocupado = bloquesNuevos.find(
      (b, i) => snaps[i].exists() && snaps[i].data().claseId !== claseId,
    )
    if (ocupado) throw new SolapamientoError(ocupado)

    // El profesor de la clase tiene que existir, estar activo y estar asignado
    // a la sede de la clase. Los nombres denormalizados salen del documento.
    const [snapSede, snapProfesor] = await Promise.all([
      tx.get(doc(db, 'academias', tenantId, 'sedes', futura.sedeId)),
      tx.get(refProfesor(db, tenantId, futura.profesorId)),
    ])
    if (!snapSede.exists() || snapSede.data().activa === false) {
      throw new ClaseInvalidaError(`La sede "${futura.sedeId}" no existe o no está activa`)
    }
    if (!snapProfesor.exists() || snapProfesor.data().activo === false) {
      throw new ClaseInvalidaError(`El profesor "${futura.profesorId}" no existe o no está activo`)
    }
    if (!(snapProfesor.data().sedes ?? []).includes(futura.sedeId)) {
      throw new ClaseInvalidaError(
        `El profesor "${futura.profesorId}" no está asignado a la sede "${futura.sedeId}"`,
      )
    }

    // Asignación de alumnos: si cambia la lista se valida (existen, activos,
    // sin duplicados, dentro del cupo); si solo cambia el cupo, se revisa que
    // los ya asignados sigan entrando. Lecturas antes de cualquier escritura.
    const cupoEfectivo = campo('cupo', 4)
    let asignacion = null
    if (nuevoCambio.alumnos !== undefined) {
      const ids = Array.isArray(nuevoCambio.alumnos) ? nuevoCambio.alumnos : []
      const snapsAlumno = await Promise.all(ids.map((id) => tx.get(refAlumno(db, tenantId, id))))
      const alumnosPorId = {}
      ids.forEach((id, i) => {
        if (snapsAlumno[i].exists()) alumnosPorId[id] = snapsAlumno[i].data()
      })
      asignacion = resolverAsignacion(ids, alumnosPorId, cupoEfectivo)
    } else if (nuevoCambio.cupo !== undefined && (datos.alumnos ?? []).length > cupoEfectivo) {
      throw new ClaseInvalidaError(
        `La clase admite ${cupoEfectivo} alumno(s) (cupo) y ya tiene ${datos.alumnos.length} asignados`,
      )
    }

    const idsNuevos = new Set(bloquesNuevos.map((b) => b.id))
    for (const [indice, bloqueId] of bloquesViejos.entries()) {
      if (!idsNuevos.has(bloqueId) && snapsViejos[indice].exists() && snapsViejos[indice].data().claseId === claseId) {
        tx.delete(refBloque(db, tenantId, bloqueId))
      }
    }
    for (const [indice, bloque] of bloquesNuevos.entries()) {
      // Si ya existe y es de esta misma clase, no hace falta reescribirlo.
      if (!snaps[indice].exists()) {
        tx.set(refBloque(db, tenantId, bloque.id), {
          ...bloque.data,
          claseId,
          creadoPor: uid,
          creadoEn: Timestamp.fromDate(now),
        })
      }
    }

    const cambios = {
      bloques: bloquesNuevos.map((b) => b.id),
      actualizadoPor: uid,
      actualizadoEn: Timestamp.fromDate(now),
    }
    for (const clave of [
      'sedeId',
      'canchaId',
      'profesorId',
      'fecha',
      'horaInicio',
      'horaFin',
      'cupo',
      'categoria',
    ]) {
      if (nuevoCambio[clave] !== undefined) cambios[clave] = nuevoCambio[clave]
    }
    // Los nombres SIEMPRE salen del documento, no del cliente.
    cambios.sedeNombre = snapSede.data().nombre ?? null
    cambios.profesorNombre = nombreCompleto(snapProfesor.data())
    if (asignacion) {
      cambios.alumnos = asignacion.alumnos
      cambios.alumnoNombres = asignacion.alumnoNombres
    }
    tx.update(claseRef, cambios)
  })

  return { claseId }
}

/**
 * Reemplaza en UNA transacción la lista de alumnos de una clase. Solo se
 * permite mientras la clase está `reservada`. Mismas validaciones que al crear:
 * existen, activos, sin duplicados y dentro del cupo. `alumnoNombres` se
 * denormaliza desde las fichas.
 *
 * Nota de diseño: que un alumno quede en dos clases a la misma hora NO se
 * bloquea en la transacción ni genera bloques de alumno (fuera de alcance).
 */
export async function asignarAlumnos(db, tenantId, claseId, alumnoIds, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const claseRef = refClase(db, tenantId, claseId)
  const ids = Array.isArray(alumnoIds) ? alumnoIds : []

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claseRef)
    if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
    const datos = snap.data()
    if (datos.estado !== 'reservada') {
      throw new ClaseInvalidaError(
        `Solo se asignan alumnos a una clase "reservada" (estado "${datos.estado}")`,
      )
    }

    const snapsAlumno = await Promise.all(ids.map((id) => tx.get(refAlumno(db, tenantId, id))))
    const alumnosPorId = {}
    ids.forEach((id, i) => {
      if (snapsAlumno[i].exists()) alumnosPorId[id] = snapsAlumno[i].data()
    })
    const { alumnos, alumnoNombres } = resolverAsignacion(ids, alumnosPorId, datos.cupo ?? 0)

    tx.update(claseRef, {
      alumnos,
      alumnoNombres,
      actualizadoPor: uid,
      actualizadoEn: Timestamp.fromDate(now),
    })
  })

  return { claseId }
}

/**
 * Registra la asistencia de una clase (embebida en el documento, §4) y la deja
 * en "pendiente de cobro" en la misma escritura.
 *
 * Los estados son `presente`, `ausente_avisada` y `ausente_sin_aviso` (+ motivo
 * opcional); cualquier otro valor se rechaza. Requiere exactamente una entrada
 * por alumno asignado. La regla de negocio de la ausencia (recuperación o nota
 * de crédito) y la ventana de aviso están SIN DEFINIR: acá solo se registra.
 * Tampoco se generan cargos ni liquidación al profesor.
 */
export async function registrarAsistencia(db, tenantId, claseId, asistencias, opciones = {}) {
  const { uid = null, now = new Date(), ahora = new Date() } = opciones
  if (!Array.isArray(asistencias)) {
    throw new ClaseInvalidaError('asistencias debe ser un arreglo')
  }
  const normalizadas = asistencias.map((registro) => {
    if (!registro?.alumnoId) throw new ClaseInvalidaError('Cada asistencia necesita alumnoId')
    if (!ESTADOS_ASISTENCIA.includes(registro.estado)) {
      throw new ClaseInvalidaError(
        `Estado de asistencia inválido "${registro.estado}". Permitidos: ${ESTADOS_ASISTENCIA.join(', ')}`,
      )
    }
    return {
      alumnoId: registro.alumnoId,
      estado: registro.estado,
      motivo: registro.motivo ?? null,
      registradoPor: uid,
      registradoEn: Timestamp.fromDate(now),
    }
  })
  if (new Set(normalizadas.map((r) => r.alumnoId)).size !== normalizadas.length) {
    throw new ClaseInvalidaError('No se admiten alumnos repetidos en la asistencia')
  }

  const claseRef = refClase(db, tenantId, claseId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claseRef)
    if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
    const estadoActual = snap.data().estado

    // Solo se puede cerrar una clase que está en estado "reservada".
    if (estadoActual !== 'reservada') {
      throw new ClaseInvalidaError(
        estadoActual === 'cancelada'
          ? `La clase ${claseId} está cancelada y no se puede cerrar`
          : `La clase ${claseId} ya está cerrada (estado "${estadoActual}")`,
      )
    }

    // No se puede cerrar una clase que todavía no terminó.
    // Se compara en hora LOCAL para no depender de UTC (Caracas = UTC-4).
    const d = snap.data()
    const [fy, fm, fd] = String(d.fecha ?? '').split('-').map(Number)
    if (fy && fm && fd && d.horaFin) {
      const finMinutos = aMinutos(d.horaFin)
      if (finMinutos !== null) {
        const finFecha = new Date(fy, fm - 1, fd)
        finFecha.setMinutes(finMinutos)
        if (ahora.getTime() < finFecha.getTime()) {
          throw new ClaseInvalidaError(
            `La clase ${claseId} todavía no terminó (horaFin ${d.horaFin} el ${d.fecha})`,
          )
        }
      }
    }

    // Exactamente una entrada por alumno asignado: ni de menos (falta alguno)
    // ni de más (alumno que no pertenece a la clase).
    const asignados = new Set(snap.data().alumnos ?? [])
    const registrados = new Set(normalizadas.map((r) => r.alumnoId))
    if (asignados.size !== registrados.size || [...asignados].some((id) => !registrados.has(id))) {
      throw new ClaseInvalidaError(
        'La asistencia debe tener exactamente una entrada por cada alumno asignado',
      )
    }

    tx.update(claseRef, {
      asistencias: normalizadas,
      estado: 'pendiente_cobro',
      actualizadoPor: uid,
      actualizadoEn: Timestamp.fromDate(now),
    })
  })

  return { claseId, estado: 'pendiente_cobro' }
}

/**
 * Membresía del usuario actual en un tenant. 1 lectura. Sirve para decidir qué
 * acciones mostrar en la UI (la autorización real la hacen las Security Rules).
 */
export async function getMiMembresia(db, tenantId, uid) {
  const snap = await getDoc(doc(db, 'academias', tenantId, 'miembros', uid))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/** Lee una clase. 1 lectura. */export async function getClase(db, tenantId, claseId) {
  const snap = await getDoc(refClase(db, tenantId, claseId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

/**
 * Estado de ocupación de un bloque concreto de 30 minutos. Útil para pintar la
 * grilla de la agenda sin traer todas las clases del día. 1 lectura.
 */
export async function getBloque(db, tenantId, bloqueId) {
  const snap = await getDoc(refBloque(db, tenantId, bloqueId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}