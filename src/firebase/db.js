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
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore'
import { CATEGORIAS, HORARIO_DEFAULT, formatHora12, horarioDeSede } from '../lib/agenda.js'

/**
 * Granularidad de la ocupación: 60 minutos (un bloque por hora en punto).
 * Ver docs/modelo-datos.md §4.1.
 */
export const MINUTOS_BLOQUE = 60

/*
 * Reglas de horario de una clase (se aplican en la capa de datos, no solo en el
 * formulario):
 * - arranca en una hora en punto dentro de la franja de la SEDE;
 * - dura 1 h o 2 h exactas;
 * - no puede terminar después del cierre de la SEDE, así que la última hora de
 *   inicio depende de la duración.
 *
 * La franja ya no es global: cada sede tiene `horario {apertura, cierre}` en
 * horas enteras. HORARIO_DEFAULT es el fallback 07:00-23:00 para las sedes que
 * todavía no tienen el campo (ver `horarioDeSede`). Las dos son puras y viven en
 * src/lib/agenda.js; acá se reexportan para no romper a quien las importa de la
 * capa de datos.
 */
export const HORA_APERTURA = HORARIO_DEFAULT.apertura * 60
export const HORA_CIERRE = HORARIO_DEFAULT.cierre * 60
export const DURACIONES_VALIDAS = [60, 120]

/** Tope de largo del nombre de una cancha (después de recortar). */
export const LIMITE_NOMBRE_CANCHA = 100

/**
 * Tope de clases futuras que `setSedeHorario` revisa antes de aceptar un
 * horario nuevo. Es una acción de configuración poco frecuente y la consulta
 * queda acotada por tenant + sede + fecha.
 */
export const LIMITE_CLASES_HORARIO = 500

/**
 * Tope de clases que `cambiarActivaCancha` revisa antes de desactivar una
 * cancha. Igual que `LIMITE_CLASES_HORARIO`: es una acción de configuración poco
 * frecuente y la consulta queda acotada por tenant + cancha + fecha.
 */
export const LIMITE_CLASES_PENDIENTES = 500

/** Categorías válidas de una clase. Ver docs/modelo-datos.md §4. */
export { CATEGORIAS, HORARIO_DEFAULT, horarioDeSede }

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
 * Normaliza un texto para buscarlo por prefijo y para ORDENARLO: minúsculas,
 * sin tildes y sin la tilde de la ñ, y con los espacios colapsados. Se usa para
 * escribir los campos `busquedaNombre` y `busquedaApellido` y para consultarlos
 * (ver `buscarAlumnos` y `listarAlumnos`).
 *
 * Se pasa a minúsculas ANTES de descomponer: así las vocales acentuadas
 * mayúsculas (Á, É, Í, Ó, Ú, Ü) también se descomponen (en NFD, `Á` es un solo
 * carácter y no se descompone; `á` sí). De `Ñ`/`ñ` queda `n`: el orden de
 * Firestore es por bytes UTF-8, así que un campo con tildes o con ñ se iría al
 * final del listado. Normalizado, el orden coincide con el alfabético.
 */
export function normalizarBusqueda(texto) {
  return String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

/**
 * Error de negocio: la configuración de una sede es inválida (horario fuera de
 * rango, cancha sin nombre o repetida, horario que deja clases afuera, etc.).
 */
export class SedeInvalidaError extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'SedeInvalidaError'
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

/**
 * Traduce una fecha "YYYY-MM-DD" + hora "HH:mm" (hora LOCAL del negocio,
 * Caracas) al instante absoluto del reloj. Se usan las partes locales del
 * Date, nunca `toISOString()`: con Caracas (UTC-4) UTC adelantaría el día.
 */
export function instanteLocal(fecha, hora) {
  if (!RE_FECHA.test(fecha ?? '')) {
    throw new ClaseInvalidaError(`Fecha inválida "${fecha}", se espera "YYYY-MM-DD"`)
  }
  const [y, m, d] = fecha.split('-').map(Number)
  const minutos = aMinutos(hora)
  const instante = new Date(y, m - 1, d, 0, 0, 0, 0)
  instante.setMinutes(minutos)
  return instante
}

/**
 * Valida que una clase no arranque en el pasado, comparando contra `ahora`
 * (inyectable). El borde exacto (`inicio === ahora`) SÍ se admite.
 */
export function validarInicioNoPasado(fecha, horaInicio, ahora) {
  if (instanteLocal(fecha, horaInicio).getTime() < ahora.getTime()) {
    throw new ClaseInvalidaError(
      `No se puede reservar una clase que ya empezó (${fecha} ${formatHora12(horaInicio)})`,
    )
  }
}

/* --------------------------------------------------------------------- */
/* Sedes y canchas: horario y configuración (helpers puros)                */
/* --------------------------------------------------------------------- */

/**
 * Valida y normaliza un horario de sede: apertura y cierre enteros entre 0 y
 * 24, con cierre > apertura. Devuelve `{apertura, cierre}`.
 */
export function validarHorario(horario) {
  const apertura = horario?.apertura
  const cierre = horario?.cierre
  if (!Number.isInteger(apertura) || !Number.isInteger(cierre)) {
    throw new SedeInvalidaError('La apertura y el cierre deben ser horas enteras')
  }
  if (apertura < 0 || apertura > 24 || cierre < 0 || cierre > 24) {
    throw new SedeInvalidaError('La apertura y el cierre deben estar entre 0 y 24')
  }
  if (cierre <= apertura) {
    throw new SedeInvalidaError('El cierre debe ser posterior a la apertura')
  }
  return { apertura, cierre }
}

/**
 * Nombre visible de una cancha. Si el documento no tiene `nombre` (canchas
 * viejas) se cae a "Cancha {numero}" y, en última instancia, al id.
 */
export function nombreDeCancha(cancha, canchaId = null) {
  const nombre = String(cancha?.nombre ?? '').trim()
  if (nombre) return nombre
  if (cancha?.numero != null) return `Cancha ${cancha.numero}`
  return String(canchaId ?? cancha?.id ?? '')
}

/**
 * Conectores que quedan en minúscula dentro de un nombre, salvo que abran el
 * nombre ("cancha de arriba" → "Cancha de Arriba").
 */
const CONECTORES_NOMBRE = new Set(['de', 'del', 'la', 'el', 'y'])

/**
 * Paso compartido por `normalizarNombreCancha` y `claveNombreCancha`: tira los
 * caracteres INVISIBLES (formato Unicode: ZWSP, ZWNJ, ZWJ, word joiner, soft
 * hyphen), recorta, colapsa los espacios repetidos y separa una LETRA seguida
 * de un DÍGITO ("  CANCHA   6 " y "CANCHA6" → "CANCHA 6"). Un dígito seguido de
 * letras no se toca: "Cancha 6A" y "6cancha" quedan como se escribieron.
 *
 * El orden importa: sacar los invisibles ANTES de separar, así un nombre
 * pegado desde otro lado ("Cancha<ZWSP>6") también queda como "Cancha 6".
 */
function limpiarEspaciosYDigitos(nombre) {
  return String(nombre ?? '')
    .replace(/\p{Cf}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
}

/**
 * Nombre visible normalizado de una cancha: recorta, colapsa espacios, separa
 * una letra pegada a un dígito y, si el nombre viene TODO en mayúsculas o TODO
 * en minúsculas, pone inicial mayúscula en cada palabra (los conectores "de",
 * "del", "la", "el" y "y" quedan en minúscula salvo en la primera palabra). Un
 * nombre ya mezclado se respeta tal cual quedó tras los pasos anteriores.
 *
 * Un token que mezcla dígitos y letras ("6A", "6cancha") se respeta como se
 * escribió, para no romper un sufijo en mayúscula; la excepción es el sufijo de
 * UNA sola letra tras el número ("6a" → "6A"), típico nombre de cancha.
 *
 * Los acentos NUNCA se agregan ni se quitan: "PANORÁMICA" → "Panorámica" y
 * "panoramica" → "Panoramica" se guardan distintos (solo el chequeo de
 * duplicados los compara sin acentos, vía `claveNombreCancha`).
 */
export function normalizarNombreCancha(nombre) {
  const texto = limpiarEspaciosYDigitos(nombre)
  const letras = texto.match(/\p{L}/gu) ?? []
  if (!letras.length) return texto
  const enMayusculas = letras.every((letra) => letra === letra.toLocaleUpperCase('es'))
  const enMinusculas = letras.every((letra) => letra === letra.toLocaleLowerCase('es'))
  if (!enMayusculas && !enMinusculas) return texto
  return texto
    .split(' ')
    .map((palabra, indice) => {
      if (/\p{N}/u.test(palabra) && /\p{L}/u.test(palabra)) {
        return /^\p{N}+\p{L}$/u.test(palabra) ? palabra.toLocaleUpperCase('es') : palabra
      }
      const enMinuscula = palabra.toLocaleLowerCase('es')
      if (indice > 0 && CONECTORES_NOMBRE.has(enMinuscula)) return enMinuscula
      return enMinuscula.charAt(0).toLocaleUpperCase('es') + enMinuscula.slice(1)
    })
    .join(' ')
}

/**
 * Clave de unicidad de un nombre de cancha: sin acentos y en minúsculas, sobre
 * el nombre ya limpiado (espacios colapsados y la letra pegada a un dígito ya
 * separada). "Cancha 5", "cancha 5", "  CANCHA   5  ", "CANCHA5" y
 * "Panorámica" / "panoramica" dan la misma clave; el nombre que se GUARDA no
 * se toca (solo pasa por `normalizarNombreCancha`). Única fuente de verdad de
 * la comparación: la usan tanto `crearCancha` como `renombrarCancha`, y las
 * canchas inactivas cuentan.
 */
export function claveNombreCancha(nombre) {
  return limpiarEspaciosYDigitos(nombre)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Valida y normaliza el nombre de una cancha: primero se normaliza
 * (`normalizarNombreCancha`), después no puede quedar vacío, tiene tope de
 * largo y no puede repetirse dentro de la sede según `claveNombreCancha`
 * (ignora caja, espacios de más, letras pegadas a dígitos y acentos).
 * `canchas` son las canchas existentes —incluidas las inactivas— y `exceptoId`
 * deja afuera a la que se está renombrando. Devuelve el nombre a guardar.
 */
export function validarNombreCancha(nombre, canchas = [], exceptoId = null) {
  const texto = normalizarNombreCancha(nombre)
  if (!texto) throw new SedeInvalidaError('La cancha necesita un nombre')
  if (texto.length > LIMITE_NOMBRE_CANCHA) {
    throw new SedeInvalidaError(
      `El nombre de la cancha no puede superar ${LIMITE_NOMBRE_CANCHA} caracteres`,
    )
  }
  const clave = claveNombreCancha(texto)
  const repetida = canchas.find(
    (cancha) =>
      cancha.id !== exceptoId && claveNombreCancha(nombreDeCancha(cancha, cancha.id)) === clave,
  )
  if (repetida) {
    throw new SedeInvalidaError(
      `Ya hay una cancha llamada "${nombreDeCancha(repetida, repetida.id)}"`,
    )
  }
  return texto
}

/**
 * Valida que una franja de clase (horas "HH:mm") entre en el horario de la
 * sede: arranca a la apertura o después y termina al cierre o antes.
 */
export function validarFranjaEnHorario(horaInicio, horaFin, horario = HORARIO_DEFAULT) {
  const franja = horarioDeSede({ horario })
  const inicio = aMinutos(horaInicio)
  const fin = aMinutos(horaFin)
  if (inicio < franja.apertura * 60) {
    throw new ClaseInvalidaError(
      `La clase no puede empezar antes de ${formatHora12(franja.apertura * 60)} (recibido ${formatHora12(horaInicio)})`,
    )
  }
  if (fin > franja.cierre * 60) {
    throw new ClaseInvalidaError(
      `La clase no puede terminar después de ${formatHora12(franja.cierre * 60)} (${formatHora12(horaInicio)}-${formatHora12(horaFin)})`,
    )
  }
  return franja
}

/** ¿El documento (sede, cancha, profesor) está activo? Campo ausente = activo. */
function estaActivo(datos) {
  return datos?.activa !== false && datos?.activo !== false
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
 *
 * `horario` es la franja de la sede (`{apertura, cierre}` en horas enteras).
 * Por defecto usa 07:00-23:00: los llamadores que tengan la sede le pasan el
 * horario real (ver `horarioDeSede`).
 */
export function bloquesDeClase(datos, horario = HORARIO_DEFAULT) {
  const { sedeId, canchaId, profesorId, fecha, horaInicio, horaFin } = datos
  if (!RE_FECHA.test(fecha ?? '')) {
    throw new ClaseInvalidaError(`Fecha inválida "${fecha}", se espera "YYYY-MM-DD"`)
  }
  if (!sedeId) throw new ClaseInvalidaError('Falta sedeId')
  if (!canchaId) throw new ClaseInvalidaError('Falta canchaId')
  if (!profesorId) throw new ClaseInvalidaError('Falta profesorId')

  const inicio = aMinutos(horaInicio)
  const fin = aMinutos(horaFin)
  const duracion = fin - inicio
  if (fin <= inicio || !DURACIONES_VALIDAS.includes(duracion)) {
    throw new ClaseInvalidaError(
      `La duración debe ser 1 h o 2 h (${formatHora12(horaInicio)}-${formatHora12(horaFin)})`,
    )
  }
  if (inicio % 60 !== 0) {
    // Solo horas EN PUNTO: con bloques de 60 min, un inicio a las 19:30 ocuparía
    // un bloque con ID de las 19:00 y se saldría de la rejilla.
    throw new ClaseInvalidaError(
      `horaInicio debe ser una hora en punto (recibido ${formatHora12(horaInicio)})`,
    )
  }
  validarFranjaEnHorario(horaInicio, horaFin, horario)

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
 * Reglas: al menos 1 alumno, sin duplicados, todos existen, todos activos
 * (`activo === false` se rechaza) y cantidad <= cupo. Un cupo <= 1 es Individual
 * (ver docs/modelo-datos.md §4).
 */
export function resolverAsignacion(alumnoIds, alumnosPorId, cupo) {
  if (!Array.isArray(alumnoIds)) {
    throw new ClaseInvalidaError('alumnos debe ser un arreglo de IDs')
  }
  const limite = Number.isFinite(cupo) ? cupo : 0
  if (alumnoIds.length < 1) {
    throw new ClaseInvalidaError('La clase necesita al menos un alumno asignado')
  }
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
const refSede = (db, tenantId, sedeId) => doc(db, 'academias', tenantId, 'sedes', sedeId)
const refCancha = (db, tenantId, sedeId, canchaId) =>
  doc(db, 'academias', tenantId, 'sedes', sedeId, 'canchas', canchaId)

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

/**
 * Canchas de una sede, ordenadas por `numero` y después nombre. Acotado por
 * sede + limit (50). El filtro de activa se hace en el cliente para que una
 * cancha vieja SIN el campo `activa` siga contando como activa (fallback); las
 * inactivas no llegan a la agenda.
 */
export async function getCanchas(db, tenantId, sedeId) {
  const q = query(collection(db, 'academias', tenantId, 'sedes', sedeId, 'canchas'), limit(50))
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((cancha) => cancha.activa !== false)
    .sort(
      (a, b) =>
        (a.numero ?? 0) - (b.numero ?? 0) ||
        String(nombreDeCancha(a, a.id)).localeCompare(String(nombreDeCancha(b, b.id)), 'es'),
    )
}

/**
 * Canchas de una sede INCLUYENDO las inactivas: es la lectura de la pantalla de
 * Configuración, que necesita listarlas para reactivarlas. Acotado por sede +
 * limit (50). Misma forma que `getCanchas` (sin el filtro de activa).
 */
export async function listarCanchas(db, tenantId, sedeId) {
  const q = query(collection(db, 'academias', tenantId, 'sedes', sedeId, 'canchas'), limit(50))
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        (a.numero ?? 0) - (b.numero ?? 0) ||
        String(nombreDeCancha(a, a.id)).localeCompare(String(nombreDeCancha(b, b.id)), 'es'),
    )
}

/* --------------------------------------------------------------------- */
/* Configuración de sedes y canchas                                        */
/* --------------------------------------------------------------------- */

/** Lee una sede. 1 lectura. */
export async function getSede(db, tenantId, sedeId) {
  const snap = await getDoc(refSede(db, tenantId, sedeId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/** Falla con SedeInvalidaError si la sede no existe. 1 lectura. */
async function exigirSede(db, tenantId, sedeId) {
  const snap = await getDoc(refSede(db, tenantId, sedeId))
  if (!snap.exists()) throw new SedeInvalidaError(`La sede "${sedeId}" no existe`)
  return { id: snap.id, ...snap.data() }
}

/**
 * Agrega una cancha a una sede. El nombre se normaliza
 * (`normalizarNombreCancha`) y debe ser único dentro de la sede
 * (case-insensitive); el `numero` se calcula como el siguiente entero.
 * La cancha nace activa. Las canchas NUNCA se borran: se desactivan.
 */
export async function crearCancha(db, tenantId, sedeId, datos = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  await exigirSede(db, tenantId, sedeId)
  const existentes = await listarCanchas(db, tenantId, sedeId)
  const nombre = validarNombreCancha(datos.nombre, existentes)
  const numero = existentes.reduce((max, cancha) => Math.max(max, Number(cancha.numero) || 0), 0) + 1

  const ref = doc(collection(db, 'academias', tenantId, 'sedes', sedeId, 'canchas'))
  await setDoc(ref, {
    nombre,
    numero,
    tipo: datos.tipo ?? null,
    activa: true,
    creadoPor: uid,
    creadoEn: Timestamp.fromDate(now),
  })
  return { canchaId: ref.id }
}

/** Renombra una cancha. Mismas reglas de nombre que al crearla (normalizado y único en la sede). */
export async function renombrarCancha(db, tenantId, sedeId, canchaId, nombre, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const snap = await getDoc(refCancha(db, tenantId, sedeId, canchaId))
  if (!snap.exists()) throw new SedeInvalidaError(`La cancha "${canchaId}" no existe`)
  const existentes = await listarCanchas(db, tenantId, sedeId)
  const nombreLimpio = validarNombreCancha(nombre, existentes, canchaId)
  await updateDoc(refCancha(db, tenantId, sedeId, canchaId), {
    nombre: nombreLimpio,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { canchaId, nombre: nombreLimpio }
}

/**
 * Activa o desactiva una cancha. Soft delete: el documento NUNCA se borra, así
 * las clases que ya la usan quedan intactas.
 *
 * DESACTIVAR se rechaza mientras la cancha tenga clases pendientes —no
 * canceladas y cuyo fin todavía no pasó, comparado contra `ahora`—: primero hay
 * que cancelarlas o moverlas a otra cancha. Una clase ya terminada no bloquea,
 * aunque siga sin cerrar o sin cobrar. Reactivar SIEMPRE se permite.
 *
 * Desactivada, la cancha no admite reservas NUEVAS ni reprogramaciones HACIA
 * ella (lo validan `crearClase` y `reprogramarClase`).
 */
export async function cambiarActivaCancha(db, tenantId, sedeId, canchaId, activa, opciones = {}) {
  const { uid = null, ahora = new Date() } = opciones
  const now = opciones.now ?? ahora
  const snap = await getDoc(refCancha(db, tenantId, sedeId, canchaId))
  if (!snap.exists()) throw new SedeInvalidaError(`La cancha "${canchaId}" no existe`)
  const valor = Boolean(activa)

  if (!valor) {
    const nombre = nombreDeCancha({ id: canchaId, ...snap.data() }, canchaId)
    const pendientes = await contarClasesPendientesDeCancha(db, tenantId, sedeId, canchaId, ahora)
    if (pendientes > 0) {
      throw new SedeInvalidaError(
        `No se puede desactivar ${nombre}: tiene ${pendientes} ` +
          `${pendientes === 1 ? 'clase pendiente' : 'clases pendientes'}. ` +
          'Cancélalas o muévelas a otra cancha primero.',
      )
    }
  }

  await updateDoc(refCancha(db, tenantId, sedeId, canchaId), {
    activa: valor,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { canchaId, activa: valor }
}

/**
 * Cuenta las clases FUTURAS (fecha >= hoy local, nunca con `toISOString()`) no
 * canceladas de una sede que quedarían fuera del horario propuesto. Acotado por
 * tenant + sede + fecha + limit (el índice `clases: sedeId + fecha + horaInicio`
 * cubre el prefijo sedeId + fecha); el filtro de estado y el de franja van en el
 * cliente. `ahora` es inyectable.
 */
async function contarClasesFueraDeHorario(db, tenantId, sedeId, horario, ahora) {
  const q = query(
    collection(db, 'academias', tenantId, 'clases'),
    where('sedeId', '==', sedeId),
    where('fecha', '>=', fechaHoyLocal(ahora)),
    limit(LIMITE_CLASES_HORARIO),
  )
  const snap = await getDocs(q)
  let fuera = 0
  for (const documento of snap.docs) {
    const clase = documento.data()
    if (clase.estado === 'cancelada') continue
    const inicio = RE_HHMM.test(clase.horaInicio ?? '') ? aMinutos(clase.horaInicio) : null
    const fin = RE_HHMM.test(clase.horaFin ?? '') ? aMinutos(clase.horaFin) : null
    if (inicio === null || fin === null) continue
    if (inicio < horario.apertura * 60 || fin > horario.cierre * 60) fuera += 1
  }
  return fuera
}

/**
 * ¿La clase todavía no terminó en `ahora`? Se compara el FIN en hora LOCAL
 * (nunca con `toISOString()`), con reloj inyectable. Una clase que termina
 * EXACTAMENTE en `ahora` ya terminó. Las canceladas nunca cuentan y una clase
 * con fecha u hora corruptas se ignora (igual que en `contarClasesFueraDeHorario`).
 * Función pura: no toca Firestore.
 */
export function clasePendiente(clase, ahora = new Date()) {
  if (clase?.estado === 'cancelada') return false
  if (!RE_FECHA.test(clase?.fecha ?? '') || !RE_HHMM.test(clase?.horaFin ?? '')) return false
  return instanteLocal(clase.fecha, clase.horaFin).getTime() > ahora.getTime()
}

/**
 * Cuenta las clases PENDIENTES de una cancha: las no canceladas cuyo fin todavía
 * no pasó (ver `clasePendiente`). Acotado por tenant + cancha + fecha (desde hoy
 * local) + limit; el índice `clases: canchaId + fecha + horaInicio` cubre el
 * prefijo canchaId + fecha. El estado y el reloj se filtran en el cliente.
 *
 * Una cancha de OTRA sede podría compartir el id del documento: las clases con
 * un `sedeId` distinto se ignoran (las que no traen `sedeId`, de datos viejos,
 * se cuentan igual).
 */
async function contarClasesPendientesDeCancha(db, tenantId, sedeId, canchaId, ahora) {
  const q = query(
    collection(db, 'academias', tenantId, 'clases'),
    where('canchaId', '==', canchaId),
    where('fecha', '>=', fechaHoyLocal(ahora)),
    limit(LIMITE_CLASES_PENDIENTES),
  )
  const snap = await getDocs(q)
  let pendientes = 0
  for (const documento of snap.docs) {
    const clase = documento.data()
    if (clase.sedeId && clase.sedeId !== sedeId) continue
    if (clasePendiente(clase, ahora)) pendientes += 1
  }
  return pendientes
}

/**
 * Fija el horario de una sede (`{apertura, cierre}` en horas enteras 0-24, con
 * cierre > apertura). Rechaza el cambio si deja FUERA a alguna clase futura no
 * cancelada, con un mensaje que dice cuántas son.
 */
export async function setSedeHorario(db, tenantId, sedeId, horario, opciones = {}) {
  const { uid = null, ahora = new Date() } = opciones
  const now = opciones.now ?? ahora
  await exigirSede(db, tenantId, sedeId)
  const nuevo = validarHorario(horario)
  const fuera = await contarClasesFueraDeHorario(db, tenantId, sedeId, nuevo, ahora)
  if (fuera > 0) {
    throw new SedeInvalidaError(
      `No se puede cambiar el horario: ${fuera} clase(s) futura(s) quedarían fuera de ` +
        `${formatHora12(nuevo.apertura * 60)} a ${formatHora12(nuevo.cierre * 60)}. ` +
        'Reprograma o cancela esas clases primero.',
    )
  }
  await updateDoc(refSede(db, tenantId, sedeId), {
    horario: nuevo,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { sedeId, horario: nuevo }
}

/** Estados admitidos por los filtros de listado. */
export const ESTADOS_LISTA = ['activos', 'inactivos', 'todos']
/** Tope duro de una página de `listarAlumnos`. */
export const LIMITE_PAGINA_ALUMNOS = 100

/** Tope duro de `buscarAlumnos`. */
export const LIMITE_BUSQUEDA_ALUMNOS = 50

/** Tope por defecto/duro de `getProfesores` cuando la pantalla pide la lista. */
export const LIMITE_PROFESORES = 200

/** Normaliza el filtro de estado. Cualquier valor raro cae en "activos". */
function normalizarEstado(estado) {
  return ESTADOS_LISTA.includes(estado) ? estado : 'activos'
}

/** Condición `activo` de una query según el filtro de estado (o ninguna). */
function filtroActivo(estado) {
  if (estado === 'todos') return []
  return [where('activo', '==', estado === 'inactivos' ? false : true)]
}

/**
 * Profesores de una academia. Con `{ sedeId }` devuelve solo los que dictan en
 * esa sede (`sedes` array-contains). Con `{ estado }` filtra por activo:
 * `"activos"` (default), `"inactivos"` o `"todos"` (sin condición de activo).
 * Acotado por tenant + activo (+ sede) + limit (`200` por defecto, tope duro).
 * El orden es client-side por apellidos y después nombre (el conjunto es chico).
 * Índices: `profesores: activo + sedes` (firestore.indexes.json); con
 * `estado: "todos"` alcanza el índice de un solo campo.
 */
export async function getProfesores(db, tenantId, opciones = {}) {
  const {
    sedeId = null,
    estado = 'activos',
    limite = LIMITE_PROFESORES,
  } = opciones
  const pedido = Number.isFinite(limite) ? Math.floor(limite) : LIMITE_PROFESORES
  const tope = Math.min(Math.max(pedido, 1), LIMITE_PROFESORES)

  const filtros = filtroActivo(normalizarEstado(estado))
  if (sedeId) filtros.push(where('sedes', 'array-contains', sedeId))
  const q = query(
    collection(db, 'academias', tenantId, 'profesores'),
    ...filtros,
    limit(tope),
  )
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        String(a.apellidos ?? '').localeCompare(String(b.apellidos ?? ''), 'es') ||
        String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es'),
    )
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
 * Lista paginada de alumnos por `busquedaApellido` ("apellidos nombre",
 * minúsculas y sin tildes), así que el orden es alfabético por APELLIDO y sin
 * distinguir acentos. Una página son `limite` documentos (100 por defecto,
 * tope duro) más uno de sonda: el extra se recorta y se devuelve como cursor
 * `siguiente` para la próxima llamada (`startAfter`). `siguiente` es `null`
 * cuando no hay más.
 *
 * `estado`: `"activos"` (default) | `"inactivos"` | `"todos"` (sin condición de
 * activo). `despues`: cursor devuelto por la llamada anterior, o `null`.
 *
 * Costo: `limite + 1` lecturas por página. Índices (firestore.indexes.json):
 * `alumnos: activo + busquedaApellido` para activos/inactivos; con `"todos"`
 * alcanza el índice de un solo campo.
 */
export async function listarAlumnos(db, tenantId, opciones = {}) {
  const {
    estado = 'activos',
    limite = LIMITE_PAGINA_ALUMNOS,
    despues = null,
  } = opciones
  const pedido = Number.isFinite(limite) ? Math.floor(limite) : LIMITE_PAGINA_ALUMNOS
  const tope = Math.min(Math.max(pedido, 1), LIMITE_PAGINA_ALUMNOS)

  const q = query(
    collection(db, 'academias', tenantId, 'alumnos'),
    ...filtroActivo(normalizarEstado(estado)),
    orderBy('busquedaApellido'),
    ...(despues ? [startAfter(despues)] : []),
    limit(tope + 1),
  )
  const snap = await getDocs(q)
  const docs = snap.docs
  const hayMas = docs.length > tope
  const pagina = hayMas ? docs.slice(0, tope) : docs

  return {
    alumnos: pagina.map((d) => ({ id: d.id, ...d.data() })),
    siguiente: hayMas ? pagina[pagina.length - 1] : null,
  }
}

/**
 * Busca alumnos por prefijo de nombre O de apellido, sin tildes ni mayúsculas.
 * Los campos normalizados son `busquedaNombre` ("nombre apellidos") y
 * `busquedaApellido` ("apellidos nombre"): corren dos consultas de prefijo en
 * paralelo, se mezclan sin duplicados y se cortan a `limite` (10 por defecto,
 * tope duro 50). Exige al menos 2 letras para no barrer la colección.
 *
 * `estado`: `"activos"` (default) | `"inactivos"` | `"todos"`. Con `"todos"` se
 * quita la condición de activo y alcanza el índice de un solo campo.
 *
 * Acotado por tenant + (activo) + límite. Índices (firestore.indexes.json):
 * `alumnos: activo + busquedaNombre` y `alumnos: activo + busquedaApellido`.
 */
export async function buscarAlumnos(db, tenantId, texto, opciones = {}) {
  const { limite = 10, estado = 'activos' } = opciones
  const pedido = Number.isFinite(limite) ? Math.floor(limite) : 10
  const tope = Math.min(Math.max(pedido, 1), LIMITE_BUSQUEDA_ALUMNOS)
  const prefijo = normalizarBusqueda(texto)
  if (prefijo.length < 2) return []

  const condiciones = filtroActivo(normalizarEstado(estado))
  const coleccion = collection(db, 'academias', tenantId, 'alumnos')
  const porCampo = (campo) =>
    query(
      coleccion,
      ...condiciones,
      where(campo, '>=', prefijo),
      where(campo, '<=', `${prefijo}\uf8ff`),
      orderBy(campo),
      limit(tope),
    )

  const [porNombre, porApellido] = await Promise.all([
    getDocs(porCampo('busquedaNombre')),
    getDocs(porCampo('busquedaApellido')),
  ])

  const encontrados = new Map()
  for (const snap of [...porNombre.docs, ...porApellido.docs]) {
    if (encontrados.has(snap.id)) continue
    encontrados.set(snap.id, { id: snap.id, ...snap.data() })
    if (encontrados.size >= tope) break
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
 * Crea una clase y ocupa todos sus bloques de 60 minutos (cancha + profesor) en
 * UNA transacción. Si algún bloque ya existe, aborta con `SolapamientoError` y
 * no escribe nada.
 *
 * `datos` acepta los campos de `clases/{claseId}` (ver docs/modelo-datos.md §4).
 * Las series fijas (`tipo: 'fija'`) NO están implementadas: sin definir.
 */
export async function crearClase(db, tenantId, datos, opciones = {}) {
  const { uid = null, ahora = new Date(), claseId = null } = opciones
  const now = opciones.now ?? ahora

  if (datos.tipo && datos.tipo !== 'variable') {
    throw new ClaseInvalidaError(
      `Solo se admiten clases "variable"; las series fijas (tipo "${datos.tipo}") están sin definir`,
    )
  }
  validarCategoria(datos.categoria)
  validarCupo(datos.cupo)
  // La franja, los bloques y el "no reservar en el pasado" se validan DENTRO de
  // la transacción: la franja ya no es global y necesita el horario de la sede
  // (ver `horarioDeSede`). El orden importa: primero la franja (horario de la
  // sede) y después el reloj, igual que en la reprogramación.
  const claseRef = claseId
    ? refClase(db, tenantId, claseId)
    : doc(collection(db, 'academias', tenantId, 'clases'))

  const cupo = datos.cupo ?? 4
  const alumnosIniciales = datos.alumnos ?? []

  // Referencias de sede, cancha y profesor para leer dentro de la transacción.
  const sedeRef = refSede(db, tenantId, datos.sedeId)
  const canchaRef = refCancha(db, tenantId, datos.sedeId, datos.canchaId)
  const profRef = refProfesor(db, tenantId, datos.profesorId)
  let bloques = []

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
    if (!snapSede.exists() || !estaActivo(snapSede.data())) {
      throw new ClaseInvalidaError(`La sede "${datos.sedeId}" no existe o no está activa`)
    }
    if (!snapCancha.exists() || !estaActivo(snapCancha.data())) {
      throw new ClaseInvalidaError(`La cancha "${datos.canchaId}" no existe o no está activa en la sede "${datos.sedeId}"`)
    }
    if (!snapProfesor.exists() || !estaActivo(snapProfesor.data())) {
      throw new ClaseInvalidaError(`El profesor "${datos.profesorId}" no existe o no está activo`)
    }
    if (!(snapProfesor.data().sedes ?? []).includes(datos.sedeId)) {
      throw new ClaseInvalidaError(
        `El profesor "${datos.profesorId}" no está asignado a la sede "${datos.sedeId}"`,
      )
    }

    // Franja + bloques con el horario REAL de la sede (fallback 07:00-23:00) y,
    // recién después, el "no reservar en el pasado" (reloj inyectado).
    bloques = bloquesDeClase(datos, horarioDeSede(snapSede.data()))
    validarInicioNoPasado(datos.fecha, datos.horaInicio, ahora)

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
  const { uid = null, ahora = new Date() } = opciones
  const now = opciones.now ?? ahora
  const claseRef = refClase(db, tenantId, claseId)

  if (nuevoCambio.tipo && nuevoCambio.tipo !== 'variable') {
    throw new ClaseInvalidaError(
      `Solo se admiten clases "variable"; las series fijas (tipo "${nuevoCambio.tipo}") están sin definir`,
    )
  }
  validarCategoria(nuevoCambio.categoria)
  if (nuevoCambio.cupo !== undefined) validarCupo(nuevoCambio.cupo)
  // La lista de alumnos no puede quedar vacía: una clase reprogramada sigue
  // necesitando al menos un alumno.
  if (nuevoCambio.alumnos !== undefined) {
    const ids = Array.isArray(nuevoCambio.alumnos) ? nuevoCambio.alumnos : []
    if (ids.length < 1) {
      throw new ClaseInvalidaError('La clase necesita al menos un alumno asignado')
    }
  }

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
    const bloquesViejos = datos.bloques ?? []

    // Sede, cancha y profesor DESTINO: existen y están activos (campo ausente =
    // activo), y el profesor está asignado a la sede. La cancha inactiva rechaza
    // la reprogramación HACIA ella; las clases que ya están en una cancha
    // inactiva no se tocan.
    const [snapSede, snapCancha, snapProfesor] = await Promise.all([
      tx.get(refSede(db, tenantId, futura.sedeId)),
      tx.get(refCancha(db, tenantId, futura.sedeId, futura.canchaId)),
      tx.get(refProfesor(db, tenantId, futura.profesorId)),
    ])
    if (!snapSede.exists() || !estaActivo(snapSede.data())) {
      throw new ClaseInvalidaError(`La sede "${futura.sedeId}" no existe o no está activa`)
    }
    if (!snapCancha.exists() || !estaActivo(snapCancha.data())) {
      throw new ClaseInvalidaError(
        `La cancha "${futura.canchaId}" no existe o no está activa en la sede "${futura.sedeId}"`,
      )
    }
    if (!snapProfesor.exists() || !estaActivo(snapProfesor.data())) {
      throw new ClaseInvalidaError(`El profesor "${futura.profesorId}" no existe o no está activo`)
    }
    if (!(snapProfesor.data().sedes ?? []).includes(futura.sedeId)) {
      throw new ClaseInvalidaError(
        `El profesor "${futura.profesorId}" no está asignado a la sede "${futura.sedeId}"`,
      )
    }

    // Franja + bloques con el horario REAL de la sede destino y, recién
    // después, el "no se reprograma al pasado" (reloj inyectado).
    const bloquesNuevos = bloquesDeClase(futura, horarioDeSede(snapSede.data()))
    validarInicioNoPasado(futura.fecha, futura.horaInicio, ahora)

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
  const { uid = null, ahora = new Date() } = opciones
  const now = opciones.now ?? ahora
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
    // Una clase reservada no puede quedarse sin alumnos: quitar al último se
    // rechaza igual que crear una reserva sin ninguno.
    if (ids.length < 1) {
      throw new ClaseInvalidaError('La clase necesita al menos un alumno asignado')
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
 *
 * `ahora` es el único reloj: se usa para el sello `registradoEn` y para validar
 * que la clase ya terminó. Es inyectable para poder probarlo.
 */
export async function registrarAsistencia(db, tenantId, claseId, asistencias, opciones = {}) {
  const { uid = null, ahora = new Date() } = opciones
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
      registradoEn: Timestamp.fromDate(ahora),
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
            `La clase ${claseId} todavía no terminó (horaFin ${formatHora12(d.horaFin)} el ${d.fecha})`,
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
      actualizadoEn: Timestamp.fromDate(ahora),
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
 * Estado de ocupación de un bloque concreto de 60 minutos. Útil para pintar la
 * grilla de la agenda sin traer todas las clases del día. 1 lectura.
 */
export async function getBloque(db, tenantId, bloqueId) {
  const snap = await getDoc(refBloque(db, tenantId, bloqueId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}