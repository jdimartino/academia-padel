/*
 * Helpers puros de la agenda: grilla horaria, estados y avatares.
 * No tocan Firestore; la página les pasa las clases ya leídas.
 */

export const HORA_MIN = 7
export const HORA_MAX = 21
export const MIN_INICIO = HORA_MIN * 60
export const MIN_FIN = HORA_MAX * 60
export const DURACION_MIN = MIN_FIN - MIN_INICIO

const RE_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "18:30" → 1110. Devuelve null si no es "HH:mm" válido. */
export function aMinutos(hhmm) {
  const match = RE_HHMM.exec(hhmm ?? '')
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** 1110 → "18:30". */
export function aHoraHHmm(minutos) {
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0')
  const mm = String(minutos % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

/** Minutos de inicio/fin de una clase, recortados a la franja visible. */
export function rangoClase(clase) {
  const inicio = aMinutos(clase.horaInicio)
  const fin = aMinutos(clase.horaFin)
  if (inicio === null || fin === null || fin <= inicio) return null
  return { inicio, fin }
}

/*
 * Mapa de estado almacenado → rótulo + tono visual.
 * Estados del modelo (docs/modelo-datos.md §4): reservada, ejecutada,
 * pendiente_cobro, cobrada, cancelada.
 * Tono visual: reservada | ejecutada | pendiente | cancelada.
 * `cobrada` no tiene un estado visual propio: se pinta como ejecutada
 * (el trabajo ya se hizo); el rótulo sí dice "Cobrada".
 */
const ESTADOS = {
  reservada: { label: 'Reservada', tono: 'reservada' },
  ejecutada: { label: 'Ejecutada', tono: 'ejecutada' },
  pendiente_cobro: { label: 'Pendiente de cobro', tono: 'pendiente' },
  cobrada: { label: 'Cobrada', tono: 'ejecutada' },
  cancelada: { label: 'Cancelada', tono: 'cancelada' },
}

export function estadoDe(estado) {
  return ESTADOS[estado] ?? { label: capitalizar(estado ?? 'Sin estado'), tono: 'reservada' }
}

export function capitalizar(texto) {
  const t = String(texto ?? '')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

/*
 * Categoría de la clase (opcional). El id guardado NO cambia ("7a",
 * "principiante"); la etiqueta que ve el usuario se centraliza acá:
 * Principiante, 1ra, 2da, 3ra, 4ta, 5ta, 6ta, 7ma.
 * Ver docs/modelo-datos.md §4.
 */
export const CATEGORIAS = ['principiante', '7a', '6a', '5a', '4a', '3a', '2a', '1a']

/** Única tabla de rótulos de nivel/categoría que ve el usuario. */
const ETIQUETAS_CATEGORIA = {
  principiante: 'Principiante',
  '1a': '1ra',
  '2a': '2da',
  '3a': '3ra',
  '4a': '4ta',
  '5a': '5ta',
  '6a': '6ta',
  '7a': '7ma',
}

export function etiquetaCategoria(categoria) {
  if (!categoria) return null
  return ETIQUETAS_CATEGORIA[categoria] ?? capitalizar(categoria)
}

/*
 * Modalidad derivada del cupo (no es un campo aparte): una clase de una sola
 * plaza es Individual; con dos o más, Grupal.
 */
export function modalidadDeClase(clase) {
  return (clase.cupo ?? 0) <= 1 ? 'Individual' : 'Grupal'
}

/** Título del bloque: "Modalidad · Categoría" (solo modalidad si no hay categoría). */
export function tituloClase(clase) {
  return [modalidadDeClase(clase), etiquetaCategoria(clase.categoria)].filter(Boolean).join(' · ')
}

/*
 * "Sin cerrar": una clase que quedó `reservada` y cuya hora de fin YA pasó, es
 * decir que se dictó (o debía dictarse) y nadie registró la asistencia.
 * Se compara en calendario/hora LOCAL. Nunca se usa toISOString(): pasaría a
 * UTC y con Caracas (UTC-4) adelantaría el día. `ahora` es inyectable para
 * poder probarlo.
 */
export function estaSinCerrar(clase, ahora = new Date()) {
  if (clase?.estado !== 'reservada' || !clase.fecha) return false
  const fin = aMinutos(clase.horaFin)
  if (fin === null) return false
  const [y, m, d] = String(clase.fecha).split('-').map(Number)
  if (!y || !m || !d) return false
  const finFecha = new Date(y, m - 1, d, 0, 0, 0, 0)
  finFecha.setMinutes(fin)
  return finFecha.getTime() < ahora.getTime()
}

/** Cantidad de clases "sin cerrar" en una lista. */
export function contarSinCerrar(clases, ahora = new Date()) {
  return (clases ?? []).filter((clase) => estaSinCerrar(clase, ahora)).length
}

/** "Pablo Profesor" → "PP" (máximo 2 iniciales). */
export function iniciales(nombre) {
  const partes = String(nombre ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

/** Horas enteras de la franja, para las etiquetas de la grilla. */
export function horasDeFranja() {
  const horas = []
  for (let h = HORA_MIN; h <= HORA_MAX; h += 1) horas.push(h)
  return horas
}

/** Líneas de fondo: cada 30 min, marcando cuáles son hora en punto. */
export function lineasDeFranja() {
  const lineas = []
  for (let m = MIN_INICIO; m <= MIN_FIN; m += 30) {
    lineas.push({ minuto: m, horaEntera: m % 60 === 0 })
  }
  return lineas
}
