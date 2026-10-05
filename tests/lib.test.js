/*
 * Pruebas de helpers puros (sin Firestore ni emulador).
 *
 *   npm run test:lib
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  contarSinCerrar,
  estaSinCerrar,
  etiquetaCategoria,
  modalidadDeClase,
  tituloClase,
} from '../src/lib/agenda.js'
import { aISO, hoyISO } from '../src/lib/fechas.js'

describe('fechas locales', () => {
  it('aISO usa las partes locales, no toISOString()', () => {
    // 2026-10-03 21:30 en Caracas (UTC-4) ya es 2026-10-04 en UTC.
    const fecha = new Date(2026, 9, 3, 21, 30, 0)
    assert.equal(aISO(fecha), '2026-10-03')
  })

  it('hoyISO coincide con las partes locales de hoy', () => {
    const ahora = new Date()
    const esperado = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(
      ahora.getDate(),
    ).padStart(2, '0')}`
    assert.equal(hoyISO(), esperado)
  })
})

describe('título de clase', () => {
  it('modalidad derivada del cupo', () => {
    assert.equal(modalidadDeClase({ cupo: 1 }), 'Individual')
    assert.equal(modalidadDeClase({ cupo: 4 }), 'Grupal')
  })

  it('etiqueta de categoría', () => {
    assert.equal(etiquetaCategoria('principiante'), 'Principiante')
    assert.equal(etiquetaCategoria('6a'), '6ta')
    assert.equal(etiquetaCategoria('1a'), '1ra')
    assert.equal(etiquetaCategoria('7a'), '7ma')
    assert.equal(etiquetaCategoria(null), null)
  })

  it('título = "Modalidad · Categoría" y solo modalidad sin categoría', () => {
    assert.equal(tituloClase({ cupo: 4, categoria: '6a' }), 'Grupal · 6ta')
    assert.equal(tituloClase({ cupo: 1, categoria: null }), 'Individual')
  })
})

describe('sin cerrar', () => {
  const base = { estado: 'reservada', fecha: '2026-10-03', horaInicio: '18:00', horaFin: '19:00' }

  it('reservada con fin ya pasado (hora local) → true', () => {
    assert.equal(estaSinCerrar(base, new Date(2026, 9, 3, 20, 0, 0)), true)
  })

  it('reservada que todavía no terminó → false', () => {
    assert.equal(estaSinCerrar(base, new Date(2026, 9, 3, 18, 30, 0)), false)
    assert.equal(estaSinCerrar(base, new Date(2026, 9, 3, 8, 0, 0)), false)
  })

  it('otro día, estado cerrado o sin fecha → false', () => {
    assert.equal(estaSinCerrar(base, new Date(2026, 9, 2, 8, 0, 0)), false)
    assert.equal(estaSinCerrar({ ...base, estado: 'pendiente_cobro' }, new Date(2026, 9, 3, 20, 0, 0)), false)
    assert.equal(estaSinCerrar({ ...base, fecha: null }, new Date(2026, 9, 3, 20, 0, 0)), false)
  })

  it('contarSinCerrar cuenta solo las vencidas', () => {
    const ahora = new Date(2026, 9, 3, 20, 0, 0)
    const clases = [base, { ...base, horaFin: '21:00' }, { ...base, estado: 'cobrada' }]
    assert.equal(contarSinCerrar(clases, ahora), 1)
  })
})
