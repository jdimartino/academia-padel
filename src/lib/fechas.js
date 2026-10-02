/*
 * Utilidades de fecha/hora puras, en calendario local.
 * Nunca se usa toISOString() para el día: eso pasa a UTC y adelanta/atrasa
 * el día según la zona. El modelo guarda `fecha` como "YYYY-MM-DD".
 */

export const DIAS_CORTOS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do']
export const DIAS_LARGOS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
]
export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

/** Date (local) → "YYYY-MM-DD". */
export function aISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** "YYYY-MM-DD" → Date local a medianoche. */
export function aFecha(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function hoyISO() {
  return aISO(new Date())
}

export function sumarDias(iso, dias) {
  const fecha = aFecha(iso)
  fecha.setDate(fecha.getDate() + dias)
  return aISO(fecha)
}

export function mismoDia(a, b) {
  return a === b
}

/** Día de la semana con lunes = 0 … domingo = 6. */
export function diaSemana(iso) {
  return (aFecha(iso).getDay() + 6) % 7
}

/** Lunes de la semana que contiene `iso`. */
export function inicioSemana(iso) {
  return sumarDias(iso, -diaSemana(iso))
}

/** 7 días ISO, de lunes a domingo. */
export function diasDeSemana(iso) {
  const lunes = inicioSemana(iso)
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i))
}

/**
 * Matriz de semanas (cada una 7 ISO) que cubre el mes de `iso`, con lunes
 * como primer día. Las celdas de relleno pertenecen a meses vecinos.
 */
export function semanasDelMes(iso) {
  const fecha = aFecha(iso)
  const primero = new Date(fecha.getFullYear(), fecha.getMonth(), 1)
  const ultimo = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0)
  const desde = inicioSemana(aISO(primero))
  const hasta = sumarDias(inicioSemana(aISO(ultimo)), 6)
  const dias = []
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d)
  return dias
}

export function esDelMes(iso, mesIso) {
  return iso.slice(0, 7) === mesIso.slice(0, 7)
}

/** "2026-10-03" → "Sábado 3 de octubre". */
export function formatearFechaLarga(iso) {
  const fecha = aFecha(iso)
  const dia = DIAS_LARGOS[fecha.getDay()]
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`
}

/** "2026-10-03" → "3 oct". */
export function formatearFechaCorta(iso) {
  const fecha = aFecha(iso)
  return `${fecha.getDate()} ${MESES[fecha.getMonth()].slice(0, 3)}`
}

export function nombreMes(iso) {
  const fecha = aFecha(iso)
  const mes = MESES[fecha.getMonth()]
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${fecha.getFullYear()}`
}
