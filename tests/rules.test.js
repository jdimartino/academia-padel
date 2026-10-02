/*
 * Pruebas de las Security Rules contra el emulador de Firestore.
 *
 * ACCESO POR AHORA: solo `administrador` opera. Profesor, alumno adulto, alumno
 * menor y tutor son FICHAS (records), no usuarios con acceso: todos sus casos
 * son DENY. La única lectura permitida a un no-admin es su propia membresía
 * (arranque de sesión + descubrimiento de tenants).
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
// Profesor, alumno y tutor se conservan como usuarios NEGATIVOS: tienen su
// membresía con su rol, pero ninguna concesión de acceso.
const UID = {
  adminT1: 'uid-admin-t1',
  profT1: 'uid-prof-t1',
  alumnoT1: 'uid-alumno-t1',
  tutorT1: 'uid-tutor-t1',
  inactivoT1: 'uid-inactivo-t1',
  dual: 'uid-dual',
  adminT2: 'uid-admin-t2',
  // Autenticado, pero sin documento de membresía en ningún tenant.
  sinMembresia: 'uid-sin-membresia',
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

    // Fichas (records), no usuarios con acceso.
    await setDoc(doc(db, 'academias', T1, 'profesores', 'p1'), {
      nombre: 'Pablo Profesor',
      activo: true,
      sedes: ['traki'],
    })

    await setDoc(doc(db, 'academias', T1, 'alumnos', 'a1'), {
      tipo: 'adulto',
      nombre: 'Aldo Adulto',
      email: 'alumno@ensayo.test',
      telefono: '+58 414 000 0001',
      activo: true,
    })
    await setDoc(doc(db, 'academias', T1, 'alumnos', 'a2'), {
      tipo: 'menor',
      nombre: 'Marta Menor',
      email: 'tutor@ensayo.test',
      tutor: {
        nombre: 'Teresa Tutora',
        email: 'tutor@ensayo.test',
        telefono: '+58 414 000 0003',
        parentesco: 'madre',
      },
      activo: true,
    })

    // Membresías. Solo `administrador` tiene acceso; los demás roles quedan
    // como usuarios negativos. Sin `profesorId`/`alumnoId`: esos vínculos de
    // login son obsoletos (las fichas se referencian por id en las clases).
    const membresia = (uid, rol, extra = {}) => ({
      uid,
      rol,
      activo: true,
      nombre: uid,
      creadoEn: null,
      ...extra,
    })

    await setDoc(doc(db, 'academias', T1, 'miembros', UID.adminT1), membresia(UID.adminT1, 'administrador'))
    await setDoc(doc(db, 'academias', T1, 'miembros', UID.profT1), membresia(UID.profT1, 'profesor'))
    await setDoc(doc(db, 'academias', T1, 'miembros', UID.alumnoT1), membresia(UID.alumnoT1, 'alumno_adulto'))
    await setDoc(doc(db, 'academias', T1, 'miembros', UID.tutorT1), membresia(UID.tutorT1, 'alumno_menor'))
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

describe('2. Admin permite, no-admin deniega al crear clases', () => {
  it('administrador de t1 CREA clase en t1 → ALLOW', async () => {
    await assertSucceeds(setDoc(doc(as(UID.adminT1), 'academias', T1, 'clases', 'nueva-admin'), clase()))
  })

  it('profesor de t1 CREA clase en t1 → DENY (rol profesor, escritura)', async () => {
    await assertFails(setDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'nueva-profe'), clase()))
  })

  it('alumno_adulto de t1 CREA clase en t1 → DENY (rol alumno_adulto, escritura)', async () => {
    await assertFails(setDoc(doc(as(UID.alumnoT1), 'academias', T1, 'clases', 'nueva-alumno'), clase()))
  })

  it('alumno_menor (tutor) de t1 CREA clase en t1 → DENY (rol alumno_menor, escritura)', async () => {
    await assertFails(setDoc(doc(as(UID.tutorT1), 'academias', T1, 'clases', 'nueva-tutor'), clase()))
  })

  it('administrador de t2 CREA clase en t1 → DENY (otro tenant)', async () => {
    await assertFails(setDoc(doc(as(UID.adminT2), 'academias', T1, 'clases', 'nueva-ajeno'), clase()))
  })

  it('usuario NO autenticado CREA clase → DENY', async () => {
    const anon = env.unauthenticatedContext().firestore()
    await assertFails(setDoc(doc(anon, 'academias', T1, 'clases', 'nueva-anon'), clase()))
  })
})

describe('3. Profesor: sin acceso (ni lectura ni asistencia)', () => {
  it('profesor de t1 LEE una clase de t1 → DENY (rol profesor, lectura)', async () => {
    await assertFails(getDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1')))
  })

  it('profesor de t1 LISTA clases de t1 → DENY (rol profesor, lectura)', async () => {
    await assertFails(getDocs(collection(as(UID.profT1), 'academias', T1, 'clases')))
  })

  it('profesor de t1 ACTUALiza asistencias de la clase → DENY (rol profesor, escritura)', async () => {
    await assertFails(
      updateDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1'), {
        asistencias: [{ alumnoId: 'a1', estado: 'presente', motivo: null }],
      }),
    )
  })

  it('profesor de t1 ACTUALiza el estado de la clase → DENY (rol profesor, escritura)', async () => {
    await assertFails(
      updateDoc(doc(as(UID.profT1), 'academias', T1, 'clases', 'c1'), { estado: 'pendiente_cobro' }),
    )
  })

  it('profesor de t1 LEE una sede de t1 → DENY (rol profesor, lectura)', async () => {
    await assertFails(getDoc(doc(as(UID.profT1), 'academias', T1, 'sedes', 'traki')))
  })

  it('profesor de t1 LEE la ficha de un profesor → DENY (rol profesor, lectura)', async () => {
    await assertFails(getDoc(doc(as(UID.profT1), 'academias', T1, 'profesores', 'p1')))
  })

  it('profesor de t1 LEE un bloque de t1 → DENY (rol profesor, lectura)', async () => {
    await assertFails(getDoc(doc(as(UID.profT1), 'academias', T1, 'bloques', 'cancha_traki_c1_2026-10-05_1800')))
  })

  it('profesor de t1 ACTUALiza la ficha de un alumno → DENY (rol profesor, escritura)', async () => {
    await assertFails(updateDoc(doc(as(UID.profT1), 'academias', T1, 'alumnos', 'a2'), { telefono: '+58 414 999 9999' }))
  })
})

describe('4. Alumno y tutor: fichas sin acceso', () => {
  it('alumno_adulto de t1 LEE la ficha de un alumno → DENY (dato de contacto)', async () => {
    await assertFails(getDoc(doc(as(UID.alumnoT1), 'academias', T1, 'alumnos', 'a1')))
  })

  it('alumno_adulto de t1 LEE su propia ficha → DENY (dato de contacto)', async () => {
    await assertFails(getDoc(doc(as(UID.alumnoT1), 'academias', T1, 'alumnos', 'a1')))
  })

  it('alumno_adulto de t1 LISTA alumnos de t1 → DENY (rol alumno_adulto, lectura)', async () => {
    await assertFails(getDocs(collection(as(UID.alumnoT1), 'academias', T1, 'alumnos')))
  })

  it('alumno_adulto de t1 ACTUALiza su propia ficha → DENY (rol alumno_adulto, escritura)', async () => {
    await assertFails(updateDoc(doc(as(UID.alumnoT1), 'academias', T1, 'alumnos', 'a1'), { telefono: '+58 414 999 9999' }))
  })

  it('alumno_adulto de t1 LEE una clase de t1 → DENY (rol alumno_adulto, lectura)', async () => {
    await assertFails(getDoc(doc(as(UID.alumnoT1), 'academias', T1, 'clases', 'c1')))
  })

  it('alumno_adulto de t1 ACTUALiza la clase donde está inscrito → DENY (rol alumno_adulto, escritura)', async () => {
    await assertFails(updateDoc(doc(as(UID.alumnoT1), 'academias', T1, 'clases', 'c1'), { alumnos: [] }))
  })

  it('alumno_adulto de t1 LEE alumnos de t2 → DENY (otro tenant)', async () => {
    await assertFails(getDoc(doc(as(UID.alumnoT1), 'academias', T2, 'alumnos', 'a1')))
  })

  it('alumno_menor (tutor) de t1 LEE la ficha del menor a su cargo → DENY (dato de contacto)', async () => {
    await assertFails(getDoc(doc(as(UID.tutorT1), 'academias', T1, 'alumnos', 'a2')))
  })

  it('alumno_menor (tutor) de t1 LEE una clase de t1 → DENY (rol alumno_menor, lectura)', async () => {
    await assertFails(getDoc(doc(as(UID.tutorT1), 'academias', T1, 'clases', 'c1')))
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

  it('alumno_adulto LISTA sus propias membresías → ALLOW (única lectura de un no-admin)', async () => {
    const q = query(collectionGroup(as(UID.alumnoT1), 'miembros'), where('uid', '==', UID.alumnoT1))
    const snap = await assertSucceeds(getDocs(q))
    assert.equal(snap.docs.length, 1)
  })

  it('alumno_menor (tutor) LISTA sus propias membresías → ALLOW (única lectura de un no-admin)', async () => {
    const q = query(collectionGroup(as(UID.tutorT1), 'miembros'), where('uid', '==', UID.tutorT1))
    const snap = await assertSucceeds(getDocs(q))
    assert.equal(snap.docs.length, 1)
  })

  it('profesor LISTA sus propias membresías → ALLOW (única lectura de un no-admin)', async () => {
    const q = query(collectionGroup(as(UID.profT1), 'miembros'), where('uid', '==', UID.profT1))
    const snap = await assertSucceeds(getDocs(q))
    assert.equal(snap.docs.length, 1)
  })

  it('profesor LEE su propia membresía → ALLOW (arranque de sesión)', async () => {
    await assertSucceeds(getDoc(doc(as(UID.profT1), 'academias', T1, 'miembros', UID.profT1)))
  })

  it('profesor LEE la membresía de OTRO → DENY', async () => {
    await assertFails(getDoc(doc(as(UID.profT1), 'academias', T1, 'miembros', UID.adminT1)))
  })

  it('profesor LISTA los miembros de t1 → DENY (rol profesor, lectura de fichas)', async () => {
    await assertFails(getDocs(collection(as(UID.profT1), 'academias', T1, 'miembros')))
  })

  it('usuario NO autenticado LISTA membresías → DENY', async () => {
    const anon = env.unauthenticatedContext().firestore()
    const q = query(collectionGroup(anon, 'miembros'), where('uid', '==', UID.adminT1))
    await assertFails(getDocs(q))
  })

  it('administrador de t1 LISTA los miembros de t1 → ALLOW', async () => {
    await assertSucceeds(getDocs(collection(as(UID.adminT1), 'academias', T1, 'miembros')))
  })

  it('administrador de t1 LISTA los miembros de t2 → DENY (otro tenant)', async () => {
    await assertFails(getDocs(collection(as(UID.adminT1), 'academias', T2, 'miembros')))
  })
})

describe('6. Admin conserva lectura y escritura de fichas y facturación', () => {
  it('administrador de t1 LEE la ficha de un alumno → ALLOW (dato de contacto)', async () => {
    await assertSucceeds(getDoc(doc(as(UID.adminT1), 'academias', T1, 'alumnos', 'a1')))
  })

  it('administrador de t1 ACTUALiza la ficha de un alumno → ALLOW', async () => {
    await assertSucceeds(updateDoc(doc(as(UID.adminT1), 'academias', T1, 'alumnos', 'a1'), { telefono: '+58 414 111 1111' }))
  })

  it('administrador de t1 ACTUALiza cupo y estado de una clase → ALLOW', async () => {
    await assertSucceeds(updateDoc(doc(as(UID.adminT1), 'academias', T1, 'clases', 'c1'), { cupo: 8 }))
    await assertSucceeds(
      updateDoc(doc(as(UID.adminT1), 'academias', T1, 'clases', 'c1'), {
        estado: 'pendiente_cobro',
        asistencias: [{ alumnoId: 'a1', estado: 'presente', motivo: null }],
      }),
    )
  })

  it('administrador de t1 CREA un bloque → ALLOW', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'bloques', 'cancha_traki_c1_2026-10-05_1800'), {
        tipo: 'cancha',
        sedeId: 'traki',
        canchaId: 'c1',
      }),
    )
  })
})

describe('7. Membresías: quién puede escribirlas y para quién', () => {
  const miembro = (uid, rol) => ({ uid, rol, activo: true, nombre: uid, creadoEn: null })

  it('usuario autenticado SIN membresía CREA su propia membresía en t1 → DENY', async () => {
    await assertFails(
      setDoc(
        doc(as(UID.sinMembresia), 'academias', T1, 'miembros', UID.sinMembresia),
        miembro(UID.sinMembresia, 'administrador'),
      ),
    )
  })

  it('profesor de t1 ACTUALIZA su propio rol a administrador → DENY', async () => {
    await assertFails(
      updateDoc(doc(as(UID.profT1), 'academias', T1, 'miembros', UID.profT1), {
        rol: 'administrador',
      }),
    )
  })

  it('alumno_adulto de t1 ACTUALIZA su propia membresía (activo) → DENY', async () => {
    await assertFails(
      updateDoc(doc(as(UID.alumnoT1), 'academias', T1, 'miembros', UID.alumnoT1), {
        activo: false,
      }),
    )
  })

  it('profesor de t1 CREA la membresía de OTRO usuario → DENY', async () => {
    await assertFails(
      setDoc(
        doc(as(UID.profT1), 'academias', T1, 'miembros', 'uid-ajeno-creado'),
        miembro('uid-ajeno-creado', 'administrador'),
      ),
    )
  })

  it('profesor de t1 ACTUALIZA la membresía de OTRO usuario → DENY', async () => {
    await assertFails(
      updateDoc(doc(as(UID.profT1), 'academias', T1, 'miembros', UID.alumnoT1), {
        activo: false,
      }),
    )
  })

  it('profesor de t1 LISTA por collectionGroup las membresías de OTRO (where uid == otro) → DENY', async () => {
    const q = query(collectionGroup(as(UID.profT1), 'miembros'), where('uid', '==', UID.adminT1))
    await assertFails(getDocs(q))
  })

  it('profesor de t1 LISTA por collectionGroup SÓLO su propia membresía (where uid == su uid) → ALLOW', async () => {
    const q = query(collectionGroup(as(UID.profT1), 'miembros'), where('uid', '==', UID.profT1))
    const snap = await assertSucceeds(getDocs(q))
    assert.equal(snap.docs.length, 1)
  })

  it('administrador de t1 CREA una membresía en t1 → ALLOW', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(UID.adminT1), 'academias', T1, 'miembros', 'uid-nuevo-t1'),
        miembro('uid-nuevo-t1', 'profesor'),
      ),
    )
  })

  it('administrador de t1 CREA una membresía en t2 → DENY (otro tenant)', async () => {
    await assertFails(
      setDoc(
        doc(as(UID.adminT1), 'academias', T2, 'miembros', 'uid-nuevo-t2'),
        miembro('uid-nuevo-t2', 'administrador'),
      ),
    )
  })

  it('administrador de t1 ACTUALIZA una membresía de t1 → ALLOW', async () => {
    await assertSucceeds(
      updateDoc(doc(as(UID.adminT1), 'academias', T1, 'miembros', UID.alumnoT1), {
        activo: false,
      }),
    )
  })
})
