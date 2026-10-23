import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { horarioDelDia } from '../src/lib/agenda.js'
import { PLAN_CLASES, cabeEnHorario, fechaRelativa, planificarClases } from '../../../scripts/seed-plan.mjs'

// Horario semanal de Traki tal como lo siembra scripts/seed.mjs (0 = lunes … 6 = domingo).
const franja = (apertura, cierre) => ({ apertura: Math.round(apertura * 60), cierre: Math.round(cierre * 60) })
const HORARIO_TRAKI = {
  0: franja(7.5, 15.5),
  1: franja(7.5, 15.5),
  2: franja(7.5, 15.5),
  3: franja(7.5, 15.5),
  4: franja(7.5, 15.5),
  5: franja(8, 13),
  6: null,
}

const aMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// 2026-10-19 es lunes: 14 días consecutivos cubren cada día de la semana dos veces.
const RELOJES = Array.from({ length: 14 }, (_, i) => new Date(2026, 9, 19 + i, 9, 0, 0))

describe('planificación de fechas del seed', () => {
  it('fechaRelativa usa partes locales y respeta el reloj inyectado', () => {
    assert.equal(fechaRelativa(0, new Date(2026, 9, 23, 23, 30)), '2026-10-23')
    assert.equal(fechaRelativa(-6, new Date(2026, 9, 23)), '2026-10-17')
  })

  for (const hoy of RELOJES) {
    const nombre = hoy.toLocaleDateString('en-US', { weekday: 'long' })
    it(`${hoy.getFullYear()}-${hoy.getMonth() + 1}-${hoy.getDate()} (${nombre}): toda clase cae dentro del horario de su día`, () => {
      const fechas = planificarClases(HORARIO_TRAKI, hoy)
      assert.equal(Object.keys(fechas).length, PLAN_CLASES.length)
      for (const clase of PLAN_CLASES) {
        const fecha = fechas[clase.id]
        const franjaDia = horarioDelDia(fecha, HORARIO_TRAKI)
        assert.ok(franjaDia, `${clase.id} cae en ${fecha}: sede cerrada`)
        assert.ok(aMin(clase.horaInicio) >= franjaDia.apertura, `${clase.id} empieza antes de abrir (${fecha})`)
        assert.ok(aMin(clase.horaFin) <= franjaDia.cierre, `${clase.id} termina después de cerrar (${fecha})`)
        assert.ok(cabeEnHorario(fecha, clase, HORARIO_TRAKI))
      }
    })

    it(`${nombre} ${hoy.getDate()}: pasadas en el pasado, futuras en el futuro, sin solapes y c0/c2/c4 el mismo día`, () => {
      const fechas = planificarClases(HORARIO_TRAKI, hoy)
      const hoyISO = fechaRelativa(0, hoy)
      for (const clase of PLAN_CLASES) {
        if (clase.dias < 0) assert.ok(fechas[clase.id] < hoyISO, `${clase.id} debería ser pasada`)
        else assert.ok(fechas[clase.id] > hoyISO, `${clase.id} debería ser futura`)
      }
      assert.equal(fechas.c0, fechas.c2)
      assert.equal(fechas.c0, fechas.c4)
      for (const a of PLAN_CLASES) {
        for (const b of PLAN_CLASES) {
          if (a.id >= b.id || fechas[a.id] !== fechas[b.id]) continue
          const comparten = a.canchaId === b.canchaId || a.profesorId === b.profesorId
          const solapan = aMin(a.horaInicio) < aMin(b.horaFin) && aMin(b.horaInicio) < aMin(a.horaFin)
          assert.ok(!(comparten && solapan), `${a.id} y ${b.id} se solapan el ${fechas[a.id]}`)
        }
      }
    })
  }

  it('falla con claridad si una clase no cabe en ningún día', () => {
    const plan = [{ id: 'x', dias: -1, canchaId: 'c1', profesorId: 'p1', horaInicio: '20:00', horaFin: '21:00' }]
    assert.throws(() => planificarClases(HORARIO_TRAKI, RELOJES[0], plan), /no cabe en ningún día/)
  })
})
