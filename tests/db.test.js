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
import { doc, getDoc, setDoc } from 'firebase/firestore'
import {
  MINUTOS_BLOQUE,
  SolapamientoError,
  bloquesDeClase,
  cancelarClase,
  crearClase,
  getCanchas,
  getClase,
  getClasesDeSedePorFecha,
  getProfesores,
  getSedes,
  registrarAsistencia,
  reprogramarClase,
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

  it('mismo profesor en DOS canchas al MISMO horario → DENY por el bloque de profesor', async () => {
    await reservar() // p1 en c1, 18:00-19:30
    await assert.rejects(
      () => reservar({ canchaId: 'c2' }),
      (error) => {
        assert.ok(error instanceof SolapamientoError)
        assert.equal(error.bloque.data.tipo, 'profesor')
        assert.equal(error.bloque.data.profesorId, 'p1')
        return true
      },
    )
    // La cancha c2 sigue libre: no quedó nada escrito.
    assert.equal((await bloque(`traki_c2_${FECHA}_1800`)).exists(), false)
  })

  it('mismo profesor en bloques ADYACENTES y otra cancha → ALLOW', async () => {
    await reservar() // p1, 18:00-19:30
    const segunda = await reservar({ canchaId: 'c2', horaInicio: '19:30', horaFin: '21:00' })
    assert.ok(segunda.claseId)
  })

  it('categoria inválida → DENY antes de escribir nada', async () => {
    await assert.rejects(() => reservar({ categoria: '8a' }), /Categoría inválida/)
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), false)
  })

  it('categoria válida se guarda en la clase', async () => {
    const { claseId } = await reservar({ categoria: '3a' })
    assert.equal((await getClase(adminDb, T1, claseId)).categoria, '3a')
  })

  it('sin categoria, la clase queda con categoria null', async () => {
    const { claseId } = await reservar()
    assert.equal((await getClase(adminDb, T1, claseId)).categoria, null)
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

describe('lecturas de agenda', () => {
  it('getSedes devuelve las sedes del tenant', async () => {
    const sedes = await getSedes(adminDb, T1)
    assert.equal(sedes.length, 1)
    assert.equal(sedes[0].id, 'traki')
  })

  it('getCanchas devuelve las canchas de la sede', async () => {
    const canchas = await getCanchas(adminDb, T1, 'traki')
    assert.deepEqual(
      canchas.map((c) => c.id),
      ['c1'],
    )
  })

  it('getProfesores devuelve solo los profesores activos', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'profesores', 'p2'), {
      nombre: 'Inactivo',
      activo: false,
    })
    const profesores = await getProfesores(adminDb, T1)
    assert.deepEqual(
      profesores.map((p) => p.id),
      ['p1'],
    )
  })

  it('getClasesDeSedePorFecha acota por sede + fecha', async () => {
    await reservar() // traki / c1 / 18:00, FECHA

    const delDia = await getClasesDeSedePorFecha(adminDb, T1, 'traki', FECHA)
    assert.equal(delDia.length, 1)
    assert.equal(delDia[0].horaInicio, '18:00')

    assert.equal((await getClasesDeSedePorFecha(adminDb, T1, 'traki', '2026-10-06')).length, 0)
    assert.equal((await getClasesDeSedePorFecha(adminDb, T1, 'boleita', FECHA)).length, 0)
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

  it('cancelar libera también los bloques del profesor', async () => {
    const { claseId, bloques } = await reservar()
    const deProfesor = bloques.filter((id) => id.startsWith('prof_'))
    assert.equal(deProfesor.length, 3)

    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })

    for (const bloqueId of deProfesor) {
      assert.equal((await bloque(bloqueId)).exists(), false, `debería liberarse ${bloqueId}`)
    }
    // El profesor vuelve a estar disponible en la otra cancha.
    assert.ok((await reservar({ canchaId: 'c2' })).claseId)
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

describe('reprogramarClase', () => {
  it('mueve la clase, libera los bloques viejos y ocupa los nuevos', async () => {
    const { claseId, bloques } = await reservar() // c1 / p1 / 18:00-19:30

    await reprogramarClase(
      adminDb,
      T1,
      claseId,
      { canchaId: 'c2', fecha: '2026-10-06' },
      { uid: ADMIN },
    )

    const movida = await getClase(adminDb, T1, claseId)
    assert.equal(movida.canchaId, 'c2')
    assert.equal(movida.fecha, '2026-10-06')

    for (const bloqueId of bloques) {
      assert.equal((await bloque(bloqueId)).exists(), false, `bloque viejo ${bloqueId}`)
    }
    for (const bloqueId of movida.bloques) {
      assert.ok((await bloque(bloqueId)).exists(), `bloque nuevo ${bloqueId}`)
    }
    assert.equal((await bloque('traki_c2_2026-10-06_1800')).exists(), true)
  })

  it('si se superpone con otra clase, falla y deja la original intacta', async () => {
    const { claseId, bloques } = await reservar() // c1 / p1
    await reservar({ canchaId: 'c2', profesorId: 'p2' }) // misma franja en c2

    await assert.rejects(
      () => reprogramarClase(adminDb, T1, claseId, { canchaId: 'c2' }, { uid: ADMIN }),
      SolapamientoError,
    )

    const original = await getClase(adminDb, T1, claseId)
    assert.equal(original.canchaId, 'c1')
    assert.deepEqual(original.bloques, bloques)
    for (const bloqueId of bloques) {
      assert.ok((await bloque(bloqueId)).exists())
    }
  })

  it('mover una clase sobre sus propios bloques → ALLOW (no se choca consigo misma)', async () => {
    const { claseId } = await reservar() // c1 / p1 / 18:00-19:30

    // Cambia solo el profesor: los bloques de cancha siguen siendo de la clase.
    await reprogramarClase(adminDb, T1, claseId, { profesorId: 'p2' }, { uid: ADMIN })

    const movida = await getClase(adminDb, T1, claseId)
    assert.equal(movida.profesorId, 'p2')
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), true)
    assert.equal((await bloque(`prof_p2_${FECHA}_1800`)).exists(), true)
    assert.equal((await bloque(`prof_p1_${FECHA}_1800`)).exists(), false)
  })

  it('reprogramar una clase inexistente → DENY', async () => {
    await assert.rejects(
      () => reprogramarClase(adminDb, T1, 'no-existe', { canchaId: 'c2' }, { uid: ADMIN }),
      /no existe/,
    )
  })
})

describe('registrarAsistencia', () => {
  it('guarda la asistencia embebida y pasa la clase a pendiente_cobro', async () => {
    const { claseId } = await reservar()

    await registrarAsistencia(
      adminDb,
      T1,
      claseId,
      [
        { alumnoId: 'a1', estado: 'presente' },
        { alumnoId: 'a2', estado: 'ausente', motivo: 'enfermedad' },
      ],
      { uid: ADMIN },
    )

    const clase = await getClase(adminDb, T1, claseId)
    assert.equal(clase.estado, 'pendiente_cobro')
    assert.equal(clase.asistencias.length, 2)
    assert.equal(clase.asistencias[0].estado, 'presente')
    assert.equal(clase.asistencias[0].registradoPor, ADMIN)
    assert.ok(clase.asistencias[0].registradoEn)
    assert.equal(clase.asistencias[1].motivo, 'enfermedad')
  })

  it('un estado de asistencia inválido → DENY', async () => {
    const { claseId } = await reservar()
    await assert.rejects(
      () => registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'tarde' }], { uid: ADMIN }),
      /Estado de asistencia inválido/,
    )
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'reservada')
  })

  it('una clase ya cerrada no se puede cerrar dos veces', async () => {
    const { claseId } = await reservar()
    await registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], {
      uid: ADMIN,
    })
    await assert.rejects(
      () => registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], { uid: ADMIN }),
      /ya está cerrada/,
    )
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