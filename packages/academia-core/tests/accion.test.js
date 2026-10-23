/*
 * Pruebas de la lógica pura del estado "ocupado" de una acción (Parte 1):
 * retraso del spinner, mínimo visible y reinicio. Sin React.
 *
 *   npm run test:lib
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DURACION_EXITO_MS,
  MIN_VISIBLE_OCUPADO_MS,
  OCUPADO_INICIAL,
  RETRASO_CARGA_MS,
  RETRASO_OCUPADO_MS,
  debeMostrarCarga,
  debeMostrarSpinner,
  esperaParaReiniciar,
  estaOcupado,
  iniciarOcupado,
  mostrarOcupado,
  puedeReiniciar,
  retrasoDe,
  terminarOcupado,
} from '../src/lib/accion.js'

describe('estado ocupado (spinner con retraso y mínimo visible)', () => {
  it('arranca quieto y se activa sin mostrar el spinner', () => {
    assert.deepEqual(OCUPADO_INICIAL, { activo: false, visible: false, inicio: 0, visibleDesde: 0 })
    const enCurso = iniciarOcupado(1000)
    assert.equal(enCurso.activo, true)
    assert.equal(enCurso.visible, false)
    assert.equal(enCurso.inicio, 1000)
    assert.equal(estaOcupado(enCurso), true)
  })

  it('debeMostrarSpinner solo pasó el retraso y sigue activo', () => {
    const enCurso = iniciarOcupado(0)
    assert.equal(debeMostrarSpinner(enCurso, RETRASO_OCUPADO_MS - 1), false)
    assert.equal(debeMostrarSpinner(enCurso, RETRASO_OCUPADO_MS), true)
    // Ya terminó: nunca se muestra después.
    assert.equal(debeMostrarSpinner(terminarOcupado(enCurso), 99999), false)
  })

  it('mostrarOcupado es idempotente y solo con acción activa', () => {
    const enCurso = iniciarOcupado(0)
    const visible = mostrarOcupado(enCurso, 400)
    assert.equal(visible.visible, true)
    assert.equal(visible.visibleDesde, 400)
    // Segunda vez: no reinicia el contador.
    assert.equal(mostrarOcupado(visible, 900).visibleDesde, 400)
    // Sobre algo terminado: no hace nada.
    const terminado = terminarOcupado(enCurso)
    assert.equal(mostrarOcupado(terminado, 400), terminado)
  })

  it('no se puede reiniciar hasta cumplir el mínimo visible', () => {
    const visible = mostrarOcupado(iniciarOcupado(0), 100)
    // La acción sigue activa: todavía no.
    assert.equal(puedeReiniciar(visible, 10_000), false)
    const terminado = terminarOcupado(visible)
    assert.equal(puedeReiniciar(terminado, 100 + MIN_VISIBLE_OCUPADO_MS - 1), false)
    assert.equal(puedeReiniciar(terminado, 100 + MIN_VISIBLE_OCUPADO_MS), true)
  })

  it('si el spinner nunca se vio, se reinicia enseguida', () => {
    const terminado = terminarOcupado(iniciarOcupado(0))
    assert.equal(puedeReiniciar(terminado, 50), true)
    assert.equal(esperaParaReiniciar(terminado, 50), 0)
  })

  it('esperaParaReiniciar cuenta lo que falta del mínimo', () => {
    const visible = mostrarOcupado(iniciarOcupado(0), 100)
    const terminado = terminarOcupado(visible)
    assert.equal(esperaParaReiniciar(terminado, 100), MIN_VISIBLE_OCUPADO_MS)
    assert.equal(esperaParaReiniciar(terminado, 300), MIN_VISIBLE_OCUPADO_MS - 200)
    assert.equal(esperaParaReiniciar(terminado, 10_000), 0)
  })

  it('estaOcupado es true mientras está activo o visible (cola del mínimo)', () => {
    const visible = mostrarOcupado(iniciarOcupado(0), 100)
    const terminado = terminarOcupado(visible)
    assert.equal(estaOcupado(visible), true)
    assert.equal(estaOcupado(terminado), true)
    assert.equal(estaOcupado(OCUPADO_INICIAL), false)
  })

  it('retrasoDe: 0 para acciones inmediatas (PDF, BCV, reportes)', () => {
    assert.equal(retrasoDe(false), RETRASO_OCUPADO_MS)
    assert.equal(retrasoDe(true), 0)
  })
})

describe('barra de progreso de carga', () => {
  it('debeMostrarCarga respeta el retraso', () => {
    assert.equal(debeMostrarCarga(RETRASO_CARGA_MS - 1), false)
    assert.equal(debeMostrarCarga(RETRASO_CARGA_MS), true)
    assert.equal(debeMostrarCarga(0, 0), true)
  })

  it('las constantes de tiempo son las esperadas', () => {
    assert.equal(RETRASO_OCUPADO_MS, 400)
    assert.equal(MIN_VISIBLE_OCUPADO_MS, 500)
    assert.equal(DURACION_EXITO_MS, 1000)
    assert.equal(RETRASO_CARGA_MS, 500)
  })
})
