/*
 * Planificación de fechas de las clases del seed (Traki). Es pura y recibe el
 * reloj (`hoy`) para poder probarla con los 7 días de la semana.
 *
 * Cada clase pide un desfase en días respecto de hoy (negativo = pasado). La
 * fecha final es el día MÁS CERCANO en esa dirección (hacia atrás si es pasada,
 * hacia adelante si es futura) en que:
 *  - la sede abre ese día de la semana,
 *  - la franja de la clase cabe dentro del horario de ESE día (el sábado de
 *    Traki cierra a las 13:00, así que una clase 13:00-14:00 no puede ir ahí), y
 *  - no se solapa con otra clase ya planificada en la misma cancha o con el
 *    mismo profesor.
 */
import { horarioDelDia } from '../packages/academia-core/src/lib/agenda.js'
import { sumarDias } from '../packages/academia-core/src/lib/fechas.js'

/** "YYYY-MM-DD" a `dias` de `hoy`, con partes LOCALES (no toISOString: Caracas es UTC-4). */
export function fechaRelativa(dias, hoy = new Date()) {
  const d = new Date(hoy.getTime())
  d.setDate(d.getDate() + dias)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const aMinutos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/**
 * Orden importa: las clases de "ayer" (c0, c2, c4) van primero para quedar todas
 * el mismo día; el resto se acomoda alrededor sin pisarlas.
 */
export const PLAN_CLASES = [
  { id: 'c0', dias: -1, canchaId: 'c2', profesorId: 'p1', horaInicio: '09:00', horaFin: '10:00' },
  { id: 'c2', dias: -1, canchaId: 'c1', profesorId: 'p1', horaInicio: '11:00', horaFin: '12:00' },
  { id: 'c4', dias: -1, canchaId: 'c3', profesorId: 'p1', horaInicio: '12:00', horaFin: '13:00' },
  { id: 'c1', dias: 1, canchaId: 'c1', profesorId: 'p1', horaInicio: '10:00', horaFin: '11:00' },
  { id: 'c3', dias: 1, canchaId: 'c2', profesorId: 'p1', horaInicio: '11:30', horaFin: '13:00' },
  { id: 'c5', dias: -2, canchaId: 'c4', profesorId: 'p1', horaInicio: '09:00', horaFin: '10:00' },
  { id: 'c6', dias: -3, canchaId: 'c5', profesorId: 'p1', horaInicio: '10:30', horaFin: '12:00' },
  { id: 'ca', dias: -4, canchaId: 'c1', profesorId: 'p1', horaInicio: '09:00', horaFin: '10:00' },
  { id: 'cb', dias: -5, canchaId: 'c1', profesorId: 'p1', horaInicio: '10:30', horaFin: '11:30' },
  { id: 'cc', dias: -6, canchaId: 'c1', profesorId: 'p1', horaInicio: '13:00', horaFin: '14:00' },
  { id: 'cd', dias: -7, canchaId: 'c1', profesorId: 'p1', horaInicio: '14:30', horaFin: '15:30' },
]

export const PLAN_POR_ID = Object.fromEntries(PLAN_CLASES.map((c) => [c.id, c]))

const seSolapan = (a, b) =>
  aMinutos(a.horaInicio) < aMinutos(b.horaFin) && aMinutos(b.horaInicio) < aMinutos(a.horaFin)

/** `true` si la clase cabe en el horario de la sede ese día (sede abierta y dentro de la franja). */
export function cabeEnHorario(fecha, clase, horarioSemana) {
  const franja = horarioDelDia(fecha, horarioSemana)
  if (!franja) return false
  return aMinutos(clase.horaInicio) >= franja.apertura && aMinutos(clase.horaFin) <= franja.cierre
}

/** { [claseId]: "YYYY-MM-DD" } para todas las clases del plan, dado el horario semanal de la sede. */
export function planificarClases(horarioSemana, hoy = new Date(), plan = PLAN_CLASES) {
  const fechas = {}
  const hechas = []
  for (const clase of plan) {
    const paso = clase.dias < 0 ? -1 : 1
    let fecha = fechaRelativa(clase.dias, hoy)
    let asignada = null
    for (let intento = 0; intento < 14 && !asignada; intento += 1) {
      const choca = hechas.some(
        (otra) =>
          otra.fecha === fecha &&
          (otra.canchaId === clase.canchaId || otra.profesorId === clase.profesorId) &&
          seSolapan(otra, clase),
      )
      if (cabeEnHorario(fecha, clase, horarioSemana) && !choca) asignada = fecha
      else fecha = sumarDias(fecha, paso)
    }
    if (!asignada) throw new Error(`La clase ${clase.id} del seed no cabe en ningún día del horario de la sede`)
    fechas[clase.id] = asignada
    hechas.push({ ...clase, fecha: asignada })
  }
  return fechas
}
