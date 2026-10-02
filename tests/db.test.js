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
  actualizarAlumno,
  asignarAlumnos,
  bloquesDeClase,
  buscarAlumnos,
  cancelarClase,
  crearAlumno,
  crearClase,
  crearProfesor,
  getAlumno,
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

  // Fichas: a1 y a2 activas, a3 inactiva (nunca asignable). `nombreBusqueda`
  // es el campo normalizado (sin tildes ni mayúsculas) que usa buscarAlumnos.
  await db.doc(`academias/${T1}/alumnos/a1`).set({
    tipo: 'adulto',
    nombre: 'Aldo Adulto',
    nombreBusqueda: 'aldo adulto',
    avisosActivos: true,
    activo: true,
  })
  await db.doc(`academias/${T1}/alumnos/a2`).set({
    tipo: 'menor',
    nombre: 'Marta Menor',
    nombreBusqueda: 'marta menor',
    avisosActivos: true,
    tutor: { nombre: 'Teresa Tutora' },
    activo: true,
  })
  await db.doc(`academias/${T1}/alumnos/a3`).set({
    tipo: 'adulto',
    nombre: 'Nadia Inactiva',
    nombreBusqueda: 'nadia inactiva',
    activo: false,
  })
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

describe('asignación de alumnos', () => {
  it('crearClase valida y denormaliza alumnoNombres', async () => {
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'] })
    const creada = await getClase(adminDb, T1, claseId)
    assert.deepEqual(creada.alumnos, ['a1', 'a2'])
    assert.deepEqual(creada.alumnoNombres, ['Aldo Adulto', 'Marta Menor'])
  })

  it('crearClase con más alumnos que el cupo → DENY y no ocupa bloques', async () => {
    await assert.rejects(() => reservar({ cupo: 1, alumnos: ['a1', 'a2'] }), /cupo/)
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), false)
  })

  it('crearClase con un alumno inactivo → DENY', async () => {
    await assert.rejects(() => reservar({ alumnos: ['a3'] }), /no está activo/)
  })

  it('crearClase con un alumno inexistente → DENY', async () => {
    await assert.rejects(() => reservar({ alumnos: ['nope'] }), /no existe/)
  })

  it('crearClase con alumnos duplicados → DENY', async () => {
    await assert.rejects(() => reservar({ alumnos: ['a1', 'a1'] }), /duplicad/)
  })

  it('asignarAlumnos reemplaza la lista de una clase reservada', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await asignarAlumnos(adminDb, T1, claseId, ['a2'], { uid: ADMIN })
    const clase = await getClase(adminDb, T1, claseId)
    assert.deepEqual(clase.alumnos, ['a2'])
    assert.deepEqual(clase.alumnoNombres, ['Marta Menor'])
  })

  it('asignarAlumnos fuera del cupo → DENY', async () => {
    const { claseId } = await reservar({ cupo: 1, alumnos: ['a1'] })
    await assert.rejects(
      () => asignarAlumnos(adminDb, T1, claseId, ['a1', 'a2'], { uid: ADMIN }),
      /cupo/,
    )
  })

  it('asignarAlumnos con un alumno inactivo → DENY', async () => {
    const { claseId } = await reservar({ alumnos: [] })
    await assert.rejects(() => asignarAlumnos(adminDb, T1, claseId, ['a3'], { uid: ADMIN }), /no está activo/)
  })

  it('asignarAlumnos en una clase cerrada → DENY', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], {
      uid: ADMIN,
    })
    await assert.rejects(
      () => asignarAlumnos(adminDb, T1, claseId, ['a2'], { uid: ADMIN }),
      /reservada/,
    )
  })

  it('reprogramarClase puede cambiar los alumnos (mismas validaciones)', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await reprogramarClase(adminDb, T1, claseId, { alumnos: ['a2'] }, { uid: ADMIN })
    const clase = await getClase(adminDb, T1, claseId)
    assert.deepEqual(clase.alumnos, ['a2'])
    assert.deepEqual(clase.alumnoNombres, ['Marta Menor'])
  })

  it('reprogramarClase no puede bajar el cupo por debajo de los asignados', async () => {
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'] })
    await assert.rejects(
      () => reprogramarClase(adminDb, T1, claseId, { cupo: 1 }, { uid: ADMIN }),
      /cupo/,
    )
  })
})

describe('buscarAlumnos', () => {
  it('encuentra por prefijo, sin tildes ni mayúsculas', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'alumnos', 'a4'), {
      tipo: 'adulto',
      nombre: 'Álvaro Ávila',
      nombreBusqueda: 'alvaro avila',
      activo: true,
    })
    const sinTilde = await buscarAlumnos(adminDb, T1, 'alv')
    assert.deepEqual(
      sinTilde.map((a) => a.id),
      ['a4'],
    )
    const conTilde = await buscarAlumnos(adminDb, T1, 'ÁLV')
    assert.deepEqual(
      conTilde.map((a) => a.id),
      ['a4'],
    )
  })

  it('no devuelve alumnos inactivos', async () => {
    assert.equal((await buscarAlumnos(adminDb, T1, 'nadia')).length, 0)
  })

  it('texto vacío no lee nada', async () => {
    assert.deepEqual(await buscarAlumnos(adminDb, T1, '   '), [])
  })

  it('acota a 10 resultados (límite por defecto)', async () => {
    for (let i = 0; i < 12; i += 1) {
      await setDoc(doc(adminDb, 'academias', T1, 'alumnos', `z${i}`), {
        tipo: 'adulto',
        nombre: `Zeta ${i}`,
        nombreBusqueda: `zeta ${i}`,
        activo: true,
      })
    }
    assert.equal((await buscarAlumnos(adminDb, T1, 'zeta')).length, 10)
    assert.equal((await buscarAlumnos(adminDb, T1, 'zeta', { limite: 3 })).length, 3)
  })
})

describe('fichas', () => {
  it('crearAlumno normaliza el nombre, exige tutor en menores y arranca activo', async () => {
    const { alumnoId } = await crearAlumno(
      adminDb,
      T1,
      { nombre: 'Ángel Niño', tipo: 'menor', tutor: { nombre: 'Tutor Uno' } },
      { uid: ADMIN },
    )
    const ficha = await getAlumno(adminDb, T1, alumnoId)
    assert.equal(ficha.nombreBusqueda, 'angel nino')
    assert.equal(ficha.avisosActivos, true)
    assert.equal(ficha.activo, true)
    assert.equal(ficha.tutor.nombre, 'Tutor Uno')

    await assert.rejects(
      () => crearAlumno(adminDb, T1, { nombre: 'Sin Tutor', tipo: 'menor' }, { uid: ADMIN }),
      /tutor/,
    )
  })

  it('actualizarAlumno hace soft delete con activo:false y lo saca del buscador', async () => {
    await actualizarAlumno(adminDb, T1, 'a1', { activo: false }, { uid: ADMIN })
    assert.equal((await getAlumno(adminDb, T1, 'a1')).activo, false)
    assert.equal((await buscarAlumnos(adminDb, T1, 'aldo')).length, 0)
  })

  it('crearProfesor no escribe tarifa por hora', async () => {
    const { profesorId } = await crearProfesor(
      adminDb,
      T1,
      { nombre: 'Paola Profesora', telefono: '+58 412 000 0002' },
      { uid: ADMIN },
    )
    const snap = await getDoc(doc(adminDb, 'academias', T1, 'profesores', profesorId))
    assert.equal(snap.data().tarifaHoraCentavos, undefined)
    assert.equal(snap.data().activo, true)
  })
})

describe('registrarAsistencia', () => {
  it('acepta ausente_avisada y ausente_sin_aviso y guarda el motivo', async () => {
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'] })
    await registrarAsistencia(
      adminDb,
      T1,
      claseId,
      [
        { alumnoId: 'a1', estado: 'ausente_avisada', motivo: 'viaje' },
        { alumnoId: 'a2', estado: 'ausente_sin_aviso' },
      ],
      { uid: ADMIN },
    )
    const clase = await getClase(adminDb, T1, claseId)
    assert.equal(clase.estado, 'pendiente_cobro')
    assert.equal(clase.asistencias[0].estado, 'ausente_avisada')
    assert.equal(clase.asistencias[0].motivo, 'viaje')
    assert.equal(clase.asistencias[0].registradoPor, ADMIN)
    assert.ok(clase.asistencias[0].registradoEn)
    assert.equal(clase.asistencias[1].estado, 'ausente_sin_aviso')
    assert.equal(clase.asistencias[1].motivo, null)
  })

  it('un estado de asistencia inválido (el viejo "ausente") → DENY', async () => {
    const { claseId } = await reservar()
    await assert.rejects(
      () => registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'ausente' }], { uid: ADMIN }),
      /Estado de asistencia inválido/,
    )
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'reservada')
  })

  it('exige una entrada por cada alumno asignado (falta uno) → DENY', async () => {
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'] })
    await assert.rejects(
      () => registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], { uid: ADMIN }),
      /exactamente una entrada/,
    )
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'reservada')
  })

  it('rechaza una entrada de un alumno que no está en la clase → DENY', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await assert.rejects(
      () =>
        registrarAsistencia(
          adminDb,
          T1,
          claseId,
          [
            { alumnoId: 'a1', estado: 'presente' },
            { alumnoId: 'a2', estado: 'presente' },
          ],
          { uid: ADMIN },
        ),
      /exactamente una entrada/,
    )
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