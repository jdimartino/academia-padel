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
import {
  CATEGORIAS,
  CATEGORIAS_GRUPO,
  DIAS_SEMANA,
  DURACIONES_VALIDAS,
  HORARIO_DEFAULT,
  HORARIO_SEMANA_DEFAULT,
  MINUTOS_BLOQUE,
  etiquetaDia,
  formatHora12,
  formatMinutos,
  franjaValida,
  horarioDeSede,
  horarioDelDia,
} from '../lib/agenda.js'
import {
  ALERTA_DIAS_MAX,
  AUSENCIA_HORAS_MAX,
  FRECUENCIAS_PLAN,
  LIMITE_NOMBRE_PERFIL,
  METODOS_PAGO,
  MODOS_COBRO,
  PAGOS_SIN_AVISO,
  PARAMETROS_DEFAULT,
  PERSONAS_MAX,
  PORCENTAJE_MAX,
  REPARTOS_AUSENCIA,
  VENCIMIENTO_DIAS_MAX,
  alertaCobroValida,
  calcularCierre,
  consumirCreditos,
  duracionesValidas,
  enteroEnRango,
  estadoLote,
  faltaConCreditoValida,
  frecuenciaPlanValida,
  leerParametros,
  lotesUsables,
  minutosDisponibles,
  minutosPlanValidos,
  modoValido,
  motivoValido,
  pagoProfesorValido,
  pagoSinAvisoValido,
  personasValidas,
  precioMensualidad,
  precioPlanValido,
  previsualizarCreditoAlumno,
  repartoAusenciaValido,
  vencimientoValido,
} from '../lib/cobros.js'
import { LIMITE_MONTO_CENTS, LIMITE_TARIFA_CENTS, centsValidos } from '../lib/dinero.js'
import { normalizarPorAlumnoProfesor } from '../lib/profesores.js'
import { sumarDias } from '../lib/fechas.js'
import { FUENTES_TASA, LIMITE_BS_POR_UNIDAD } from '../lib/tasas.js'

/**
 * Granularidad de la ocupación: 30 minutos. La definición vive en
 * src/lib/agenda.js (`MINUTOS_BLOQUE`), que es el módulo puro compartido con la
 * grilla y el formulario; acá se reexporta para no romper a quien la importa de
 * la capa de datos. Ver docs/modelo-datos.md §4.1.
 */
export { MINUTOS_BLOQUE }

/*
 * Reglas de horario de una clase (se aplican en la capa de datos, no solo en el
 * formulario):
 * - arranca en punto o a y media (múltiplo de MINUTOS_BLOQUE) dentro de la
 *   franja de la SEDE PARA ESE DÍA;
 * - dura 1 h, 1 h 30 o 2 h exactas (ver DURACIONES_VALIDAS);
 * - no puede terminar después del cierre de la SEDE ese día, así que la última
 *   hora de inicio depende de la duración.
 *
 * La franja no es global: cada sede tiene un horario POR DÍA DE LA SEMANA con
 * apertura y cierre en MINUTOS (múltiplos de 30) o `null` si ese día está
 * cerrado (ver `horarioDeSede` y `horarioDelDia` en src/lib/agenda.js).
 * HORARIO_SEMANA_DEFAULT es el fallback 07:00-23:00 para las sedes sin el campo
 * o con datos corruptos. Todo eso es puro y vive en src/lib/agenda.js; acá se
 * reexporta para no romper a quien lo importa de la capa de datos.
 *
 * HORA_APERTURA y HORA_CIERRE son la franja del día por defecto (07:00-23:00),
 * en MINUTOS (420-1380): antes eran horas enteras y con el horario por día todo
 * el proyecto trabaja en minutos.
 */
export const HORA_APERTURA = HORARIO_DEFAULT.apertura
export const HORA_CIERRE = HORARIO_DEFAULT.cierre
export { DURACIONES_VALIDAS }

/** Tope de largo del nombre de una cancha (después de recortar). */
export const LIMITE_NOMBRE_CANCHA = 100

/**
 * Tope de largo del nombre de una sede. Es el MISMO tope que el de una cancha:
 * los nombres de sede se normalizan y se comparan con las mismas utilidades
 * (`normalizarNombreCancha` / `claveNombreCancha`).
 */
export const LIMITE_NOMBRE_SEDE = LIMITE_NOMBRE_CANCHA

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
export {
  CATEGORIAS,
  CATEGORIAS_GRUPO,
  HORARIO_DEFAULT,
  HORARIO_SEMANA_DEFAULT,
  horarioDeSede,
  horarioDelDia,
}

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
 * Valida la CATEGORÍA DE GRUPO de una clase (opcional): `infantil`, `junior` o
 * `adulto`, o `null`/ausente si no se indica. Es un campo DISTINTO de
 * `categoria` (el nivel: Principiante, 7ª…1ª) y todavía no afecta precios.
 */
function validarCategoriaGrupo(categoriaGrupo) {
  if (categoriaGrupo != null && !CATEGORIAS_GRUPO.includes(categoriaGrupo)) {
    throw new ClaseInvalidaError(
      `Categoría de grupo inválida "${categoriaGrupo}". Permitidas: ${CATEGORIAS_GRUPO.join(', ')}`,
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

/**
 * Error de negocio: la configuración de cobros es inválida (perfil sin nombre o
 * repetido, modo/personas fuera del enum, tarifa o monto que no es un entero de
 * centavos, parámetro fuera de rango, etc.).
 */
export class CobroInvalidoError extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'CobroInvalidoError'
  }
}

/** Error de negocio: la tasa BCV guardada es inválida (Bs fuera de rango, etc.). */
export class TasaInvalidaError extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'TasaInvalidaError'
  }
}

/** Tope de perfiles de cobro que se listan de una academia. */
export const LIMITE_PERFILES_COBRO = 50

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
 * Valida y normaliza el HORARIO SEMANAL de una sede: un mapa con los 7 días
 * (claves 0 = lunes … 6 = domingo, ver `DIAS_SEMANA`). Cada día es `null` (la
 * sede está cerrada ese día) o una franja `{apertura, cierre}` en MINUTOS,
 * múltiplos de MINUTOS_BLOQUE, dentro de 0-1440 y con cierre > apertura.
 *
 * Es estricto a propósito: solo acepta el formato nuevo. El formato VIEJO de un
 * solo par de horas enteras se sigue LEYENDO (`horarioDeSede` lo expande a los
 * 7 días), pero lo que se escribe es siempre el formato por día.
 *
 * Devuelve un mapa nuevo con los 7 días.
 */
export function validarHorario(horario) {
  if (!horario || typeof horario !== 'object' || Array.isArray(horario)) {
    throw new SedeInvalidaError('El horario debe indicar los 7 días de la semana')
  }
  const claves = Object.keys(horario)
  if (claves.length !== DIAS_SEMANA.length) {
    throw new SedeInvalidaError('El horario debe traer exactamente los 7 días de la semana')
  }
  const semana = {}
  for (const dia of DIAS_SEMANA) {
    const etiqueta = etiquetaDia(dia)
    if (!Object.hasOwn(horario, dia)) {
      throw new SedeInvalidaError(`Falta el horario del ${etiqueta.toLowerCase()}`)
    }
    const valor = horario[dia]
    if (valor === null) {
      semana[dia] = null
      continue
    }
    // Estricto con la FORMA: exactamente `{apertura, cierre}` (sin campos
    // extra), igual que la validación de firestore.rules. El lector
    // (`franjaValida`) sí es tolerante y solo mira las dos horas.
    const esObjeto = valor !== null && typeof valor === 'object' && !Array.isArray(valor)
    const franja = esObjeto && Object.keys(valor).length === 2 ? franjaValida(valor) : null
    if (!franja) {
      throw new SedeInvalidaError(
        `El horario del ${etiqueta.toLowerCase()} es inválido: la apertura y el cierre deben ` +
          `ser múltiplos de ${MINUTOS_BLOQUE} min entre 0 y 1440, con el cierre después de la apertura`,
      )
    }
    semana[dia] = franja
  }
  return semana
}

/**
 * Nombre visible de una sede. Si el documento no tiene `nombre` se cae al id.
 */
export function nombreDeSede(sede, sedeId = null) {
  const nombre = String(sede?.nombre ?? '').trim()
  return nombre || String(sedeId ?? sede?.id ?? '')
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
 * Valida y normaliza el nombre de una SEDE con las MISMAS reglas y utilidades
 * que el de una cancha (`normalizarNombreCancha` + `claveNombreCancha`): no
 * puede quedar vacío, tiene tope de largo y no puede repetirse dentro del tenant
 * (ignora caja, espacios de más, letras pegadas a dígitos y acentos; las sedes
 * inactivas también cuentan). `sedes` son las sedes existentes y `exceptoId`
 * deja afuera a la que se está renombrando. Devuelve el nombre a guardar.
 */
export function validarNombreSede(nombre, sedes = [], exceptoId = null) {
  const texto = normalizarNombreCancha(nombre)
  if (!texto) throw new SedeInvalidaError('La sede necesita un nombre')
  if (texto.length > LIMITE_NOMBRE_SEDE) {
    throw new SedeInvalidaError(
      `El nombre de la sede no puede superar ${LIMITE_NOMBRE_SEDE} caracteres`,
    )
  }
  const clave = claveNombreCancha(texto)
  const repetida = sedes.find(
    (sede) => sede.id !== exceptoId && claveNombreCancha(nombreDeSede(sede, sede.id)) === clave,
  )
  if (repetida) {
    throw new SedeInvalidaError(`Ya hay una sede llamada "${nombreDeSede(repetida, repetida.id)}"`)
  }
  return texto
}

/**
 * Valida que una franja de clase (horas "HH:mm") entre en el horario del DÍA de
 * la sede: arranca a la apertura o después y termina al cierre o antes.
 *
 * `horario` es la franja del día en MINUTOS (`{apertura, cierre}`), tal como la
 * devuelve `horarioDelDia`. Con `null` —día CERRADO— la clase se rechaza. Sin
 * argumento (o con un valor corrupto) se usa el default 07:00-23:00.
 */
export function validarFranjaEnHorario(horaInicio, horaFin, horario = HORARIO_DEFAULT) {
  const franja = horario === null ? null : (franjaValida(horario) ?? HORARIO_DEFAULT)
  if (!franja) {
    throw new ClaseInvalidaError('La sede está cerrada ese día: no se pueden reservar clases')
  }
  const inicio = aMinutos(horaInicio)
  const fin = aMinutos(horaFin)
  if (inicio < franja.apertura) {
    throw new ClaseInvalidaError(
      `La clase no puede empezar antes de ${formatMinutos(franja.apertura)} (recibido ${formatHora12(horaInicio)})`,
    )
  }
  if (fin > franja.cierre) {
    throw new ClaseInvalidaError(
      `La clase no puede terminar después de ${formatMinutos(franja.cierre)} (${formatHora12(horaInicio)}-${formatHora12(horaFin)})`,
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
 * Los bloques son de MINUTOS_BLOQUE (30) minutos: una clase de 90 minutos ocupa
 * 3 bloques de cancha + 3 de profesor. Como el inicio siempre cae en la grilla
 * y la duración es múltiplo de 30, el rango se cubre exacto.
 *
 * `horario` es la franja del DÍA de la clase en minutos (`{apertura, cierre}`),
 * tal como la devuelve `horarioDelDia` a partir del horario semanal de la sede.
 * Por defecto usa 07:00-23:00; con `null` (día cerrado) rechaza la clase.
 */
export function bloquesDeClase(datos, horario = HORARIO_DEFAULT, duraciones = DURACIONES_VALIDAS) {
  const { sedeId, canchaId, profesorId, fecha, horaInicio, horaFin } = datos
  if (!RE_FECHA.test(fecha ?? '')) {
    throw new ClaseInvalidaError(`Fecha inválida "${fecha}", se espera "YYYY-MM-DD"`)
  }
  if (!sedeId) throw new ClaseInvalidaError('Falta sedeId')
  if (!canchaId) throw new ClaseInvalidaError('Falta canchaId')
  if (!profesorId) throw new ClaseInvalidaError('Falta profesorId')

  // Duraciones admitidas: las de los parámetros de la academia (fuente de
  // verdad, ver `duracionesPermitidas`), con DURACIONES_VALIDAS como fallback.
  const validas = Array.isArray(duraciones) && duraciones.length ? duraciones : DURACIONES_VALIDAS
  const inicio = aMinutos(horaInicio)
  const fin = aMinutos(horaFin)
  const duracion = fin - inicio
  if (fin <= inicio || !validas.includes(duracion)) {
    throw new ClaseInvalidaError(
      `La duración debe ser ${validas.map((m) => `${m} min`).join(', ')} ` +
        `(${formatHora12(horaInicio)}-${formatHora12(horaFin)})`,
    )
  }
  if (inicio % MINUTOS_BLOQUE !== 0) {
    // El inicio tiene que caer en la grilla de bloques: un inicio a las 19:15
    // ocuparía bloques a las 19:00 y 19:30 y no chocaría con una clase de
    // 18:00-19:30, aunque en la realidad se pisan. Ver docs/modelo-datos.md §4.1.
    throw new ClaseInvalidaError(
      `horaInicio debe ser en punto o a y media (múltiplo de ${MINUTOS_BLOQUE} min) ` +
        `(recibido ${formatHora12(horaInicio)})`,
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
const refPerfilCobro = (db, tenantId, perfilId) =>
  doc(db, 'academias', tenantId, 'perfilesCobro', perfilId)
const refParametros = (db, tenantId) => doc(db, 'academias', tenantId, 'config', 'parametros')
const refTasas = (db, tenantId) => doc(db, 'academias', tenantId, 'config', 'tasas')
const refCargo = (db, tenantId, cargoId) => doc(db, 'academias', tenantId, 'cargos', cargoId)
const refPagoProfesor = (db, tenantId, pagoId) =>
  doc(db, 'academias', tenantId, 'pagosProfesor', pagoId)
const coleccionCargos = (db, tenantId) => collection(db, 'academias', tenantId, 'cargos')
const coleccionPagosProfesor = (db, tenantId) =>
  collection(db, 'academias', tenantId, 'pagosProfesor')
const coleccionPlanesAlumno = (db, tenantId) =>
  collection(db, 'academias', tenantId, 'planesAlumno')
const refPlanAlumno = (db, tenantId, planId) =>
  doc(db, 'academias', tenantId, 'planesAlumno', planId)
const coleccionCreditos = (db, tenantId) => collection(db, 'academias', tenantId, 'creditos')
const refCredito = (db, tenantId, creditoId) =>
  doc(db, 'academias', tenantId, 'creditos', creditoId)
const refMovimientoCredito = (db, tenantId, movimientoId) =>
  doc(db, 'academias', tenantId, 'movimientosCredito', movimientoId)
const refUsuario = (db, tenantId, uid) => doc(db, 'academias', tenantId, 'usuarios', uid)
const coleccionUsuarios = (db, tenantId) => collection(db, 'academias', tenantId, 'usuarios')

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
 * Sedes de una academia INCLUYENDO las inactivas: es la lectura de la pantalla
 * de Configuración, que necesita verlas para reactivarlas y para validar que el
 * nombre no se repita. Acotado por tenant + limit (50). Misma forma que
 * `getSedes` (sin el filtro de activa).
 */
export async function listarSedes(db, tenantId) {
  const q = query(collection(db, 'academias', tenantId, 'sedes'), limit(50))
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        (a.orden ?? 0) - (b.orden ?? 0) ||
        String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es'),
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
 * Crea una sede. El nombre se normaliza (`normalizarNombreCancha`) y debe ser
 * único dentro del tenant, contando las sedes inactivas; el `orden` se calcula
 * como el siguiente entero. La sede nace ACTIVA y con `horario` de 7 días: el
 * que venga en `datos.horario` (validado) o el default 07:00-23:00.
 */
export async function crearSede(db, tenantId, datos = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const existentes = await listarSedes(db, tenantId)
  const nombre = validarNombreSede(datos.nombre, existentes)
  const horario = datos.horario === undefined
    ? { ...HORARIO_SEMANA_DEFAULT }
    : validarHorario(datos.horario)
  const orden = existentes.reduce((max, sede) => Math.max(max, Number(sede.orden) || 0), 0) + 1

  const ref = doc(collection(db, 'academias', tenantId, 'sedes'))
  await setDoc(ref, {
    nombre,
    activa: true,
    orden,
    horario,
    creadoPor: uid,
    creadoEn: Timestamp.fromDate(now),
  })
  return { sedeId: ref.id }
}

/** Renombra una sede. Mismas reglas de nombre que al crearla (normalizado y único en el tenant). */
export async function renombrarSede(db, tenantId, sedeId, nombre, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  await exigirSede(db, tenantId, sedeId)
  const existentes = await listarSedes(db, tenantId)
  const nombreLimpio = validarNombreSede(nombre, existentes, sedeId)
  await updateDoc(refSede(db, tenantId, sedeId), {
    nombre: nombreLimpio,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { sedeId, nombre: nombreLimpio }
}

/**
 * Desactiva una sede. Soft delete: el documento NUNCA se borra, así las clases
 * que ya la usan quedan intactas.
 *
 * Se rechaza mientras la sede tenga clases pendientes —no canceladas y cuyo fin
 * todavía no pasó, comparado contra `ahora`—: primero hay que cancelarlas o
 * moverlas a otra sede. Una clase ya terminada no bloquea, aunque siga sin
 * cerrar o sin cobrar.
 *
 * Desactivada, la sede no admite reservas NUEVAS ni reprogramaciones HACIA ella
 * (lo validan `crearClase` y `reprogramarClase`) y desaparece de la agenda.
 */
export async function desactivarSede(db, tenantId, sedeId, opciones = {}) {
  const { uid = null, ahora = new Date() } = opciones
  const now = opciones.now ?? ahora
  const sede = await exigirSede(db, tenantId, sedeId)
  const pendientes = await contarClasesPendientesDeSede(db, tenantId, sedeId, ahora)
  if (pendientes > 0) {
    throw new SedeInvalidaError(
      `No se puede desactivar ${nombreDeSede(sede, sedeId)}: tiene ${pendientes} ` +
        `${pendientes === 1 ? 'clase pendiente' : 'clases pendientes'}. ` +
        'Cancélalas o muévelas a otra sede primero.',
    )
  }
  await updateDoc(refSede(db, tenantId, sedeId), {
    activa: false,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { sedeId, activa: false }
}

/** Reactiva una sede. SIEMPRE se permite, aunque tenga clases pendientes. */
export async function reactivarSede(db, tenantId, sedeId, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  await exigirSede(db, tenantId, sedeId)
  await updateDoc(refSede(db, tenantId, sedeId), {
    activa: true,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { sedeId, activa: true }
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
 * canceladas de una sede que quedarían fuera del HORARIO SEMANAL propuesto. La
 * comprobación es POR DÍA DE LA SEMANA: una clase del martes se compara solo con
 * el horario del martes, en minutos reales. Un día que queda CERRADO (`null`)
 * deja fuera a todas sus clases. Acotado por tenant + sede + fecha + limit (el
 * índice `clases: sedeId + fecha + horaInicio` cubre el prefijo sedeId + fecha);
 * el filtro de estado y el de franja van en el cliente. `ahora` es inyectable.
 */
async function contarClasesFueraDeHorario(db, tenantId, sedeId, semana, ahora) {
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
    const franja = horarioDelDia(clase.fecha, semana)
    if (franja === null) {
      // Día cerrado en el horario nuevo (o fecha corrupta): la clase no cabe.
      fuera += RE_FECHA.test(clase.fecha ?? '') ? 1 : 0
      continue
    }
    const inicio = RE_HHMM.test(clase.horaInicio ?? '') ? aMinutos(clase.horaInicio) : null
    const fin = RE_HHMM.test(clase.horaFin ?? '') ? aMinutos(clase.horaFin) : null
    if (inicio === null || fin === null) continue
    if (inicio < franja.apertura || fin > franja.cierre) fuera += 1
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
 * Cuenta las clases PENDIENTES de una SEDE (ver `clasePendiente`), para la
 * guarda de la desactivación. Acotado por tenant + sede + fecha (desde hoy
 * local) + limit; el índice `clases: sedeId + fecha + horaInicio` cubre el
 * prefijo sedeId + fecha. El estado y el reloj se filtran en el cliente.
 */
async function contarClasesPendientesDeSede(db, tenantId, sedeId, ahora) {
  const q = query(
    collection(db, 'academias', tenantId, 'clases'),
    where('sedeId', '==', sedeId),
    where('fecha', '>=', fechaHoyLocal(ahora)),
    limit(LIMITE_CLASES_PENDIENTES),
  )
  const snap = await getDocs(q)
  let pendientes = 0
  for (const documento of snap.docs) {
    if (clasePendiente(documento.data(), ahora)) pendientes += 1
  }
  return pendientes
}

/**
 * Fija el horario SEMANAL de una sede: un mapa con los 7 días (0 = lunes … 6 =
 * domingo) donde cada día es `{apertura, cierre}` en minutos o `null` (cerrado).
 * Rechaza el cambio si deja FUERA a alguna clase futura no cancelada —comparando
 * cada clase con el horario de SU día de la semana, en minutos—, con un mensaje
 * que dice cuántas son.
 */
export async function setSedeHorario(db, tenantId, sedeId, horario, opciones = {}) {
  const { uid = null, ahora = new Date() } = opciones
  const now = opciones.now ?? ahora
  await exigirSede(db, tenantId, sedeId)
  const semana = validarHorario(horario)
  const fuera = await contarClasesFueraDeHorario(db, tenantId, sedeId, semana, ahora)
  if (fuera > 0) {
    throw new SedeInvalidaError(
      `No se puede cambiar el horario: ${fuera} ${fuera === 1 ? 'clase futura quedaría' : 'clases futuras quedarían'} ` +
        'fuera del horario de su día. Reprograma o cancela esas clases primero.',
    )
  }
  await updateDoc(refSede(db, tenantId, sedeId), {
    horario: semana,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { sedeId, horario: semana }
}

/* --------------------------------------------------------------------- */
/* Cobros: perfiles, tarifas por sede y parámetros (Fase 3)                */
/* --------------------------------------------------------------------- */

/*
 * Fase 3: SOLO se guardan, configuran y sugieren precios. No se generan
 * cargos, pagos, liquidaciones, créditos ni emails (Fases 4-5). Todo monto se
 * guarda como ENTERO de centavos de USD (nunca floats).
 */

/**
 * Valida y normaliza el nombre de un PERFIL DE COBRO con las MISMAS utilidades
 * que el de una sede o cancha: no puede quedar vacío, tiene tope de largo y no
 * se repite dentro del tenant (sin distinguir caja, espacios, acentos). Los
 * perfiles inactivos también cuentan. Devuelve el nombre a guardar.
 */
export function validarNombrePerfil(nombre, perfiles = [], exceptoId = null) {
  const texto = normalizarNombreCancha(nombre)
  if (!texto) throw new CobroInvalidoError('El perfil de cobro necesita un nombre')
  if (texto.length > LIMITE_NOMBRE_PERFIL) {
    throw new CobroInvalidoError(
      `El nombre del perfil no puede superar ${LIMITE_NOMBRE_PERFIL} caracteres`,
    )
  }
  const clave = claveNombreCancha(texto)
  const repetido = perfiles.find(
    (perfil) => perfil.id !== exceptoId && claveNombreCancha(perfil.nombre) === clave,
  )
  if (repetido) {
    throw new CobroInvalidoError(`Ya hay un perfil de cobro llamado "${repetido.nombre}"`)
  }
  return texto
}

/** Valida la cantidad de personas de un perfil: 1..PERSONAS_MAX o `null`. */
function validarPersonas(personas) {
  if (!personasValidas(personas)) {
    throw new CobroInvalidoError(
      `Las personas del perfil deben ser un entero entre 1 y ${PERSONAS_MAX}, o "cualquiera"`,
    )
  }
}

/** Valida el modo de cobro contra el enum. */
function validarModo(modo) {
  if (!modoValido(modo)) {
    throw new CobroInvalidoError(`Modo de cobro inválido "${modo}". Permitidos: ${MODOS_COBRO.join(', ')}`)
  }
}

/**
 * Perfiles de cobro de una academia, activos e inactivos, ordenados por `orden`
 * y después nombre. Acotado por tenant + limit (50). Hace falta ver los
 * inactivos: la pantalla los reactiva y `setTarifasSede` valida contra todos.
 */
export async function listarPerfilesCobro(db, tenantId) {
  const q = query(collection(db, 'academias', tenantId, 'perfilesCobro'), limit(LIMITE_PERFILES_COBRO))
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        (Number(a.orden) || 0) - (Number(b.orden) || 0) ||
        String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es'),
    )
}

/**
 * Crea un perfil de cobro. El nombre se normaliza y debe ser único en el tenant
 * (cuentan los inactivos); `modo` sale del enum y `personas` es 1..4 o `null`.
 * `orden` es el siguiente entero salvo que se indique. `perfilId` es opcional:
 * lo usa el seed para clonar los defaults con ids fijos.
 */
export async function crearPerfilCobro(db, tenantId, datos = {}, opciones = {}) {
  const { uid = null, now = new Date(), perfilId = null } = opciones
  const existentes = await listarPerfilesCobro(db, tenantId)
  const nombre = validarNombrePerfil(datos.nombre, existentes, perfilId)
  const modo = datos.modo ?? 'total'
  validarModo(modo)
  const personas = datos.personas ?? null
  validarPersonas(personas)
  const activo = datos.activo ?? true
  if (typeof activo !== 'boolean') {
    throw new CobroInvalidoError('activo debe ser booleano')
  }
  const orden = Number.isInteger(datos.orden)
    ? datos.orden
    : existentes.reduce((max, perfil) => Math.max(max, Number(perfil.orden) || 0), 0) + 1

  const ref = perfilId
    ? refPerfilCobro(db, tenantId, perfilId)
    : doc(collection(db, 'academias', tenantId, 'perfilesCobro'))
  await setDoc(ref, {
    nombre,
    personas,
    modo,
    activo,
    orden,
    creadoPor: uid,
    creadoEn: Timestamp.fromDate(now),
  })
  return { perfilId: ref.id }
}

/**
 * Actualiza un perfil de cobro (renombrar, cambiar modo/personas/orden). Los
 * perfiles NUNCA se borran: se desactivan con `cambiarActivaPerfilCobro`.
 */
export async function actualizarPerfilCobro(db, tenantId, perfilId, cambios = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const snap = await getDoc(refPerfilCobro(db, tenantId, perfilId))
  if (!snap.exists()) throw new CobroInvalidoError(`El perfil de cobro "${perfilId}" no existe`)
  const existentes = await listarPerfilesCobro(db, tenantId)

  const update = {}
  if (cambios.nombre !== undefined) {
    update.nombre = validarNombrePerfil(cambios.nombre, existentes, perfilId)
  }
  if (cambios.modo !== undefined) {
    validarModo(cambios.modo)
    update.modo = cambios.modo
  }
  if (cambios.personas !== undefined) {
    validarPersonas(cambios.personas)
    update.personas = cambios.personas
  }
  if (cambios.orden !== undefined) {
    if (!Number.isInteger(cambios.orden)) {
      throw new CobroInvalidoError('El orden del perfil debe ser un entero')
    }
    update.orden = cambios.orden
  }
  update.actualizadoPor = uid
  update.actualizadoEn = Timestamp.fromDate(now)
  await updateDoc(refPerfilCobro(db, tenantId, perfilId), update)
  return { perfilId }
}

/** Activa o desactiva un perfil de cobro (soft delete: NUNCA se borra). */
export async function cambiarActivaPerfilCobro(db, tenantId, perfilId, activa, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const snap = await getDoc(refPerfilCobro(db, tenantId, perfilId))
  if (!snap.exists()) throw new CobroInvalidoError(`El perfil de cobro "${perfilId}" no existe`)
  const valor = Boolean(activa)
  await updateDoc(refPerfilCobro(db, tenantId, perfilId), {
    activo: valor,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { perfilId, activo: valor }
}

/**
 * Valida un mapa de tarifas por sede: claves = ids de perfiles CONOCIDOS (activos
 * o inactivos), valores = enteros de centavos entre 0 y LIMITE_TARIFA_CENTS.
 * Devuelve un mapa normalizado nuevo. Una clave ausente = "sin tarifa".
 */
export function validarTarifas(tarifas, perfiles = []) {
  if (!tarifas || typeof tarifas !== 'object' || Array.isArray(tarifas)) {
    throw new CobroInvalidoError('Las tarifas deben ser un mapa de perfil a precio por hora')
  }
  const conocidos = new Set(perfiles.map((perfil) => perfil.id))
  const normalizado = {}
  for (const clave of Object.keys(tarifas)) {
    if (!conocidos.has(clave)) {
      throw new CobroInvalidoError(`Perfil de cobro desconocido en las tarifas: "${clave}"`)
    }
    if (!centsValidos(tarifas[clave], LIMITE_TARIFA_CENTS)) {
      throw new CobroInvalidoError(
        `La tarifa de "${clave}" debe ser un entero de centavos entre 0 y ${LIMITE_TARIFA_CENTS}`,
      )
    }
    normalizado[clave] = tarifas[clave]
  }
  return normalizado
}

/**
 * Fija el mapa `tarifas` de una sede (perfil → centavos por hora). Reemplaza el
 * mapa completo: las claves ausentes quedan sin tarifa. No toca el resto de la
 * sede (renombrar, horario y activa siguen intactos).
 */
export async function setTarifasSede(db, tenantId, sedeId, tarifas, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  await exigirSede(db, tenantId, sedeId)
  const perfiles = await listarPerfilesCobro(db, tenantId)
  const normalizado = validarTarifas(tarifas, perfiles)
  await updateDoc(refSede(db, tenantId, sedeId), {
    tarifas: normalizado,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { sedeId, tarifas: normalizado }
}

/**
 * Lee los parámetros de la academia. Si el documento falta o algún campo está
 * corrupto, `leerParametros` rellena con los defaults (nunca lanza). 1 lectura.
 */
export async function getParametros(db, tenantId) {
  const snap = await getDoc(refParametros(db, tenantId))
  return leerParametros(snap.exists() ? snap.data() : null)
}

/**
 * Valida un documento completo de parámetros (obligatorio antes de escribir):
 * tipos, enums, rangos y duraciones. Rechaza campos desconocidos y devuelve el
 * mapa normalizado con TODOS los campos (los que no vengan usan su default).
 */
export function validarParametros(entrada) {
  const d = entrada ?? {}
  const conocidos = new Set([
    'avisoAusenciaHoras',
    'porcentajeFaltaSinAviso',
    'pagoProfesor',
    'descuentoHermanosPct',
    'duracionesPermitidas',
    'vencimientoCreditoDias',
    'alertaCobro',
    'restringirCategoriaPorFranja',
    'repartoAusenciaAvisada',
    'pagoProfesorSiTodosFaltanSinAviso',
    'faltaSinAvisoConCredito',
    'creditoRequierePago',
  ])
  for (const clave of Object.keys(d)) {
    if (!conocidos.has(clave)) {
      throw new CobroInvalidoError(`Campo de parámetros desconocido: "${clave}"`)
    }
  }

  const aviso = d.avisoAusenciaHoras ?? PARAMETROS_DEFAULT.avisoAusenciaHoras
  if (!enteroEnRango(aviso, 0, AUSENCIA_HORAS_MAX)) {
    throw new CobroInvalidoError(`avisoAusenciaHoras debe ser un entero entre 0 y ${AUSENCIA_HORAS_MAX}`)
  }
  const porcentaje = d.porcentajeFaltaSinAviso ?? PARAMETROS_DEFAULT.porcentajeFaltaSinAviso
  if (!enteroEnRango(porcentaje, 0, PORCENTAJE_MAX)) {
    throw new CobroInvalidoError(`porcentajeFaltaSinAviso debe ser un entero entre 0 y ${PORCENTAJE_MAX}`)
  }
  const pago = d.pagoProfesor ?? PARAMETROS_DEFAULT.pagoProfesor
  if (!pagoProfesorValido(pago)) {
    throw new CobroInvalidoError(
      `pagoProfesor debe ser { modo: "por_hora" | "por_clase", montoCents } con montoCents entero entre 0 y ${LIMITE_MONTO_CENTS}`,
    )
  }
  const descuento = d.descuentoHermanosPct ?? PARAMETROS_DEFAULT.descuentoHermanosPct
  if (!enteroEnRango(descuento, 0, PORCENTAJE_MAX)) {
    throw new CobroInvalidoError(`descuentoHermanosPct debe ser un entero entre 0 y ${PORCENTAJE_MAX}`)
  }
  const duraciones = d.duracionesPermitidas ?? [...PARAMETROS_DEFAULT.duracionesPermitidas]
  if (!duracionesValidas(duraciones)) {
    throw new CobroInvalidoError(
      'duracionesPermitidas debe ser una lista no vacía, sin repetidos, ascendente, con múltiplos de ' +
        `${MINUTOS_BLOQUE} min entre 60 y 240 (p. ej. [60, 90, 120])`,
    )
  }
  const vencimiento = d.vencimientoCreditoDias ?? PARAMETROS_DEFAULT.vencimientoCreditoDias
  if (!vencimientoValido(vencimiento)) {
    throw new CobroInvalidoError(
      `vencimientoCreditoDias debe ser null (no vence) o un entero entre 1 y ${VENCIMIENTO_DIAS_MAX}`,
    )
  }
  const alerta = d.alertaCobro ?? PARAMETROS_DEFAULT.alertaCobro
  if (!alertaCobroValida(alerta)) {
    throw new CobroInvalidoError(
      `alertaCobro debe ser { dias: entero entre 0 y ${ALERTA_DIAS_MAX}, referencia: "clase" | "vencimiento" }`,
    )
  }
  const restringir = d.restringirCategoriaPorFranja ?? PARAMETROS_DEFAULT.restringirCategoriaPorFranja
  if (typeof restringir !== 'boolean') {
    throw new CobroInvalidoError('restringirCategoriaPorFranja debe ser booleano')
  }
  const reparto = d.repartoAusenciaAvisada ?? PARAMETROS_DEFAULT.repartoAusenciaAvisada
  if (!repartoAusenciaValido(reparto)) {
    throw new CobroInvalidoError(
      `repartoAusenciaAvisada debe ser ${REPARTOS_AUSENCIA.join(' | ')}`,
    )
  }
  const pagoSinAviso =
    d.pagoProfesorSiTodosFaltanSinAviso ?? PARAMETROS_DEFAULT.pagoProfesorSiTodosFaltanSinAviso
  if (!pagoSinAvisoValido(pagoSinAviso)) {
    throw new CobroInvalidoError(
      `pagoProfesorSiTodosFaltanSinAviso debe ser ${PAGOS_SIN_AVISO.join(' | ')}`,
    )
  }
  const faltaCredito =
    d.faltaSinAvisoConCredito ?? PARAMETROS_DEFAULT.faltaSinAvisoConCredito
  if (!faltaConCreditoValida(faltaCredito)) {
    throw new CobroInvalidoError(
      `faltaSinAvisoConCredito debe ser descuenta_proporcional | descuenta_completo | cobra_aparte`,
    )
  }
  const creditoRequierePago = d.creditoRequierePago ?? PARAMETROS_DEFAULT.creditoRequierePago
  if (typeof creditoRequierePago !== 'boolean') {
    throw new CobroInvalidoError('creditoRequierePago debe ser booleano')
  }

  return {
    avisoAusenciaHoras: aviso,
    porcentajeFaltaSinAviso: porcentaje,
    pagoProfesor: { modo: pago.modo, montoCents: pago.montoCents },
    descuentoHermanosPct: descuento,
    duracionesPermitidas: [...duraciones],
    vencimientoCreditoDias: vencimiento,
    alertaCobro: { dias: alerta.dias, referencia: alerta.referencia },
    restringirCategoriaPorFranja: restringir,
    repartoAusenciaAvisada: reparto,
    pagoProfesorSiTodosFaltanSinAviso: pagoSinAviso,
    faltaSinAvisoConCredito: faltaCredito,
    creditoRequierePago,
  }
}

/**
 * Escribe los parámetros de la academia. Acepta cambios parciales: se mezclan
 * sobre los valores actuales (o los defaults) y se validan completos antes de
 * escribir `academias/{tenant}/config/parametros`.
 */
export async function setParametros(db, tenantId, cambios = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const snapparam = await getDoc(refParametros(db, tenantId))
  const actuales = leerParametros(snapparam.exists() ? snapparam.data() : null)
  const normalizado = validarParametros({ ...actuales, ...cambios })
  await setDoc(refParametros(db, tenantId), {
    ...normalizado,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return normalizado
}

/**
 * Valida y normaliza las tasas BCV de una academia: `bsPorUsd` y `bsPorEur`
 * finitos, mayores a 0 y dentro del tope; `fuente` ∈ `api` | `manual`; `fecha`
 * "YYYY-MM-DD" o null. Lanza `TasaInvalidaError`.
 */
export function validarTasas(entrada) {
  const d = entrada ?? {}
  for (const clave of ['bsPorUsd', 'bsPorEur']) {
    const valor = d[clave]
    if (
      typeof valor !== 'number' ||
      !Number.isFinite(valor) ||
      valor <= 0 ||
      valor > LIMITE_BS_POR_UNIDAD
    ) {
      throw new TasaInvalidaError(
        `${clave} debe ser un número mayor a 0 y hasta ${LIMITE_BS_POR_UNIDAD}`,
      )
    }
  }
  const fuente = d.fuente
  if (!FUENTES_TASA.includes(fuente)) {
    throw new TasaInvalidaError(`fuente debe ser ${FUENTES_TASA.join(' | ')}`)
  }
  const fecha = d.fecha ?? null
  if (fecha !== null && (typeof fecha !== 'string' || !RE_FECHA.test(fecha))) {
    throw new TasaInvalidaError('fecha debe ser "YYYY-MM-DD" o null')
  }
  return { bsPorUsd: d.bsPorUsd, bsPorEur: d.bsPorEur, fecha, fuente }
}

/**
 * Normaliza el documento `config/tasas` a la forma que usa la UI. Devuelve null
 * si el documento no existe o viene corrupto. `actualizadoEn` queda en ms.
 */
export function leerTasasDoc(datos) {
  if (!datos) return null
  try {
    const { bsPorUsd, bsPorEur, fecha, fuente } = validarTasas(datos)
    const sello = datos.actualizadoEn
    const ms =
      sello == null
        ? null
        : typeof sello?.toMillis === 'function'
          ? sello.toMillis()
          : Date.parse(sello)
    return {
      bsPorUsd,
      bsPorEur,
      fecha,
      fuente,
      actualizadoEn: Number.isFinite(ms) ? ms : null,
    }
  } catch {
    return null
  }
}

/**
 * Última tasa conocida de la academia (1 lectura). Devuelve `null` si no hay
 * documento o si está corrupto.
 */
export async function getTasas(db, tenantId) {
  const snap = await getDoc(refTasas(db, tenantId))
  return snap.exists() ? leerTasasDoc(snap.data()) : null
}

/**
 * Escribe la tasa BCV de la academia (`config/tasas`): la usa tanto el guardado
 * automático desde la API (`fuente: 'api'`) como el override manual del admin
 * (`fuente: 'manual'`). Solo el admin puede escribir (firestore.rules).
 */
export async function setTasas(db, tenantId, datos = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const normalizado = validarTasas(datos)
  await setDoc(refTasas(db, tenantId), {
    ...normalizado,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return normalizado
}

/**
 * Valida y normaliza el SNAPSHOT de cobro de una clase (opcional). Debe traer
 * exactamente las claves del modelo; `montoCents` es obligatorio y entero >= 0.
 * Los montos son centavos de USD. Devuelve `null` si no hay cobro.
 */
export function validarCobro(cobro) {
  if (cobro === undefined || cobro === null) return null
  if (typeof cobro !== 'object' || Array.isArray(cobro)) {
    throw new CobroInvalidoError('El cobro de la clase debe ser un objeto')
  }
  const claves = [
    'perfilCobroId',
    'modo',
    'tarifaHoraCents',
    'montoEstandarCents',
    'montoCents',
    'ajustado',
    'motivoAjuste',
  ]
  const extra = Object.keys(cobro).filter((clave) => !claves.includes(clave))
  if (extra.length) {
    throw new CobroInvalidoError(`El cobro tiene campos de más: ${extra.join(', ')}`)
  }
  const perfilCobroId = cobro.perfilCobroId ?? null
  if (perfilCobroId !== null && typeof perfilCobroId !== 'string') {
    throw new CobroInvalidoError('perfilCobroId debe ser texto o null')
  }
  const modo = cobro.modo ?? null
  if (modo !== null && !modoValido(modo)) {
    throw new CobroInvalidoError(`Modo de cobro inválido "${modo}". Permitidos: ${MODOS_COBRO.join(', ')}`)
  }
  const tarifaHoraCents = cobro.tarifaHoraCents ?? null
  if (tarifaHoraCents !== null && !centsValidos(tarifaHoraCents, LIMITE_TARIFA_CENTS)) {
    throw new CobroInvalidoError(
      `La tarifa por hora debe ser un entero de centavos entre 0 y ${LIMITE_TARIFA_CENTS}`,
    )
  }
  const montoEstandarCents = cobro.montoEstandarCents ?? null
  if (montoEstandarCents !== null && !centsValidos(montoEstandarCents, LIMITE_MONTO_CENTS)) {
    throw new CobroInvalidoError(
      `El monto estándar debe ser un entero de centavos entre 0 y ${LIMITE_MONTO_CENTS}`,
    )
  }
  if (!centsValidos(cobro.montoCents, LIMITE_MONTO_CENTS)) {
    throw new CobroInvalidoError(
      `El monto de la clase debe ser un entero de centavos entre 0 y ${LIMITE_MONTO_CENTS}`,
    )
  }
  const motivoAjuste = cobro.motivoAjuste ?? null
  if (!motivoValido(motivoAjuste)) {
    throw new CobroInvalidoError(
      `Motivo de ajuste inválido "${motivoAjuste}". Permitidos: descuento, cortesia, acuerdo, otro (o null)`,
    )
  }
  return {
    perfilCobroId,
    modo,
    tarifaHoraCents,
    montoEstandarCents,
    montoCents: cobro.montoCents,
    ajustado: Boolean(cobro.ajustado),
    motivoAjuste,
  }
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
/* Acceso de profesores (Fase 7)                                           */
/* --------------------------------------------------------------------- */

/*
 * Un PROFESOR es una ficha (`profesores/{profesorId}`) y, además, puede tener
 * ACCESO a la app. Ese acceso vive en `usuarios/{uid}` (roles de login), NO en
 * `miembros`, que sigue siendo la fuente del administrador. El admin crea la
 * cuenta de Auth con `crearCuenta` (instancia secundaria, ver authProfesor.js),
 * la contraseña temporal nunca se guarda, y acá solo se escribe el vínculo
 * `usuario → profesor`. Las reglas validan que `profesorId` exista.
 */

/** Tope de usuarios de profesor que se listan de una vez. */
export const LIMITE_USUARIOS_PROFESOR = 200

/** Tope de clases que se listan para un profesor. */
export const LIMITE_CLASES_PROFESOR = 100

/** Lee el documento de acceso de un uid (profesor). 1 lectura. */
export async function getUsuarioProfesor(db, tenantId, uid) {
  const snap = await getDoc(refUsuario(db, tenantId, uid))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/**
 * Accesos de PROFESOR del usuario a través de las academias: es el
 * descubrimiento del arranque de sesión cuando no hay `miembros` (los profesores
 * no tienen membresía). Acotado por `uid` + `activo` + limit. Las reglas solo
 * dejan leer los documentos propios y activos.
 */
export async function getMisAccesosProfesor(db, uid, opciones = {}) {
  const { limite = 20 } = opciones
  const pedido = Number.isFinite(limite) ? Math.floor(limite) : 20
  const q = query(
    collectionGroup(db, 'usuarios'),
    where('uid', '==', uid),
    where('activo', '==', true),
    limit(Math.min(Math.max(pedido, 1), 50)),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, tenantId: d.ref.parent.parent.id, ...d.data() }))
}

/** Lista los accesos de profesor del tenant. Acotado por tenant + limit. */
export async function listarUsuariosProfesor(db, tenantId, opciones = {}) {
  const { limite = LIMITE_USUARIOS_PROFESOR } = opciones
  const pedido = Number.isFinite(limite) ? Math.floor(limite) : LIMITE_USUARIOS_PROFESOR
  const tope = Math.min(Math.max(pedido, 1), LIMITE_USUARIOS_PROFESOR)
  const q = query(coleccionUsuarios(db, tenantId), limit(tope))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Crea el acceso de un profesor: primero la cuenta de Auth (con la función
 * `crearCuenta` inyectada, que resuelve `{ uid }`) y después el documento
 * `usuarios/{uid}`. Devuelve el uid. La contraseña NO se escribe en Firestore ni
 * se loguea; sin `crearCuenta` se falla para no dejar cuentas a medias.
 */
export async function crearAccesoProfesor(db, tenantId, datos = {}, opciones = {}) {
  const { now = new Date(), crearCuenta } = opciones
  const email = String(datos.email ?? '').trim().toLowerCase()
  const password = datos.password
  const profesorId = String(datos.profesorId ?? '').trim()
  if (!email) throw new FichaInvalidaError('El acceso necesita un email')
  if (!profesorId) throw new FichaInvalidaError('El acceso necesita un profesor')
  if (typeof crearCuenta !== 'function') {
    throw new FichaInvalidaError('Falta el creador de cuentas de profesor')
  }
  const { uid: uidProfesor } = await crearCuenta({ email, password })
  if (!uidProfesor) throw new FichaInvalidaError('La cuenta de profesor no devolvió un uid')
  await setDoc(refUsuario(db, tenantId, uidProfesor), {
    uid: uidProfesor,
    rol: 'profesor',
    profesorId,
    email,
    activo: true,
    creadoEn: Timestamp.fromDate(now),
  })
  return { uid: uidProfesor }
}

/** Activa o desactiva el acceso de un profesor (soft delete). */
export async function cambiarActivoProfesor(db, tenantId, uid, activo, opciones = {}) {
  const { actualizadoPor = null, now = new Date() } = opciones
  await updateDoc(refUsuario(db, tenantId, uid), {
    activo: Boolean(activo),
    actualizadoPor,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { uid, activo: Boolean(activo) }
}

/**
 * Clases de un profesor desde `desde` (por defecto HOY local) hacia adelante,
 * ordenadas por fecha y hora. Acotado por tenant + profesor + rango + limit.
 * Usa el índice `clases: profesorId + fecha` de firestore.indexes.json.
 */
export async function getClasesDeProfesor(db, tenantId, profesorId, opciones = {}) {
  const {
    desde = fechaHoyLocal(),
    hasta = null,
    limite = LIMITE_CLASES_PROFESOR,
  } = opciones
  if (!profesorId) throw new ClaseInvalidaError('Falta el profesor')
  const pedido = Number.isFinite(limite) ? Math.floor(limite) : LIMITE_CLASES_PROFESOR
  const tope = Math.min(Math.max(pedido, 1), LIMITE_CLASES_PROFESOR)
  const filtros = [where('profesorId', '==', profesorId), where('fecha', '>=', desde)]
  if (hasta) filtros.push(where('fecha', '<=', hasta))
  const q = query(
    collection(db, 'academias', tenantId, 'clases'),
    ...filtros,
    orderBy('fecha'),
    limit(tope),
  )
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort(
      (a, b) =>
        String(a.fecha ?? '').localeCompare(String(b.fecha ?? '')) ||
        String(a.horaInicio ?? '').localeCompare(String(b.horaInicio ?? '')),
    )
}

/**
 * Guarda la asistencia que carga un profesor en una clase ABIERTA (`reservada`).
 * Escribe SOLO `asistenciaProfesor` (las reglas lo exigen: `affectedKeys` acotado
 * a ese campo). Valida contra los alumnos reales de la clase con el helper puro
 * y reenvuelve su error como error de negocio.
 */
export async function guardarAsistenciaProfesor(db, tenantId, claseId, porAlumno, opciones = {}) {
  const { uid = null, profesorId = null, now = new Date() } = opciones
  if (!uid) throw new ClaseInvalidaError('Falta el usuario que registra la asistencia')
  const claseRef = refClase(db, tenantId, claseId)
  const snap = await getDoc(claseRef)
  if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
  const d = snap.data()
  if (profesorId && d.profesorId !== profesorId) {
    throw new ClaseInvalidaError('La clase no pertenece a este profesor')
  }
  if (d.estado !== 'reservada') {
    throw new ClaseInvalidaError(
      `Solo se registra la asistencia de una clase abierta (estado "${d.estado}")`,
    )
  }
  let normalizado
  try {
    normalizado = normalizarPorAlumnoProfesor(porAlumno, d.alumnos ?? [])
  } catch (error) {
    throw new ClaseInvalidaError(error.message)
  }
  await updateDoc(claseRef, {
    asistenciaProfesor: {
      porAlumno: normalizado,
      registradoPor: uid,
      registradoEn: Timestamp.fromDate(now),
    },
  })
  return { claseId }
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
 * Crea una clase y ocupa todos sus bloques de MINUTOS_BLOQUE (30) minutos
 * (cancha + profesor) en UNA transacción. Si algún bloque ya existe, aborta con
 * `SolapamientoError` y no escribe nada.
 *
 * El solapamiento sale de los bloques, que son de minutos REALES: una clase de
 * 7:30 a 9:00 (3 bloques) choca con una de 8:00 a 9:00 (2 bloques) y NO choca
 * con una de 9:00 a 10:00 (el borde exacto se toca, no se solapa).
 *
 * `datos` acepta los campos de `clases/{claseId}` (ver docs/modelo-datos.md §4),
 * incluida `categoriaGrupo` (`infantil` | `junior` | `adulto` | `null`), que es
 * DISTINTA del nivel `categoria`.
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
  validarCategoriaGrupo(datos.categoriaGrupo)
  validarCupo(datos.cupo)
  // El cobro es un SNAPSHOT opcional: se valida ya (tipos/enums/montos) y se
  // guarda tal cual. Cambios de tarifa posteriores NO lo modifican.
  const cobro = validarCobro(datos.cobro)
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
  // Parámetros: fuente de verdad de las duraciones permitidas. Se lee en la
  // misma transacción (1 lectura extra). Si falta el documento, defaults.
  const parametrosRef = refParametros(db, tenantId)
  let bloques = []

  await runTransaction(db, async (tx) => {
    // Todas las lecturas ANTES de cualquier escritura (requisito de las
    // transacciones de Firestore).

    // Leer sede, cancha y profesor para validar existencia y actividad,
    // y tomar los nombres denormalizados de los documentos.
    const [snapSede, snapCancha, snapProfesor, snapParametros] = await Promise.all([
      tx.get(sedeRef),
      tx.get(canchaRef),
      tx.get(profRef),
      tx.get(parametrosRef),
    ])
    const parametros = leerParametros(snapParametros.exists() ? snapParametros.data() : null)
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

    // Franja + bloques con el horario REAL de la sede PARA EL DÍA de la clase
    // (fallback 07:00-23:00 si la sede no tiene el campo; `null` si ese día está
    // cerrado) y, recién después, el "no reservar en el pasado" (reloj inyectado).
    bloques = bloquesDeClase(
      datos,
      horarioDelDia(datos.fecha, horarioDeSede(snapSede.data())),
      parametros.duracionesPermitidas,
    )
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
      categoriaGrupo: datos.categoriaGrupo ?? null,
      asistencias: [],
      alumnos,
      alumnoNombres,
      cupo,
      sedeId: datos.sedeId,
      // Nombres tomados de los documentos, no del cliente.
      sedeNombre: snapSede.data().nombre ?? null,
      canchaId: datos.canchaId,
      canchaNombre: nombreDeCancha({ id: datos.canchaId, ...snapCancha.data() }, datos.canchaId),
      profesorId: datos.profesorId,
      profesorNombre: nombreCompleto(snapProfesor.data()),
      fecha: datos.fecha,
      horaInicio: datos.horaInicio,
      horaFin: datos.horaFin,
      // Snapshot de cobro (opcional; null en clases sin precio).
      cobro,
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
 * canchaId, sedeId, profesorId, categoriaGrupo, …). Los que no vengan se
 * conservan.
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
  validarCategoriaGrupo(nuevoCambio.categoriaGrupo)
  if (nuevoCambio.cupo !== undefined) validarCupo(nuevoCambio.cupo)
  // La lista de alumnos no puede quedar vacía: una clase reprogramada sigue
  // necesitando al menos un alumno.
  if (nuevoCambio.alumnos !== undefined) {
    const ids = Array.isArray(nuevoCambio.alumnos) ? nuevoCambio.alumnos : []
    if (ids.length < 1) {
      throw new ClaseInvalidaError('La clase necesita al menos un alumno asignado')
    }
  }
  // Cobro: si viene en el cambio, se valida y se guarda como snapshot nuevo. Si
  // no viene, el cobro existente queda intacto (una reprogramación que no toca
  // el precio no lo pisa).
  const cobro = nuevoCambio.cobro !== undefined ? validarCobro(nuevoCambio.cobro) : undefined
  const parametrosRef = refParametros(db, tenantId)

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
    const [snapSede, snapCancha, snapProfesor, snapParametros] = await Promise.all([
      tx.get(refSede(db, tenantId, futura.sedeId)),
      tx.get(refCancha(db, tenantId, futura.sedeId, futura.canchaId)),
      tx.get(refProfesor(db, tenantId, futura.profesorId)),
      tx.get(parametrosRef),
    ])
    const parametros = leerParametros(snapParametros.exists() ? snapParametros.data() : null)
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

    // Franja + bloques con el horario REAL de la sede destino PARA EL DÍA de la
    // clase (`null` si ese día está cerrado) y, recién después, el "no se
    // reprograma al pasado" (reloj inyectado).
    const bloquesNuevos = bloquesDeClase(
      futura,
      horarioDelDia(futura.fecha, horarioDeSede(snapSede.data())),
      parametros.duracionesPermitidas,
    )
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
      'categoriaGrupo',
    ]) {
      if (nuevoCambio[clave] !== undefined) cambios[clave] = nuevoCambio[clave]
    }
    if (cobro !== undefined) cambios.cobro = cobro
    // Los nombres SIEMPRE salen del documento, no del cliente.
    cambios.sedeNombre = snapSede.data().nombre ?? null
    cambios.canchaNombre = nombreDeCancha(
      { id: futura.canchaId, ...snapCancha.data() },
      futura.canchaId,
    )
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

/** Página por defecto / tope duro de los listados de cobros (Phase 4). */
export const LIMITE_COBROS_PAGINA = 50
export const LIMITE_COBROS_MAX = 100

/** Normaliza y valida la asistencia que llega a `cerrarClase` / `registrarAsistencia`. */
function normalizarAsistencias(asistencias, uid, ahora) {
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
  return normalizadas
}

/** Minutos entre horaInicio y horaFin de una clase; 0 si no se pueden leer. */
function duracionDeClase(d) {
  try {
    const inicio = aMinutos(d.horaInicio)
    const fin = aMinutos(d.horaFin)
    return fin > inicio ? fin - inicio : 0
  } catch {
    return 0
  }
}

/**
 * Lotes de crédito de un alumno, leídos FUERA de una transacción (el SDK web
 * no admite queries dentro). Acotado por tenant + alumno + limit (50). Es la
 * pre-lectura que `cerrarClase` revalida con `tx.get`.
 */
async function leerLotesDeAlumno(db, tenantId, alumnoId) {
  const q = query(
    coleccionCreditos(db, tenantId),
    where('alumnoId', '==', alumnoId),
    limit(LIMITE_CREDITOS_ALUMNO),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** Tope de lotes que se listan de un alumno. */
export const LIMITE_CREDITOS_ALUMNO = 50

/**
 * ¿El cierre de una clase está saldado? Todos sus cargos (los que existen) y su
 * pago están `pagado` o `anulado`. `cargoPagadoId`/`pagoPagado` permiten tratar
 * como pagado el documento que se acaba de marcar en la misma transacción
 * (que todavía se leyó como `pendiente`).
 */
function cierreSaldado({ cargos = [], pago = null, cargoPagadoId = null, pagoPagado = false } = {}) {
  const cargosOk = cargos.every(
    (cargo) =>
      !cargo ||
      cargo.estado === 'pagado' ||
      cargo.estado === 'anulado' ||
      cargo.id === cargoPagadoId,
  )
  const pagoOk = pagoPagado || !pago || pago.estado === 'pagado' || pago.estado === 'anulado'
  return cargosOk && pagoOk
}

/**
 * Lee el estado del cierre de una clase dentro de una transacción, SIN queries:
 * el documento de la clase, sus cargos deterministas (`${claseId}_${alumnoId}`)
 * y su pago (`pagoProfesor/{claseId}`). Devuelve `null` si la clase no existe.
 * Todos los `tx.get` van antes de cualquier escritura.
 */
async function leerEstadoCierreTx(tx, db, tenantId, claseId) {
  const claseSnap = await tx.get(refClase(db, tenantId, claseId))
  if (!claseSnap.exists()) return null
  const alumnos = claseSnap.data().alumnos ?? []
  const [cargosSnaps, pagoSnap] = await Promise.all([
    Promise.all(alumnos.map((alumnoId) => tx.get(refCargo(db, tenantId, `${claseId}_${alumnoId}`)))),
    tx.get(refPagoProfesor(db, tenantId, claseId)),
  ])
  return {
    clase: claseSnap.data(),
    cargos: cargosSnaps.map((s) => (s.exists() ? { id: s.id, ...s.data() } : null)),
    pago: pagoSnap.exists() ? { id: pagoSnap.id, ...pagoSnap.data() } : null,
  }
}

/**
 * Sincroniza el estado de una clase cerrada a `cobrada` cuando ya no queda nada
 * por cobrar (todos los cargos y el pago en `pagado`/`anulado`). Se llama dentro
 * de la transacción de marcar pagado, con TODAS las lecturas ya hechas.
 */
function sincronizarClaseCobrada(
  tx,
  db,
  tenantId,
  claseId,
  estado,
  { cargoPagadoId = null, pagoPagado = false } = {},
) {
  if (!estado || !estado.clase || estado.clase.estado !== 'pendiente_cobro') return false
  if (!cierreSaldado({ cargos: estado.cargos, pago: estado.pago, cargoPagadoId, pagoPagado })) {
    return false
  }
  tx.update(refClase(db, tenantId, claseId), { estado: 'cobrada' })
  return true
}

/**
 * Cierra una clase: registra la asistencia y, en la MISMA transacción, genera
 * los cargos de los alumnos y el pago del profesor (Phase 4), consumiendo el
 * crédito prepago de los alumnos cuando corresponde (Phase 5).
 *
 * `datos`: `{ asistencias, seFactura = true, montoCents = null, motivoAjuste = null }`.
 * - `asistencias`: exactamente una por alumno asignado, con los estados del enum.
 * - `seFactura: false` (fuerza mayor: lluvia, luz): no genera cargos ni pago;
 *   la clase queda cerrada con `facturada: false`.
 * - `montoCents`: monto MANUAL de la clase. Es obligatorio cuando la clase no
 *   tiene `cobro` y se factura; con `motivoAjuste` (`otro` por defecto).
 *
 * Crédito (Phase 5), ANTES de crear el cargo de cada alumno (ver
 * `previsualizarCreditoAlumno`, la misma regla pura que usa la UI):
 * - `presente` con crédito suficiente → descuenta los minutos de la clase (FIFO
 *   entre lotes), escribe el movimiento y NO crea cargo.
 * - `presente` sin crédito suficiente → cargo normal y advertencia
 *   `credito_insuficiente` (sin consumo parcial).
 * - `ausente_sin_aviso` → según `faltaSinAvisoConCredito`: descuenta los minutos
 *   (proporcional o completo) si alcanza; si no, cae al cargo normal;
 *   `cobra_aparte` = siempre cargo normal.
 * - `ausente_avisada` o `seFactura: false` → sin descuento.
 *
 * Guardas (las mismas de la asistencia): solo una clase `reservada`, no antes
 * de `horaFin`, sin alumnos ajenos, sin doble cierre. Los IDs son deterministas
 * (`${claseId}_${alumnoId}` para cargos y movimientos, `${claseId}` para el
 * pago), así que un reintento nunca duplica.
 *
 * El estado final es `pendiente_cobro` (o `cobrada` si no quedó nada por
 * cobrar). `anularCierre` la devuelve a `reservada`.
 *
 * Las lecturas de lotes se hacen FUERA de la transacción (el SDK web no admite
 * queries dentro) y se revalidan con `tx.get` dentro: si los minutos cambiaron,
 * se cae limpiamente al cargo normal.
 */
export async function cerrarClase(db, tenantId, claseId, datos = {}, opciones = {}) {
  const { uid = null, ahora = new Date() } = opciones
  const asistencias = normalizarAsistencias(datos.asistencias, uid, ahora)
  const seFactura = datos.seFactura !== false
  const montoManual = datos.montoCents ?? null
  const motivoAjuste = datos.motivoAjuste ?? null
  // Origen de la asistencia: si un profesor la había cargado antes del cierre,
  // queda registrado quién la confirmó. Es solo un sello informativo: NO cambia
  // el cálculo de cargos ni del pago al profesor.
  const confirmadoPorProfesorId = datos.confirmadoPorProfesorId ?? null
  if (montoManual !== null && !centsValidos(montoManual, LIMITE_MONTO_CENTS)) {
    throw new CobroInvalidoError(
      `El monto de la clase debe ser un entero de centavos entre 0 y ${LIMITE_MONTO_CENTS}`,
    )
  }
  if (!motivoValido(motivoAjuste)) {
    throw new CobroInvalidoError(
      `Motivo de ajuste inválido "${motivoAjuste}". Permitidos: descuento, cortesia, acuerdo, otro (o null)`,
    )
  }

  const claseRef = refClase(db, tenantId, claseId)
  const parametrosRef = refParametros(db, tenantId)
  let resultado = null

  // Pre-lectura (fuera de la transacción): los alumnos asignados y sus lotes
  // son CANDIDATOS. Dentro de la transacción se revalidan con tx.get.
  const clasePrevia = await getDoc(claseRef)
  const alumnosPrevios = clasePrevia.exists() ? (clasePrevia.data().alumnos ?? []) : []
  const lotesPorAlumno = {}
  for (const alumnoId of alumnosPrevios) {
    lotesPorAlumno[alumnoId] = await leerLotesDeAlumno(db, tenantId, alumnoId)
  }

  await runTransaction(db, async (tx) => {
    const [snap, snapParametros] = await Promise.all([
      tx.get(claseRef),
      tx.get(parametrosRef),
    ])
    if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
    const d = snap.data()

    if (d.estado !== 'reservada') {
      throw new ClaseInvalidaError(
        d.estado === 'cancelada'
          ? `La clase ${claseId} está cancelada y no se puede cerrar`
          : `La clase ${claseId} ya está cerrada (estado "${d.estado}")`,
      )
    }

    // No se puede cerrar una clase que todavía no terminó (hora LOCAL).
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

    // Exactamente una entrada por alumno asignado (ni de menos ni de más).
    const asignados = new Set(d.alumnos ?? [])
    const registrados = new Set(asistencias.map((r) => r.alumnoId))
    if (asignados.size !== registrados.size || [...asignados].some((id) => !registrados.has(id))) {
      throw new ClaseInvalidaError(
        'La asistencia debe tener exactamente una entrada por cada alumno asignado',
      )
    }

    // Snapshot final del cobro: el manual (siempre ajustado) o el guardado.
    let cobro = d.cobro ?? null
    if (montoManual !== null) {
      cobro = cobro
        ? { ...cobro, montoCents: montoManual, ajustado: true, motivoAjuste: motivoAjuste ?? cobro.motivoAjuste ?? 'otro' }
        : {
            perfilCobroId: null,
            modo: 'total',
            tarifaHoraCents: null,
            montoEstandarCents: null,
            montoCents: montoManual,
            ajustado: true,
            motivoAjuste: motivoAjuste ?? 'otro',
          }
      cobro = validarCobro(cobro)
    }
    if (seFactura && !cobro) {
      throw new CobroInvalidoError(
        'La clase no tiene precio: carga un monto para poder cerrarla con cobro',
      )
    }

    const parametros = leerParametros(snapParametros.exists() ? snapParametros.data() : null)
    const duracionMin = duracionDeClase(d)
    const cierre = calcularCierre({
      cobro,
      duracionMin,
      asistencias,
      parametros,
      seFactura,
    })

    // --- Créditos: lecturas (antes de cualquier escritura) -------------
    // Reunir todos los lotes candidatos del grupo y leerlos con tx.get, más el
    // estado de sus cargos (para `creditoRequierePago`). Se revalida el saldo
    // real dentro de la transacción.
    const lotesTodos = []
    const idsUnicos = new Set()
    for (const alumnoId of d.alumnos ?? []) {
      for (const lote of lotesPorAlumno[alumnoId] ?? []) {
        if (idsUnicos.has(lote.id)) continue
        idsUnicos.add(lote.id)
        lotesTodos.push(lote)
      }
    }
    const snapsLotes = {}
    const idsLotes = [...idsUnicos]
    const lecturasLotes = idsLotes.map((id) => tx.get(refCredito(db, tenantId, id)))
    const idsCargosCredito = new Set(
      lotesTodos.map((lote) => lote.cargoId).filter(Boolean),
    )
    const lecturasCargos = [...idsCargosCredito].map((id) => tx.get(refCargo(db, tenantId, id)))
    const [snapsLotesArr, snapsCargosArr] = await Promise.all([
      Promise.all(lecturasLotes),
      Promise.all(lecturasCargos),
    ])
    idsLotes.forEach((id, i) => {
      if (snapsLotesArr[i].exists()) snapsLotes[id] = { id, ...snapsLotesArr[i].data() }
    })
    const cargoEstado = {}
    ;[...idsCargosCredito].forEach((id, i) => {
      if (snapsCargosArr[i].exists()) cargoEstado[id] = snapsCargosArr[i].data().estado
    })

    const esCortesia = cobro != null && cobro.montoCents === 0 && cobro.motivoAjuste === 'cortesia'
    const facturable = cierre.resumen.facturable

    // Decisión por alumno + consumo FIFO.
    const nombrePorId = {}
    ;(d.alumnos ?? []).forEach((id, i) => {
      nombrePorId[id] = (d.alumnoNombres ?? [])[i] ?? id
    })

    const cubiertos = new Set()
    const movimientos = []
    const actualizacionesLotes = {}
    const advertencias = []
    if (facturable && !esCortesia) {
      for (const registro of asistencias) {
        const alumnoId = registro.alumnoId
        const lotesAlumno = (lotesPorAlumno[alumnoId] ?? [])
          .map((lote) => {
            const vigente = snapsLotes[lote.id]
            if (!vigente) return null
            const pagado = !parametros.creditoRequierePago
              ? true
              : vigente.cargoId
                ? cargoEstado[vigente.cargoId] === 'pagado'
                : false
            return { ...vigente, cargoPagado: pagado }
          })
          .filter(Boolean)
        const usables = lotesUsables(lotesAlumno, d.fecha, {
          creditoRequierePago: parametros.creditoRequierePago,
        })
        const disponibles = usables.reduce((total, lote) => total + minutosDisponibles(lote), 0)
        const preview = previsualizarCreditoAlumno({
          estado: registro.estado,
          minutosClase: duracionMin,
          minutosDisponibles: disponibles,
          porcentajeFaltaSinAviso: parametros.porcentajeFaltaSinAviso,
          faltaSinAvisoConCredito: parametros.faltaSinAvisoConCredito,
        })
        if (!preview.usaCredito) {
          if (preview.insuficiente) {
            advertencias.push({ alumnoId, motivo: 'credito_insuficiente' })
          }
          continue
        }
        const { asignaciones, faltante } = consumirCreditos(usables, preview.minutos)
        if (faltante > 0) {
          // Cambió el saldo entre la pre-lectura y la transacción: se cobra normal.
          advertencias.push({ alumnoId, motivo: 'credito_insuficiente' })
          continue
        }
        cubiertos.add(alumnoId)
        movimientos.push({
          id: `${claseId}_${alumnoId}`,
          doc: {
            claseId,
            alumnoId,
            minutos: preview.minutos,
            asignaciones,
            motivo: preview.motivo,
            creadoEn: Timestamp.fromDate(ahora),
          },
        })
        for (const asignacion of asignaciones) {
          const anterior = actualizacionesLotes[asignacion.creditoId] ?? {
            minutosUsados: snapsLotes[asignacion.creditoId]?.minutosUsados ?? 0,
            minutosComprados: snapsLotes[asignacion.creditoId]?.minutosComprados ?? 0,
          }
          anterior.minutosUsados += asignacion.minutos
          actualizacionesLotes[asignacion.creditoId] = anterior
        }
      }
    }

    const cargos = cierre.cargos
      .filter((cargo) => !cubiertos.has(cargo.alumnoId))
      .map((cargo) => ({
        id: `${claseId}_${cargo.alumnoId}`,
        doc: {
          claseId,
          alumnoId: cargo.alumnoId,
          alumnoNombre: nombrePorId[cargo.alumnoId] ?? cargo.alumnoId,
          sedeId: d.sedeId,
          fecha: d.fecha,
          concepto: cargo.concepto,
          montoCents: cargo.montoCents,
          estado: 'pendiente',
          pagadoEn: null,
          metodoPago: null,
          creadoEn: Timestamp.fromDate(ahora),
        },
      }))

    const pagoProfesor =
      cierre.pagoProfesor.montoCents > 0
        ? {
            claseId,
            profesorId: d.profesorId,
            profesorNombre: d.profesorNombre ?? null,
            sedeId: d.sedeId,
            fecha: d.fecha,
            montoCents: cierre.pagoProfesor.montoCents,
            base: { modo: parametros.pagoProfesor.modo, minutos: duracionMin },
            estado: 'pendiente',
            pagadoEn: null,
            metodoPago: null,
          }
        : null

    // Nada por cobrar (todo cubierto por crédito y sin pago al profesor) →
    // la clase nace directamente `cobrada`. `seFactura: false` (fuerza mayor)
    // NO entra acá: se conserva el comportamiento histórico `pendiente_cobro`
    // con `facturada: false`.
    const nadaACobrar = seFactura && cargos.length === 0 && pagoProfesor === null
    const estadoFinal = nadaACobrar ? 'cobrada' : 'pendiente_cobro'

    tx.update(claseRef, {
      asistencias,
      estado: estadoFinal,
      facturada: Boolean(seFactura),
      cobro,
      ...(confirmadoPorProfesorId ? { confirmadoPorProfesorId } : {}),
      actualizadoPor: uid,
      actualizadoEn: Timestamp.fromDate(ahora),
    })
    for (const cargo of cargos) {
      tx.set(refCargo(db, tenantId, cargo.id), cargo.doc)
    }
    if (pagoProfesor) {
      tx.set(refPagoProfesor(db, tenantId, claseId), pagoProfesor)
    }
    for (const movimiento of movimientos) {
      tx.set(refMovimientoCredito(db, tenantId, movimiento.id), movimiento.doc)
    }
    for (const [loteId, datosLote] of Object.entries(actualizacionesLotes)) {
      const agotado = datosLote.minutosUsados >= datosLote.minutosComprados
      tx.update(refCredito(db, tenantId, loteId), {
        minutosUsados: datosLote.minutosUsados,
        estado: agotado ? 'agotado' : 'activo',
      })
    }

    resultado = {
      claseId,
      estado: estadoFinal,
      facturada: Boolean(seFactura),
      cargos: cargos.map((cargo) => ({ id: cargo.id, ...cargo.doc })),
      pagoProfesor: pagoProfesor ? { id: claseId, ...pagoProfesor } : null,
      movimientos: movimientos.map((m) => ({ id: m.id, ...m.doc })),
      advertencias,
      resumen: cierre.resumen,
    }
  })

  return resultado
}

/**
 * Atajo histórico: registra la asistencia SIN generar cobro. Es `cerrarClase`
 * con `seFactura: false` (fuerza mayor), así que deja la clase en
 * `pendiente_cobro` con `facturada: false` y sin cargos ni pago al profesor.
 * Se conserva por compatibilidad; la UI usa `cerrarClase`.
 */
export async function registrarAsistencia(db, tenantId, claseId, asistencias, opciones = {}) {
  return cerrarClase(db, tenantId, claseId, { asistencias, seFactura: false }, opciones)
}

/**
 * Marca un cargo como pagado (pago COMPLETO; los parciales quedan fuera de
 * alcance). `metodoPago` ∈ METODOS_PAGO. Idempotente si ya estaba pagado.
 * Si el cargo es de una clase, vuelve a evaluar su estado y la deja `cobrada`
 * cuando ya no queda nada por cobrar (Phase 5).
 */
export async function marcarCargoPagado(db, tenantId, cargoId, datos = {}, opciones = {}) {
  const { ahora = new Date() } = opciones
  const metodoPago = datos.metodoPago ?? null
  if (!METODOS_PAGO.includes(metodoPago)) {
    throw new CobroInvalidoError(`método de pago inválido "${metodoPago}"`)
  }
  const ref = refCargo(db, tenantId, cargoId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ClaseInvalidaError(`El cargo ${cargoId} no existe`)
    const data = snap.data()
    const estado = data.estado
    if (estado === 'pagado') return
    if (estado !== 'pendiente') {
      throw new CobroInvalidoError(`Solo se cobra un cargo pendiente (estado "${estado}")`)
    }
    // Todas las lecturas antes de las escrituras.
    const claseId = data.claseId ?? null
    const estadoClase = claseId ? await leerEstadoCierreTx(tx, db, tenantId, claseId) : null

    tx.update(ref, {
      estado: 'pagado',
      pagadoEn: Timestamp.fromDate(ahora),
      metodoPago,
    })
    if (claseId) {
      sincronizarClaseCobrada(tx, db, tenantId, claseId, estadoClase, { cargoPagadoId: cargoId })
    }
  })
  return { cargoId, estado: 'pagado' }
}

/**
 * Marca el pago de una clase al profesor como pagado (completo). Espejo de
 * `marcarCargoPagado` sobre `pagosProfesor/{claseId}`: al pagarlo, la clase
 * pasa a `cobrada` si ya no queda nada por cobrar.
 */
export async function marcarPagoProfesorPagado(db, tenantId, pagoId, datos = {}, opciones = {}) {
  const { ahora = new Date() } = opciones
  const metodoPago = datos.metodoPago ?? null
  if (!METODOS_PAGO.includes(metodoPago)) {
    throw new CobroInvalidoError(`método de pago inválido "${metodoPago}"`)
  }
  const ref = refPagoProfesor(db, tenantId, pagoId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ClaseInvalidaError(`El pago ${pagoId} no existe`)
    const data = snap.data()
    const estado = data.estado
    if (estado === 'pagado') return
    if (estado !== 'pendiente') {
      throw new CobroInvalidoError(`Solo se paga un pago pendiente (estado "${estado}")`)
    }
    const claseId = data.claseId ?? pagoId
    const estadoClase = await leerEstadoCierreTx(tx, db, tenantId, claseId)

    tx.update(ref, {
      estado: 'pagado',
      pagadoEn: Timestamp.fromDate(ahora),
      metodoPago,
    })
    sincronizarClaseCobrada(tx, db, tenantId, claseId, estadoClase, { pagoPagado: true })
  })
  return { pagoId, estado: 'pagado' }
}

/**
 * Anula el cierre de una clase: marca `anulado` sus cargos y su pago (si no
 * están pagados), revierte los movimientos de crédito (devuelve los minutos a
 * sus lotes) y vuelve la clase a `reservada` para poder cerrarla otra vez. Se
 * rechaza si algún cargo o el pago ya está `pagado` (primero hay que deshacer el
 * cobro). Acepta clases `pendiente_cobro` o `cobrada` (si nada está pagado).
 */
export async function anularCierre(db, tenantId, claseId, opciones = {}) {
  const { uid = null, ahora = new Date() } = opciones
  const claseRef = refClase(db, tenantId, claseId)
  const pagoRef = refPagoProfesor(db, tenantId, claseId)

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(claseRef)
    if (!snap.exists()) throw new ClaseInvalidaError(`La clase ${claseId} no existe`)
    const clase = snap.data()
    if (clase.estado !== 'pendiente_cobro' && clase.estado !== 'cobrada') {
      throw new ClaseInvalidaError(`Solo se anula una clase cerrada (estado "${clase.estado}")`)
    }
    // El SDK web NO deja consultar (Query) dentro de una transacción, así que
    // cargos y movimientos se leen con sus IDs deterministas.
    const alumnos = clase.alumnos ?? []
    const [snapCargos, snapPago, snapMovimientos] = await Promise.all([
      Promise.all(alumnos.map((a) => tx.get(refCargo(db, tenantId, `${claseId}_${a}`)))),
      tx.get(pagoRef),
      Promise.all(alumnos.map((a) => tx.get(refMovimientoCredito(db, tenantId, `${claseId}_${a}`)))),
    ])
    const pagado =
      snapCargos.some((d) => d.exists() && d.data().estado === 'pagado') ||
      (snapPago.exists() && snapPago.data().estado === 'pagado')
    if (pagado) {
      throw new CobroInvalidoError(
        'No se puede anular el cierre: hay un cobro o pago ya registrado. Deshazlo primero.',
      )
    }

    // Asignaciones de crédito a revertir (lecturas antes de escrituras).
    const asignaciones = []
    snapMovimientos.forEach((d) => {
      if (!d.exists()) return
      for (const asignacion of d.data().asignaciones ?? []) asignaciones.push(asignacion)
    })
    const loteIds = [...new Set(asignaciones.map((a) => a.creditoId))]
    const snapLotes = await Promise.all(
      loteIds.map((id) => tx.get(refCredito(db, tenantId, id))),
    )

    // Escrituras.
    snapCargos.forEach((d) => {
      if (d.exists() && d.data().estado === 'pendiente') tx.update(d.ref, { estado: 'anulado' })
    })
    if (snapPago.exists() && snapPago.data().estado === 'pendiente') {
      tx.update(pagoRef, { estado: 'anulado' })
    }
    snapLotes.forEach((d, i) => {
      if (!d.exists()) return
      const loteId = loteIds[i]
      const devolver = asignaciones
        .filter((a) => a.creditoId === loteId)
        .reduce((total, a) => total + a.minutos, 0)
      const usados = Math.max(0, (d.data().minutosUsados ?? 0) - devolver)
      const comprados = d.data().minutosComprados ?? 0
      tx.update(refCredito(db, tenantId, loteId), {
        minutosUsados: usados,
        estado: usados >= comprados ? 'agotado' : 'activo',
      })
    })
    snapMovimientos.forEach((d) => {
      if (!d.exists()) return
      // Se revierte SIN borrar (las reglas no permiten delete): el movimiento
      // queda en cero y un nuevo cierre lo reescribe con su id determinista.
      tx.update(d.ref, { minutos: 0, asignaciones: [] })
    })
    tx.update(claseRef, {
      estado: 'reservada',
      facturada: false,
      actualizadoPor: uid,
      actualizadoEn: Timestamp.fromDate(ahora),
    })
  })

  return { claseId, estado: 'reservada' }
}

/** Normaliza un rango de fechas opcional para los listados de cobros. */
function rangoFechas(desde, hasta) {
  return { desde: desde ?? null, hasta: hasta ?? null }
}

/**
 * Cargos PENDIENTES, acotados por tenant y opcionalmente por sede y rango de
 * fechas. Página chica: 50 por defecto, tope 100. Requiere los índices de
 * `firestore.indexes.json`.
 */
export async function listarCargosPendientes(db, tenantId, opciones = {}) {
  const { sedeId = null, limite } = opciones
  const { desde, hasta } = rangoFechas(opciones.desde, opciones.hasta)
  const tope = Math.min(Math.max(1, Number(limite) || LIMITE_COBROS_PAGINA), LIMITE_COBROS_MAX)
  const filtros = [where('estado', '==', 'pendiente')]
  if (sedeId) filtros.push(where('sedeId', '==', sedeId))
  if (desde) filtros.push(where('fecha', '>=', desde))
  if (hasta) filtros.push(where('fecha', '<=', hasta))
  const q = query(
    coleccionCargos(db, tenantId),
    ...filtros,
    orderBy('fecha'),
    limit(tope),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Pagos PENDIENTES al profesor, con los mismos filtros y topes que
 * `listarCargosPendientes` (colección `pagosProfesor`).
 */
export async function listarPagosProfesorPendientes(db, tenantId, opciones = {}) {
  const { sedeId = null, limite } = opciones
  const { desde, hasta } = rangoFechas(opciones.desde, opciones.hasta)
  const tope = Math.min(Math.max(1, Number(limite) || LIMITE_COBROS_PAGINA), LIMITE_COBROS_MAX)
  const filtros = [where('estado', '==', 'pendiente')]
  if (sedeId) filtros.push(where('sedeId', '==', sedeId))
  if (desde) filtros.push(where('fecha', '>=', desde))
  if (hasta) filtros.push(where('fecha', '<=', hasta))
  const q = query(
    coleccionPagosProfesor(db, tenantId),
    ...filtros,
    orderBy('fecha'),
    limit(tope),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Cierre de una clase para el detalle: sus cargos (todos los estados), los
 * movimientos de crédito (Phase 5) y el pago al profesor, o `null`. Acotado por
 * clase; el gasto de los movimientos se filtra en el cliente.
 */
export async function getCierreDeClase(db, tenantId, claseId) {
  const cargosQuery = query(coleccionCargos(db, tenantId), where('claseId', '==', claseId))
  const movimientosQuery = query(
    collection(db, 'academias', tenantId, 'movimientosCredito'),
    where('claseId', '==', claseId),
  )
  const [snapCargos, snapPago, snapMovimientos] = await Promise.all([
    getDocs(cargosQuery),
    getDoc(refPagoProfesor(db, tenantId, claseId)),
    getDocs(movimientosQuery),
  ])
  return {
    cargos: snapCargos.docs.map((d) => ({ id: d.id, ...d.data() })),
    pagoProfesor: snapPago.exists() ? { id: snapPago.id, ...snapPago.data() } : null,
    movimientos: snapMovimientos.docs.map((d) => ({ id: d.id, ...d.data() })),
  }
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
 * Estado de ocupación de un bloque concreto de MINUTOS_BLOQUE (30) minutos.
 * Útil para pintar la grilla de la agenda sin traer todas las clases del día.
 * 1 lectura.
 */
export async function getBloque(db, tenantId, bloqueId) {
  const snap = await getDoc(refBloque(db, tenantId, bloqueId))
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
}

/* --------------------------------------------------------------------- */
/* Planes de alumno y créditos (Phase 5)                                   */
/* --------------------------------------------------------------------- */

/** Tope de planes que se listan de un alumno. */
export const LIMITE_PLANES_ALUMNO = 50

/**
 * Clave normalizada de un representante para detectar hermanos: nombre+apellidos
 * plegados (`normalizarBusqueda`, así "Ávila" == "avila") y el teléfono solo con
 * dígitos. Devuelve `null` si no hay ni nombre ni teléfono.
 */
export function claveRepresentante(representante) {
  if (!representante) return null
  const nombre = normalizarBusqueda(
    `${representante.nombre ?? ''} ${representante.apellidos ?? ''}`,
  )
  const telefono = String(representante.telefono ?? '').replace(/\D/g, '')
  if (!nombre && !telefono) return null
  return `${nombre}|${telefono}`
}

/**
 * ¿Conviene sugerir el descuento de hermanos? PURA: un MENOR con representante
 * identificable cuenta como hermano si OTRO menor ACTIVO comparte el mismo
 * representante (misma clave normalizada nombre+teléfono). Es solo una
 * sugerencia para la UI; quien decide es el administrador.
 */
export function sugerirDescuentoHermanos(alumno, alumnos = []) {
  if (alumno?.tipo !== 'menor') return false
  const clave = claveRepresentante(alumno.representante)
  if (!clave) return false
  return (alumnos ?? []).some(
    (otro) =>
      otro.id !== alumno.id &&
      otro.tipo === 'menor' &&
      otro.activo !== false &&
      claveRepresentante(otro.representante) === clave,
  )
}

/** Valida y normaliza los datos de un plan de alumno. `esMenor` habilita el descuento. */
function validarPlanDatos(datos, { esMenor = false } = {}) {
  const nombre = String(datos?.nombre ?? '').trim()
  if (!nombre) throw new CobroInvalidoError('El plan necesita un nombre')
  if (nombre.length > LIMITE_NOMBRE_PERFIL) {
    throw new CobroInvalidoError(`El nombre del plan no puede superar ${LIMITE_NOMBRE_PERFIL} caracteres`)
  }
  const frecuencia = datos?.frecuencia ?? 'mensual'
  if (!frecuenciaPlanValida(frecuencia)) {
    throw new CobroInvalidoError(`Frecuencia de plan inválida "${frecuencia}". Permitidas: ${FRECUENCIAS_PLAN.join(', ')}`)
  }
  if (!minutosPlanValidos(datos?.minutosIncluidos)) {
    throw new CobroInvalidoError(
      `minutosIncluidos debe ser un entero mayor a 0 y múltiplo de ${MINUTOS_BLOQUE}`,
    )
  }
  if (!precioPlanValido(datos?.precioCents)) {
    throw new CobroInvalidoError(
      `precioCents debe ser un entero de centavos mayor a 0 (hasta ${LIMITE_MONTO_CENTS})`,
    )
  }
  const descuentoHermanos = Boolean(datos?.descuentoHermanos)
  if (descuentoHermanos && !esMenor) {
    throw new CobroInvalidoError('El descuento de hermanos solo aplica a alumnos menores')
  }
  return {
    nombre,
    frecuencia,
    minutosIncluidos: datos.minutosIncluidos,
    precioCents: datos.precioCents,
    descuentoHermanos,
  }
}

/** Plan ACTIVO de un alumno, o `null`. Acotado por alumno + activo + limit(2). */
export async function getPlanActivo(db, tenantId, alumnoId) {
  const q = query(
    coleccionPlanesAlumno(db, tenantId),
    where('alumnoId', '==', alumnoId),
    where('activo', '==', true),
    limit(2),
  )
  const snap = await getDocs(q)
  return snap.docs.length ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null
}

/** Planes de un alumno (activos e inactivos), más recientes primero. */
export async function listarPlanesAlumno(db, tenantId, alumnoId) {
  const q = query(
    coleccionPlanesAlumno(db, tenantId),
    where('alumnoId', '==', alumnoId),
    limit(LIMITE_PLANES_ALUMNO),
  )
  const snap = await getDocs(q)
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.creadoEn?.seconds ?? 0).localeCompare(String(a.creadoEn?.seconds ?? 0)))
}

/**
 * Crea un plan de alumno. Un alumno puede tener COMO MUCHO un plan activo.
 * `planId` es opcional (lo usa el seed). El descuento de hermanos solo aplica a
 * menores.
 */
export async function crearPlanAlumno(db, tenantId, datos = {}, opciones = {}) {
  const { now = new Date(), planId = null } = opciones
  const alumno = await getAlumno(db, tenantId, datos.alumnoId)
  if (!alumno) throw new CobroInvalidoError(`El alumno ${datos.alumnoId} no existe`)
  const activo = datos.activo ?? true
  if (activo) {
    const yaActivo = await getPlanActivo(db, tenantId, datos.alumnoId)
    if (yaActivo && yaActivo.id !== planId) {
      throw new CobroInvalidoError('El alumno ya tiene un plan activo')
    }
  }
  const limpio = validarPlanDatos(datos, { esMenor: alumno.tipo === 'menor' })
  const ref = planId ? refPlanAlumno(db, tenantId, planId) : doc(coleccionPlanesAlumno(db, tenantId))
  await setDoc(ref, {
    alumnoId: datos.alumnoId,
    ...limpio,
    activo: Boolean(activo),
    creadoEn: Timestamp.fromDate(now),
  })
  return { planId: ref.id }
}

/** Actualiza un plan de alumno (merge validado). */
export async function actualizarPlanAlumno(db, tenantId, planId, cambios = {}, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const ref = refPlanAlumno(db, tenantId, planId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new CobroInvalidoError(`El plan "${planId}" no existe`)
  const actual = snap.data()
  const alumno = await getAlumno(db, tenantId, actual.alumnoId)
  const activo = cambios.activo !== undefined ? Boolean(cambios.activo) : actual.activo !== false
  if (activo) {
    const yaActivo = await getPlanActivo(db, tenantId, actual.alumnoId)
    if (yaActivo && yaActivo.id !== planId) {
      throw new CobroInvalidoError('El alumno ya tiene un plan activo')
    }
  }
  const limpio = validarPlanDatos({ ...actual, ...cambios }, { esMenor: alumno?.tipo === 'menor' })
  await updateDoc(ref, {
    ...limpio,
    activo,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { planId }
}

/** Desactiva un plan de alumno (soft delete: los planes NUNCA se borran). */
export async function desactivarPlanAlumno(db, tenantId, planId, opciones = {}) {
  const { uid = null, now = new Date() } = opciones
  const ref = refPlanAlumno(db, tenantId, planId)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new CobroInvalidoError(`El plan "${planId}" no existe`)
  await updateDoc(ref, {
    activo: false,
    actualizadoPor: uid,
    actualizadoEn: Timestamp.fromDate(now),
  })
  return { planId, activo: false }
}

/**
 * Crédito de un alumno en `fecha` (por defecto HOY): todos los lotes con su
 * estado EFECTIVO (el vencimiento es perezoso), los usables en orden FIFO y los
 * vencidos, más el total disponible. Respeta `creditoRequierePago`.
 */
export async function getCreditoAlumno(db, tenantId, alumnoId, fecha = fechaHoyLocal(), opciones = {}) {
  const parametros = opciones.creditoRequierePago === undefined
    ? await getParametros(db, tenantId)
    : null
  const creditoRequierePago =
    opciones.creditoRequierePago ??
    parametros?.creditoRequierePago ??
    PARAMETROS_DEFAULT.creditoRequierePago

  const lotes = await leerLotesDeAlumno(db, tenantId, alumnoId)
  const cargoIds = [...new Set(lotes.map((lote) => lote.cargoId).filter(Boolean))]
  const cargoEstado = {}
  await Promise.all(
    cargoIds.map(async (cargoId) => {
      const snap = await getDoc(refCargo(db, tenantId, cargoId))
      if (snap.exists()) cargoEstado[cargoId] = snap.data().estado
    }),
  )
  const conEstado = lotes.map((lote) => ({
    ...lote,
    cargoPagado: !creditoRequierePago
      ? true
      : lote.cargoId
        ? cargoEstado[lote.cargoId] === 'pagado'
        : false,
  }))
  const usables = lotesUsables(conEstado, fecha, { creditoRequierePago })
  const vencidos = conEstado.filter(
    (lote) =>
      estadoLote(lote, fecha, { creditoRequierePago, cargoPagado: lote.cargoPagado }) === 'vencido',
  )
  const minutosDisponiblesTotal = usables.reduce(
    (total, lote) => total + minutosDisponibles(lote),
    0,
  )
  return {
    lotes: conEstado,
    usables,
    vencidos,
    minutosDisponibles: minutosDisponiblesTotal,
    creditoRequierePago,
  }
}

/** Días entre dos fechas "YYYY-MM-DD". */
function sumarDiasISO(fecha, dias) {
  return sumarDias(fecha, dias)
}

/**
 * Compra (o renueva) el crédito del alumno a partir de su plan ACTIVO: crea el
 * lote y su cargo de `mensualidad` (concepto `mensualidad`, `claseId: null`,
 * `creditoId`) en UNA transacción. El precio es el del plan menos el descuento
 * de hermanos si el plan lo tiene. El vencimiento sale de
 * `parametros.vencimientoCreditoDias` (null = no vence).
 */
export async function comprarCredito(db, tenantId, alumnoId, opciones = {}) {
  const { now = new Date() } = opciones
  const alumno = await getAlumno(db, tenantId, alumnoId)
  if (!alumno) throw new CobroInvalidoError(`El alumno ${alumnoId} no existe`)
  const plan = await getPlanActivo(db, tenantId, alumnoId)
  if (!plan) throw new CobroInvalidoError('El alumno no tiene un plan activo')
  const parametros = await getParametros(db, tenantId)

  const fecha = fechaHoyLocal(now)
  const venceEn = parametros.vencimientoCreditoDias
    ? sumarDiasISO(fecha, parametros.vencimientoCreditoDias)
    : null
  const montoCents = precioMensualidad(plan, parametros.descuentoHermanosPct)

  const creditoRef = doc(coleccionCreditos(db, tenantId))
  const cargoRef = refCargo(db, tenantId, `men_${creditoRef.id}`)
  const planRef = refPlanAlumno(db, tenantId, plan.id)

  await runTransaction(db, async (tx) => {
    const planSnap = await tx.get(planRef)
    if (!planSnap.exists() || planSnap.data().activo === false) {
      throw new CobroInvalidoError('El alumno no tiene un plan activo')
    }
    tx.set(cargoRef, {
      claseId: null,
      alumnoId,
      alumnoNombre: nombreCompleto(alumno),
      sedeId: null,
      fecha,
      concepto: 'mensualidad',
      creditoId: creditoRef.id,
      planId: plan.id,
      planNombre: plan.nombre,
      montoCents,
      estado: 'pendiente',
      pagadoEn: null,
      metodoPago: null,
      creadoEn: Timestamp.fromDate(now),
    })
    tx.set(creditoRef, {
      alumnoId,
      planId: plan.id,
      minutosComprados: plan.minutosIncluidos,
      minutosUsados: 0,
      inicio: fecha,
      venceEn,
      cargoId: cargoRef.id,
      estado: 'activo',
      creadoEn: Timestamp.fromDate(now),
    })
  })
  return { creditoId: creditoRef.id, cargoId: cargoRef.id, montoCents, venceEn }
}

/**
 * Anula un lote de crédito SIN usar (minutosUsados = 0) y su cargo, siempre que
 * el cargo no esté `pagado`. Idempotente si ya estaba anulado.
 */
export async function anularCredito(db, tenantId, creditoId) {
  const creditoRef = refCredito(db, tenantId, creditoId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(creditoRef)
    if (!snap.exists()) throw new CobroInvalidoError(`El lote "${creditoId}" no existe`)
    const data = snap.data()
    if (data.estado === 'anulado') return
    if ((data.minutosUsados ?? 0) > 0) {
      throw new CobroInvalidoError('No se anula un crédito que ya tiene minutos usados')
    }
    const cargoRef = data.cargoId ? refCargo(db, tenantId, data.cargoId) : null
    const cargoSnap = cargoRef ? await tx.get(cargoRef) : null
    if (cargoSnap?.exists() && cargoSnap.data().estado === 'pagado') {
      throw new CobroInvalidoError('No se anula un crédito cuyo cargo ya está pagado')
    }
    tx.update(creditoRef, { estado: 'anulado' })
    if (cargoSnap?.exists() && cargoSnap.data().estado === 'pendiente') {
      tx.update(cargoRef, { estado: 'anulado' })
    }
  })
  return { creditoId, estado: 'anulado' }
}