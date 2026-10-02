/*
 * Pruebas de las Security Rules contra el emulador de Firestore.
 *
 * Cada test dice explícitamente el ROL que actúa y si se espera ALLOW o DENY.
 * Las reglas son la única frontera de autorización del sistema, así que esto
 * se prueba de verdad y no a ojo.
 *
 * Se usa el runner nativo de Node (`node --test`) para no agregar dependencias:
 *   npm run test:rules
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, it } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

const PROJECT_ID = 'academia-padel-jdm'

const T1 = 't1'
const T2 = 't2'

// Uidos de los usuarios de prueba. No se crean en Auth: `authenticatedContext`
// alcanza para que las reglas vean request.auth.uid.
const UID = {
  adminT1: 'uid-admin-t1',
  profT1: 'uid-prof-t1',
  alumnoT1: 'uid-alumno-t1',
  alumno2T1: 'uid-alumno2-t1',
  inactivoT1: 'uid-inactivo-t1',
  dual: 'uid-dual',
  adminT2: 'uid-admin-t2',
}

const FECHA = '2026-10-05'

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
    tipo: 'variable',
    serieId: null,
    cupo: 4,
    alumnos: ['a1'],
    alumnoNombres: ['Aldo Adulto'],
    asistencias: [],
    estado: 'reservada',
    creadoPor: 'seed',
    creadoEn: null,
    ...extra,
  }
}

let env

/** Cliente de un usuario concreto (rol ya seteado en su documento de membresía). */
function as(uid) {
  return env.authenticatedContext(uid).firestore()
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })

  // Seeds sin reglas (contexto de librería, no de cliente).
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()

    await setDoc(doc(db, 'academias', T1), {
      nombre: 'Academia Uno',
      slug: T1,
      estado: 'activa',
      plan: 'basico',
      zonaHoraria: 'America/Caracas',
      moneda: 'USD',
    })
    await setDoc(doc(db, 'academias', T2), {
      nombre: 'Academia Dos',
      slug: T2,
      estado: 'activa',
      plan: 'basico',
      zonaHoraria: 'America/Caracas',
      moneda: 'USD',
    })

    await setDoc(doc(db, 'academias', T1, 'sedes', 'traki'), {
      nombre: 'Traki',
      activa: true,
      orden: 0,
    })
    await setDoc(doc(db, 'academias', T1, 'sedes', 'traki', 'canchas', 'c1'), {
      nombre: 'Cancha 1',
      numero: 1,
      tipo: 'indoor',
      activa: true,
    })

    await setDoc(doc(db, 'academias', T1, 'profesores', 'p1'), {
      nombre: 'Pablo Profesor',
      activo: true,
      sedes: ['traki'],
    })

    await setDoc(doc(db, 'academias', T1, 'alumnos', 'a1'), {
      tipo: 'adulto',
      nombre: 'Aldo Adulto',
      activo: true,
    })
    await setDoc(doc(db, 'academias', T1, 'alumnos', 'a2'), {
      tipo: 'adulto',
      nombre: 'Ana Otra',
      activo: true,
    })

    const membresia = (uid, rol, extra = {}) => ({
      uid,
      rol,
      activo: true,
      nombre: uid,
      profesorId: null,
      alumnoId: null,
      creadoEn: null,
      ...extra,
    })

    await setDoc(doc(db, 'academias', T1, 'miembros', UID.adminT1), membresia(UID.adminT1, 'administrador'))
    await setDoc(doc(db, 'academias', T1, 'miembros', UID.profT1), membresia(UID.profT1, 'profesor', { profesorId: 'p1' }))
    await setDoc(doc(db, 'academias', T1, 'miembros', UID.alumnoT1), membresia(UID.alumnoT1, 'alumno_adulto', { alumnoId: 'a1' }))
    await setDoc(doc(db, 'academias', T1, 'miembros', UID.alumno2T1), membresia(UID.alumno2T1, 'alumno_adulto', { alumnoId: 'a2' }))
    await setDoc(doc(db, 'academias', T1, 'miembros', UID.inactivoT1), membresia(UID.inactivoT1, 'administrador', { activo: false }))
    // Pertenece a las dos academias: sirve para probar el descubrimiento.
    await setDoc(doc(db, 'academias', T1, 'miembros', UID.dual), membresia(UID.dual, 'administrador'))
    await setDoc(doc(db, 'academias', T2, 'miembros', UID.dual), membresia(UID.dual, 'administrador'))
    await setDoc(doc(db, 'academias', T2, 'miembros', UID.adminT2), membresia(UID.adminT2, 'administrador'))

    await setDoc(doc(db, 'academias', T1, 'clases', 'c1'), clase())
    await setDoc(doc(db, 'academias', T2, 'clases', 'c9'), clase())
  })
})

after(async () => {
  await env.cleanup()
})

describe('1. Aislamiento por tenant', () => {
  it('administrador de t1 LEE academias/t1 → ALLOW', async () => {
    await assertSucceeds(getDoc(doc(as(UID.adminT1), 'academias', T1)))
  })

  it('administrador de t1 LEE academias/t2 → DENY (leer otro tenant)', async () => {
    await assertFails(getDoc(doc(as(UID.adminT1), 'academias', T2)))
  })

  it('administrador de t1 LISTA clases de t2 → DENY (leer otro tenant)', async () => {
    await assertFails(getDocs(collection(as(UID.adminT1), 'academias', T2, 'clases')))
  })

  it('profesor de t1 LEE clases de t1 → ALLOW (mismo tenant)', async () => {
    await assertSucceeds(getDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1')))
  })

  it('administrador de t2 LEE clases de t1 → DENY (leer otro tenant)', async () => {
    await assertFails(getDoc(doc(as(UID.adminT2), 'academias', T1, 'clases', 'c1')))
  })

  it('usuario NO autenticado LEE academias/t1 → DENY', async () => {
    const anon = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(anon, 'academias', T1)))
  })

  it('miembro con activo:false LEE academias/t1 → DENY (membresía inactiva)', async () => {
    await assertFails(getDoc(doc(as(UID.inactivoT1), 'academias', T1)))
  })
})

describe('2. Crear clases: solo administrador', () => {
  it('administrador de t1 CREA clase en t1 → ALLOW', async () => {
    await assertSucceeds(setDoc(doc(as(UID.adminT1), 'academias', T1, 'clases', 'nueva-admin'), clase()))
  })

  it('profesor de t1 CREA clase en t1 → DENY', async () => {
    await assertFails(setDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'nueva-profe'), clase()))
  })

  it('alumno_adulto de t1 CREA clase en t1 → DENY', async () => {
    await assertFails(setDoc(doc(as(UID.alumnoT1), 'academias', T1, 'clases', 'nueva-alumno'), clase()))
  })

  it('administrador de t2 CREA clase en t1 → DENY (otro tenant)', async () => {
    await assertFails(setDoc(doc(as(UID.adminT2), 'academias', T1, 'clases', 'nueva-ajeno'), clase()))
  })

  it('usuario NO autenticado CREA clase → DENY', async () => {
    const anon = env.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(anon, 'academias', T1, 'clases', 'nueva-anon'), clase()))
  })
})

describe('3. Profesor: asistencia y estado sí, cupo no', () => {
  it('profesor de t1 ACTUALiza asistencias de la clase → ALLOW', async () => {
    await assertSucceeds(
      updateDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1'), {
        asistencias: [{ alumnoId: 'a1', estado: 'presente', motivo: null }],
      }),
    )
  })

  it('profesor de t1 ACTUALiza estado de la clase → ALLOW', async () => {
    await assertSucceeds(
      updateDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1'), { estado: 'ejecutada' }),
    )
  })

  it('profesor de t1 ACTUALiza cupo → DENY', async () => {
    await assertFails(updateDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1'), { cupo: 8 }))
  })

  it('profesor de t1 ACTUALiza cancha/fecha → DENY (no puede mover la reserva)', async () => {
    await assertFails(updateDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1'), { canchaId: 'c2' }))
    await assertFails(updateDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1'), { fecha: '2026-10-06' }))
  })

  it('profesor de t1 ACTUALiza alumnos (inscribir) → DENY', async () => {
    await assertFails(updateDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1'), { alumnos: ['a1', 'a2'] }))
  })

  it('alumno_adulto de t1 ACTUALiza estado/asistencias → DENY', async () => {
    await assertFails(
      updateDoc(doc(as(UID.alumnoT1), 'academias', T1, 'clases', 'c1'), { estado: 'ejecutada' }),
    )
  })

  it('administrador de t1 ACTUALiza cupo → ALLOW', async () => {
    await assertSucceeds(updateDoc(doc(as(UID.adminT1), 'academias', T1, 'clases', 'c1'), { cupo: 8 }))
  })
})

describe('4. Alumnos no editan nada', () => {
  it('alumno_adulto LEE alumnos de t1 → ALLOW (listado de la academia)', async () => {
    await assertSucceeds(getDoc(doc(as(UID.alumnoT1), 'academias', T1, 'alumnos', 'a1')))
  })

  it('alumno_adulto de t1 ACTUALiza su propia ficha → DENY', async () => {
    await assertFails(updateDoc(doc(as(UID.alumnoT1), 'academias', T1, 'alumnos', 'a1'), { telefono: '+58 414 999 9999' }))
  })

  it('alumno_adulto de t1 ACTUALiza la ficha de OTRO alumno → DENY', async () => {
    await assertFails(updateDoc(doc(as(UID.alumnoT1), 'academias', T1, 'alumnos', 'a2'), { telefono: '+58 414 999 9999' }))
  })

  it('alumno_adulto de t1 ACTUALiza la clase donde está inscrito → DENY', async () => {
    await assertFails(updateDoc(doc(as(UID.alumnoT1), 'academias', T1, 'clases', 'c1'), { alumnos: [] }))
  })

  it('alumno_adulto de t1 LEE alumnos de t2 → DENY (otro tenant)', async () => {
    await assertFails(getDoc(doc(as(UID.alumnoT1), 'academias', T2, 'alumnos', 'a1')))
  })

  it('profesor de t1 ACTUALiza la ficha de un alumno → DENY', async () => {
    await assertFails(updateDoc(doc(as(UID.profT1), 'academias', T1, 'alumnos', 'a2'), { telefono: '+58 414 999 9999' }))
  })
})

describe('5. Descubrimiento: collectionGroup("miembros")', () => {
  it('usuario autenticado LISTA sus propias membresías (uid == su uid) → ALLOW', async () => {
    const q = query(collectionGroup(as(UID.dual), 'miembros'), where('uid', '==', UID.dual))
    const snap = await assertSucceeds(getDocs(q))
    const tenants = snap.docs.map((d) => d.ref.parent.parent.id).sort()
    assert.deepEqual(tenants, [T1, T2])
  })

  it('usuario autenticado LISTA las membresías de OTRO usuario → DENY', async () => {
    const q = query(collectionGroup(as(UID.dual), 'miembros'), where('uid', '==', UID.adminT1))
    await assertFails(getDocs(q))
  })

  it('alumno_adulto LISTA sus propias membresías → ALLOW', async () => {
    const q = query(collectionGroup(as(UID.alumnoT1), 'miembros'), where('uid', '==', UID.alumnoT1))
    const snap = await assertSucceeds(getDocs(q))
    assert.equal(snap.docs.length, 1)
  })

  it('usuario NO autenticado LISTA membresías → DENY', async () => {
    const anon = env.unauthenticatedContext().firestore()
    const q = query(collectionGroup(anon, 'miembros'), where('uid', '==', UID.adminT1))
    await assertFails(getDocs(q))
  })

  it('miembro de t1 LISTA los miembros de t1 → ALLOW', async () => {
    await assertSucceeds(getDocs(collection(as(UID.adminT1), 'academias', T1, 'miembros')))
  })

  it('miembro de t1 LISTA los miembros de t2 → DENY (otro tenant)', async () => {
    await assertFails(getDocs(collection(as(UID.adminT1), 'academias', T2, 'miembros')))
  })
})