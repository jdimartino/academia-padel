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
  ClaseInvalidaError,
  CobroInvalidoError,
  FichaInvalidaError,
  SedeInvalidaError,
  TasaInvalidaError,
  actualizarAlumno,
  actualizarPerfilCobro,
  actualizarPlanAlumno,
  actualizarProfesor,
  anularCredito,
  anularCierre,
  asignarAlumnos,
  bloquesDeClase,
  buscarAlumnos,
  cambiarActivaCancha,
  cambiarActivaPerfilCobro,
  cancelarClase,
  cerrarClase,
  comprarCredito,
  crearAlumno,
  crearCancha,
  crearClase,
  crearPerfilCobro,
  crearPlanAlumno,
  crearProfesor,
  crearSede,
  desactivarPlanAlumno,
  desactivarSede,
  fechaHoyLocal,
  getAlumno,
  getCanchas,
  getClase,
  getClasesDeSedePorFecha,
  getCierreDeClase,
  getCreditoAlumno,
  getParametros,
  getPlanActivo,
  getProfesores,
  getSede,
  getSedes,
  getTasas,
  horarioDeSede,
  horarioDelDia,
  leerTasasDoc,
  listarAlumnos,
  listarCanchas,
  listarCargosPendientes,
  listarPagosProfesorPendientes,
  listarPerfilesCobro,
  listarPlanesAlumno,
  listarSedes,
  marcarCargoPagado,
  marcarPagoProfesorPagado,
  nombreCompleto,
  nombreDeCancha,
  reactivarSede,
  registrarAsistencia,
  renombrarCancha,
  renombrarSede,
  reprogramarClase,
  setParametros,
  setSedeHorario,
  setTarifasSede,
  setTasas,
  sugerirDescuentoHermanos,
  validarCobro,
  validarHorario,
  validarParametros,
  validarTarifas,
  validarTasas,
  cambiarActivoProfesor,
  crearAccesoProfesor,
  getClasesDeProfesor,
  getMisAccesosProfesor,
  getUsuarioProfesor,
  guardarAsistenciaProfesor,
  listarUsuariosProfesor,
} from '../src/firebase/db.js'
import { PARAMETROS_DEFAULT } from '../src/lib/cobros.js'

const PROJECT_ID = 'academia-padel-jdm'
const T1 = 't1'
const ADMIN = 'uid-admin-t1'
const ALUMNO = 'uid-alumno-t1'
/** Profesor con ACCESO (Fase 7): su doc vive en `usuarios/{uid}`, no en `miembros`. */
const PROFE = 'uid-prof-t1'
/*
 * Fecha de ensayo FUTURA: el "ahora" inyectado de las reservas queda fijo una
 * hora antes de las 18:00 locales (Caracas) de ese día, así la regla "no se
 * reserva en el pasado" nunca rompe la suite dependa de cuándo se corra.
 * 2026-11-15 es DOMINGO; 2026-11-14 sábado y 2026-11-16 lunes.
 */
const FECHA = '2026-11-15'
const AHORA_RESERVA = new Date(2026, 10, 15, 17, 0, 0)
/** Momento local después de que termina la clase de ensayo (horaFin 19:00). */
const DESPUES_DEL_FIN = new Date(2026, 10, 15, 20, 0, 0)

/** Fechas de ensayo con día de la semana conocido (0 = lunes en el horario). */
const LUNES = '2026-11-16'
const SABADO = '2026-11-14'
const DOMINGO = FECHA

/** Franja de un día en MINUTOS, como la guarda una sede. */
const franja = (apertura, cierre) => ({ apertura, cierre })

/** Franja default 07:00-23:00 en minutos. */
const FRANJA_DEFAULT = franja(7 * 60, 23 * 60)

/**
 * Horario semanal completo: todos los días con `abierto` (07:00-23:00 por
 * defecto) salvo los días que vengan en `porDia` (una franja o `null` = cerrado).
 */
function semana(porDia = {}, abierto = FRANJA_DEFAULT) {
  return Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((dia) => [dia, dia in porDia ? porDia[dia] : { ...abierto }]),
  )
}

let env
let adminDb
let alumnoDb
let profeDb

/** Clase base de ensayo: 18:00-19:00 (una hora en punto, 1 h) con a1. */
function clase(extra = {}) {
  return {
    sedeId: 'traki',
    sedeNombre: 'Traki',
    canchaId: 'c1',
    profesorId: 'p1',
    profesorNombre: 'Pablo Profesor',
    fecha: FECHA,
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 4,
    alumnos: ['a1'],
    alumnoNombres: ['Aldo Adulto'],
    ...extra,
  }
}

/** Reserva como administrador y devuelve el resultado de crearClase. */
const reservar = (extra) =>
  crearClase(adminDb, T1, clase(extra), { uid: ADMIN, ahora: AHORA_RESERVA })

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
  await db.doc(`academias/${T1}/sedes/traki/canchas/c2`).set({ nombre: 'Cancha 2', activa: true })
  // p1 y p2 dictan en traki; p3 solo en boleita (sirve para el rechazo
  // "profesor no asignado a la sede").
  await db
    .doc(`academias/${T1}/profesores/p1`)
    .set({ nombre: 'Pablo', apellidos: 'Profesor', sedes: ['traki'], activo: true })
  await db
    .doc(`academias/${T1}/profesores/p2`)
    .set({ nombre: 'Pedro', apellidos: 'Pérez', sedes: ['traki', 'boleita'], activo: true })
  await db
    .doc(`academias/${T1}/profesores/p3`)
    .set({ nombre: 'Sofía', apellidos: 'Solo Boleita', sedes: ['boleita'], activo: true })

  // Fichas: a1 y a2 activas, a3 inactiva (nunca asignable). Los campos
  // normalizados del buscador son `busquedaNombre` ("nombre apellidos") y
  // `busquedaApellido` ("apellidos nombre").
  await db.doc(`academias/${T1}/alumnos/a1`).set({
    tipo: 'adulto',
    nombre: 'Aldo',
    apellidos: 'Adulto',
    busquedaNombre: 'aldo adulto',
    busquedaApellido: 'adulto aldo',
    fechaIngreso: '2026-01-01',
    avisosActivos: true,
    activo: true,
  })
  await db.doc(`academias/${T1}/alumnos/a2`).set({
    tipo: 'menor',
    nombre: 'Marta',
    apellidos: 'Menor',
    busquedaNombre: 'marta menor',
    busquedaApellido: 'menor marta',
    fechaIngreso: '2026-01-01',
    avisosActivos: true,
    representante: { nombre: 'Teresa', apellidos: 'Representante', email: null, telefono: null },
    activo: true,
  })
  await db.doc(`academias/${T1}/alumnos/a3`).set({
    tipo: 'adulto',
    nombre: 'Nadia',
    apellidos: 'Inactiva',
    busquedaNombre: 'nadia inactiva',
    busquedaApellido: 'inactiva nadia',
    activo: false,
  })

  // Acceso de profesor (Fase 7): doc en `usuarios`, vinculado a la ficha p1.
  await db.doc(`academias/${T1}/usuarios/${PROFE}`).set({
    uid: PROFE,
    rol: 'profesor',
    profesorId: 'p1',
    email: 'profe@t1.test',
    activo: true,
    creadoEn: null,
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
  profeDb = env.authenticatedContext(PROFE).firestore()
})

after(async () => {
  await env.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(sembrarBase)
})

describe('ids deterministas', () => {
  it('una clase de 2 horas ocupa 4 bloques de cancha + 4 de profesor (1 por media hora)', () => {
    const bloques = bloquesDeClase(clase({ horaFin: '20:00' }))
    assert.equal(bloques.length, 8)
    assert.deepEqual(
      bloques.filter((b) => b.data.tipo === 'cancha').map((b) => b.id),
      [
        `traki_c1_${FECHA}_1800`,
        `traki_c1_${FECHA}_1830`,
        `traki_c1_${FECHA}_1900`,
        `traki_c1_${FECHA}_1930`,
      ],
    )
    assert.deepEqual(
      bloques.filter((b) => b.data.tipo === 'profesor').map((b) => b.id),
      [
        `prof_p1_${FECHA}_1800`,
        `prof_p1_${FECHA}_1830`,
        `prof_p1_${FECHA}_1900`,
        `prof_p1_${FECHA}_1930`,
      ],
    )
  })

  it('una clase de 90 min que arranca a y media ocupa 3 bloques por recurso', () => {
    const bloques = bloquesDeClase(clase({ horaInicio: '18:30', horaFin: '20:00' }))
    assert.equal(bloques.length, 6)
    assert.deepEqual(
      bloques.filter((b) => b.data.tipo === 'cancha').map((b) => b.id),
      [`traki_c1_${FECHA}_1830`, `traki_c1_${FECHA}_1900`, `traki_c1_${FECHA}_1930`],
    )
  })

  it('la granularidad es de 30 minutos', () => {
    assert.equal(MINUTOS_BLOQUE, 30)
  })

  it('acepta los inicios en punto y a y media', () => {
    assert.equal(bloquesDeClase(clase({ horaInicio: '07:00', horaFin: '08:00' })).length, 4)
    assert.equal(bloquesDeClase(clase({ horaInicio: '07:30', horaFin: '08:30' })).length, 4)
  })

  it('rechaza un inicio que no cae en la grilla de 30 min (7:15)', () => {
    assert.throws(
      () => bloquesDeClase(clase({ horaInicio: '07:15', horaFin: '08:15' })),
      /media|múltiplo de 30/i,
    )
  })

  it('acepta las duraciones 60, 90 y 120', () => {
    assert.equal(bloquesDeClase(clase({ horaInicio: '18:00', horaFin: '19:00' })).length, 4)
    assert.equal(bloquesDeClase(clase({ horaInicio: '18:00', horaFin: '19:30' })).length, 6)
    assert.equal(bloquesDeClase(clase({ horaInicio: '18:00', horaFin: '20:00' })).length, 8)
  })

  it('rechaza las duraciones 45 y 150', () => {
    assert.throws(
      () => bloquesDeClase(clase({ horaInicio: '18:00', horaFin: '18:45' })),
      /duración|válida/i,
    )
    assert.throws(
      () => bloquesDeClase(clase({ horaInicio: '18:00', horaFin: '20:30' })),
      /duración|válida/i,
    )
  })
})

describe('crearClase', () => {
  it('horario libre → ALLOW: crea la clase y sus 4 bloques de 30 min', async () => {
    const { claseId, bloques } = await reservar()
    // 1 h = 2 bloques de cancha + 2 de profesor.
    assert.equal(bloques.length, 4)

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

  it('solapamiento PARCIAL (una clase de 2 h que arranca antes y pisa la de 1 h) → DENY', async () => {
    await reservar() // c1 / p1, 18:00-19:00
    await assert.rejects(
      () => reservar({ horaInicio: '17:00', horaFin: '19:00' }),
      SolapamientoError,
    )
  })

  it('franjas ADYACENTES (17:00-18:00 junto a 18:00-19:00) → ALLOW en la misma cancha', async () => {
    await reservar({ horaInicio: '17:00', horaFin: '18:00' })
    assert.ok((await reservar({ horaInicio: '18:00', horaFin: '19:00' })).claseId)
  })

  it('solapamiento 17:30-19:00 contra 18:00-19:00 → DENY (minutos reales, no bloques de hora)', async () => {
    // La clase larga arranca a y media: con el redondeo a la hora en punto de
    // antes, los bloques no se habrían cruzado.
    await reservar({ horaInicio: '17:30', horaFin: '19:00' })
    // Mismo profesor (p1) en otra cancha, en una franja que se pisa.
    await assert.rejects(
      () => reservar({ canchaId: 'c2', horaInicio: '18:00', horaFin: '19:00' }),
      SolapamientoError,
    )
  })

  it('borde exacto 17:30-19:00 contra 19:00-20:00 → ALLOW (no se solapan)', async () => {
    await reservar({ horaInicio: '17:30', horaFin: '19:00' })
    assert.ok(
      (
        await reservar({ canchaId: 'c2', profesorId: 'p2', horaInicio: '19:00', horaFin: '20:00' })
      ).claseId,
    )
  })

  it('solapamiento 17:00-18:30 contra 18:00-19:00 → DENY', async () => {
    await reservar({ horaInicio: '17:00', horaFin: '18:30' })
    await assert.rejects(
      () => reservar({ horaInicio: '18:00', horaFin: '19:00' }),
      SolapamientoError,
    )
  })

  it('una clase a y media libera solo sus propios bloques', async () => {
    // 18:30-20:00 ocupa 18:30, 19:00 y 19:30.
    await reservar({ horaInicio: '18:30', horaFin: '20:00' })
    // 18:00-19:00 pisa la clase larga en la misma cancha: no entra.
    await assert.rejects(
      () => reservar({ horaInicio: '18:00', horaFin: '19:00' }),
      SolapamientoError,
    )
    // 20:00-21:00 arranca justo cuando termina: entra.
    assert.ok(
      (
        await reservar({ canchaId: 'c2', profesorId: 'p2', horaInicio: '20:00', horaFin: '21:00' })
      ).claseId,
    )
  })

  it('hora de inicio a la media hora (19:30-20:30) → ALLOW y ocupa 2 bloques', async () => {
    const { bloques } = await reservar({ horaInicio: '19:30', horaFin: '20:30' })
    assert.deepEqual(bloques.filter((id) => id.startsWith('traki_')), [
      `traki_c1_${FECHA}_1930`,
      `traki_c1_${FECHA}_2000`,
    ])
  })

  it('hora de inicio en un cuarto de hora (19:15) → DENY (no cae en la grilla)', async () => {
    await assert.rejects(
      () => reservar({ horaInicio: '19:15', horaFin: '20:15' }),
      /media|múltiplo de 30/i,
    )
    assert.equal((await bloque(`traki_c1_${FECHA}_1900`)).exists(), false)
  })

  it('solapamiento con el mismo horario pero otro profesor → DENY (la cancha manda)', async () => {
    await reservar()
    await assert.rejects(() => reservar({ profesorId: 'p2' }), SolapamientoError)
  })

  it('solapamiento a otro horario pero con el mismo profesor → DENY (el profesor manda)', async () => {
    await reservar()
    await assert.rejects(
      () => reservar({ canchaId: 'c2', horaInicio: '18:00', horaFin: '20:00' }),
      SolapamientoError,
    )
  })

  it('mismo profesor en DOS canchas al MISMO horario → DENY por el bloque de profesor', async () => {
    await reservar() // p1 en c1, 18:00-19:00
    await assert.rejects(
      () => reservar({ canchaId: 'c2' }),
      (error) => {
        assert.ok(error instanceof SolapamientoError)
        assert.equal(error.bloque.data.tipo, 'profesor')
        assert.equal(error.bloque.data.profesorId, 'p1')
        return true
      },
    )
  })

  it('profesor liberado: en la misma franja se puede reservar en otra cancha', async () => {
    await reservar() // p1, 18:00-19:00
    const segunda = await reservar({ canchaId: 'c2', profesorId: 'p2' })
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
    const segunda = await reservar({ horaInicio: '19:00', horaFin: '21:00' })
    assert.ok(segunda.claseId)
  })

  it('misma cancha y misma franja pero otro día → ALLOW', async () => {
    await reservar()
    assert.ok((await reservar({ fecha: '2026-11-16' })).claseId)
  })

  it('misma franja, otra cancha y otro profesor → ALLOW', async () => {
    await reservar()
    assert.ok((await reservar({ canchaId: 'c2', profesorId: 'p2' })).claseId)
  })

  it('duración de 90 minutos (18:00-19:30) → ALLOW y ocupa 6 bloques', async () => {
    const { bloques } = await reservar({ horaInicio: '18:00', horaFin: '19:30' })
    // 1 h 30 = 3 bloques de cancha + 3 de profesor.
    assert.equal(bloques.length, 6)
  })

  it('duración de 45 minutos → DENY (no está entre las válidas)', async () => {
    await assert.rejects(
      () => reservar({ horaInicio: '18:00', horaFin: '18:45' }),
      /duración|60 min|válida/i,
    )
  })

  it('duración de 150 minutos → DENY (no está entre las válidas)', async () => {
    await assert.rejects(
      () => reservar({ horaInicio: '18:00', horaFin: '20:30' }),
      /duración|válida/i,
    )
  })

  it('alumno_adulto intenta reservar → DENY por las reglas y no queda nada escrito', async () => {
    await assert.rejects(() =>
      crearClase(alumnoDb, T1, clase(), { uid: ALUMNO, ahora: AHORA_RESERVA }),
    )
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), false)
  })

  it('clase sin ningún alumno → DENY (toda reserva exige al menos 1)', async () => {
    await assert.rejects(() => reservar({ alumnos: [] }), /al menos un alumno/i)
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), false)
  })

  it('2 horas: 18:00-20:00 → ALLOW y ocupa 8 bloques (4 por recurso)', async () => {
    const { bloques } = await reservar({ horaFin: '20:00' })
    assert.equal(bloques.length, 8)
  })

  it('inicio a las 22:00 con 1 h → ALLOW (termina 23:00)', async () => {
    assert.ok((await reservar({ horaInicio: '22:00', horaFin: '23:00' })).claseId)
  })

  it('inicio a las 22:00 con 2 h → DENY (terminaría 00:00)', async () => {
    await assert.rejects(
      () => reservar({ horaInicio: '22:00', horaFin: '24:00' }),
      /23:00|terminar|válida/i,
    )
  })

  it('inicio a las 21:00 con 2 h → ALLOW (termina 23:00)', async () => {
    assert.ok((await reservar({ horaInicio: '21:00', horaFin: '23:00' })).claseId)
  })

  it('inicio antes de las 07:00 → DENY', async () => {
    // El mensaje muestra la hora en 12 h ("7:00 AM"), aunque el dato sea 24 h.
    await assert.rejects(
      () => reservar({ horaInicio: '06:00', horaFin: '07:00' }),
      /7:00 AM|empezar antes/i,
    )
  })

  it('inicio en una hora del pasado (mismo día) → DENY', async () => {
    // El "ahora" inyectado es 17:00; una clase a las 16:00 ya empezó.
    await assert.rejects(
      () => reservar({ horaInicio: '16:00', horaFin: '17:00' }),
      /pasado|ya empezó|ya comenzó/i,
    )
  })

  it('inicio en un día pasado → DENY', async () => {
    await assert.rejects(
      () => reservar({ fecha: '2026-11-14' }),
      /pasado|ya empezó|ya comenzó/i,
    )
  })

  it('inicio exactamente en el "ahora" inyectado → ALLOW (el borde no es pasado)', async () => {
    assert.ok((await reservar({ horaInicio: '17:00', horaFin: '18:00' })).claseId)
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
    // c1 y c2 están sembradas en sembrarBase.
    assert.ok(canchas.some((c) => c.id === 'c1'), 'debe incluir c1')
    assert.ok(canchas.some((c) => c.id === 'c2'), 'debe incluir c2')
  })

  it('getProfesores devuelve solo los profesores activos', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'profesores', 'p2'), {
      nombre: 'Inactivo',
      activo: false,
    })
    const profesores = await getProfesores(adminDb, T1)
    // p1 y p3 están activos; p2 se acaba de marcar inactivo.
    assert.deepEqual(
      profesores.map((p) => p.id),
      ['p1', 'p3'],
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
    // Una clase de 1 h ocupa 2 bloques de 30 min de profesor.
    assert.equal(deProfesor.length, 2)

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
    const { claseId, bloques } = await reservar() // c1 / p1 / 18:00-19:00

    await reprogramarClase(
      adminDb,
      T1,
      claseId,
      { canchaId: 'c2', fecha: '2026-11-16' },
      { uid: ADMIN },
    )

    const movida = await getClase(adminDb, T1, claseId)
    assert.equal(movida.canchaId, 'c2')
    assert.equal(movida.fecha, '2026-11-16')

    for (const bloqueId of bloques) {
      assert.equal((await bloque(bloqueId)).exists(), false, `bloque viejo ${bloqueId}`)
    }
    for (const bloqueId of movida.bloques) {
      assert.ok((await bloque(bloqueId)).exists(), `bloque nuevo ${bloqueId}`)
    }
    assert.equal((await bloque('traki_c2_2026-11-16_1800')).exists(), true)
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
    const { claseId } = await reservar() // c1 / p1 / 18:00-19:00

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

  it('reprogramar a un horario del pasado (mismo día) → DENY', async () => {
    const { claseId } = await reservar()
    await assert.rejects(
      () => reprogramarClase(adminDb, T1, claseId, { horaInicio: '16:00', horaFin: '17:00' }, { uid: ADMIN, ahora: AHORA_RESERVA }),
      /pasado|ya empezó|ya comenzó/i,
    )
  })

  it('reprogramar a una duración de 90 minutos → ALLOW', async () => {
    const { claseId } = await reservar()
    await reprogramarClase(
      adminDb,
      T1,
      claseId,
      { horaFin: '19:30' },
      { uid: ADMIN, ahora: AHORA_RESERVA },
    )
    const movida = await getClase(adminDb, T1, claseId)
    assert.equal(movida.horaFin, '19:30')
    assert.equal(movida.bloques.length, 6)
  })

  it('reprogramar a un inicio de media hora → ALLOW', async () => {
    const { claseId } = await reservar()
    await reprogramarClase(
      adminDb,
      T1,
      claseId,
      { horaInicio: '18:30', horaFin: '19:30' },
      { uid: ADMIN, ahora: AHORA_RESERVA },
    )
    const movida = await getClase(adminDb, T1, claseId)
    assert.equal(movida.horaInicio, '18:30')
    assert.deepEqual(movida.bloques.filter((id) => id.startsWith('traki_')), [
      `traki_c1_${FECHA}_1830`,
      `traki_c1_${FECHA}_1900`,
    ])
  })

  it('reprogramar a un inicio en cuarto de hora (18:15) → DENY', async () => {
    const { claseId } = await reservar()
    await assert.rejects(
      () =>
        reprogramarClase(
          adminDb,
          T1,
          claseId,
          { horaInicio: '18:15', horaFin: '19:15' },
          { uid: ADMIN, ahora: AHORA_RESERVA },
        ),
      /media|múltiplo de 30/i,
    )
  })

  it('reprogramar a las 22:00 con 2 h → DENY (terminaría 00:00)', async () => {
    const { claseId } = await reservar()
    await assert.rejects(
      () => reprogramarClase(adminDb, T1, claseId, { horaInicio: '22:00', horaFin: '24:00' }, { uid: ADMIN, ahora: AHORA_RESERVA }),
      /23:00|terminar|válida/i,
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
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await assert.rejects(() => asignarAlumnos(adminDb, T1, claseId, ['a3'], { uid: ADMIN }), /no está activo/)
  })

  it('asignarAlumnos no puede dejar la clase sin alumnos (lista vacía) → DENY', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await assert.rejects(
      () => asignarAlumnos(adminDb, T1, claseId, [], { uid: ADMIN }),
      /al menos un alumno/i,
    )
    // El estado queda intacto.
    assert.deepEqual((await getClase(adminDb, T1, claseId)).alumnos, ['a1'])
  })

  it('asignarAlumnos de 2 a 1 alumno → ALLOW (sigue habiendo uno)', async () => {
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'] })
    await asignarAlumnos(adminDb, T1, claseId, ['a2'], { uid: ADMIN })
    assert.deepEqual((await getClase(adminDb, T1, claseId)).alumnos, ['a2'])
  })

  it('reprogramarClase no puede dejar la clase sin alumnos → DENY', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await assert.rejects(
      () => reprogramarClase(adminDb, T1, claseId, { alumnos: [] }, { uid: ADMIN }),
      /al menos un alumno/i,
    )
  })

  it('reprogramarClase con un alumno inactivo → DENY', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await assert.rejects(
      () => reprogramarClase(adminDb, T1, claseId, { alumnos: ['a3'] }, { uid: ADMIN }),
      /no está activo/,
    )
  })

  it('asignarAlumnos en una clase cerrada → DENY', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], {
      uid: ADMIN,
      ahora: DESPUES_DEL_FIN,
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
  const sembrarAlvaro = () =>
    setDoc(doc(adminDb, 'academias', T1, 'alumnos', 'a4'), {
      tipo: 'adulto',
      nombre: 'Álvaro',
      apellidos: 'Ávila',
      busquedaNombre: 'alvaro avila',
      busquedaApellido: 'avila alvaro',
      activo: true,
    })

  it('encuentra por prefijo del nombre, sin tildes ni mayúsculas', async () => {
    await sembrarAlvaro()
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

  it('encuentra por prefijo del apellido', async () => {
    await sembrarAlvaro()
    const porApellido = await buscarAlumnos(adminDb, T1, 'Ávi')
    assert.deepEqual(
      porApellido.map((a) => a.id),
      ['a4'],
    )
  })

  it('encuentra por prefijo "nombre apellido" y "apellido nombre"', async () => {
    await sembrarAlvaro()
    assert.deepEqual((await buscarAlumnos(adminDb, T1, 'aldo ad')).map((a) => a.id), ['a1'])
    assert.deepEqual((await buscarAlumnos(adminDb, T1, 'adulto ald')).map((a) => a.id), ['a1'])
  })

  it('exige al menos 2 letras', async () => {
    await sembrarAlvaro()
    assert.deepEqual(await buscarAlumnos(adminDb, T1, 'a'), [])
    assert.deepEqual(await buscarAlumnos(adminDb, T1, 'á'), [])
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
        apellidos: 'Zeta',
        busquedaNombre: `zeta ${i}`,
        busquedaApellido: `zeta ${i}`,
        activo: true,
      })
    }
    assert.equal((await buscarAlumnos(adminDb, T1, 'zeta')).length, 10)
    assert.equal((await buscarAlumnos(adminDb, T1, 'zeta', { limite: 3 })).length, 3)
  })

  it('no repite alumnos que coinciden por nombre y por apellido', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'alumnos', 'a5'), {
      tipo: 'adulto',
      nombre: 'Zoe',
      apellidos: 'Zoe',
      busquedaNombre: 'zoe zoe',
      busquedaApellido: 'zoe zoe',
      activo: true,
    })
    const resultados = await buscarAlumnos(adminDb, T1, 'zoe')
    assert.deepEqual(resultados.map((a) => a.id), ['a5'])
  })
})

describe('listarAlumnos: orden accent-insensitive, filtro de estado y paginación', () => {
  /**
   * Crea N alumnos de prueba. Por defecto deja ~1 de cada 5 inactivo (así el
   * listado tiene las dos poblaciones); con `activo` se fija el estado de todas.
   */
  async function crearMuchos(cantidad, { desde = 0, activo } = {}) {
    const ids = []
    for (let i = desde; i < desde + cantidad; i += 1) {
      const numero = String(i).padStart(4, '0')
      const datos = {
        nombre: `Zeta ${numero}`,
        apellidos: `Apellido ${numero}`,
        tipo: 'adulto',
        activo: activo ?? i % 5 !== 0,
      }
      const { alumnoId } = await crearAlumno(adminDb, T1, datos, { uid: ADMIN })
      ids.push(alumnoId)
    }
    return ids
  }

  it('ordena por apellido sin distinguir tildes ni ñ', async () => {
    const casos = [
      ['Ávila', 'Álvaro'],
      ['Cañas', 'Renata'],
      ['Iriarte', 'Joaquín'],
      ['Muñoz', 'Lucía'],
      ['Ñáñez', 'Iker'],
      ['Núñez', 'Óscar'],
      ['Peña', 'Diego'],
      ['Zambrano', 'Elena'],
    ]
    for (const [apellidos, nombre] of casos) {
      await crearAlumno(adminDb, T1, { nombre, apellidos, tipo: 'adulto' }, { uid: ADMIN })
    }

    const { alumnos, siguiente } = await listarAlumnos(adminDb, T1, { limite: 100 })
    assert.equal(siguiente, null)
    // El default es `activos`, así que la ficha inactiva del seed (a3) no
    // aparece. El resto va por el apellido normalizado: sin tildes ni ñ.
    assert.deepEqual(
      alumnos.map((a) => a.apellidos),
      ['Adulto', 'Ávila', 'Cañas', 'Iriarte', 'Menor', 'Muñoz', 'Ñáñez', 'Núñez', 'Peña', 'Zambrano'],
    )
    // Con "todos" la inactiva sí entra y el orden sigue siendo el alfabético.
    const todos = await listarAlumnos(adminDb, T1, { estado: 'todos', limite: 100 })
    assert.deepEqual(
      todos.alumnos.map((a) => a.apellidos),
      ['Adulto', 'Ávila', 'Cañas', 'Inactiva', 'Iriarte', 'Menor', 'Muñoz', 'Ñáñez', 'Núñez', 'Peña', 'Zambrano'],
    )
    // El campo persistido queda sin tildes: Firestore ordena por bytes UTF-8 y
    // con tildes esas fichas se irían al final del listado.
    const avila = alumnos.find((a) => a.apellidos === 'Ávila')
    assert.equal(avila.busquedaApellido, 'avila alvaro')
  })

  it('por defecto lista solo activos y hasta 100 por página', async () => {
    await crearMuchos(120, { activo: true })

    const { alumnos, siguiente } = await listarAlumnos(adminDb, T1)
    assert.equal(alumnos.length, 100)
    assert.ok(siguiente, 'debería haber una página siguiente')
    assert.ok(alumnos.every((a) => a.activo !== false))
  })

  it('pagina con cursor: sin repetidos, sin huecos y `siguiente` null al final', async () => {
    await crearMuchos(105)

    const vistos = []
    let despues = null
    let paginas = 0
    do {
      const pagina = await listarAlumnos(adminDb, T1, { estado: 'todos', limite: 100, despues })
      vistos.push(...pagina.alumnos.map((a) => a.id))
      despues = pagina.siguiente
      paginas += 1
    } while (despues && paginas < 10)

    // 105 creados + 3 del seed = 108 → dos páginas (100 + 8), sin repetidos.
    assert.equal(vistos.length, 108)
    assert.equal(new Set(vistos).size, 108, 'no debe repetir alumnos')
    assert.equal(paginas, 2)
    assert.equal(despues, null)

    // Y lo mismo con el default (solo activos): 84 creados + 2 del seed = 86,
    // que entra en una sola página.
    const activos = []
    let cursor = null
    let vueltas = 0
    do {
      const pagina = await listarAlumnos(adminDb, T1, { limite: 100, despues: cursor })
      activos.push(...pagina.alumnos.map((a) => a.id))
      cursor = pagina.siguiente
      vueltas += 1
    } while (cursor && vueltas < 10)

    assert.equal(activos.length, 86)
    assert.equal(new Set(activos).size, 86, 'no debe repetir alumnos activos')
    assert.equal(vueltas, 1)
    assert.equal(cursor, null)
  })

  it('filtra por estado inactivos y todos', async () => {
    await crearMuchos(6, { activo: true })

    const inactivos = await listarAlumnos(adminDb, T1, { estado: 'inactivos' })
    assert.deepEqual(
      inactivos.alumnos.map((a) => a.apellidos),
      ['Inactiva'],
    )
    assert.ok(inactivos.alumnos.every((a) => a.activo === false))

    await actualizarAlumno(adminDb, T1, 'a3', { activo: true }, { uid: ADMIN })
    assert.equal((await listarAlumnos(adminDb, T1, { estado: 'inactivos' })).alumnos.length, 0)

    const todos = await listarAlumnos(adminDb, T1, { estado: 'todos' })
    assert.equal(todos.alumnos.length, 9) // 3 del seed + 6
  })

  it('acota el límite a 100 aunque pidan más', async () => {
    await crearMuchos(120, { activo: true })
    const { alumnos, siguiente } = await listarAlumnos(adminDb, T1, { limite: 500 })
    assert.equal(alumnos.length, 100)
    assert.ok(siguiente)
  })

  it('un filtro de estado desconocido cae en activos', async () => {
    const raro = await listarAlumnos(adminDb, T1, { estado: 'cualquiera' })
    assert.deepEqual(raro.alumnos.map((a) => a.id), ['a1', 'a2'])
  })
})

describe('buscarAlumnos con estado', () => {
  it('estado inactivos encuentra solo fichas inactivas', async () => {
    const inactivos = await buscarAlumnos(adminDb, T1, 'nadia', { estado: 'inactivos' })
    assert.deepEqual(inactivos.map((a) => a.id), ['a3'])
  })

  it('estado todos incluye activos e inactivos (mismo prefijo de apellido)', async () => {
    // "Ávila" (activa) y "Ávila inactiva": las dos comparten prefijo normalizado.
    await setDoc(doc(adminDb, 'academias', T1, 'alumnos', 'a4'), {
      tipo: 'adulto',
      nombre: 'Álvaro',
      apellidos: 'Ávila',
      busquedaNombre: 'alvaro avila',
      busquedaApellido: 'avila alvaro',
      activo: true,
    })
    await setDoc(doc(adminDb, 'academias', T1, 'alumnos', 'a5'), {
      tipo: 'adulto',
      nombre: 'Ana',
      apellidos: 'Ávila',
      busquedaNombre: 'ana avila',
      busquedaApellido: 'avila ana',
      activo: false,
    })

    const todos = await buscarAlumnos(adminDb, T1, 'avila', { estado: 'todos', limite: 30 })
    assert.deepEqual(todos.map((a) => a.id).sort(), ['a4', 'a5'])

    const activos = await buscarAlumnos(adminDb, T1, 'avila', { limite: 30 })
    assert.deepEqual(activos.map((a) => a.id), ['a4'])

    const inactivos = await buscarAlumnos(adminDb, T1, 'avila', { estado: 'inactivos', limite: 30 })
    assert.deepEqual(inactivos.map((a) => a.id), ['a5'])
  })

  it('limite 30 devuelve 30 cuando hay más coincidencias', async () => {
    for (let i = 0; i < 40; i += 1) {
      const numero = String(i).padStart(2, '0')
      await setDoc(doc(adminDb, 'academias', T1, 'alumnos', `w${numero}`), {
        tipo: 'adulto',
        nombre: `Wolf ${numero}`,
        apellidos: `Wolf ${numero}`,
        busquedaNombre: `wolf ${numero}`,
        busquedaApellido: `wolf ${numero}`,
        activo: true,
      })
    }
    assert.equal((await buscarAlumnos(adminDb, T1, 'wolf', { limite: 30 })).length, 30)
    // Tope duro: aunque pidan más, no pasa de 50.
    assert.equal((await buscarAlumnos(adminDb, T1, 'wolf', { limite: 500 })).length, 40)
  })
})

describe('reactivación de un alumno inactivo', () => {
  it('actualizarAlumno con activo:true reactiva una ficha inactiva', async () => {
    const antes = await getAlumno(adminDb, T1, 'a3')
    assert.equal(antes.activo, false)

    await actualizarAlumno(adminDb, T1, 'a3', { activo: true }, { uid: ADMIN })

    const despues = await getAlumno(adminDb, T1, 'a3')
    assert.equal(despues.activo, true)
    // Ordenado por apellido normalizado: adulto, inactiva, menor.
    assert.deepEqual((await listarAlumnos(adminDb, T1)).alumnos.map((a) => a.id), ['a1', 'a3', 'a2'])
  })
})

describe('getProfesores con estado', () => {
  it('por defecto solo activos, ordenados por apellidos y después nombre', async () => {
    const profesores = await getProfesores(adminDb, T1)
    assert.deepEqual(profesores.map((p) => p.id), ['p2', 'p1', 'p3'])
  })

  it('estado inactivos y todos incluyen fichas inactivas', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'profesores', 'p4'), {
      nombre: 'Zoilo',
      apellidos: 'Inactivo',
      sedes: ['traki'],
      activo: false,
    })

    assert.deepEqual((await getProfesores(adminDb, T1, { estado: 'inactivos' })).map((p) => p.id), ['p4'])
    assert.deepEqual(
      (await getProfesores(adminDb, T1, { estado: 'todos' })).map((p) => p.id),
      ['p4', 'p2', 'p1', 'p3'],
    )
    // El filtro por sede se conserva con estado "todos".
    assert.deepEqual(
      (await getProfesores(adminDb, T1, { estado: 'todos', sedeId: 'boleita' })).map((p) => p.id),
      ['p2', 'p3'],
    )
  })
})

describe('fichas', () => {
  const alumnoBase = (extra = {}) => ({
    nombre: 'Ángel',
    apellidos: 'Niño',
    tipo: 'menor',
    representante: { nombre: 'Teresa', apellidos: 'Representante' },
    ...extra,
  })

  it('crearAlumno recorta, denormaliza el buscador, exige representante en menores y arranca activo', async () => {
    const { alumnoId } = await crearAlumno(
      adminDb,
      T1,
      alumnoBase({ nombre: '  Ángel ', apellidos: ' Niño ' }),
      { uid: ADMIN },
    )
    const ficha = await getAlumno(adminDb, T1, alumnoId)
    assert.equal(ficha.nombre, 'Ángel')
    assert.equal(ficha.apellidos, 'Niño')
    assert.equal(ficha.busquedaNombre, 'angel nino')
    assert.equal(ficha.busquedaApellido, 'nino angel')
    assert.equal(ficha.avisosActivos, true)
    assert.equal(ficha.activo, true)
    assert.equal(ficha.representante.nombre, 'Teresa')
    assert.equal(ficha.tipo, 'menor')

    await assert.rejects(
      () => crearAlumno(adminDb, T1, { nombre: 'Sin', apellidos: 'Representante', tipo: 'menor' }, { uid: ADMIN }),
      FichaInvalidaError,
    )
  })

  it('crearAlumno exige nombre y apellidos', async () => {
    await assert.rejects(
      () => crearAlumno(adminDb, T1, { apellidos: 'Sin Nombre' }, { uid: ADMIN }),
      FichaInvalidaError,
    )
    await assert.rejects(
      () => crearAlumno(adminDb, T1, { nombre: 'Sin Apellidos' }, { uid: ADMIN }),
      FichaInvalidaError,
    )
  })

  it('representante de un menor exige nombre y apellidos', async () => {
    await assert.rejects(
      () => crearAlumno(adminDb, T1, alumnoBase({ representante: { apellidos: 'Solo Apellido' } }), { uid: ADMIN }),
      FichaInvalidaError,
    )
    await assert.rejects(
      () => crearAlumno(adminDb, T1, alumnoBase({ representante: { nombre: 'Solo Nombre' } }), { uid: ADMIN }),
      FichaInvalidaError,
    )
  })

  it('profesor exige nombre y apellidos', async () => {
    await assert.rejects(
      () => crearProfesor(adminDb, T1, { apellidos: 'Sin Nombre' }, { uid: ADMIN }),
      FichaInvalidaError,
    )
    await assert.rejects(
      () => crearProfesor(adminDb, T1, { nombre: 'Sin Apellidos' }, { uid: ADMIN }),
      FichaInvalidaError,
    )
  })

  it('documento: van el tipo y el número juntos o ninguno, y el tipo sale del enum', async () => {
    // Ninguno: se guarda null.
    const { alumnoId } = await crearAlumno(
      adminDb,
      T1,
      { nombre: 'Doc', apellidos: 'Nulo', documento: { tipo: '', numero: '' } },
      { uid: ADMIN },
    )
    assert.equal((await getAlumno(adminDb, T1, alumnoId)).documento, null)

    // Completo: se recorta.
    const { alumnoId: conDoc } = await crearAlumno(
      adminDb,
      T1,
      { nombre: 'Doc', apellidos: 'Completo', documento: { tipo: 'cedula', numero: ' V-1 ' } },
      { uid: ADMIN },
    )
    assert.deepEqual((await getAlumno(adminDb, T1, conDoc)).documento, {
      tipo: 'cedula',
      numero: 'V-1',
    })

    // Solo uno de los dos → error.
    await assert.rejects(
      () => crearAlumno(adminDb, T1, { nombre: 'Doc', apellidos: 'Medio', documento: { tipo: 'cedula' } }, { uid: ADMIN }),
      FichaInvalidaError,
    )
    // Tipo fuera del enum → error.
    await assert.rejects(
      () => crearAlumno(
        adminDb,
        T1,
        { nombre: 'Doc', apellidos: 'Malo', documento: { tipo: 'rif', numero: 'X-1' } },
        { uid: ADMIN },
      ),
      FichaInvalidaError,
    )
  })

  it('contactoEmergencia: nombre y teléfono van juntos o ninguno', async () => {
    const { alumnoId } = await crearAlumno(
      adminDb,
      T1,
      {
        nombre: 'Con',
        apellidos: 'Contacto',
        contactoEmergencia: { nombre: 'Elsa', telefono: '+58 000 000 0009' },
      },
      { uid: ADMIN },
    )
    assert.deepEqual((await getAlumno(adminDb, T1, alumnoId)).contactoEmergencia, {
      nombre: 'Elsa',
      telefono: '+58 000 000 0009',
    })

    await assert.rejects(
      () => crearAlumno(
        adminDb,
        T1,
        { nombre: 'Sin', apellidos: 'Telefono', contactoEmergencia: { nombre: 'Elsa' } },
        { uid: ADMIN },
      ),
      FichaInvalidaError,
    )
  })

  it('nivel fuera del enum → FichaInvalidaError', async () => {
    await assert.rejects(
      () => crearAlumno(adminDb, T1, { nombre: 'Nivel', apellidos: 'Malo', nivel: 'intermedio' }, { uid: ADMIN }),
      FichaInvalidaError,
    )
  })

  it('fechaIngreso arranca en la fecha LOCAL de hoy y acepta "YYYY-MM-DD"', async () => {
    const ahora = new Date(2026, 0, 15, 23, 30)
    assert.equal(fechaHoyLocal(ahora), '2026-01-15')
    const { alumnoId } = await crearAlumno(
      adminDb,
      T1,
      { nombre: 'Hoy', apellidos: 'Local' },
      { uid: ADMIN, now: ahora },
    )
    assert.equal((await getAlumno(adminDb, T1, alumnoId)).fechaIngreso, '2026-01-15')

    const { alumnoId: conFecha } = await crearAlumno(
      adminDb,
      T1,
      { nombre: 'Fecha', apellidos: 'Fija', fechaIngreso: '2025-03-01' },
      { uid: ADMIN },
    )
    assert.equal((await getAlumno(adminDb, T1, conFecha)).fechaIngreso, '2025-03-01')
  })

  it('aplica los topes de largo de los textos', async () => {
    await assert.rejects(
      () => crearAlumno(adminDb, T1, { nombre: 'x'.repeat(201), apellidos: 'Largo' }, { uid: ADMIN }),
      FichaInvalidaError,
    )
    await assert.rejects(
      () => crearAlumno(adminDb, T1, { nombre: 'Tel', apellidos: 'Largo', telefono: '9'.repeat(31) }, { uid: ADMIN }),
      FichaInvalidaError,
    )
    await assert.rejects(
      () =>
        crearAlumno(
          adminDb,
          T1,
          {
            nombre: 'Doc',
            apellidos: 'Largo',
            documento: { tipo: 'cedula', numero: '9'.repeat(31) },
          },
          { uid: ADMIN },
        ),
      FichaInvalidaError,
    )
    await assert.rejects(
      () => crearAlumno(adminDb, T1, { nombre: 'Notas', apellidos: 'Largas', notas: 'x'.repeat(1001) }, { uid: ADMIN }),
      FichaInvalidaError,
    )
  })

  it('actualizarAlumno recalcula el buscador al cambiar nombre o apellidos', async () => {
    await actualizarAlumno(adminDb, T1, 'a1', { apellidos: 'Actualizado' }, { uid: ADMIN })
    const ficha = await getAlumno(adminDb, T1, 'a1')
    assert.equal(ficha.busquedaNombre, 'aldo actualizado')
    assert.equal(ficha.busquedaApellido, 'actualizado aldo')
  })

  it('actualizarAlumno hace soft delete con activo:false y lo saca del buscador', async () => {
    await actualizarAlumno(adminDb, T1, 'a1', { activo: false }, { uid: ADMIN })
    assert.equal((await getAlumno(adminDb, T1, 'a1')).activo, false)
    assert.equal((await buscarAlumnos(adminDb, T1, 'aldo')).length, 0)
  })

  it('crearProfesor no escribe tarifa por hora y guarda sus sedes', async () => {
    const { profesorId } = await crearProfesor(
      adminDb,
      T1,
      { nombre: 'Paola', apellidos: 'Profesora', telefono: '+58 000 000 0002', sedes: ['traki'] },
      { uid: ADMIN },
    )
    const snap = await getDoc(doc(adminDb, 'academias', T1, 'profesores', profesorId))
    assert.equal(snap.data().tarifaHoraCentavos, undefined)
    assert.equal(snap.data().activo, true)
    assert.deepEqual(snap.data().sedes, ['traki'])
    assert.equal(nombreCompleto(snap.data()), 'Paola Profesora')
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
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
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
      () => registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], {
        uid: ADMIN,
        ahora: DESPUES_DEL_FIN,
      }),
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
          { uid: ADMIN, ahora: DESPUES_DEL_FIN },
        ),
      /exactamente una entrada/,
    )
  })

  it('una clase ya cerrada no se puede cerrar dos veces', async () => {
    const { claseId } = await reservar()
    await registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], {
      uid: ADMIN,
      ahora: DESPUES_DEL_FIN,
    })
    await assert.rejects(
      () => registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], {
        uid: ADMIN,
        ahora: DESPUES_DEL_FIN,
      }),
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
    assert.equal(creada.bloques.length, 4)
  })
})

// ============================================================
// BLOCK A — nuevas pruebas (deben FALLAR antes del fix)
// ============================================================

describe('[A1] cancelarClase: guardia de estado y propiedad de bloques', () => {
  it('[REPRODUCE] cancelar clase ya cancelada no borra bloques de clase B (escenario doble-click)', async () => {
    // 1. Reservar clase A y cancelarla (libera los bloques).
    const { claseId: claseA, bloques: bloquesA } = await reservar()
    await cancelarClase(adminDb, T1, claseA, { uid: ADMIN })

    // 2. Reservar clase B en los mismos slots: reutiliza los mismos IDs de bloque.
    const { claseId: claseB, bloques: bloquesB } = await reservar()
    assert.deepEqual(bloquesA, bloquesB, 'los IDs de bloque deben ser deterministas e idénticos')

    // 3. Cancelar clase A de nuevo (pantalla vieja / doble click).
    //    Con el bug: clase A ya está cancelada → estado no se chequea → se borran
    //    los bloques por ID → los bloques de clase B quedan destruidos.
    //    Con el fix: se detecta que clase A ya está cancelada → no-op.
    await cancelarClase(adminDb, T1, claseA, { uid: ADMIN })

    // Los bloques de clase B deben seguir existiendo.
    for (const bloqueId of bloquesB) {
      const snap = await bloque(bloqueId)
      assert.ok(
        snap.exists() && snap.data().claseId === claseB,
        `bloque ${bloqueId} debe pertenecer a clase B`,
      )
    }
  })

  it('cancelar clase en estado pendiente_cobro → DENY', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], {
      uid: ADMIN,
      ahora: DESPUES_DEL_FIN,
    })
    // Clase pasa a pendiente_cobro — no se puede cancelar.
    await assert.rejects(
      () => cancelarClase(adminDb, T1, claseId, { uid: ADMIN }),
      /reservada/,
    )
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'pendiente_cobro')
  })

  it('cancelar guarda bloques: [] en la clase cancelada', async () => {
    const { claseId } = await reservar()
    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })
    const cancelada = await getClase(adminDb, T1, claseId)
    assert.deepEqual(cancelada.bloques, [])
  })
})

describe('[A2] reprogramarClase: guardia de estado', () => {
  it('[REPRODUCE] reprogramar clase cancelada crea bloques fantasma → DENY', async () => {
    const { claseId } = await reservar()
    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })
    // Intentar reprogramar una clase cancelada debe fallar.
    await assert.rejects(
      () => reprogramarClase(adminDb, T1, claseId, { fecha: '2026-10-07' }, { uid: ADMIN }),
      /reservada/,
    )
  })

  it('[REPRODUCE] reprogramar clase en pendiente_cobro → DENY', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], {
      uid: ADMIN,
      ahora: DESPUES_DEL_FIN,
    })
    await assert.rejects(
      () => reprogramarClase(adminDb, T1, claseId, { fecha: '2026-10-07' }, { uid: ADMIN }),
      /reservada/,
    )
  })

  it('reprogramar solo borra bloques propios', async () => {
    const { claseId } = await reservar({
      fecha: '2026-11-17',
      horaInicio: '10:00',
      horaFin: '11:00',
    })
    const claseOriginal = await getClase(adminDb, T1, claseId)
    const bloqueRobadoId = claseOriginal.bloques[0]

    // Mutar el bloque para dárselo a otra clase ("otra_clase")
    const refBloque = doc(adminDb, 'academias', T1, 'bloques', bloqueRobadoId)
    await setDoc(refBloque, { claseId: 'otra_clase', activo: true, id: bloqueRobadoId })

    // Reprogramar suelta los bloques viejos
    await reprogramarClase(
      adminDb,
      T1,
      claseId,
      { fecha: '2026-11-18', horaInicio: '15:00', horaFin: '16:00' },
      { uid: ADMIN, ahora: AHORA_RESERVA }
    )

    // El bloque viejo robado no debe ser borrado
    const snapBloque = await getDoc(refBloque)
    assert.equal(snapBloque.exists(), true)
    assert.equal(snapBloque.data().claseId, 'otra_clase')
  })
})

describe('[A3] registrarAsistencia: guardia de estado y hora', () => {
  it('[REPRODUCE] cerrar clase cancelada → DENY (solo se cierra estando reservada)', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })
    // La clase cancelada NO está en ESTADOS_CERRADOS, así el bug pasa el filtro actual.
    await assert.rejects(
      () => registrarAsistencia(adminDb, T1, claseId, [{ alumnoId: 'a1', estado: 'presente' }], { uid: ADMIN }),
      (err) => {
        assert.ok(err instanceof ClaseInvalidaError)
        assert.match(err.message, /está cancelada y no se puede cerrar/)
        return true
      }
    )
    const clase = await getClase(adminDb, T1, claseId)
    assert.equal(clase.estado, 'cancelada')
  })

  it('no se puede cerrar clase que todavía no empezó (ahora < horaFin)', async () => {
    // Clase el FECHA a las 18:00-19:00; simulamos que son las 17:00.
    const { claseId } = await reservar({ alumnos: ['a1'] })
    const antesDeEmpezar = new Date(2026, 10, 15, 17, 0, 0)
    await assert.rejects(
      () =>
        registrarAsistencia(
          adminDb,
          T1,
          claseId,
          [{ alumnoId: 'a1', estado: 'presente' }],
          { uid: ADMIN, ahora: antesDeEmpezar },
        ),
      /todavía no terminó/,
    )
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'reservada')
  })
})

// ============================================================
// BLOCK B — nuevas pruebas de validación
// ============================================================

describe('[B1] cupo: validación de entero 1-4', () => {
  it('cupo 0 → DENY', async () => {
    // Para que no falle por asignar alumnos > cupo, no enviamos alumnos.
    await assert.rejects(
      () => reservar({ cupo: 0, alumnos: ['a1'] }),
      (err) => {
        assert.ok(err instanceof ClaseInvalidaError)
        assert.match(err.message, /cupo debe estar entre 1 y/)
        return true
      }
    )
  })

  it('cupo 5 → DENY (excede el máximo del modelo)', async () => {
    await assert.rejects(() => reservar({ cupo: 5 }), /cupo/)
  })

  it('cupo string numérico → DENY', async () => {
    await assert.rejects(
      () => reservar({ cupo: '2', alumnos: ['a1'] }),
      (err) => {
        assert.ok(err instanceof ClaseInvalidaError)
        assert.match(err.message, /cupo debe ser un entero/)
        return true
      }
    )
  })

  it('cupo 1.5 (no entero) → DENY', async () => {
    await assert.rejects(() => reservar({ cupo: 1.5 }), /cupo/)
  })

  it('cupo 4 (máximo) → ALLOW', async () => {
    const { claseId } = await reservar({ cupo: 4, alumnos: ['a1'] })
    assert.equal((await getClase(adminDb, T1, claseId)).cupo, 4)
  })

  it('cupo 1 (Individual) → ALLOW', async () => {
    const { claseId } = await reservar({ cupo: 1, alumnos: ['a1'] })
    assert.equal((await getClase(adminDb, T1, claseId)).cupo, 1)
  })
})

describe('[B2] crearClase: sede/cancha/profesor deben existir y estar activos', () => {
  it('sedeId inexistente → DENY', async () => {
    await assert.rejects(() => reservar({ sedeId: 'no-existe' }), /sede/)
  })

  it('sede inactiva → DENY', async () => {
    // Sembrar sede inactiva
    await setDoc(doc(adminDb, 'academias', T1, 'sedes', 'inactiva'), { nombre: 'Inactiva', activa: false })
    await assert.rejects(
      () => reservar({ sedeId: 'inactiva' }),
      /sede/,
    )
  })

  it('canchaId inexistente en la sede → DENY', async () => {
    await assert.rejects(() => reservar({ canchaId: 'no-existe' }), /cancha/)
  })

  it('cancha que pertenece a otra sede → DENY', async () => {
    // cancha c1 pertenece a 'traki', no a 'boleita'
    await setDoc(doc(adminDb, 'academias', T1, 'sedes', 'boleita'), { nombre: 'Boleita', activa: true })
    await assert.rejects(
      () => reservar({ sedeId: 'boleita', canchaId: 'c1' }),
      /cancha/,
    )
  })

  it('profesor inexistente → DENY', async () => {
    await assert.rejects(() => reservar({ profesorId: 'no-existe' }), /profesor/)
  })

  it('profesor inactivo → DENY', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'profesores', 'pinact'), { nombre: 'Inactivo', activo: false })
    await assert.rejects(
      () => reservar({ profesorId: 'pinact' }),
      /profesor/,
    )
  })

  it('nombres denormalizados se toman del documento, no del cliente', async () => {
    const { claseId } = await reservar({ sedeNombre: 'IGNORAR', profesorNombre: 'IGNORAR' })
    const c = await getClase(adminDb, T1, claseId)
    // El nombre real de la sede es 'Traki' y el del profesor "Pablo Profesor".
    assert.equal(c.sedeNombre, 'Traki', 'sedeNombre debe venir del doc de sede')
    assert.equal(
      c.profesorNombre,
      'Pablo Profesor',
      'profesorNombre debe venir del doc de profesor',
    )
  })
})

describe('[B3] fichas: whitelist y representante para menores', () => {
  it('crearAlumno ignora campos no permitidos (whitelist)', async () => {
    const { alumnoId } = await crearAlumno(
      adminDb,
      T1,
      { nombre: 'Test', apellidos: 'Whitelist', tipo: 'adulto', campoExtraño: 'inyectado', activo: true },
      { uid: ADMIN },
    )
    const ficha = await getAlumno(adminDb, T1, alumnoId)
    assert.equal(ficha.campoExtraño, undefined, 'campos no permitidos no deben guardarse')
  })

  it('actualizarAlumno ignora campos no permitidos (whitelist)', async () => {
    await actualizarAlumno(adminDb, T1, 'a1', { campoExtraño: 'inyectado' }, { uid: ADMIN })
    const ficha = await getAlumno(adminDb, T1, 'a1')
    assert.equal(ficha.campoExtraño, undefined)
  })

  it('crearProfesor ignora campos no permitidos (whitelist)', async () => {
    const { profesorId } = await crearProfesor(
      adminDb,
      T1,
      { nombre: 'Test', apellidos: 'Prof', campoExtraño: 'inyectado' },
      { uid: ADMIN },
    )
    const snap = await getDoc(doc(adminDb, 'academias', T1, 'profesores', profesorId))
    assert.equal(snap.data().campoExtraño, undefined)
  })

  it('actualizarProfesor ignora campos no permitidos (whitelist)', async () => {
    await actualizarProfesor(adminDb, T1, 'p1', { campoExtraño: 'inyectado' }, { uid: ADMIN })
    const snap = await getDoc(doc(adminDb, 'academias', T1, 'profesores', 'p1'))
    assert.equal(snap.data().campoExtraño, undefined)
  })

  it('actualizarAlumno a menor sin representante → FichaInvalidaError', async () => {
    await assert.rejects(
      () => actualizarAlumno(adminDb, T1, 'a2', { representante: { nombre: '' } }, { uid: ADMIN }),
      FichaInvalidaError,
    )
  })

  it('actualizarAlumno de menor a adulto limpia el representante', async () => {
    await actualizarAlumno(adminDb, T1, 'a2', { tipo: 'adulto' }, { uid: ADMIN })
    const ficha = await getAlumno(adminDb, T1, 'a2')
    assert.equal(ficha.tipo, 'adulto')
    assert.equal(ficha.representante, null)
  })
})

describe('[B5] profesor por sede: create y reprogram', () => {
  it('crearClase con un profesor no asignado a la sede → ClaseInvalidaError', async () => {
    await assert.rejects(
      () => reservar({ profesorId: 'p3' }),
      (error) => error instanceof ClaseInvalidaError && /no está asignado a la sede/.test(error.message),
    )
  })

  it('reprogramarClase a un profesor no asignado a la sede → ClaseInvalidaError', async () => {
    const { claseId } = await reservar()
    await assert.rejects(
      () => reprogramarClase(adminDb, T1, claseId, { profesorId: 'p3' }, { uid: ADMIN }),
      (error) => error instanceof ClaseInvalidaError && /no está asignado a la sede/.test(error.message),
    )
    // La clase queda intacta.
    assert.equal((await getClase(adminDb, T1, claseId)).profesorId, 'p1')
  })

  it('reprogramarClase a otra sede con un profesor de esa sede → ALLOW', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'sedes', 'boleita'), { nombre: 'Boleíta', activa: true })
    await setDoc(doc(adminDb, 'academias', T1, 'sedes', 'boleita', 'canchas', 'c1'), {
      nombre: 'Cancha 1',
      activa: true,
    })
    const { claseId } = await reservar()
    await reprogramarClase(
      adminDb,
      T1,
      claseId,
      { sedeId: 'boleita', profesorId: 'p3' },
      { uid: ADMIN },
    )
    const movida = await getClase(adminDb, T1, claseId)
    assert.equal(movida.sedeId, 'boleita')
    assert.equal(movida.profesorId, 'p3')
    assert.equal(movida.sedeNombre, 'Boleíta')
    assert.equal(movida.profesorNombre, 'Sofía Solo Boleita')
  })
})

describe('[B4] getSedes y getProfesores: filtro activo en la query', () => {
  it('getSedes no devuelve sedes inactivas aunque estén en la BD', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'sedes', 'inactivaSede'), {
      nombre: 'Inactiva', activa: false, orden: 99,
    })
    const sedes = await getSedes(adminDb, T1)
    assert.ok(!sedes.some((s) => s.id === 'inactivaSede'), 'sede inactiva no debe aparecer')
  })

  it('getProfesores no devuelve profesores inactivos aunque estén en la BD', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'profesores', 'inactivoProf'), {
      nombre: 'Inactivo', apellidos: 'Prof', activo: false,
    })
    const profesores = await getProfesores(adminDb, T1)
    assert.ok(!profesores.some((p) => p.id === 'inactivoProf'), 'profesor inactivo no debe aparecer')
  })

  it('getProfesores con sedeId solo devuelve los asignados a esa sede', async () => {
    const deTraki = await getProfesores(adminDb, T1, { sedeId: 'traki' })
    assert.deepEqual(deTraki.map((p) => p.id).sort(), ['p1', 'p2'])
    const deBoleita = await getProfesores(adminDb, T1, { sedeId: 'boleita' })
    assert.deepEqual(deBoleita.map((p) => p.id).sort(), ['p2', 'p3'])
    assert.deepEqual(await getProfesores(adminDb, T1, { sedeId: 'sin-gente' }), [])
  })

  it('getProfesores ordena por apellidos y después nombre', async () => {
    const nombres = (await getProfesores(adminDb, T1)).map((p) => nombreCompleto(p))
    assert.deepEqual(nombres, ['Pedro Pérez', 'Pablo Profesor', 'Sofía Solo Boleita'])
  })
})

/* --------------------------------------------------------------------- */
/* [A3] Configuración por sede: canchas y horario                         */
/* --------------------------------------------------------------------- */

describe('[A3] canchas: crear, renombrar y unicidad', () => {
  it('crearCancha recorta el nombre, la numera y nace activa', async () => {
    const { canchaId } = await crearCancha(adminDb, T1, 'traki', { nombre: '  Cancha 3  ' }, { uid: ADMIN })
    const nueva = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === canchaId)
    assert.equal(nombreDeCancha(nueva, nueva.id), 'Cancha 3')
    assert.equal(nueva.activa, true)
    assert.ok(Number.isInteger(nueva.numero) && nueva.numero >= 1)
  })

  it('crearCancha con nombre vacío o solo espacios → SedeInvalidaError', async () => {
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: '   ' }, { uid: ADMIN }),
      (error) => error instanceof SedeInvalidaError && /nombre/.test(error.message),
    )
  })

  it('crearCancha con un nombre ya usado (otra caja/espacios) → SedeInvalidaError', async () => {
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: '  cancha 1 ' }, { uid: ADMIN }),
      (error) => error instanceof SedeInvalidaError && /Ya hay/.test(error.message),
    )
    assert.equal((await listarCanchas(adminDb, T1, 'traki')).length, 2)
  })

  it('renombrarCancha normaliza y acepta el propio nombre con otra caja', async () => {
    await renombrarCancha(adminDb, T1, 'traki', 'c1', '  Central  ', { uid: ADMIN })
    const canchas = await listarCanchas(adminDb, T1, 'traki')
    assert.equal(nombreDeCancha(canchas.find((c) => c.id === 'c1')), 'Central')
    // El mismo nombre de la propia cancha no es conflicto y queda normalizado.
    await renombrarCancha(adminDb, T1, 'traki', 'c1', 'CENTRAL', { uid: ADMIN })
    const guardada = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === 'c1')
    assert.equal(guardada.nombre, 'Central')
  })

  it('renombrarCancha con el nombre de OTRA cancha → SedeInvalidaError', async () => {
    await assert.rejects(
      () => renombrarCancha(adminDb, T1, 'traki', 'c1', 'Cancha 2', { uid: ADMIN }),
      SedeInvalidaError,
    )
  })

  it('renombrarCancha inexistente → SedeInvalidaError', async () => {
    await assert.rejects(
      () => renombrarCancha(adminDb, T1, 'traki', 'no-existe', 'Otra', { uid: ADMIN }),
      SedeInvalidaError,
    )
  })
})

/*
 * [B1] Reproducción de la falla de QA: "Cancha 5" y después "cancha 5" se
 * aceptaban. La unicidad del nombre debe ignorar caja, espacios de más y
 * acentos, y las canchas inactivas también cuentan.
 */
describe('[B1] canchas: nombre duplicado (caja, espacios y acentos)', () => {
  const MENSAJE_DUPLICADO = (error) =>
    error instanceof SedeInvalidaError && /Ya hay una cancha llamada/.test(error.message)

  beforeEach(async () => {
    await crearCancha(adminDb, T1, 'traki', { nombre: 'Cancha 5' }, { uid: ADMIN })
    const { canchaId } = await crearCancha(
      adminDb,
      T1,
      'traki',
      { nombre: 'Panorámica' },
      { uid: ADMIN },
    )
    await cambiarActivaCancha(adminDb, T1, 'traki', canchaId, false, { uid: ADMIN })
  })

  it('crearCancha con el MISMO nombre en otra caja → SedeInvalidaError (reproduce QA)', async () => {
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: 'cancha 5' }, { uid: ADMIN }),
      SedeInvalidaError,
    )
    // La cancha nueva NO se creó: siguen 4 (c1, c2, Cancha 5, Panorámica).
    assert.equal((await listarCanchas(adminDb, T1, 'traki')).length, 4)
  })

  it('crearCancha ignorando espacios de más al inicio, al final y en medio → DENY', async () => {
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: '  cancha   5  ' }, { uid: ADMIN }),
      SedeInvalidaError,
    )
  })

  it('crearCancha ignorando acentos y caja ("panoramica" vs "Panorámica") → DENY', async () => {
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: 'panoramica' }, { uid: ADMIN }),
      MENSAJE_DUPLICADO,
    )
  })

  it('una cancha INACTIVA también cuenta para el duplicado', async () => {
    // "Panorámica" quedó inactiva en el beforeEach.
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: 'PANORAMICA' }, { uid: ADMIN }),
      SedeInvalidaError,
    )
  })

  it('renombrarCancha aplica la misma regla (caja, espacios y acentos) → DENY', async () => {
    const { canchaId } = await crearCancha(adminDb, T1, 'traki', { nombre: 'Auxiliar' }, { uid: ADMIN })
    await assert.rejects(
      () => renombrarCancha(adminDb, T1, 'traki', canchaId, '  CAncha   5 ', { uid: ADMIN }),
      SedeInvalidaError,
    )
    await assert.rejects(
      () => renombrarCancha(adminDb, T1, 'traki', canchaId, 'PANORAMICA', { uid: ADMIN }),
      SedeInvalidaError,
    )
    // El documento quedó intacto.
    const sinCambios = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === canchaId)
    assert.equal(sinCambios.nombre, 'Auxiliar')
  })

  it('renombrarCancha al PROPIO nombre con otra caja, espacios o acentos → ALLOW', async () => {
    // Se renombra "Panorámica" (inactiva) a "  PANORAMICA  ": es su propio
    // nombre, así que se acepta y se guarda normalizado. El acento no se
    // agrega: la normalización nunca toca los acentos.
    const propia = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.nombre === 'Panorámica')
    await renombrarCancha(adminDb, T1, 'traki', propia.id, '  PANORAMICA  ', { uid: ADMIN })
    const guardada = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === propia.id)
    assert.equal(guardada.nombre, 'Panoramica')
  })

  it('renombrarCancha al propio nombre con espacios de más en medio → ALLOW', async () => {
    const { canchaId } = await crearCancha(adminDb, T1, 'traki', { nombre: 'Cancha 9' }, { uid: ADMIN })
    await renombrarCancha(adminDb, T1, 'traki', canchaId, 'Cancha   9', { uid: ADMIN })
    const guardada = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === canchaId)
    assert.equal(guardada.nombre, 'Cancha 9')
  })
})

/*
 * [B1] Nombre normalizado automáticamente: se guarda con espacios colapsados,
 * letras separadas de los dígitos y caja arreglada. El duplicado se chequea
 * DESPUÉS de normalizar, contra TODAS las canchas de la sede (activas e
 * inactivas), comparando sin acentos.
 */
describe('[B1] canchas: nombre normalizado al crear y renombrar', () => {
  const MENSAJE_DUPLICADO = (nombreExistente) => (error) =>
    error instanceof SedeInvalidaError &&
    error.message === `Ya hay una cancha llamada "${nombreExistente}"`

  it('"cancha 6" sobre "Cancha 6" existente → DENY con el mensaje nuevo', async () => {
    await crearCancha(adminDb, T1, 'traki', { nombre: 'Cancha 6' }, { uid: ADMIN })
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: 'cancha 6' }, { uid: ADMIN }),
      MENSAJE_DUPLICADO('Cancha 6'),
    )
    // La cancha nueva NO se creó: siguen 3 (c1, c2, Cancha 6).
    assert.equal((await listarCanchas(adminDb, T1, 'traki')).length, 3)
  })

  it('"CANCHA6" sobre "Cancha 6" existente (letras pegadas a dígitos) → DENY', async () => {
    await crearCancha(adminDb, T1, 'traki', { nombre: 'Cancha 6' }, { uid: ADMIN })
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: 'CANCHA6' }, { uid: ADMIN }),
      MENSAJE_DUPLICADO('Cancha 6'),
    )
  })

  it('el nombre GUARDADO es el normalizado ("CANCHA6" → "Cancha 6")', async () => {
    const { canchaId } = await crearCancha(adminDb, T1, 'traki', { nombre: 'CANCHA6' }, { uid: ADMIN })
    const nueva = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === canchaId)
    assert.equal(nueva.nombre, 'Cancha 6')
  })

  it('renombrarCancha al propio nombre en otra caja/espacios → ALLOW y normalizado', async () => {
    const { canchaId } = await crearCancha(adminDb, T1, 'traki', { nombre: 'CANCHA6' }, { uid: ADMIN })
    await renombrarCancha(adminDb, T1, 'traki', canchaId, '  cancha   6 ', { uid: ADMIN })
    const guardada = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === canchaId)
    assert.equal(guardada.nombre, 'Cancha 6')
  })

  it('renombrarCancha al nombre de OTRA cancha → DENY con el nombre existente', async () => {
    await crearCancha(adminDb, T1, 'traki', { nombre: 'CANCHA6' }, { uid: ADMIN })
    await assert.rejects(
      () => renombrarCancha(adminDb, T1, 'traki', 'c1', 'cancha6', { uid: ADMIN }),
      MENSAJE_DUPLICADO('Cancha 6'),
    )
    assert.equal(nombreDeCancha((await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === 'c1')), 'Cancha 1')
  })

  it('una cancha INACTIVA también bloquea el nombre nuevo', async () => {
    const { canchaId } = await crearCancha(adminDb, T1, 'traki', { nombre: 'Panorámica' }, { uid: ADMIN })
    await cambiarActivaCancha(adminDb, T1, 'traki', canchaId, false, { uid: ADMIN })
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: 'PANORAMICA' }, { uid: ADMIN }),
      MENSAJE_DUPLICADO('Panorámica'),
    )
    await assert.rejects(
      () => renombrarCancha(adminDb, T1, 'traki', 'c1', 'panoramica', { uid: ADMIN }),
      MENSAJE_DUPLICADO('Panorámica'),
    )
  })

  it('"Panoramica" vs "Panorámica" (acentos) → DENY', async () => {
    await crearCancha(adminDb, T1, 'traki', { nombre: 'Panorámica' }, { uid: ADMIN })
    await assert.rejects(
      () => crearCancha(adminDb, T1, 'traki', { nombre: 'Panoramica' }, { uid: ADMIN }),
      MENSAJE_DUPLICADO('Panorámica'),
    )
    // El nombre guardado conserva el acento original: no se agrega ni se quita.
    const guardada = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.nombre === 'Panorámica')
    assert.ok(guardada)
  })
})

/*
 * [B1] Regresión del bug reportado a mano: "CANCHA6" se veía guardado como
 * "Cancha6". La regla "letra + dígito → un espacio" tiene que aplicarse SIEMPRE,
 * sea cual sea la caja del texto, y tanto al crear como al renombrar. Estos
 * casos pasan por las funciones REALES (crearCancha / renombrarCancha) y leen el
 * nombre ya escrito en Firestore.
 */
describe('[B1] canchas: letra pegada a dígito en cualquier caja (regresión)', () => {
  const CASOS = [
    ['CANCHA6', 'Cancha 6'],
    ['cancha6', 'Cancha 6'],
    ['Cancha6', 'Cancha 6'],
    ['CANCHA6A', 'Cancha 6A'],
    ['Cancha6A', 'Cancha 6A'],
    ['Cancha 6A', 'Cancha 6A'],
    ['6cancha', '6cancha'],
    ['Central Sur', 'Central Sur'],
  ]

  /** Nombre tal como quedó guardado después de crear la cancha. */
  async function crearYLeer(nombre) {
    const { canchaId } = await crearCancha(adminDb, T1, 'traki', { nombre }, { uid: ADMIN })
    const guardada = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === canchaId)
    return guardada.nombre
  }

  /** Nombre tal como quedó guardado después de renombrar la cancha. */
  async function renombrarYLeer(canchaId, nombre) {
    const { nombre: devuelto } = await renombrarCancha(adminDb, T1, 'traki', canchaId, nombre, {
      uid: ADMIN,
    })
    const guardada = (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === canchaId)
    assert.equal(devuelto, guardada.nombre, 'lo devuelto y lo guardado deben coincidir')
    return guardada.nombre
  }

  for (const [entrada, esperado] of CASOS) {
    it(`crearCancha "${entrada}" → guarda "${esperado}"`, async () => {
      assert.equal(await crearYLeer(entrada), esperado)
    })
  }

  it('renombrarCancha aplica la MISMA regla a las mismas entradas', async () => {
    const { canchaId } = await crearCancha(adminDb, T1, 'traki', { nombre: 'Auxiliar' }, { uid: ADMIN })
    for (const [entrada, esperado] of CASOS) {
      assert.equal(await renombrarYLeer(canchaId, entrada), esperado, `entrada: ${entrada}`)
    }
  })

  it('un carácter INVISIBLE entre letra y dígito no deja el nombre pegado ("Cancha6")', async () => {
    // ZWSP, ZWNJ, ZWJ, word joiner y soft hyphen: al pegar el nombre desde otro
    // lado se cuelan y el nombre quedaba "Cancha6" sin el espacio de la regla 2.
    const invisibles = ['\u200b', '\u200c', '\u200d', '\u2060', '\u00ad']
    for (const [i, invisible] of invisibles.entries()) {
      const numero = 7 + i
      assert.equal(
        await crearYLeer(`Cancha${invisible}${numero}`),
        `Cancha ${numero}`,
        `crear con ${JSON.stringify(invisible)}`,
      )
    }
    const { canchaId } = await crearCancha(adminDb, T1, 'traki', { nombre: 'Auxiliar' }, { uid: ADMIN })
    assert.equal(await renombrarYLeer(canchaId, 'CANCHA\u200b6'), 'Cancha 6', 'renombrar con ZWSP')
  })
})

describe('[A3] canchas: desactivar y reactivar (nunca borrar)', () => {
  it('desactivar la saca de getCanchas pero sigue en listarCanchas', async () => {
    await cambiarActivaCancha(adminDb, T1, 'traki', 'c1', false, { uid: ADMIN })

    const activas = await getCanchas(adminDb, T1, 'traki')
    assert.ok(!activas.some((c) => c.id === 'c1'), 'c1 no debe estar en la agenda')

    const todas = await listarCanchas(adminDb, T1, 'traki')
    const c1 = todas.find((c) => c.id === 'c1')
    assert.ok(c1, 'el documento de c1 NO se borra')
    assert.equal(c1.activa, false)
  })

  it('reactivar la devuelve a getCanchas', async () => {
    await cambiarActivaCancha(adminDb, T1, 'traki', 'c1', false, { uid: ADMIN })
    await cambiarActivaCancha(adminDb, T1, 'traki', 'c1', true, { uid: ADMIN })
    assert.ok((await getCanchas(adminDb, T1, 'traki')).some((c) => c.id === 'c1'))
  })

  it('desactivar una cancha inexistente → SedeInvalidaError', async () => {
    await assert.rejects(
      () => cambiarActivaCancha(adminDb, T1, 'traki', 'no-existe', false, { uid: ADMIN }),
      SedeInvalidaError,
    )
  })

  it('una cancha sin el campo activa cuenta como activa (fallback)', async () => {
    await setDoc(doc(adminDb, 'academias', T1, 'sedes', 'traki', 'canchas', 'c3'), {
      nombre: 'Cancha 3',
    })
    assert.ok((await getCanchas(adminDb, T1, 'traki')).some((c) => c.id === 'c3'))
  })
})

/*
 * Desactivar una cancha con clases PENDIENTES (no canceladas y cuyo fin todavía
 * no pasó, comparado contra el reloj inyectado `ahora` en hora local) se
 * rechaza con un mensaje en español que dice cuántas son. Una clase que termina
 * EXACTAMENTE en `ahora` ya terminó, y una clase terminada no bloquea aunque
 * siga sin cerrar o sin cobrar. Reactivar siempre se permite.
 */
describe('[A3] desactivar una cancha con clases pendientes', () => {
  const desactivar = (ahora) =>
    cambiarActivaCancha(adminDb, T1, 'traki', 'c1', false, { uid: ADMIN, ahora })

  /** Estado guardado de la cancha c1 (para verificar que un rechazo no escribe). */
  const canchaC1 = async () =>
    (await listarCanchas(adminDb, T1, 'traki')).find((c) => c.id === 'c1')

  it('una clase futura → rechaza con el nombre y la cantidad', async () => {
    await reservar() // c1, 18:00-19:00
    await assert.rejects(
      () => desactivar(AHORA_RESERVA),
      (error) =>
        error instanceof SedeInvalidaError &&
        error.message ===
          'No se puede desactivar Cancha 1: tiene 1 clase pendiente. Cancélalas o muévelas a otra cancha primero.',
    )
    // El rechazo no escribió nada: la cancha sigue activa.
    assert.equal((await canchaC1()).activa, true)
  })

  it('varias clases pendientes → mensaje en plural con la cantidad', async () => {
    await reservar({ horaInicio: '18:00', horaFin: '19:00' })
    await reservar({ horaInicio: '20:00', horaFin: '21:00' })
    await assert.rejects(
      () => desactivar(AHORA_RESERVA),
      (error) =>
        error instanceof SedeInvalidaError &&
        error.message.startsWith('No se puede desactivar Cancha 1: tiene 2 clases pendientes.'),
    )
    assert.equal((await canchaC1()).activa, true)
  })

  it('una clase más tarde HOY que todavía no terminó → rechaza', async () => {
    await reservar() // 18:00-19:00 del día de ensayo
    const hoyAM = new Date(2026, 10, 15, 10, 0, 0)
    await assert.rejects(
      () => desactivar(hoyAM),
      (error) => error instanceof SedeInvalidaError && /tiene 1 clase pendiente/.test(error.message),
    )
  })

  it('solo clases canceladas → se desactiva', async () => {
    const { claseId } = await reservar()
    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })
    assert.equal((await desactivar(AHORA_RESERVA)).activa, false)
  })

  it('solo clases ya terminadas (aunque sigan sin cerrar o sin cobrar) → se desactiva', async () => {
    await reservar() // 18:00-19:00, queda "reservada": sin cerrar
    await setDoc(doc(adminDb, 'academias', T1, 'clases', 'cobro'), {
      ...clase({ horaInicio: '17:00', horaFin: '18:00' }),
      estado: 'pendiente_cobro',
      bloques: [],
    })
    assert.equal((await desactivar(DESPUES_DEL_FIN)).activa, false)
  })

  it('una clase que termina EXACTAMENTE en `ahora` ya terminó → se desactiva', async () => {
    await reservar() // 18:00-19:00
    const finExacto = new Date(2026, 10, 15, 19, 0, 0)
    assert.equal((await desactivar(finExacto)).activa, false)
  })

  it('las clases de OTRA cancha se ignoran', async () => {
    await reservar({ canchaId: 'c2', profesorId: 'p2' })
    assert.equal((await desactivar(AHORA_RESERVA)).activa, false)
  })

  it('reactivar SIEMPRE se permite, aunque haya clases pendientes', async () => {
    await reservar() // con la cancha activa
    await setDoc(
      doc(adminDb, 'academias', T1, 'sedes', 'traki', 'canchas', 'c1'),
      { activa: false },
      { merge: true },
    )
    const { activa } = await cambiarActivaCancha(adminDb, T1, 'traki', 'c1', true, {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    assert.equal(activa, true)
    assert.equal((await canchaC1()).activa, true)
  })
})

describe('[A3] horario de sede: validación y guardado por día', () => {
  it('horarioDeSede expande el formato viejo y cae al default si falta o está corrupto', () => {
    const porDefecto = horarioDeSede({})
    for (const dia of [0, 3, 6]) assert.deepEqual(porDefecto[dia], FRANJA_DEFAULT)
    // Formato viejo (un par de horas enteras): se expande a los 7 días.
    const viejo = horarioDeSede({ horario: { apertura: 8, cierre: 20 } })
    for (const dia of [0, 3, 6]) assert.deepEqual(viejo[dia], franja(480, 1200))
    // Corrupto: default en los 7 días.
    assert.deepEqual(horarioDeSede({ horario: { apertura: '8', cierre: 20 } })[0], FRANJA_DEFAULT)
    assert.deepEqual(horarioDeSede({ horario: { apertura: 20, cierre: 8 } })[0], FRANJA_DEFAULT)
    assert.deepEqual(horarioDeSede({ horario: { 0: franja(435, 930) } })[0], FRANJA_DEFAULT)
  })

  it('rechaza horarios incompletos, no múltiplos de 30, fuera de rango o con cierre <= apertura', async () => {
    const incompleto = semana()
    delete incompleto[6]
    const invalidos = [
      null,
      [1, 2, 3],
      {},
      incompleto,
      { ...semana(), 7: franja(420, 1380) },
      semana({ 0: franja(435, 930) }), // 7:15 no es múltiplo de 30
      semana({ 0: { apertura: 420, cierre: 1380, extra: 1 } }),
      semana({ 0: { apertura: 420, cierre: 420 } }),
      semana({ 0: franja(900, 420) }),
      semana({ 0: franja(420, 1500) }),
      semana({ 0: franja(-30, 930) }),
      semana({ 0: { apertura: '420', cierre: 1380 } }),
      { apertura: 7, cierre: 23 }, // formato VIEJO al ESCRIBIR: se rechaza
    ]
    for (const horario of invalidos) {
      await assert.rejects(
        () => setSedeHorario(adminDb, T1, 'traki', horario, { uid: ADMIN, ahora: AHORA_RESERVA }),
        SedeInvalidaError,
        `debía rechazar ${JSON.stringify(horario)}`,
      )
    }
    // Ningún rechazo escribió: la sede sigue sin horario (default).
    assert.equal((await getSede(adminDb, T1, 'traki')).horario, undefined)
  })

  it('guarda el horario por día (con días cerrados) y getSede lo devuelve', async () => {
    const propuesto = semana({ 5: franja(480, 780), 6: null }, franja(450, 930))
    const { horario } = await setSedeHorario(adminDb, T1, 'traki', propuesto, {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    assert.deepEqual(horario, propuesto)
    assert.deepEqual((await getSede(adminDb, T1, 'traki')).horario, propuesto)

    // El día cerrado se lee como null (sin huecos) y los abiertos con su franja.
    const guardada = await getSede(adminDb, T1, 'traki')
    const leido = horarioDeSede(guardada)
    assert.equal(horarioDelDia(DOMINGO, leido), null)
    assert.deepEqual(horarioDelDia(SABADO, leido), franja(480, 780))
    assert.deepEqual(horarioDelDia(LUNES, leido), franja(450, 930))
  })

  it('valida en memoria sin tocar la base (validarHorario)', () => {
    assert.deepEqual(validarHorario(semana({ 6: null })), semana({ 6: null }))
    assert.throws(() => validarHorario(semana({ 0: franja(435, 930) })), SedeInvalidaError)
    assert.throws(() => validarHorario({ apertura: 7, cierre: 23 }), SedeInvalidaError)
  })

  it('una sede con el formato VIEJO se lee expandida a 7 días y admite reservas', async () => {
    await setDoc(
      doc(adminDb, 'academias', T1, 'sedes', 'traki'),
      { horario: { apertura: 7, cierre: 23 } },
      { merge: true },
    )
    const expandido = horarioDeSede(await getSede(adminDb, T1, 'traki'))
    for (const dia of [0, 1, 2, 3, 4, 5, 6]) assert.deepEqual(expandido[dia], FRANJA_DEFAULT)
    // La reserva del domingo 18:00-19:00 sigue funcionando con el formato viejo.
    assert.ok((await reservar()).claseId)
  })

  it('setSedeHorario en una sede inexistente → SedeInvalidaError', async () => {
    await assert.rejects(
      () =>
        setSedeHorario(adminDb, T1, 'no-existe', semana(), { uid: ADMIN, ahora: AHORA_RESERVA }),
      (error) => error instanceof SedeInvalidaError && /no existe/.test(error.message),
    )
  })
})

describe('[A3] horario de sede vs clases futuras (por día de la semana)', () => {
  it('rechaza el horario que deja clases futuras fuera, diciendo cuántas', async () => {
    await reservar({ horaInicio: '22:00', horaFin: '23:00' })
    await reservar({ canchaId: 'c2', profesorId: 'p2', horaInicio: '22:00', horaFin: '23:00' })

    await assert.rejects(
      () =>
        setSedeHorario(adminDb, T1, 'traki', semana({}, franja(420, 1320)), {
          uid: ADMIN,
          ahora: AHORA_RESERVA,
        }),
      (error) => error instanceof SedeInvalidaError && /2 clase/.test(error.message),
    )
    // No se guardó nada: la sede sigue sin horario (default).
    assert.equal((await getSede(adminDb, T1, 'traki')).horario, undefined)
  })

  it('compara cada clase con el horario de SU día, en minutos reales', async () => {
    // Una clase el DOMINGO (FECHA) y otra el LUNES, las dos de 22:00 a 23:00.
    await reservar({ horaInicio: '22:00', horaFin: '23:00' })
    await crearClase(
      adminDb,
      T1,
      clase({ fecha: LUNES, canchaId: 'c2', profesorId: 'p2', horaInicio: '22:00', horaFin: '23:00' }),
      { uid: ADMIN, ahora: AHORA_RESERVA },
    )

    // Cerrar antes SOLO el domingo deja fuera solo la clase del domingo.
    await assert.rejects(
      () =>
        setSedeHorario(adminDb, T1, 'traki', semana({ 6: franja(420, 1320) }), {
          uid: ADMIN,
          ahora: AHORA_RESERVA,
        }),
      (error) => error instanceof SedeInvalidaError && /1 clase/.test(error.message),
    )
    // Y al revés: cerrar antes SOLO el lunes deja fuera solo la del lunes.
    await assert.rejects(
      () =>
        setSedeHorario(adminDb, T1, 'traki', semana({ 0: franja(420, 1320) }), {
          uid: ADMIN,
          ahora: AHORA_RESERVA,
        }),
      (error) => error instanceof SedeInvalidaError && /1 clase/.test(error.message),
    )
    // Con los dos días abiertos hasta las 23:00 no queda ninguna fuera.
    const { horario } = await setSedeHorario(adminDb, T1, 'traki', semana(), {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    assert.deepEqual(horario[6], FRANJA_DEFAULT)
  })

  it('un día que queda CERRADO deja fuera a todas sus clases', async () => {
    await reservar() // domingo 18:00-19:00
    await assert.rejects(
      () =>
        setSedeHorario(adminDb, T1, 'traki', semana({ 6: null }), {
          uid: ADMIN,
          ahora: AHORA_RESERVA,
        }),
      (error) => error instanceof SedeInvalidaError && /1 clase/.test(error.message),
    )
  })

  it('rechaza un horario que abre más tarde que una clase futura', async () => {
    await reservar() // domingo 18:00-19:00
    await assert.rejects(
      () =>
        setSedeHorario(adminDb, T1, 'traki', semana({ 6: franja(1200, 1380) }), {
          uid: ADMIN,
          ahora: AHORA_RESERVA,
        }),
      (error) => error instanceof SedeInvalidaError && /1 clase/.test(error.message),
    )
  })

  it('ignora las clases canceladas y las de fechas pasadas', async () => {
    const { claseId } = await reservar({ horaInicio: '22:00', horaFin: '23:00' })
    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })
    // Clase pasada escrita a mano (una reserva en el pasado no es válida).
    await setDoc(doc(adminDb, 'academias', T1, 'clases', 'pasada'), {
      ...clase({ fecha: '2026-11-14', horaInicio: '22:00', horaFin: '23:00' }),
      estado: 'reservada',
      bloques: [],
    })

    const { horario } = await setSedeHorario(adminDb, T1, 'traki', semana({}, franja(420, 1320)), {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    assert.deepEqual(horario[0], franja(420, 1320))
  })
})

describe('[A3] reserva y reprogramación usan el horario del día de la sede', () => {
  /** Madrugada del día de ensayo: sirve para probar franjas fuera de 07-23. */
  const AHORA_MADRUGADA = new Date(2026, 10, 15, 5, 0, 0)

  it('sin horario, la sede usa el default 07:00-23:00', async () => {
    assert.equal((await getSede(adminDb, T1, 'traki')).horario, undefined)
    assert.ok((await reservar({ horaInicio: '22:00', horaFin: '23:00' })).claseId)
    await assert.rejects(
      () =>
        crearClase(adminDb, T1, clase({ horaInicio: '06:00', horaFin: '07:00' }), {
          uid: ADMIN,
          ahora: AHORA_MADRUGADA,
        }),
      /empezar antes/,
    )
  })

  it('con la sede abierta a las 06:00, la reserva de 06:00 se acepta', async () => {
    await setSedeHorario(adminDb, T1, 'traki', semana({}, franja(360, 1440)), {
      uid: ADMIN,
      ahora: AHORA_MADRUGADA,
    })
    const { claseId } = await crearClase(
      adminDb,
      T1,
      clase({ horaInicio: '06:00', horaFin: '07:00' }),
      { uid: ADMIN, ahora: AHORA_MADRUGADA },
    )
    assert.ok(claseId)
  })

  it('una sede que abre 7:30 admite la reserva de 7:30 y rechaza la de 7:00', async () => {
    await setSedeHorario(adminDb, T1, 'traki', semana({}, franja(450, 930)), {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    // Lunes 7:30-8:30: entra justo a la apertura.
    assert.ok(
      (
        await crearClase(
          adminDb,
          T1,
          clase({ fecha: LUNES, horaInicio: '07:30', horaFin: '08:30' }),
          { uid: ADMIN, ahora: AHORA_RESERVA },
        )
      ).claseId,
    )
    // Lunes 7:00-8:00: empieza antes de la apertura (otra cancha y profesor).
    await assert.rejects(
      () =>
        crearClase(
          adminDb,
          T1,
          clase({
            fecha: LUNES,
            canchaId: 'c2',
            profesorId: 'p2',
            horaInicio: '07:00',
            horaFin: '08:00',
          }),
          { uid: ADMIN, ahora: AHORA_RESERVA },
        ),
      /empezar antes/,
    )
  })

  it('rechaza una reserva en un día CERRADO', async () => {
    await setSedeHorario(adminDb, T1, 'traki', semana({ 6: null }), {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    await assert.rejects(
      () => reservar(),
      (error) => error instanceof ClaseInvalidaError && /cerrada/.test(error.message),
    )
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), false)
  })

  it('rechaza una reserva antes de la apertura de la sede', async () => {
    await setSedeHorario(adminDb, T1, 'traki', semana({}, franja(1140, 1380)), {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    await assert.rejects(() => reservar({ horaInicio: '18:00', horaFin: '19:00' }), /empezar antes/)
  })

  it('rechaza una reserva que termina después del cierre de la sede', async () => {
    await setSedeHorario(adminDb, T1, 'traki', semana({}, franja(420, 1320)), {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    await assert.rejects(() => reservar({ horaInicio: '22:00', horaFin: '23:00' }), /terminar/)
  })

  it('permite reservar justo dentro del horario de la sede', async () => {
    await setSedeHorario(adminDb, T1, 'traki', semana({}, franja(1080, 1380)), {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    assert.ok((await reservar({ horaInicio: '18:00', horaFin: '19:00' })).claseId)
    assert.ok(
      (
        await reservar({
          canchaId: 'c2',
          profesorId: 'p2',
          horaInicio: '22:00',
          horaFin: '23:00',
        })
      ).claseId,
    )
  })

  it('la reprogramación usa el horario del día de la sede destino', async () => {
    const { claseId } = await reservar() // domingo 18:00-19:00
    await setSedeHorario(adminDb, T1, 'traki', semana({}, franja(420, 1320)), {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    await assert.rejects(
      () =>
        reprogramarClase(
          adminDb,
          T1,
          claseId,
          { horaInicio: '22:00', horaFin: '23:00' },
          { uid: ADMIN, ahora: AHORA_RESERVA },
        ),
      /terminar/,
    )
    // La clase original queda intacta.
    assert.equal((await getClase(adminDb, T1, claseId)).horaInicio, '18:00')
  })

  it('la reprogramación a un día CERRADO se rechaza', async () => {
    const { claseId } = await reservar() // domingo 18:00-19:00
    await setSedeHorario(adminDb, T1, 'traki', semana({ 0: null }), {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    await assert.rejects(
      () =>
        reprogramarClase(
          adminDb,
          T1,
          claseId,
          { fecha: LUNES, horaInicio: '18:00', horaFin: '19:00' },
          { uid: ADMIN, ahora: AHORA_RESERVA },
        ),
      (error) => error instanceof ClaseInvalidaError && /cerrada/.test(error.message),
    )
    assert.equal((await getClase(adminDb, T1, claseId)).fecha, FECHA)
  })
})

describe('[A3] cancha inactiva: rechaza reservas nuevas y reprogramaciones', () => {
  it('crearClase en una cancha inactiva → DENY', async () => {
    await cambiarActivaCancha(adminDb, T1, 'traki', 'c1', false, { uid: ADMIN })
    await assert.rejects(
      () => reservar(),
      (error) => error instanceof ClaseInvalidaError && /cancha/.test(error.message),
    )
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), false)
  })

  it('reprogramar HACIA una cancha inactiva → DENY y la clase queda intacta', async () => {
    const { claseId, bloques } = await reservar() // c1
    await cambiarActivaCancha(adminDb, T1, 'traki', 'c2', false, { uid: ADMIN })

    await assert.rejects(
      () =>
        reprogramarClase(adminDb, T1, claseId, { canchaId: 'c2' }, { uid: ADMIN, ahora: AHORA_RESERVA }),
      (error) => error instanceof ClaseInvalidaError && /cancha/.test(error.message),
    )
    const original = await getClase(adminDb, T1, claseId)
    assert.equal(original.canchaId, 'c1')
    assert.deepEqual(original.bloques, bloques)
  })

  it('desactivar una cancha NO toca las clases que ya la usan', async () => {
    const { claseId, bloques } = await reservar() // c1
    // Se desactiva con el reloj DESPUÉS del fin de la clase: con una clase
    // pendiente la desactivación se rechaza (ver el describe de más abajo).
    await cambiarActivaCancha(adminDb, T1, 'traki', 'c1', false, {
      uid: ADMIN,
      ahora: DESPUES_DEL_FIN,
    })

    const claseGuardada = await getClase(adminDb, T1, claseId)
    assert.equal(claseGuardada.estado, 'reservada')
    assert.equal(claseGuardada.canchaId, 'c1')
    assert.deepEqual(claseGuardada.bloques, bloques)
    for (const bloqueId of bloques) {
      assert.ok((await bloque(bloqueId)).exists(), `bloque ${bloqueId} intacto`)
    }
  })
})
/* --------------------------------------------------------------------- */
/* [F2] Sedes: crear, renombrar, desactivar y reactivar                    */
/* --------------------------------------------------------------------- */

describe('[F2] sedes: crear, renombrar, desactivar y reactivar', () => {
  const leerSede = (sedeId) => getSede(adminDb, T1, sedeId)

  it('crearSede normaliza el nombre, la deja activa y con horario default', async () => {
    const { sedeId } = await crearSede(adminDb, T1, { nombre: '  boleita   norte ' }, { uid: ADMIN })
    const sede = await leerSede(sedeId)
    assert.equal(sede.nombre, 'Boleita Norte')
    assert.equal(sede.activa, true)
    assert.ok(Number.isInteger(sede.orden))
    assert.deepEqual(sede.horario, semana())
    // Nace visible en la agenda y en la lista completa.
    assert.ok((await getSedes(adminDb, T1)).some((s) => s.id === sedeId))
    assert.ok((await listarSedes(adminDb, T1)).some((s) => s.id === sedeId))
  })

  it('crearSede con nombre vacío o solo espacios → SedeInvalidaError', async () => {
    await assert.rejects(
      () => crearSede(adminDb, T1, { nombre: '   ' }, { uid: ADMIN }),
      (error) => error instanceof SedeInvalidaError && /nombre/.test(error.message),
    )
  })

  it('crearSede con nombre repetido (caja, espacios y acentos) → SedeInvalidaError', async () => {
    await crearSede(adminDb, T1, { nombre: 'Boleíta' }, { uid: ADMIN })
    for (const repetido of ['traki', '  TRAKI  ', 'boleita', 'BOLEITA']) {
      await assert.rejects(
        () => crearSede(adminDb, T1, { nombre: repetido }, { uid: ADMIN }),
        (error) => error instanceof SedeInvalidaError && /Ya hay una sede llamada/.test(error.message),
        `debía rechazar ${repetido}`,
      )
    }
    // La sede nueva NO se creó: siguen traki + Boleíta.
    assert.equal((await listarSedes(adminDb, T1)).length, 2)
  })

  it('crearSede guarda el horario por día que se le pase y valida el que no sirve', async () => {
    const horario = semana({ 0: franja(450, 930), 6: null })
    const { sedeId } = await crearSede(adminDb, T1, { nombre: 'Media Hora', horario }, { uid: ADMIN })
    assert.deepEqual((await leerSede(sedeId)).horario, horario)
    await assert.rejects(
      () =>
        crearSede(
          adminDb,
          T1,
          { nombre: 'Horario malo', horario: semana({ 0: franja(435, 930) }) },
          { uid: ADMIN },
        ),
      SedeInvalidaError,
    )
  })

  it('renombrarSede normaliza, acepta su propio nombre y rechaza el de otra sede', async () => {
    const { sedeId } = await crearSede(adminDb, T1, { nombre: 'boleita' }, { uid: ADMIN })
    const { nombre } = await renombrarSede(adminDb, T1, sedeId, '  Central  ', { uid: ADMIN })
    assert.equal(nombre, 'Central')
    // El propio nombre en otra caja no es conflicto y queda normalizado.
    await renombrarSede(adminDb, T1, sedeId, 'CENTRAL', { uid: ADMIN })
    assert.equal((await leerSede(sedeId)).nombre, 'Central')
    // El nombre de OTRA sede sí se rechaza.
    await assert.rejects(
      () => renombrarSede(adminDb, T1, sedeId, '  traki ', { uid: ADMIN }),
      (error) =>
        error instanceof SedeInvalidaError &&
        error.message === 'Ya hay una sede llamada "Traki"',
    )
    await assert.rejects(
      () => renombrarSede(adminDb, T1, 'no-existe', 'Otra', { uid: ADMIN }),
      SedeInvalidaError,
    )
  })

  it('desactivar una sede sin clases pendientes la saca de la agenda pero no la borra', async () => {
    const { sedeId } = await crearSede(adminDb, T1, { nombre: 'Auxiliar' }, { uid: ADMIN })
    const { activa } = await desactivarSede(adminDb, T1, sedeId, {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    assert.equal(activa, false)
    assert.ok(!(await getSedes(adminDb, T1)).some((s) => s.id === sedeId))
    // El documento NO se borra: sigue en la lista completa para reactivarla.
    const todas = await listarSedes(adminDb, T1)
    const guardada = todas.find((s) => s.id === sedeId)
    assert.ok(guardada, 'el documento de la sede NO se borra')
    assert.equal(guardada.activa, false)
  })

  it('desactivar una sede con clases pendientes → rechaza con la cantidad y no escribe', async () => {
    await reservar() // domingo 18:00-19:00 en traki
    await assert.rejects(
      () => desactivarSede(adminDb, T1, 'traki', { uid: ADMIN, ahora: AHORA_RESERVA }),
      (error) =>
        error instanceof SedeInvalidaError &&
        error.message ===
          'No se puede desactivar Traki: tiene 1 clase pendiente. Cancélalas o muévelas a otra sede primero.',
    )
    assert.equal((await leerSede('traki')).activa, true)
  })

  it('varias clases pendientes → mensaje en plural con la cantidad', async () => {
    await reservar({ horaInicio: '18:00', horaFin: '19:00' })
    await reservar({ canchaId: 'c2', profesorId: 'p2', horaInicio: '20:00', horaFin: '21:00' })
    await assert.rejects(
      () => desactivarSede(adminDb, T1, 'traki', { uid: ADMIN, ahora: AHORA_RESERVA }),
      (error) =>
        error instanceof SedeInvalidaError &&
        error.message.startsWith('No se puede desactivar Traki: tiene 2 clases pendientes.'),
    )
  })

  it('solo cuentan las clases PENDIENTES: una cancelada no bloquea', async () => {
    const { claseId } = await reservar()
    await cancelarClase(adminDb, T1, claseId, { uid: ADMIN })
    const { activa } = await desactivarSede(adminDb, T1, 'traki', {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    assert.equal(activa, false)
  })

  it('una clase ya terminada no bloquea la desactivación', async () => {
    await reservar() // 18:00-19:00
    const { activa } = await desactivarSede(adminDb, T1, 'traki', {
      uid: ADMIN,
      ahora: DESPUES_DEL_FIN,
    })
    assert.equal(activa, false)
  })

  it('reactivar SIEMPRE se permite, aunque haya clases pendientes', async () => {
    await reservar() // clase pendiente en traki
    await setDoc(
      doc(adminDb, 'academias', T1, 'sedes', 'traki'),
      { activa: false },
      { merge: true },
    )
    const { activa } = await reactivarSede(adminDb, T1, 'traki', { uid: ADMIN })
    assert.equal(activa, true)
    assert.equal((await leerSede('traki')).activa, true)
  })

  it('una sede desactivada rechaza reservas nuevas', async () => {
    await setDoc(
      doc(adminDb, 'academias', T1, 'sedes', 'traki'),
      { activa: false },
      { merge: true },
    )
    await assert.rejects(
      () => reservar(),
      (error) => error instanceof ClaseInvalidaError && /no está activa/.test(error.message),
    )
  })

  it('desactivar o reactivar una sede inexistente → SedeInvalidaError', async () => {
    await assert.rejects(
      () => desactivarSede(adminDb, T1, 'no-existe', { uid: ADMIN }),
      SedeInvalidaError,
    )
    await assert.rejects(
      () => reactivarSede(adminDb, T1, 'no-existe', { uid: ADMIN }),
      SedeInvalidaError,
    )
  })
})

/* --------------------------------------------------------------------- */
/* [F2] Categoría de grupo de la clase (distinta del nivel `categoria`)    */
/* --------------------------------------------------------------------- */

describe('[F2] categoría de grupo en la clase', () => {
  it('crearClase guarda la categoría de grupo válida', async () => {
    const { claseId } = await reservar({ categoriaGrupo: 'infantil' })
    assert.equal((await getClase(adminDb, T1, claseId)).categoriaGrupo, 'infantil')
  })

  it('crearClase sin categoría de grupo la deja en null', async () => {
    const { claseId } = await reservar()
    assert.equal((await getClase(adminDb, T1, claseId)).categoriaGrupo, null)
  })

  it('crearClase con categoría de grupo inválida → ClaseInvalidaError', async () => {
    for (const valor of ['juvenil', 'Infantil', 'adultos', 'niños', 7, {}]) {
      await assert.rejects(
        () => reservar({ categoriaGrupo: valor }),
        (error) =>
          error instanceof ClaseInvalidaError && /Categoría de grupo inválida/.test(error.message),
        `debía rechazar ${JSON.stringify(valor)}`,
      )
    }
    // Ningún rechazo escribió la clase.
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), false)
  })

  it('la categoría de grupo es un campo APARTE del nivel de la clase', async () => {
    const { claseId } = await reservar({ categoria: '6a', categoriaGrupo: 'junior' })
    const guardada = await getClase(adminDb, T1, claseId)
    assert.equal(guardada.categoria, '6a')
    assert.equal(guardada.categoriaGrupo, 'junior')
  })

  it('reprogramarClase cambia la categoría de grupo, la limpia con null y la valida', async () => {
    const { claseId } = await reservar({ categoriaGrupo: 'infantil' })
    await reprogramarClase(
      adminDb,
      T1,
      claseId,
      { categoriaGrupo: 'adulto' },
      { uid: ADMIN, ahora: AHORA_RESERVA },
    )
    assert.equal((await getClase(adminDb, T1, claseId)).categoriaGrupo, 'adulto')

    await reprogramarClase(
      adminDb,
      T1,
      claseId,
      { categoriaGrupo: null },
      { uid: ADMIN, ahora: AHORA_RESERVA },
    )
    assert.equal((await getClase(adminDb, T1, claseId)).categoriaGrupo, null)

    await assert.rejects(
      () =>
        reprogramarClase(
          adminDb,
          T1,
          claseId,
          { categoriaGrupo: 'juvenil' },
          { uid: ADMIN, ahora: AHORA_RESERVA },
        ),
      (error) =>
        error instanceof ClaseInvalidaError && /Categoría de grupo inválida/.test(error.message),
    )
  })
})

/* --------------------------------------------------------------------- */
/* [F3] Cobros: perfiles, tarifas por sede, parámetros y cobro de clase    */
/* --------------------------------------------------------------------- */

/** Crea un perfil con id fijo (como el seed) y devuelve el resultado. */
const sembrarPerfil = (perfilId, datos = {}) =>
  crearPerfilCobro(
    adminDb,
    T1,
    { nombre: `Perfil ${perfilId}`, modo: 'total', personas: null, ...datos },
    { uid: ADMIN, perfilId },
  )

describe('[F3] perfiles de cobro', () => {
  it('una academia sin perfiles lista vacío', async () => {
    assert.deepEqual(await listarPerfilesCobro(adminDb, T1), [])
  })

  it('crea un perfil con orden automático y lo devuelve en el listado', async () => {
    await crearPerfilCobro(
      adminDb,
      T1,
      { nombre: '  Individual  ', personas: 1, modo: 'total' },
      { uid: ADMIN },
    )
    const lista = await listarPerfilesCobro(adminDb, T1)
    assert.equal(lista.length, 1)
    assert.equal(lista[0].nombre, 'Individual')
    assert.equal(lista[0].orden, 1)
    assert.equal(lista[0].activo, true)
    assert.equal(lista[0].personas, 1)
  })

  it('crea con id fijo (seed) y ordena por `orden`', async () => {
    await sembrarPerfil('b', { nombre: 'Segundo', orden: 2 })
    await sembrarPerfil('a', { nombre: 'Primero', orden: 1 })
    const ids = (await listarPerfilesCobro(adminDb, T1)).map((p) => p.id)
    assert.deepEqual(ids, ['a', 'b'])
  })

  it('rechaza un nombre duplicado (sin importar mayúsculas/espacios)', async () => {
    await crearPerfilCobro(adminDb, T1, { nombre: 'Pareja' }, { uid: ADMIN })
    await assert.rejects(
      () => crearPerfilCobro(adminDb, T1, { nombre: '  pareja ' }, { uid: ADMIN }),
      CobroInvalidoError,
    )
  })

  it('rechaza nombre vacío, modo y personas inválidos', async () => {
    await assert.rejects(
      () => crearPerfilCobro(adminDb, T1, { nombre: '   ' }, { uid: ADMIN }),
      CobroInvalidoError,
    )
    await assert.rejects(
      () => crearPerfilCobro(adminDb, T1, { nombre: 'X', modo: 'mitad' }, { uid: ADMIN }),
      CobroInvalidoError,
    )
    await assert.rejects(
      () => crearPerfilCobro(adminDb, T1, { nombre: 'X', personas: 5 }, { uid: ADMIN }),
      CobroInvalidoError,
    )
  })

  it('actualiza campos y desactiva (soft delete: nunca se borra)', async () => {
    await sembrarPerfil('p', { nombre: 'Pareja', personas: 2, modo: 'total' })
    await actualizarPerfilCobro(
      adminDb,
      T1,
      'p',
      { nombre: 'Duplas', modo: 'por_persona' },
      { uid: ADMIN },
    )
    const guardado = (await listarPerfilesCobro(adminDb, T1)).find((p) => p.id === 'p')
    assert.equal(guardado.nombre, 'Duplas')
    assert.equal(guardado.modo, 'por_persona')

    await cambiarActivaPerfilCobro(adminDb, T1, 'p', false, { uid: ADMIN })
    const inactivo = (await listarPerfilesCobro(adminDb, T1)).find((p) => p.id === 'p')
    assert.equal(inactivo.activo, false)
  })

  it('actualizar un perfil inexistente → CobroInvalidoError', async () => {
    await assert.rejects(
      () => actualizarPerfilCobro(adminDb, T1, 'nope', { nombre: 'X' }, { uid: ADMIN }),
      CobroInvalidoError,
    )
    await assert.rejects(
      () => cambiarActivaPerfilCobro(adminDb, T1, 'nope', false, { uid: ADMIN }),
      CobroInvalidoError,
    )
  })
})

describe('[F3] tarifas por sede', () => {
  it('validaTarifas normaliza el mapa y rechaza lo inválido', () => {
    const perfiles = [{ id: 'a' }, { id: 'b' }]
    assert.deepEqual(validarTarifas({ a: 4000 }, perfiles), { a: 4000 })
    assert.throws(() => validarTarifas({ a: 4000, z: 100 }, perfiles), CobroInvalidoError)
    assert.throws(() => validarTarifas({ a: -1 }, perfiles), CobroInvalidoError)
    assert.throws(() => validarTarifas(null, perfiles), CobroInvalidoError)
  })

  it('fija y REEMPLAZA el mapa completo de una sede', async () => {
    await sembrarPerfil('a', { nombre: 'A' })
    await sembrarPerfil('b', { nombre: 'B' })
    await setTarifasSede(adminDb, T1, 'traki', { a: 4000, b: 4500 }, { uid: ADMIN })
    assert.deepEqual((await getSede(adminDb, T1, 'traki')).tarifas, { a: 4000, b: 4500 })

    // Reemplazo: la clave ausente queda sin tarifa.
    await setTarifasSede(adminDb, T1, 'traki', { a: 5000 }, { uid: ADMIN })
    assert.deepEqual((await getSede(adminDb, T1, 'traki')).tarifas, { a: 5000 })
  })

  it('rechaza una tarifa de un perfil desconocido', async () => {
    await sembrarPerfil('a', { nombre: 'A' })
    await assert.rejects(
      () => setTarifasSede(adminDb, T1, 'traki', { z: 100 }, { uid: ADMIN }),
      CobroInvalidoError,
    )
  })

  it('rechaza montos que no son enteros de centavos válidos', async () => {
    await sembrarPerfil('a', { nombre: 'A' })
    await assert.rejects(
      () => setTarifasSede(adminDb, T1, 'traki', { a: -5 }, { uid: ADMIN }),
      CobroInvalidoError,
    )
  })
})

describe('[F3] parámetros de la academia', () => {
  it('getParametros devuelve los defaults cuando no existe el documento', async () => {
    assert.deepEqual(await getParametros(adminDb, T1), { ...PARAMETROS_DEFAULT })
  })

  it('validarParametros completa con defaults y valida rangos', () => {
    const normal = validarParametros({})
    assert.deepEqual(normal, { ...PARAMETROS_DEFAULT })
    assert.throws(() => validarParametros({ porcentajeFaltaSinAviso: 101 }), CobroInvalidoError)
    assert.throws(() => validarParametros({ duracionesPermitidas: [] }), CobroInvalidoError)
    assert.throws(() => validarParametros({ alertaCobro: { dias: -1 } }), CobroInvalidoError)
    assert.throws(() => validarParametros({ campoRaro: 1 }), CobroInvalidoError)
  })

  it('setParametros mezcla cambios parciales sobre los actuales', async () => {
    await setParametros(adminDb, T1, { avisoAusenciaHoras: 48 }, { uid: ADMIN })
    let guardados = await getParametros(adminDb, T1)
    assert.equal(guardados.avisoAusenciaHoras, 48)
    assert.equal(guardados.porcentajeFaltaSinAviso, PARAMETROS_DEFAULT.porcentajeFaltaSinAviso)

    await setParametros(
      adminDb,
      T1,
      { pagoProfesor: { modo: 'por_clase', montoCents: 3000 }, vencimientoCreditoDias: 30 },
      { uid: ADMIN },
    )
    guardados = await getParametros(adminDb, T1)
    assert.deepEqual(guardados.pagoProfesor, { modo: 'por_clase', montoCents: 3000 })
    assert.equal(guardados.vencimientoCreditoDias, 30)
    // El cambio previo sigue intacto (mezcla, no reemplazo).
    assert.equal(guardados.avisoAusenciaHoras, 48)
  })

  it('setParametros rechaza valores inválidos y no escribe', async () => {
    await assert.rejects(
      () => setParametros(adminDb, T1, { porcentajeFaltaSinAviso: -1 }, { uid: ADMIN }),
      CobroInvalidoError,
    )
    assert.deepEqual(await getParametros(adminDb, T1), { ...PARAMETROS_DEFAULT })
  })
})

describe('[F3] cobro de la clase (snapshot)', () => {
  const cobroValido = {
    perfilCobroId: 'cuatro',
    modo: 'total',
    tarifaHoraCents: 5500,
    montoEstandarCents: 5500,
    montoCents: 5500,
    ajustado: false,
    motivoAjuste: null,
  }

  it('validarCobro normaliza y rechaza formas inválidas', () => {
    assert.deepEqual(validarCobro(cobroValido), cobroValido)
    assert.equal(validarCobro(null), null)
    assert.equal(validarCobro(undefined), null)
    assert.throws(() => validarCobro({ ...cobroValido, montoCents: -1 }), CobroInvalidoError)
    assert.throws(() => validarCobro({ ...cobroValido, modo: 'mitad' }), CobroInvalidoError)
    assert.throws(() => validarCobro({ ...cobroValido, extra: 1 }), CobroInvalidoError)
  })

  it('crearClase guarda el snapshot de cobro tal cual', async () => {
    const { claseId } = await reservar({ cobro: { ...cobroValido, ajustado: true, motivoAjuste: 'descuento' } })
    const guardada = await getClase(adminDb, T1, claseId)
    assert.deepEqual(guardada.cobro, { ...cobroValido, ajustado: true, motivoAjuste: 'descuento' })
  })

  it('crearClase sin cobro lo deja en null', async () => {
    const { claseId } = await reservar()
    assert.equal((await getClase(adminDb, T1, claseId)).cobro, null)
  })

  it('crearClase con un cobro inválido → CobroInvalidoError y no escribe', async () => {
    await assert.rejects(
      () => reservar({ cobro: { ...cobroValido, montoCents: 'gratis' } }),
      CobroInvalidoError,
    )
    assert.equal((await bloque(`traki_c1_${FECHA}_1800`)).exists(), false)
  })

  it('reprogramar sin `cobro` conserva el existente', async () => {
    const { claseId } = await reservar({ cobro: cobroValido })
    await reprogramarClase(adminDb, T1, claseId, { horaInicio: '20:00', horaFin: '21:00' }, {
      uid: ADMIN,
      ahora: AHORA_RESERVA,
    })
    assert.deepEqual((await getClase(adminDb, T1, claseId)).cobro, cobroValido)
  })

  it('reprogramar con `cobro: null` lo limpia', async () => {
    const { claseId } = await reservar({ cobro: cobroValido })
    await reprogramarClase(adminDb, T1, claseId, { cobro: null }, { uid: ADMIN, ahora: AHORA_RESERVA })
    assert.equal((await getClase(adminDb, T1, claseId)).cobro, null)
  })

  it('crearClase respeta duracionesPermitidas de los parámetros', async () => {
    // Solo 120 min: la clase de 1 h (18:00-19:00) debe fallar.
    await setParametros(adminDb, T1, { duracionesPermitidas: [120] }, { uid: ADMIN })
    await assert.rejects(
      () => reservar(),
      (error) => error instanceof ClaseInvalidaError && /duración debe ser/.test(error.message),
    )
    // Y una de 2 h sí se crea.
    const { claseId } = await reservar({ horaInicio: '18:00', horaFin: '20:00' })
    assert.equal((await getClase(adminDb, T1, claseId)).horaFin, '20:00')
  })
})

/* --------------------------------------------------------------------- */
/* [F4] Cierre de clase: cargos y pago al profesor                        */
/* --------------------------------------------------------------------- */

describe('[F4] cerrarClase: cargos y pago al profesor', () => {
  const cobroPareja = {
    perfilCobroId: 'pareja',
    modo: 'total',
    tarifaHoraCents: 5000,
    montoEstandarCents: 5000,
    montoCents: 5000,
    ajustado: false,
    motivoAjuste: null,
  }

  const presentes = (ids) => ids.map((alumnoId) => ({ alumnoId, estado: 'presente' }))

  it('escribe asistencia, cargos y pago en una sola transacción', async () => {
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'], cobro: cobroPareja })
    const res = await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: presentes(['a1', 'a2']) },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )

    const clase = await getClase(adminDb, T1, claseId)
    assert.equal(clase.estado, 'pendiente_cobro')
    assert.equal(clase.facturada, true)
    assert.equal(clase.asistencias.length, 2)

    const { cargos, pagoProfesor } = await getCierreDeClase(adminDb, T1, claseId)
    assert.deepEqual(
      cargos.map((c) => c.id).sort(),
      [`${claseId}_a1`, `${claseId}_a2`].sort(),
    )
    assert.ok(cargos.every((c) => c.estado === 'pendiente' && c.montoCents === 2500))
    assert.ok(cargos.every((c) => c.concepto === 'clase' && c.sedeId === 'traki'))
    assert.equal(pagoProfesor.id, claseId)
    assert.equal(pagoProfesor.montoCents, 1500)
    assert.deepEqual(pagoProfesor.base, { modo: 'por_hora', minutos: 60 })
    assert.equal(pagoProfesor.estado, 'pendiente')
    assert.equal(res.pagoProfesor.montoCents, 1500)
  })

  it('el doble cierre se rechaza y no duplica cargos (ids deterministas)', async () => {
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'], cobro: cobroPareja })
    await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: presentes(['a1', 'a2']) },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )
    await assert.rejects(
      cerrarClase(
        adminDb,
        T1,
        claseId,
        { asistencias: presentes(['a1', 'a2']) },
        { uid: ADMIN, ahora: DESPUES_DEL_FIN },
      ),
      /ya está cerrada/,
    )
    const { cargos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.length, 2)
  })

  it('mantiene las guardias: alumno ajeno y hora de fin', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await assert.rejects(
      cerrarClase(
        adminDb,
        T1,
        claseId,
        { asistencias: presentes(['a1', 'a2']) },
        { uid: ADMIN, ahora: DESPUES_DEL_FIN },
      ),
      /exactamente una entrada/,
    )
    await assert.rejects(
      cerrarClase(
        adminDb,
        T1,
        claseId,
        { asistencias: presentes(['a1']) },
        { uid: ADMIN, ahora: AHORA_RESERVA },
      ),
      /todavía no terminó/,
    )
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'reservada')
  })

  it('seFactura false: cierra sin cargos ni pago', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroPareja })
    await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: presentes(['a1']), seFactura: false },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )
    const clase = await getClase(adminDb, T1, claseId)
    assert.equal(clase.facturada, false)
    const { cargos, pagoProfesor } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.length, 0)
    assert.equal(pagoProfesor, null)
  })

  it('sin cobro exige monto manual; con él, genera el cargo', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await assert.rejects(
      cerrarClase(
        adminDb,
        T1,
        claseId,
        { asistencias: presentes(['a1']) },
        { uid: ADMIN, ahora: DESPUES_DEL_FIN },
      ),
      CobroInvalidoError,
    )
    await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: presentes(['a1']), montoCents: 3000 },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )
    const { cargos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.length, 1)
    assert.equal(cargos[0].montoCents, 3000)
    const clase = await getClase(adminDb, T1, claseId)
    assert.equal(clase.cobro.montoCents, 3000)
    assert.equal(clase.cobro.ajustado, true)
  })
})

describe('[F4] marcar pagado y anular cierre', () => {
  const cobroUno = {
    perfilCobroId: 'individual',
    modo: 'total',
    tarifaHoraCents: 5000,
    montoEstandarCents: 5000,
    montoCents: 5000,
    ajustado: false,
    motivoAjuste: null,
  }

  async function cerrarUno() {
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: [{ alumnoId: 'a1', estado: 'presente' }] },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )
    const { cargos, pagoProfesor } = await getCierreDeClase(adminDb, T1, claseId)
    return { claseId, cargoId: cargos[0].id, cargos, pagoProfesor }
  }

  it('marca un cargo pagado y luego bloquea el anular', async () => {
    const { claseId, cargoId } = await cerrarUno()
    await marcarCargoPagado(adminDb, T1, cargoId, { metodoPago: 'efectivo' }, { uid: ADMIN })
    const { cargos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.find((c) => c.id === cargoId).estado, 'pagado')
    assert.ok(cargos.find((c) => c.id === cargoId).pagadoEn)
    await assert.rejects(anularCierre(adminDb, T1, claseId, { uid: ADMIN }), /cobro o pago ya registrado/)
  })

  it('valida el método de pago y la existencia', async () => {
    const { cargoId } = await cerrarUno()
    await assert.rejects(
      marcarCargoPagado(adminDb, T1, cargoId, { metodoPago: 'bitcoin' }, { uid: ADMIN }),
      CobroInvalidoError,
    )
    await assert.rejects(
      marcarCargoPagado(adminDb, T1, 'nope', { metodoPago: 'efectivo' }, { uid: ADMIN }),
      ClaseInvalidaError,
    )
  })

  it('el método de pago del profesor usa el mismo catálogo', async () => {
    const { claseId } = await cerrarUno()
    await marcarPagoProfesorPagado(adminDb, T1, claseId, { metodoPago: 'zelle' }, { uid: ADMIN })
    const { pagoProfesor } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(pagoProfesor.estado, 'pagado')
    assert.equal(pagoProfesor.metodoPago, 'zelle')
    await assert.rejects(anularCierre(adminDb, T1, claseId, { uid: ADMIN }), /cobro o pago ya registrado/)
  })

  it('anular el cierre vuelve la clase a reservada y permite cerrarla de nuevo', async () => {
    const { claseId } = await cerrarUno()
    await anularCierre(adminDb, T1, claseId, { uid: ADMIN })
    const clase = await getClase(adminDb, T1, claseId)
    assert.equal(clase.estado, 'reservada')
    const cierre = await getCierreDeClase(adminDb, T1, claseId)
    assert.ok(cierre.cargos.every((c) => c.estado === 'anulado'))
    assert.equal(cierre.pagoProfesor.estado, 'anulado')

    // Se puede volver a cerrar: los cargos y el pago vuelven a `pendiente`.
    await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: [{ alumnoId: 'a1', estado: 'presente' }] },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )
    const recerrado = await getCierreDeClase(adminDb, T1, claseId)
    assert.ok(recerrado.cargos.every((c) => c.estado === 'pendiente'))
    assert.equal(recerrado.pagoProfesor.estado, 'pendiente')
  })
})

describe('[F4] listados de cobros pendientes', () => {
  const cobro = {
    perfilCobroId: 'individual',
    modo: 'total',
    tarifaHoraCents: 5000,
    montoEstandarCents: 5000,
    montoCents: 5000,
    ajustado: false,
    motivoAjuste: null,
  }

  it('devuelve cargos y pagos pendientes acotados por sede y fecha', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'], cobro })
    await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: [{ alumnoId: 'a1', estado: 'presente' }] },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )

    const cargos = await listarCargosPendientes(adminDb, T1, {
      sedeId: 'traki',
      desde: FECHA,
      hasta: FECHA,
    })
    assert.equal(cargos.length, 1)
    assert.equal(cargos[0].claseId, claseId)

    const pagos = await listarPagosProfesorPendientes(adminDb, T1, {
      sedeId: 'traki',
      desde: FECHA,
      hasta: FECHA,
    })
    assert.equal(pagos.length, 1)
    assert.equal(pagos[0].claseId, claseId)
    assert.equal(pagos[0].montoCents, 1500)

    // Fuera del rango no aparece nada.
    const fuera = await listarCargosPendientes(adminDb, T1, { desde: '2027-01-01', hasta: '2027-01-02' })
    assert.equal(fuera.length, 0)
  })
})

/* --------------------------------------------------------------------- */
/* [F5] Mensualidades: planes, créditos y consumo al cerrar               */
/* --------------------------------------------------------------------- */

describe('[F5] mensualidades: planes, créditos y consumo al cerrar', () => {
  const cobroUno = {
    perfilCobroId: 'individual',
    modo: 'total',
    tarifaHoraCents: 5000,
    montoEstandarCents: 5000,
    montoCents: 5000,
    ajustado: false,
    motivoAjuste: null,
  }
  const cobroPareja = { ...cobroUno, perfilCobroId: 'pareja' }
  const AHORA_CREDITO = new Date(2026, 10, 14, 10, 0, 0)

  const presente = (alumnoId = 'a1') => [{ alumnoId, estado: 'presente' }]
  const sinAviso = (alumnoId = 'a1') => [{ alumnoId, estado: 'ausente_sin_aviso' }]

  function crearPlan(alumnoId = 'a1', extra = {}) {
    return crearPlanAlumno(
      adminDb,
      T1,
      {
        alumnoId,
        nombre: 'Mensual 8 horas',
        frecuencia: 'mensual',
        minutosIncluidos: 480,
        precioCents: 8000,
        descuentoHermanos: false,
        ...extra,
      },
      { uid: ADMIN },
    )
  }

  function comprar(alumnoId = 'a1', opciones = {}) {
    return comprarCredito(adminDb, T1, alumnoId, { ...opciones, now: opciones.now ?? AHORA_CREDITO })
  }

  function cerrar(claseId, asistencias, extra = {}) {
    return cerrarClase(adminDb, T1, claseId, { asistencias, ...extra }, {
      uid: ADMIN,
      ahora: DESPUES_DEL_FIN,
    })
  }

  async function datoCredito(creditoId) {
    const snap = await getDoc(doc(adminDb, 'academias', T1, 'creditos', creditoId))
    return snap.data()
  }

  async function datoCargo(cargoId) {
    const snap = await getDoc(doc(adminDb, 'academias', T1, 'cargos', cargoId))
    return snap.data()
  }

  beforeEach(async () => {
    // Estos tests ejercitan el consumo de crédito en sí; fijan de forma explícita
    // que el crédito NO requiere pago. El default de la academia ahora es `true`
    // y tiene su propio test ("creditoRequierePago: bloquea...").
    await setParametros(adminDb, T1, { creditoRequierePago: false }, { uid: ADMIN })
  })

  it('crea un plan activo y rechaza un segundo activo del mismo alumno', async () => {
    const { planId } = await crearPlan('a1')
    assert.equal((await getPlanActivo(adminDb, T1, 'a1')).id, planId)
    await assert.rejects(crearPlan('a1'), CobroInvalidoError)

    await desactivarPlanAlumno(adminDb, T1, planId, { uid: ADMIN })
    assert.equal(await getPlanActivo(adminDb, T1, 'a1'), null)
    await assert.doesNotReject(crearPlan('a1'))
  })

  it('el descuento de hermanos solo aplica a menores', async () => {
    await assert.rejects(crearPlan('a1', { descuentoHermanos: true }), CobroInvalidoError)
    await assert.doesNotReject(crearPlan('a2', { descuentoHermanos: true }))
  })

  it('actualiza un plan validando minutos/frecuencia/precio', async () => {
    const { planId } = await crearPlan('a1')
    await assert.rejects(
      actualizarPlanAlumno(adminDb, T1, planId, { minutosIncluidos: 45 }, { uid: ADMIN }),
      CobroInvalidoError,
    )
    await actualizarPlanAlumno(
      adminDb,
      T1,
      planId,
      { minutosIncluidos: 600, precioCents: 9000 },
      { uid: ADMIN },
    )
    const planes = await listarPlanesAlumno(adminDb, T1, 'a1')
    assert.equal(planes[0].minutosIncluidos, 600)
    assert.equal(planes[0].precioCents, 9000)
  })

  it('compra el crédito: lote + cargo de mensualidad en una transacción', async () => {
    await crearPlan('a1')
    const { creditoId, cargoId, montoCents } = await comprar('a1')
    assert.equal(montoCents, 8000)
    const lote = await datoCredito(creditoId)
    assert.equal(lote.minutosComprados, 480)
    assert.equal(lote.minutosUsados, 0)
    assert.equal(lote.estado, 'activo')
    const cargo = await datoCargo(cargoId)
    assert.equal(cargo.concepto, 'mensualidad')
    assert.equal(cargo.claseId, null)
    assert.equal(cargo.creditoId, creditoId)
    assert.equal(cargo.montoCents, 8000)
    assert.equal(cargo.estado, 'pendiente')
  })

  it('aplica el descuento de hermanos al precio del lote', async () => {
    await crearPlan('a2', { descuentoHermanos: true, precioCents: 8000 })
    const { cargoId } = await comprar('a2')
    assert.equal((await datoCargo(cargoId)).montoCents, 7200)
  })

  it('anularCredito se permite sin uso y con cargo no pagado; se niega tras pagarlo', async () => {
    await crearPlan('a1')
    const uno = await comprar('a1')
    await anularCredito(adminDb, T1, uno.creditoId)
    assert.equal((await datoCredito(uno.creditoId)).estado, 'anulado')
    assert.equal((await datoCargo(uno.cargoId)).estado, 'anulado')

    const otro = await comprar('a1')
    await marcarCargoPagado(adminDb, T1, otro.cargoId, { metodoPago: 'efectivo' }, { uid: ADMIN })
    await assert.rejects(anularCredito(adminDb, T1, otro.creditoId), CobroInvalidoError)
  })

  it('un presente con crédito suficiente consume la clase y no genera cargo', async () => {
    await crearPlan('a1')
    const { creditoId } = await comprar('a1')
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    const res = await cerrar(claseId, presente())

    const { cargos, pagoProfesor, movimientos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.length, 0)
    assert.equal(pagoProfesor.montoCents, 1500)
    assert.equal(movimientos.length, 1)
    assert.equal(movimientos[0].id, `${claseId}_a1`)
    assert.equal(movimientos[0].minutos, 60)
    assert.equal(movimientos[0].motivo, 'clase')
    assert.deepEqual(movimientos[0].asignaciones, [{ creditoId, minutos: 60 }])
    assert.equal(res.estado, 'pendiente_cobro')
    assert.equal((await datoCredito(creditoId)).minutosUsados, 60)
  })

  it('cubre solo al alumno con crédito y cobra al resto', async () => {
    await crearPlan('a1')
    await comprar('a1')
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'], cobro: cobroPareja })
    await cerrar(claseId, [
      { alumnoId: 'a1', estado: 'presente' },
      { alumnoId: 'a2', estado: 'presente' },
    ])
    const { cargos, movimientos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.deepEqual(cargos.map((c) => c.alumnoId), ['a2'])
    assert.equal(cargos[0].montoCents, 2500)
    assert.equal(movimientos.length, 1)
    assert.equal(movimientos[0].alumnoId, 'a1')
  })

  it('crédito insuficiente: cae al cargo normal con advertencia', async () => {
    await crearPlan('a1', { minutosIncluidos: 30 })
    await comprar('a1')
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    const res = await cerrar(claseId, presente())
    const { cargos, movimientos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.length, 1)
    assert.equal(cargos[0].montoCents, 5000)
    assert.equal(movimientos.length, 0)
    assert.deepEqual(res.advertencias, [{ alumnoId: 'a1', motivo: 'credito_insuficiente' }])
  })

  it('falta sin aviso: descuenta_completo (default)', async () => {
    await crearPlan('a1')
    const { creditoId } = await comprar('a1')
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    await cerrar(claseId, sinAviso())
    const { cargos, movimientos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.length, 0)
    assert.equal(movimientos[0].minutos, 60)
    assert.equal(movimientos[0].motivo, 'falta_sin_aviso')
    assert.equal((await datoCredito(creditoId)).minutosUsados, 60)
  })

  it('falta sin aviso: descuenta_proporcional', async () => {
    await setParametros(adminDb, T1, { faltaSinAvisoConCredito: 'descuenta_proporcional' }, { uid: ADMIN })
    await crearPlan('a1')
    const { creditoId } = await comprar('a1')
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    await cerrar(claseId, sinAviso())
    const { movimientos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(movimientos[0].minutos, 30)
    assert.equal((await datoCredito(creditoId)).minutosUsados, 30)
  })

  it('falta sin aviso: cobra_aparte genera el cargo normal', async () => {
    await setParametros(adminDb, T1, { faltaSinAvisoConCredito: 'cobra_aparte' }, { uid: ADMIN })
    await crearPlan('a1')
    await comprar('a1')
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    await cerrar(claseId, sinAviso())
    const { cargos, movimientos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.length, 1)
    assert.equal(cargos[0].concepto, 'falta_sin_aviso')
    assert.equal(movimientos.length, 0)
  })

  it('ausente_avisada y seFactura false no tocan el crédito', async () => {
    await crearPlan('a1')
    const { creditoId } = await comprar('a1')
    const uno = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    await cerrar(uno.claseId, [{ alumnoId: 'a1', estado: 'ausente_avisada' }])
    assert.equal((await getCierreDeClase(adminDb, T1, uno.claseId)).movimientos.length, 0)

    const dos = await reservar({
      alumnos: ['a1'],
      cobro: cobroUno,
      horaInicio: '17:00',
      horaFin: '18:00',
    })
    await cerrar(dos.claseId, presente(), { seFactura: false })
    assert.equal((await getCierreDeClase(adminDb, T1, dos.claseId)).movimientos.length, 0)
    assert.equal((await datoCredito(creditoId)).minutosUsados, 0)
  })

  it('creditoRequierePago: bloquea el lote hasta que el cargo esté pagado', async () => {
    await setParametros(adminDb, T1, { creditoRequierePago: true }, { uid: ADMIN })
    await crearPlan('a1')
    const { cargoId } = await comprar('a1')

    const uno = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    await cerrar(uno.claseId, presente())
    let cierre = await getCierreDeClase(adminDb, T1, uno.claseId)
    assert.equal(cierre.cargos.length, 1)
    assert.equal(cierre.movimientos.length, 0)

    await marcarCargoPagado(adminDb, T1, cargoId, { metodoPago: 'efectivo' }, { uid: ADMIN })
    const dos = await reservar({
      alumnos: ['a1'],
      cobro: cobroUno,
      horaInicio: '17:00',
      horaFin: '18:00',
    })
    await cerrar(dos.claseId, presente())
    cierre = await getCierreDeClase(adminDb, T1, dos.claseId)
    assert.equal(cierre.cargos.length, 0)
    assert.equal(cierre.movimientos.length, 1)
  })

  it('un lote vencido no se usa y cae al cargo normal', async () => {
    await crearPlan('a1')
    const { creditoId } = await comprar('a1')
    const ref = doc(adminDb, 'academias', T1, 'creditos', creditoId)
    await setDoc(ref, { ...(await getDoc(ref)).data(), venceEn: '2026-11-01' })

    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    await cerrar(claseId, presente())
    const { cargos, movimientos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.length, 1)
    assert.equal(movimientos.length, 0)

    const credito = await getCreditoAlumno(adminDb, T1, 'a1', FECHA)
    assert.equal(credito.minutosDisponibles, 0)
    assert.equal(credito.vencidos.length, 1)
  })

  it('anularCierre devuelve los minutos al lote y permite recerrar', async () => {
    await crearPlan('a1')
    const { creditoId } = await comprar('a1')
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    await cerrar(claseId, presente())
    assert.equal((await datoCredito(creditoId)).minutosUsados, 60)

    await anularCierre(adminDb, T1, claseId, { uid: ADMIN })
    assert.equal((await datoCredito(creditoId)).minutosUsados, 0)
    const cierre = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cierre.movimientos[0].minutos, 0)
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'reservada')

    await cerrar(claseId, presente())
    assert.equal((await datoCredito(creditoId)).minutosUsados, 60)
  })

  it('una clase cubierta por crédito sin pago nace cobrada y se puede anular', async () => {
    await setParametros(adminDb, T1, { pagoProfesor: { modo: 'por_hora', montoCents: 0 } }, { uid: ADMIN })
    await crearPlan('a1')
    await comprar('a1')
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    const res = await cerrar(claseId, presente())
    assert.equal(res.estado, 'cobrada')
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'cobrada')

    await anularCierre(adminDb, T1, claseId, { uid: ADMIN })
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'reservada')
  })

  it('una clase normal pasa a cobrada al pagar cargo y pago, y entonces no se anula', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'], cobro: cobroUno })
    await cerrar(claseId, presente())
    const { cargos } = await getCierreDeClase(adminDb, T1, claseId)

    await marcarCargoPagado(adminDb, T1, cargos[0].id, { metodoPago: 'efectivo' }, { uid: ADMIN })
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'pendiente_cobro')

    await marcarPagoProfesorPagado(adminDb, T1, claseId, { metodoPago: 'efectivo' }, { uid: ADMIN })
    assert.equal((await getClase(adminDb, T1, claseId)).estado, 'cobrada')
    await assert.rejects(
      anularCierre(adminDb, T1, claseId, { uid: ADMIN }),
      /cobro o pago ya registrado/,
    )
  })

  it('sugerirDescuentoHermanos detecta el hermano por representante', async () => {
    const a2 = await getAlumno(adminDb, T1, 'a2')
    assert.equal(sugerirDescuentoHermanos(a2, [a2]), false)
    await crearAlumno(
      adminDb,
      T1,
      {
        tipo: 'menor',
        nombre: 'Marta',
        apellidos: 'Menor Dos',
        representante: { nombre: 'Teresa', apellidos: 'Representante', email: null, telefono: null },
      },
      { uid: ADMIN, alumnoId: 'a12' },
    )
    const a12 = await getAlumno(adminDb, T1, 'a12')
    assert.equal(sugerirDescuentoHermanos(a2, [a2, a12]), true)
  })
})

describe('[F6] tasas BCV (config/tasas)', () => {
  const TASAS = { bsPorUsd: 879.1225, bsPorEur: 977.68092347, fecha: '2026-10-15', fuente: 'api' }

  it('getTasas devuelve null cuando todavía no hay documento (el alumno no puede leer)', async () => {
    assert.equal(await getTasas(adminDb, T1), null)
    await assert.rejects(() => getTasas(alumnoDb, T1))
  })

  it('validarTasas normaliza y rechaza valores fuera de rango', () => {
    assert.deepEqual(validarTasas(TASAS), TASAS)
    assert.deepEqual(validarTasas({ bsPorUsd: 1, bsPorEur: 2, fuente: 'manual' }), {
      bsPorUsd: 1,
      bsPorEur: 2,
      fecha: null,
      fuente: 'manual',
    })
    assert.throws(() => validarTasas({ bsPorEur: 2, fuente: 'api' }), TasaInvalidaError)
    assert.throws(() => validarTasas({ bsPorUsd: 0, bsPorEur: 2, fuente: 'api' }), TasaInvalidaError)
    assert.throws(() => validarTasas({ bsPorUsd: 2, bsPorEur: 200000000, fuente: 'api' }), TasaInvalidaError)
    assert.throws(() => validarTasas({ bsPorUsd: 2, bsPorEur: 3, fuente: 'otra' }), TasaInvalidaError)
    assert.throws(
      () => validarTasas({ bsPorUsd: 2, bsPorEur: 3, fuente: 'api', fecha: '15/10/2026' }),
      TasaInvalidaError,
    )
  })

  it('leerTasasDoc normaliza el sello de auditoría y descarta documentos corruptos', () => {
    assert.equal(leerTasasDoc(null), null)
    assert.equal(leerTasasDoc({ ...TASAS, actualizadoEn: null }).actualizadoEn, null)
    assert.equal(
      leerTasasDoc({ ...TASAS, actualizadoEn: { toMillis: () => 1729000000000 } }).actualizadoEn,
      1729000000000,
    )
    assert.equal(leerTasasDoc({ ...TASAS, bsPorUsd: '879' }), null)
  })

  it('setTasas escribe y getTasas lo lee de vuelta con la auditoría', async () => {
    const ahora = new Date('2026-10-15T13:30:00')
    const normalizado = await setTasas(adminDb, T1, TASAS, { uid: ADMIN, now: ahora })
    assert.deepEqual(normalizado, TASAS)

    const leidas = await getTasas(adminDb, T1)
    assert.equal(leidas.bsPorUsd, 879.1225)
    assert.equal(leidas.bsPorEur, 977.68092347)
    assert.equal(leidas.fecha, '2026-10-15')
    assert.equal(leidas.fuente, 'api')
    assert.equal(leidas.actualizadoEn, ahora.getTime())
  })

  it('setTasas permite el override manual sin fecha', async () => {
    await setTasas(adminDb, T1, { bsPorUsd: 900, bsPorEur: 1000, fuente: 'manual' }, { uid: ADMIN })
    const leidas = await getTasas(adminDb, T1)
    assert.equal(leidas.fuente, 'manual')
    assert.equal(leidas.fecha, null)
  })

  it('setTasas rechaza valores inválidos y no escribe', async () => {
    await assert.rejects(
      () => setTasas(adminDb, T1, { bsPorUsd: -1, bsPorEur: 3, fuente: 'api' }, { uid: ADMIN }),
      TasaInvalidaError,
    )
    assert.equal(await getTasas(adminDb, T1), null)
  })

  it('solo el admin puede escribir la tasa (las reglas bloquean al alumno)', async () => {
    await assert.rejects(() => setTasas(alumnoDb, T1, TASAS, { uid: ALUMNO }))
    await assert.rejects(() => getTasas(alumnoDb, T1))
  })
})

describe('[F7] acceso de profesores y asistencia del profesor', () => {
  const cobro = {
    perfilCobroId: 'cuatro',
    modo: 'total',
    tarifaHoraCents: 5500,
    montoEstandarCents: 5500,
    montoCents: 5500,
    ajustado: false,
    motivoAjuste: null,
  }
  const presentes = (ids) => ids.map((alumnoId) => ({ alumnoId, estado: 'presente' }))

  it('getUsuarioProfesor lee el acceso y listarUsuariosProfesor lo lista', async () => {
    const usuario = await getUsuarioProfesor(adminDb, T1, PROFE)
    assert.equal(usuario.profesorId, 'p1')
    assert.equal(usuario.activo, true)
    assert.equal(await getUsuarioProfesor(adminDb, T1, 'nadie'), null)

    const lista = await listarUsuariosProfesor(adminDb, T1)
    assert.deepEqual(
      lista.map((u) => u.id),
      [PROFE],
    )
  })

  it('crearAccesoProfesor usa la función inyectada y escribe usuarios/{uid}', async () => {
    const llamadas = []
    const fake = async ({ email, password }) => {
      llamadas.push({ email, password })
      return { uid: 'uid-nuevo' }
    }
    const { uid } = await crearAccesoProfesor(
      adminDb,
      T1,
      { email: 'Nuevo@X.test', password: 'secreta123', profesorId: 'p2' },
      { crearCuenta: fake },
    )
    assert.equal(uid, 'uid-nuevo')
    assert.deepEqual(llamadas, [{ email: 'nuevo@x.test', password: 'secreta123' }])

    const usuario = await getUsuarioProfesor(adminDb, T1, 'uid-nuevo')
    assert.equal(usuario.uid, 'uid-nuevo')
    assert.equal(usuario.rol, 'profesor')
    assert.equal(usuario.profesorId, 'p2')
    assert.equal(usuario.email, 'nuevo@x.test')
    assert.equal(usuario.activo, true)
    assert.ok(usuario.creadoEn != null)
  })

  it('getMisAccesosProfesor descubre el tenant por uid (solo activos)', async () => {
    // Con el cliente del propio profesor (las reglas exigen uid == auth.uid y activo).
    const propios = await getMisAccesosProfesor(profeDb, PROFE)
    assert.deepEqual(
      propios.map((a) => ({ tenantId: a.tenantId, profesorId: a.profesorId })),
      [{ tenantId: T1, profesorId: 'p1' }],
    )
    // Un uid ajeno choca con la regla (uid != auth.uid): la consulta se rechaza.
    await assert.rejects(() => getMisAccesosProfesor(profeDb, 'otro-uid'))
  })

  it('crearAccesoProfesor no escribe nada si falta el creador de cuentas o el email', async () => {
    await assert.rejects(
      () => crearAccesoProfesor(adminDb, T1, { email: 'x@y.test', profesorId: 'p1' }),
      FichaInvalidaError,
    )
    await assert.rejects(
      () => crearAccesoProfesor(adminDb, T1, { profesorId: 'p1' }, { crearCuenta: async () => ({ uid: 'z' }) }),
      FichaInvalidaError,
    )
    assert.deepEqual(await listarUsuariosProfesor(adminDb, T1), [
      { id: PROFE, uid: PROFE, rol: 'profesor', profesorId: 'p1', email: 'profe@t1.test', activo: true, creadoEn: null },
    ])
  })

  it('cambiarActivoProfesor desactiva y reactiva (soft delete)', async () => {
    await cambiarActivoProfesor(adminDb, T1, PROFE, false, { actualizadoPor: ADMIN })
    assert.equal((await getUsuarioProfesor(adminDb, T1, PROFE)).activo, false)
    await cambiarActivoProfesor(adminDb, T1, PROFE, true, { actualizadoPor: ADMIN })
    assert.equal((await getUsuarioProfesor(adminDb, T1, PROFE)).activo, true)
  })

  it('getClasesDeProfesor devuelve solo las clases del profesor desde `desde`', async () => {
    const { claseId: mia } = await reservar()
    const { claseId: ajena } = await reservar({
      canchaId: 'c2',
      profesorId: 'p2',
      horaInicio: '20:00',
      horaFin: '21:00',
    })
    const clases = await getClasesDeProfesor(adminDb, T1, 'p1', { desde: FECHA })
    assert.deepEqual(
      clases.map((c) => c.id),
      [mia],
    )
    assert.ok(!clases.some((c) => c.id === ajena))
  })

  it('el profesor lee sus propias clases con su cliente (reglas) y no las ajenas', async () => {
    const { claseId } = await reservar()
    const propias = await getClasesDeProfesor(profeDb, T1, 'p1', { desde: FECHA })
    assert.ok(propias.some((c) => c.id === claseId))

    const { claseId: ajena } = await reservar({
      canchaId: 'c2',
      profesorId: 'p2',
      horaInicio: '20:00',
      horaFin: '21:00',
    })
    await assert.rejects(() => getClase(profeDb, T1, ajena))
  })

  it('guardarAsistenciaProfesor escribe solo asistenciaProfesor', async () => {
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'] })
    await guardarAsistenciaProfesor(
      profeDb,
      T1,
      claseId,
      { a1: 'presente', a2: 'ausente_con_aviso' },
      { uid: PROFE, profesorId: 'p1' },
    )
    const clase = await getClase(adminDb, T1, claseId)
    assert.deepEqual(clase.asistenciaProfesor.porAlumno, {
      a1: 'presente',
      a2: 'ausente_con_aviso',
    })
    assert.equal(clase.asistenciaProfesor.registradoPor, PROFE)
    assert.ok(clase.asistenciaProfesor.registradoEn != null)
    assert.equal(clase.estado, 'reservada')
  })

  it('guardarAsistenciaProfesor rechaza un estado fuera del enum y no escribe', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await assert.rejects(
      () =>
        guardarAsistenciaProfesor(
          profeDb,
          T1,
          claseId,
          { a1: 'ausente_avisada' },
          { uid: PROFE, profesorId: 'p1' },
        ),
      ClaseInvalidaError,
    )
    assert.equal((await getClase(adminDb, T1, claseId)).asistenciaProfesor, undefined)
  })

  it('guardarAsistenciaProfesor exige una entrada por cada alumno asignado', async () => {
    const { claseId } = await reservar({ alumnos: ['a1', 'a2'] })
    await assert.rejects(
      () =>
        guardarAsistenciaProfesor(
          profeDb,
          T1,
          claseId,
          { a1: 'presente' },
          { uid: PROFE, profesorId: 'p1' },
        ),
      ClaseInvalidaError,
    )
  })

  it('guardarAsistenciaProfesor rechaza una clase ya cerrada', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'], cobro })
    await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: presentes(['a1']) },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )
    await assert.rejects(
      () =>
        guardarAsistenciaProfesor(
          profeDb,
          T1,
          claseId,
          { a1: 'presente' },
          { uid: PROFE, profesorId: 'p1' },
        ),
      ClaseInvalidaError,
    )
  })

  it('guardarAsistenciaProfesor rechaza una clase de otro profesor', async () => {
    const { claseId } = await reservar({ canchaId: 'c2', profesorId: 'p2' })
    // Con el cliente del admin se llega a la guardia de la capa de datos (con el
    // cliente del profesor las reglas ya negarían la lectura previa).
    await assert.rejects(
      () =>
        guardarAsistenciaProfesor(
          adminDb,
          T1,
          claseId,
          { a1: 'presente' },
          { uid: PROFE, profesorId: 'p1' },
        ),
      ClaseInvalidaError,
    )
  })

  it('un profesor inactivo no puede guardar (las reglas bloquean)', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'] })
    await cambiarActivoProfesor(adminDb, T1, PROFE, false, { actualizadoPor: ADMIN })
    await assert.rejects(() =>
      guardarAsistenciaProfesor(
        profeDb,
        T1,
        claseId,
        { a1: 'presente' },
        { uid: PROFE, profesorId: 'p1' },
      ),
    )
  })

  it('cerrarClase registra confirmadoPorProfesorId sin tocar el cobro', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'], cobro })
    await guardarAsistenciaProfesor(
      profeDb,
      T1,
      claseId,
      { a1: 'presente' },
      { uid: PROFE, profesorId: 'p1' },
    )
    await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: presentes(['a1']), confirmadoPorProfesorId: 'p1' },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )
    const clase = await getClase(adminDb, T1, claseId)
    assert.equal(clase.confirmadoPorProfesorId, 'p1')
    assert.deepEqual(clase.asistenciaProfesor.porAlumno, { a1: 'presente' })
    const { cargos } = await getCierreDeClase(adminDb, T1, claseId)
    assert.equal(cargos.length, 1)
    assert.equal(cargos[0].montoCents, 5500)
  })

  it('cerrarClase sin confirmadoPorProfesorId no escribe el sello', async () => {
    const { claseId } = await reservar({ alumnos: ['a1'], cobro })
    await cerrarClase(
      adminDb,
      T1,
      claseId,
      { asistencias: presentes(['a1']) },
      { uid: ADMIN, ahora: DESPUES_DEL_FIN },
    )
    assert.equal((await getClase(adminDb, T1, claseId)).confirmadoPorProfesorId, undefined)
  })
})
