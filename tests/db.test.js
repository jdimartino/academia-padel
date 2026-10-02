/*
 * Pruebas de la reserva sin solapamientos contra el emulador de Firestore.
 *
 * Corre el MISMO código de src/firebase/db.js que usa la app, pero con la
 * instancia del emulador y un cliente autenticado como administrador, de modo
 * que las Security Rules también participan.
 *
 *   npm run test:db
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, describe, it } from 'node:test'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc } from 'firebase/firestore'
import {
  MINUTOS_BLOQUE,
  SolapamientoError,
  bloquesDeClase,
  cancelarClase,
  crearClase,
  getClase,
} from '../src/firebase/db.js'

const PROJECT_ID = 'academia-padel-jdm'
const T1 = 't1'
const ADMIN = 'uid-admin-t1'
const ALUMNO = 'uid-alumno-t1'
const FECHA = '2026-10-05'

let env
let adminDb
let alumnoDb

const clase = (extra = {}) => ({
  sedeId: 'traki',
  sedeNombre: 'Traki',
  canchaId: 'c1',
  profesorId: 'p1',
  profesorNombre: 'Pablo Profesor',
  fecha: FECHA,
  horaInicio: '18:00',
  horaFin: '19:30',
  cupo: 4,
  alumnos: ['a1'],
  alumnoNombres: ['Aldo Adulto'],
  ...extra,
})

/** Reserva como administrador y devuelve el resultado de crearClase. */
const reservar = (extra) => crearClase(adminDb, T1, clase(extra), { uid: ADMIN })

/** El bloque existe o no, leído con el cliente admin. */
const bloque = (bloqueId) => getDoc(doc(adminDb, 'academias', T1, 'bloques', bloqueId))

async function sembrarBase(context) {
  const db = context.firestore()
  await db.doc(`academias/${T1}/miembros/${ADMIN}`).set({
    uid: ADMIN,
    rol: 'administrador',
    activo: true,
    nombre: 'Admin',
  })
  await db.doc(`academias/${T1}/miembros/${ALUMNO}`).set({
    uid: ALUMNO,
    rol: 'alumno_adulto',
    activo: true,
    nombre: 'Alumno',
    alumnoId: 'a1',
  })
  await db.doc(`academias/${T1}/sedes/traki`).set({ nombre: 'Traki', activa: true })
  await db.doc(`academias/${T1}/sedes/traki/canchas/c1`).set({ nombre: 'Cancha 1', activa: true })
  await db.doc(`academias/${T1}/profesores/p1`).set({ nombre: 'Pablo', activo: true })
  await db.doc(`academias/${T1}/alumnos/a1`).set({ nombre: 'Aldo Adulto', activo: true })
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
  await env.withSecurityRulesDisabled(sembrarBase)
  adminDb = env.authenticatedContext(ADMIN).firestore()
  alumnoDb = env.authenticatedContext(ALUMNO).firestore()
})

after(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(sembrarBase)
})

describe('ids deterministas', () => {
  it('una clase de 90 minutos ocupa 3 bloques de cancha + 3 de profesor', () => {
    const bloques = bloquesDeClase(clase())
    assert.equal(bloques.length, 6)
    assert.deepEqual(
      bloques.filter((b) => b.data.tipo === 'cancha').map((b) => b.id),
      [`traki_c1_${FECHA}_1800`, `traki_c1_${FECHA}_1830`, `traki_c1_${FECHA}_1900`],
    )
    assert.deepEqual(
      bloques.filter((b) => b.data.tipo === 'profesor').map((b) => b.id),
      [`prof_p1_${FECHA}_1800`, `prof_p1_${FECHA}_1830`, `prof_p1_${FECHA}_1900`],
    )
  })

  it('la granularidad es de 30 minutos', () => {
    assert.equal(MINUTOS_BLOQUE, 30)
  })
})

describe('crearClase', () => {
  it('horario libre → ALLOW: crea la clase y sus 6 bloques', async () => {
    const { claseId, bloques } = await reservar()

    const creada = await getClase(adminDb, T1, claseId)
    assert.equal(creada.estado, 'reservada')
    assert.equal(creada.tipo, 'variable')
    assert.deepEqual(creada.bloques, bloques)

    for (const bloqueId of bloques) {
      const snap = await bloque(bloqueId)
      assert.ok(snap.exists(), `debería existir el bloque ${bloqueId}`)
      assert.equal(snap.data().claseId, claseId)
      assert.equal(snap.data().fecha, FECHA)
    }
  })

  it('solapamiento EXACTO (misma cancha, mismo profesor, mismo horario) → DENY', async () => {
    await reservar()
    await assert.rejects(
      () => reservar(),
      (error) => {
        assert.ok(error instanceof SolapamientoError, `esperaba SolapamientoError, llegó ${error.name}`)
        assert.equal(error.bloque.data.tipo, 'cancha')
        assert.equal(error.bloque.id, `traki_c1_${FECHA}_1800`)
        return true
      },
    )
  })

  it('solapamiento PARCIAL (empieza antes de que termine la otra y sigue después) → DENY', async () => {
    await reservar() // 18:00-19:30
    await assert.rejects(() => reservar({ horaInicio: '19:00', horaFin: '20:00' }), SolapamientoError)
  })

  it('hora de inicio fuera de la grilla de 30 min → DENY (si no, se escaparía del bloqueo)', async () => {
    await assert.rejects(() => reservar({ horaInicio: '19:15', horaFin: '20:15' }), /múltiplo de 30 minutos/)
  })

  it('solapamiento con el mismo horario pero otro profesor → DENY (la cancha manda)', async () => {
    await reservar()
    await assert.rejects(() => reservar({ profesorId: 'p2' }), SolapamientoError)
  })

  it('solapamiento a otro horario pero con el mismo profesor → DENY (el profesor manda)', async () => {
    await reservar()
    await assert.rejects(
      () => reservar({ canchaId: 'c2', horaInicio: '19:00', horaFin: '20:30' }),
      SolapamientoError,
    )
  })

  it('horario ADYACENTE (empieza justo al terminar) → ALLOW', async () => {
    await reservar()
    const segunda = await reservar({ horaInicio: '19:30', horaFin: '21:00' })
    assert.ok(segunda.claseId)
  })

  it('misma cancha y misma franja pero otro día → ALLOW', async () => {
    await reservar()
    assert.ok((await reservar({ fecha: '2026-10-06' })).claseId)
  })

  it('misma franja, otra cancha y otro profesor → ALLOW', async () => {
    await reservar()
    assert.ok((await reservar({ canchaId: 'c2', profesorId: 'p2' })).claseId)
  })

  it('duración que no es múltiplo de 30 → DENY antes de escribir nada', async () => {
    await assert.rejects(
      () => reservar({ horaInicio: '18:00', horaFin: '18:45' }),
      /múltiplo de 30 minutos/,
    )
  })

  it('alumno_adulto intenta reservar → DENY por las reglas y no queda nada escrito', async () => {
    await assert.rejects(() => crearClase(alumnoDb, T1, clase(), { uid: ALUMNO }))
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), false)
  })
})

describe('cancelarClase', () => {
  it('cancelar borra los bloques y vuelve a liberar el horario', async () => {
    const { claseId, bloques } = await reservar()

    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })

    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'cancelada')
    for (const bloqueId of bloques) {
      assert.equal((await bloque(bloqueId)).exists(), false, `el bloque ${bloqueId} debería haberse borrado`)
    }

    // El horario vuelve a estar disponible.
    assert.ok((await reservar()).claseId)
  })

  it('cancelar dos veces no falla (idempotente)', async () => {
    const { claseId } = await reservar()
    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })
    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'cancelada')
  })

  it('cancelar una clase inexistente → DENY', async () => {
    await assert.rejects(() => cancelarClase(adminDb, T1, 'no-existe', { uid: ADMIN }), /no existe/)
  })
})

describe('carreras', () => {
  it('dos reservas simultáneas del MISMO horario → solo una gana', async () => {
    const intentos = await Promise.allSettled([reservar(), reservar()])

    const ganadoras = intentos.filter((r) => r.status === 'fulfilled')
    const perdedoras = intentos.filter((r) => r.status === 'rejected')
    assert.equal(ganadoras.length, 1, 'exactamente una reserva debe ganar')
    assert.equal(perdedoras.length, 1)
    assert.ok(perdedoras[0].reason instanceof SolapamientoError)

    const creada = await getClase(adminDb, T1, ganadoras[0].value.claseId)
    assert.equal(creada.bloques.length, 6)
  })
})