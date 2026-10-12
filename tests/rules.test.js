/*
 * Pruebas de las Security Rules contra el emulador de Firestore.
 *
 * ACCESO POR AHORA: solo `administrador` opera. Profesor, alumno adulto, alumno
 * menor y representante son FICHAS (records), no usuarios con acceso: todos sus casos
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
  deleteDoc,
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
// Profesor, alumno y representante se conservan como usuarios NEGATIVOS: tienen su
// membresía con su rol, pero ninguna concesión de acceso.
const UID = {
  adminT1: 'uid-admin-t1',
  profT1: 'uid-prof-t1',
  alumnoT1: 'uid-alumno-t1',
  representanteT1: 'uid-representante-t1',
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
      email: 'representante@ensayo.test',
      representante: {
        nombre: 'Teresa Representante',
        email: 'representante@ensayo.test',
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
    await setDoc(doc(db, 'academias', T1, 'miembros', UID.representanteT1), membresia(UID.representanteT1, 'alumno_menor'))
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

  it('alumno_menor (representante) de t1 CREA clase en t1 → DENY (rol alumno_menor, escritura)', async () => {
    await assertFails(setDoc(doc(as(UID.representanteT1), 'academias', T1, 'clases', 'nueva-representante'), clase()))
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

  it('profesor de t1 LISTA alumnos de t1 → DENY (rol profesor, lectura; dato de contacto)', async () => {
    await assertFails(getDocs(collection(as(UID.profT1), 'academias', T1, 'alumnos')))
  })
})

describe('4. Alumno y representante: fichas sin acceso', () => {
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

  it('alumno_menor (representante) de t1 LEE la ficha del menor a su cargo → DENY (dato de contacto)', async () => {
    await assertFails(getDoc(doc(as(UID.representanteT1), 'academias', T1, 'alumnos', 'a2')))
  })

  it('alumno_menor (representante) de t1 LEE una clase de t1 → DENY (rol alumno_menor, lectura)', async () => {
    await assertFails(getDoc(doc(as(UID.representanteT1), 'academias', T1, 'clases', 'c1')))
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

  it('alumno_menor (representante) LISTA sus propias membresías → ALLOW (única lectura de un no-admin)', async () => {
    const q = query(collectionGroup(as(UID.representanteT1), 'miembros'), where('uid', '==', UID.representanteT1))
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

describe('8. Sedes y canchas: solo admin y validación de campos', () => {
  const cancha = (extra = {}) => ({ nombre: 'Cancha reglas', numero: 1, activa: true, ...extra })
  const canchaRef = (db, canchaId) => doc(db, 'academias', T1, 'sedes', 'traki', 'canchas', canchaId)

  it('administrador de t1 CREA una cancha válida → ALLOW', async () => {
    await assertSucceeds(setDoc(canchaRef(as(UID.adminT1), 'rc-allow'), cancha()))
  })

  it('administrador de t1 ACTUALIZA una cancha (nombre y activa) → ALLOW', async () => {
    await assertSucceeds(setDoc(canchaRef(as(UID.adminT1), 'rc-upd'), cancha()))
    await assertSucceeds(
      updateDoc(canchaRef(as(UID.adminT1), 'rc-upd'), { nombre: 'Cancha 9', activa: false }),
    )
  })

  it('administrador de t1 CREA una cancha con nombre vacío → DENY', async () => {
    await assertFails(setDoc(canchaRef(as(UID.adminT1), 'rc-vacio'), cancha({ nombre: '' })))
  })

  it('administrador de t1 CREA una cancha con nombre de solo espacios → DENY', async () => {
    await assertFails(setDoc(canchaRef(as(UID.adminT1), 'rc-espacios'), cancha({ nombre: '   ' })))
  })

  it('administrador de t1 CREA una cancha sin nombre → DENY', async () => {
    const sinNombre = cancha()
    delete sinNombre.nombre
    await assertFails(setDoc(canchaRef(as(UID.adminT1), 'rc-sin-nombre'), sinNombre))
  })

  it('administrador de t1 CREA una cancha con activa no booleana → DENY', async () => {
    await assertFails(
      setDoc(canchaRef(as(UID.adminT1), 'rc-activa'), cancha({ activa: 'si' })),
    )
  })

  it('administrador de t1 deja una cancha con nombre vacío al ACTUALIZAR → DENY', async () => {
    await assertSucceeds(setDoc(canchaRef(as(UID.adminT1), 'rc-upd-vacio'), cancha()))
    await assertFails(updateDoc(canchaRef(as(UID.adminT1), 'rc-upd-vacio'), { nombre: '  ' }))
  })

  it('profesor de t1 CREA una cancha en t1 → DENY (rol profesor)', async () => {
    await assertFails(setDoc(canchaRef(as(UID.profT1), 'rc-profe'), cancha()))
  })

  it('alumno_adulto de t1 ACTUALIZA una cancha de t1 → DENY', async () => {
    await assertFails(updateDoc(canchaRef(as(UID.alumnoT1), 'rc-allow'), { activa: false }))
  })

  it('administrador de t2 CREA una cancha en t1 → DENY (otro tenant)', async () => {
    await assertFails(setDoc(canchaRef(as(UID.adminT2), 'rc-t2'), cancha()))
  })

  it('usuario NO autenticado LEE una cancha de t1 → DENY', async () => {
    const anon = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(canchaRef(anon, 'rc-allow')))
  })

  /** Franja de un día en minutos (formato nuevo del horario). */
  const dia = (apertura, cierre) => ({ apertura, cierre })
  /** Horario semanal de 7 días: `porDia` pisa los días indicados (null = cerrado). */
  const semana = (porDia = {}, abierto = dia(450, 930)) =>
    Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, d in porDia ? porDia[d] : { ...abierto }]))
  const sedeRef = (db, sedeId = 'traki') => doc(db, 'academias', T1, 'sedes', sedeId)
  const actualizarHorario = (horario, ref = sedeRef(as(UID.adminT1))) =>
    updateDoc(ref, { horario })

  it('administrador de t1 CREA una sede con nombre y horario por día válidos → ALLOW', async () => {
    await assertSucceeds(
      setDoc(sedeRef(as(UID.adminT1), 'rnueva'), {
        nombre: 'Sede nueva',
        activa: true,
        horario: semana({ 5: dia(480, 780), 6: null }),
      }),
    )
  })

  it('administrador de t1 CREA una sede sin nombre → DENY', async () => {
    await assertFails(
      setDoc(sedeRef(as(UID.adminT1), 'rsin-nombre'), { activa: true, horario: semana() }),
    )
  })

  it('administrador de t1 CREA una sede con nombre vacío → DENY', async () => {
    await assertFails(
      setDoc(sedeRef(as(UID.adminT1), 'rvacia'), { nombre: '   ', activa: true }),
    )
  })

  it('administrador de t1 CREA una sede con activa no booleana → DENY', async () => {
    await assertFails(
      setDoc(sedeRef(as(UID.adminT1), 'ractiva'), { nombre: 'Sede', activa: 'si' }),
    )
  })

  it('profesor de t1 CREA una sede en t1 → DENY (rol profesor)', async () => {
    await assertFails(setDoc(sedeRef(as(UID.profT1), 'rprofe'), { nombre: 'Sede', activa: true }))
  })

  it('administrador de t2 CREA una sede en t1 → DENY (otro tenant)', async () => {
    await assertFails(setDoc(sedeRef(as(UID.adminT2), 'rt2'), { nombre: 'Sede', activa: true }))
  })

  it('administrador de t1 ACTUALIZA el horario por día (7:30-15:30 y domingo cerrado) → ALLOW', async () => {
    await assertSucceeds(actualizarHorario(semana({ 6: null })))
  })

  it('un día CERRADO (null) es válido → ALLOW', async () => {
    await assertSucceeds(actualizarHorario(semana({ 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null })))
  })

  it('horario con 7:15 (no múltiplo de 30) → DENY', async () => {
    await assertFails(actualizarHorario(semana({ 0: dia(435, 930) })))
  })

  it('horario con cierre igual a apertura → DENY', async () => {
    await assertFails(actualizarHorario(semana({ 0: dia(930, 930) })))
  })

  it('horario con cierre MENOR que la apertura → DENY', async () => {
    await assertFails(actualizarHorario(semana({ 0: dia(930, 450) })))
  })

  it('horario con una hora fuera de 0-1440 → DENY', async () => {
    await assertFails(actualizarHorario(semana({ 0: dia(450, 1470) })))
    await assertFails(actualizarHorario(semana({ 0: dia(-30, 930) })))
  })

  it('horario con una hora no entera → DENY', async () => {
    await assertFails(actualizarHorario(semana({ 0: dia(450.5, 930) })))
  })

  it('horario con un día de menos → DENY', async () => {
    const incompleto = semana()
    delete incompleto[6]
    await assertFails(actualizarHorario(incompleto))
  })

  it('horario con una clave extra (día 7) → DENY', async () => {
    await assertFails(actualizarHorario({ ...semana(), 7: dia(450, 930) }))
  })

  it('horario con campos extra dentro de un día → DENY', async () => {
    await assertFails(actualizarHorario(semana({ 0: { ...dia(450, 930), extra: 1 } })))
  })

  it('horario con el formato VIEJO de horas enteras → ALLOW (compatibilidad de lectura)', async () => {
    await assertSucceeds(actualizarHorario({ apertura: 7, cierre: 23 }))
  })

  it('horario con el formato viejo corrupto → DENY', async () => {
    await assertFails(actualizarHorario({ apertura: 23, cierre: 7 }))
    await assertFails(actualizarHorario({ apertura: 7, cierre: 25 }))
    await assertFails(actualizarHorario({ apertura: 7, cierre: 23, extra: 1 }))
  })

  it('horario que no es un mapa → DENY', async () => {
    await assertFails(actualizarHorario([1, 2, 3]))
    await assertFails(actualizarHorario('7-23'))
  })

  it('administrador de t1 ACTUALIZA una sede sin tocar el horario → ALLOW', async () => {
    await assertSucceeds(
      updateDoc(sedeRef(as(UID.adminT1)), {
        direccion: 'Calle de ensayo',
      }),
    )
  })

  it('administrador de t1 DESACTIVA una sede (activa: false) → ALLOW', async () => {
    await assertSucceeds(updateDoc(sedeRef(as(UID.adminT1)), { activa: false }))
    await assertSucceeds(updateDoc(sedeRef(as(UID.adminT1)), { activa: true }))
  })

  it('profesor de t1 ACTUALIZA el horario de la sede → DENY (rol profesor)', async () => {
    await assertFails(actualizarHorario(semana(), sedeRef(as(UID.profT1))))
  })
})

describe('9. Clase: categoría de grupo validada en las reglas', () => {
  const claseRef = (db, claseId) => doc(db, 'academias', T1, 'clases', claseId)

  it('administrador de t1 CREA una clase con categoriaGrupo válida → ALLOW', async () => {
    await assertSucceeds(
      setDoc(claseRef(as(UID.adminT1), 'cg-infantil'), clase({ categoriaGrupo: 'infantil' })),
    )
  })

  it('categoriaGrupo null → ALLOW', async () => {
    await assertSucceeds(
      setDoc(claseRef(as(UID.adminT1), 'cg-null'), clase({ categoriaGrupo: null })),
    )
  })

  it('administrador de t1 CREA una clase con categoriaGrupo inválida → DENY', async () => {
    for (const valor of ['juvenil', 'Infantil', 'adultos', 'niños']) {
      await assertFails(
        setDoc(claseRef(as(UID.adminT1), `cg-malo-${valor}`), clase({ categoriaGrupo: valor })),
      )
    }
  })

  it('administrador de t1 ACTUALIZA una clase a una categoriaGrupo inválida → DENY', async () => {
    await assertSucceeds(
      setDoc(claseRef(as(UID.adminT1), 'cg-upd'), clase({ categoriaGrupo: 'junior' })),
    )
    await assertFails(updateDoc(claseRef(as(UID.adminT1), 'cg-upd'), { categoriaGrupo: 'juvenil' }))
    await assertSucceeds(updateDoc(claseRef(as(UID.adminT1), 'cg-upd'), { categoriaGrupo: 'adulto' }))
  })
})

/* --------------------------------------------------------------------- */
/* [F3] Cobros: perfiles, tarifas, parámetros y cobro de la clase          */
/* --------------------------------------------------------------------- */

/** Perfil de cobro mínimo válido para las reglas. */
const perfil = (extra = {}) => ({
  nombre: 'Individual',
  personas: 1,
  modo: 'total',
  activo: true,
  orden: 1,
  ...extra,
})

describe('[F3] perfilesCobro: solo admin, nunca se borran', () => {
  it('administrador de t1 CREA un perfil válido → ALLOW', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'perfilesCobro', 'individual'), perfil()),
    )
  })

  it('profesor de t1 CREA un perfil → DENY', async () => {
    await assertFails(
      setDoc(doc(as(UID.profT1), 'academias', T1, 'perfilesCobro', 'x'), perfil()),
    )
  })

  it('administrador de t2 CREA un perfil en t1 → DENY (otro tenant)', async () => {
    await assertFails(
      setDoc(doc(as(UID.adminT2), 'academias', T1, 'perfilesCobro', 'x'), perfil()),
    )
  })

  it('un perfil con modo inválido → DENY', async () => {
    await assertFails(
      setDoc(
        doc(as(UID.adminT1), 'academias', T1, 'perfilesCobro', 'x'),
        perfil({ modo: 'mitad' }),
      ),
    )
  })

  it('un perfil con personas fuera de 1-4 → DENY', async () => {
    await assertFails(
      setDoc(
        doc(as(UID.adminT1), 'academias', T1, 'perfilesCobro', 'x'),
        perfil({ personas: 5 }),
      ),
    )
  })

  it('un perfil sin nombre → DENY', async () => {
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'perfilesCobro', 'x'), perfil({ nombre: '' })),
    )
  })

  it('administrador de t1 LEE los perfiles → ALLOW; otro tenant → DENY', async () => {
    await assertSucceeds(getDocs(collection(as(UID.adminT1), 'academias', T1, 'perfilesCobro')))
    await assertFails(getDocs(collection(as(UID.adminT2), 'academias', T1, 'perfilesCobro')))
  })

  it('BORRAR un perfil → DENY (soft delete con activo:false)', async () => {
    await assertFails(deleteDoc(doc(as(UID.adminT1), 'academias', T1, 'perfilesCobro', 'individual')))
  })
})

describe('[F3] config/parametros: solo admin, con campos válidos', () => {
  it('administrador de t1 escribe parámetros válidos → ALLOW', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'config', 'parametros'), {
        avisoAusenciaHoras: 24,
        porcentajeFaltaSinAviso: 50,
        pagoProfesor: { modo: 'por_hora', montoCents: 1500 },
        duracionesPermitidas: [60, 90, 120],
        vencimientoCreditoDias: null,
      }),
    )
  })

  it('un no-admin escribe parámetros → DENY', async () => {
    await assertFails(
      setDoc(doc(as(UID.profT1), 'academias', T1, 'config', 'parametros'), { avisoAusenciaHoras: 1 }),
    )
  })

  it('parámetros con un rango inválido → DENY', async () => {
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'config', 'parametros'), {
        porcentajeFaltaSinAviso: 101,
      }),
    )
  })

  it('administrador de t1 LEE parámetros → ALLOW; otro tenant → DENY', async () => {
    await assertSucceeds(getDoc(doc(as(UID.adminT1), 'academias', T1, 'config', 'parametros')))
    await assertFails(getDoc(doc(as(UID.adminT2), 'academias', T1, 'config', 'parametros')))
  })

  it('BORRAR los parámetros → DENY (no se borran)', async () => {
    await assertFails(deleteDoc(doc(as(UID.adminT1), 'academias', T1, 'config', 'parametros')))
  })
})

describe('[F3] tarifas en la sede', () => {
  it('administrador de t1 CREA una sede con tarifas → ALLOW', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'sedes', 'tarifada'), {
        nombre: 'Tarifada',
        activa: true,
        tarifas: { individual: 4000, pareja: 4500 },
      }),
    )
  })

  it('una sede con tarifas que no son un mapa → DENY', async () => {
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'sedes', 'mala'), {
        nombre: 'Mala',
        activa: true,
        tarifas: [4000],
      }),
    )
  })
})

describe('[F3] cobro en la clase', () => {
  const cobro = {
    perfilCobroId: 'cuatro',
    modo: 'total',
    tarifaHoraCents: 5500,
    montoEstandarCents: 5500,
    montoCents: 5500,
    ajustado: false,
    motivoAjuste: null,
  }

  it('administrador CREA una clase con cobro válido → ALLOW', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'clases', 'con-cobro'), clase({ cobro })),
    )
  })

  it('una clase con montoCents no entero → DENY', async () => {
    await assertFails(
      setDoc(
        doc(as(UID.adminT1), 'academias', T1, 'clases', 'cobro-malo'),
        clase({ cobro: { ...cobro, montoCents: 'gratis' } }),
      ),
    )
  })

  it('un cobro con claves de más → DENY', async () => {
    await assertFails(
      setDoc(
        doc(as(UID.adminT1), 'academias', T1, 'clases', 'cobro-extra'),
        clase({ cobro: { ...cobro, propina: 100 } }),
      ),
    )
  })

  it('una clase con modo de cobro inválido → DENY', async () => {
    await assertFails(
      setDoc(
        doc(as(UID.adminT1), 'academias', T1, 'clases', 'cobro-modo'),
        clase({ cobro: { ...cobro, modo: 'mitad' } }),
      ),
    )
  })
})

/* --------------------------------------------------------------------- */
/* [F4] Cargos y pagos al profesor: solo admin, con forma validada        */
/* --------------------------------------------------------------------- */

const cargo = (extra = {}) => ({
  claseId: 'c1',
  alumnoId: 'a1',
  alumnoNombre: 'Aldo Adulto',
  sedeId: 'traki',
  fecha: FECHA,
  concepto: 'clase',
  montoCents: 2500,
  estado: 'pendiente',
  pagadoEn: null,
  metodoPago: null,
  creadoEn: new Date(),
  ...extra,
})

const pagoProfesor = (extra = {}) => ({
  claseId: 'c1',
  profesorId: 'p1',
  profesorNombre: 'Pablo Profesor',
  sedeId: 'traki',
  fecha: FECHA,
  montoCents: 1500,
  base: { modo: 'por_hora', minutos: 60 },
  estado: 'pendiente',
  pagadoEn: null,
  metodoPago: null,
  ...extra,
})

describe('[F4] cargos: solo admin, enums y centavos enteros', () => {
  it('administrador CREA un cargo válido → ALLOW', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'c1_a1'), cargo()),
    )
  })

  it('profesor CREA un cargo → DENY', async () => {
    await assertFails(setDoc(doc(as(UID.profT1), 'academias', T1, 'cargos', 'c1_a1'), cargo()))
  })

  it('administrador de t2 crea un cargo en t1 → DENY (otro tenant)', async () => {
    await assertFails(setDoc(doc(as(UID.adminT2), 'academias', T1, 'cargos', 'c1_a1'), cargo()))
  })

  it('concepto o estado inválidos → DENY', async () => {
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'x1'), cargo({ concepto: 'propina' })),
    )
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'x2'), cargo({ estado: 'raro' })),
    )
  })

  it('monto negativo o float, o método inválido → DENY', async () => {
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'x1'), cargo({ montoCents: -1 })),
    )
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'x2'), cargo({ montoCents: 12.5 })),
    )
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'x3'), cargo({ metodoPago: 'bitcoin' })),
    )
  })

  it('un cargo con un campo de más → DENY', async () => {
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'x1'), cargo({ propina: 100 })),
    )
  })

  it('el admin marca un cargo pagado → ALLOW, pero borrarlo → DENY', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'c1_a1'), cargo()),
    )
    await assertSucceeds(
      updateDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'c1_a1'), {
        estado: 'pagado',
        pagadoEn: new Date(),
        metodoPago: 'efectivo',
      }),
    )
    await assertFails(deleteDoc(doc(as(UID.adminT1), 'academias', T1, 'cargos', 'c1_a1')))
  })
})

describe('[F4] pagosProfesor: solo admin, con forma validada', () => {
  it('administrador CREA un pago válido → ALLOW', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'pagosProfesor', 'c1'), pagoProfesor()),
    )
  })

  it('profesor CREA un pago → DENY', async () => {
    await assertFails(
      setDoc(doc(as(UID.profT1), 'academias', T1, 'pagosProfesor', 'c1'), pagoProfesor()),
    )
  })

  it('base incompleta o monto float → DENY', async () => {
    await assertFails(
      setDoc(
        doc(as(UID.adminT1), 'academias', T1, 'pagosProfesor', 'x1'),
        pagoProfesor({ base: { modo: 'por_hora' } }),
      ),
    )
    await assertFails(
      setDoc(
        doc(as(UID.adminT1), 'academias', T1, 'pagosProfesor', 'x2'),
        pagoProfesor({ montoCents: 15.5 }),
      ),
    )
  })

  it('borrar un pago → DENY', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'pagosProfesor', 'c1'), pagoProfesor()),
    )
    await assertFails(deleteDoc(doc(as(UID.adminT1), 'academias', T1, 'pagosProfesor', 'c1')))
  })
})

describe('[F4] parámetros de cierre: enums validados', () => {
  it('valores válidos → ALLOW; enum inválido → DENY', async () => {
    await assertSucceeds(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'config', 'parametros'), {
        repartoAusenciaAvisada: 'reparte_entre_presentes',
        pagoProfesorSiTodosFaltanSinAviso: 'proporcional_cobrado',
      }),
    )
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'config', 'parametros'), {
        repartoAusenciaAvisada: 'reparte',
      }),
    )
    await assertFails(
      setDoc(doc(as(UID.adminT1), 'academias', T1, 'config', 'parametros'), {
        pagoProfesorSiTodosFaltanSinAviso: 'mitad',
      }),
    )
  })
})
