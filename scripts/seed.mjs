/*
 * Seed del "tenant de ensayo" contra el Emulator Suite.
 *
 * No agrega dependencias: usa fetch nativo de Node y la API REST del emulador.
 * Usa el token "owner" del emulador para saltear las Security Rules (es el
 * único lugar del proyecto autorizado a hacerlo, y solo corre local).
 *
 * Requisitos: emuladores de auth + firestore levantados. Ver README.
 * Uso:  npm run seed        (o  node scripts/seed.mjs)
 */

import { bloquesDeClase } from '../src/firebase/db.js'

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? 'academia-padel-jdm'
const EMULATOR_HOST = process.env.EMULATOR_HOST ?? '127.0.0.1'
const FIRESTORE_PORT = process.env.FIRESTORE_EMULATOR_PORT ?? '8080'
const AUTH_PORT = process.env.AUTH_EMULATOR_PORT ?? '9099'

const FIRESTORE = `http://${EMULATOR_HOST}:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
const AUTH = `http://${EMULATOR_HOST}:${AUTH_PORT}`
const TENANT = 'ensayo'
const TENANT_DOC = `academias/${TENANT}`
const OWNER_HEADERS = { Authorization: 'Bearer owner' }

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } }
  if (typeof value === 'object') return { mapValue: { fields: toFields(value) } }
  throw new Error(`Tipo no soportado en seed: ${typeof value}`)
}

function toFields(data) {
  const fields = {}
  for (const [key, value] of Object.entries(data)) fields[key] = toValue(value)
  return fields
}

async function request(url, options = {}) {
  const res = await fetch(url, options)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { ok: res.ok, status: res.status, body }
}

async function setDoc(path, data) {
  const { ok, status, body } = await request(`${FIRESTORE}/${path}`, {
    method: 'PATCH',
    headers: { ...OWNER_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(data) }),
  })
  if (!ok) throw new Error(`Firestore PATCH ${path} → ${status}: ${JSON.stringify(body)}`)
}

async function crearUsuario({ email, password, nombre }) {
  const { ok, status, body } = await request(
    `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`,
    {
      method: 'POST',
      headers: { ...OWNER_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, emailVerified: true, displayName: nombre }),
    },
  )
  if (!ok) throw new Error(`Auth crear ${email} → ${status}: ${JSON.stringify(body)}`)
  return body.localId
}

async function limpiar() {
  await request(`${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
    headers: OWNER_HEADERS,
  })
  await request(`${FIRESTORE}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
    headers: OWNER_HEADERS,
  })
}

/** "YYYY-MM-DD" relativo a hoy, con partes LOCALES (no toISOString: Caracas es UTC-4). */
function diaRelativo(dias) {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Crea una clase con sus bloques de 30 min, reutilizando el mismo cálculo puro
 * que usa `crearClase` en src/firebase/db.js. El seed escribe por REST con
 * token "owner" (único lugar autorizado a saltear reglas), así que no puede
 * llamar la transacción del SDK; reusa `bloquesDeClase` para que la clase sea
 * dueña de sus bloques igual que en la app.
 */
async function crearClaseEnSeed(datos) {
  const bloques = bloquesDeClase(datos)
  const creadoEn = new Date()
  const clase = {
    tipo: 'variable',
    serieId: null,
    estado: datos.estado ?? 'reservada',
    categoria: datos.categoria ?? null,
    asistencias: datos.asistencias ?? [],
    alumnos: datos.alumnos ?? [],
    alumnoNombres: datos.alumnoNombres ?? [],
    cupo: datos.cupo ?? 4,
    sedeId: datos.sedeId,
    sedeNombre: datos.sedeNombre ?? null,
    canchaId: datos.canchaId,
    profesorId: datos.profesorId,
    profesorNombre: datos.profesorNombre ?? null,
    fecha: datos.fecha,
    horaInicio: datos.horaInicio,
    horaFin: datos.horaFin,
    bloques: bloques.map((b) => b.id),
    creadoPor: 'seed',
    creadoEn,
  }
  await setDoc(`${TENANT_DOC}/clases/${datos.id}`, clase)
  for (const bloque of bloques) {
    await setDoc(`${TENANT_DOC}/bloques/${bloque.id}`, {
      ...bloque.data,
      claseId: datos.id,
      creadoPor: 'seed',
      creadoEn,
    })
  }
}

/*
 * Usuarios de Auth del tenant de ensayo. Por ahora SOLO el administrador tiene
 * acceso. profe@, alumno@ y tutor@ se conservan como usuarios NEGATIVOS: tienen
 * membresía con su rol, pero las reglas les niegan toda lectura/escritura salvo
 * su propia membresía. Profesor y alumno son fichas (records), no cuentas: ya
 * no se enlazan con `profesorId`/`alumnoId` en la membresía.
 */
const USUARIOS = [
  { email: 'admin@ensayo.test', password: 'ensayo1234', nombre: 'Ana Administradora', rol: 'administrador' },
  { email: 'profe@ensayo.test', password: 'ensayo1234', nombre: 'Pablo Profesor', rol: 'profesor' },
  { email: 'alumno@ensayo.test', password: 'ensayo1234', nombre: 'Aldo Adulto', rol: 'alumno_adulto' },
  { email: 'tutor@ensayo.test', password: 'ensayo1234', nombre: 'Teresa Tutora', rol: 'alumno_menor' },
]

const SEDES = [
  { id: 'traki', nombre: 'Traki', canchas: 3 },
  { id: 'boleita', nombre: 'Boleíta', canchas: 2 },
  { id: 'santa-rosa', nombre: 'Santa Rosa', canchas: 2 },
  { id: 'capital', nombre: 'Capital', canchas: 2 },
]

async function main() {
  console.log(`Seed del tenant "${TENANT}" en ${EMULATOR_HOST} (proyecto ${PROJECT_ID})…`)

  try {
    await fetch(`${AUTH}/`, { method: 'GET' })
  } catch {
    throw new Error('No responden los emuladores. Levantalos con `npm run emulators` antes de seedear.')
  }

  await limpiar()
  console.log('· Emuladores limpios')

  const tenant = 'academias/' + TENANT
  await setDoc(tenant, {
    nombre: 'Academia de Ensayo',
    slug: TENANT,
    estado: 'activa',
    plan: 'basico',
    zonaHoraria: 'America/Caracas',
    moneda: 'USD',
    creadoEn: new Date(),
  })

  for (const sede of SEDES) {
    await setDoc(`${tenant}/sedes/${sede.id}`, {
      nombre: sede.nombre,
      direccion: `Sede ${sede.nombre}`,
      activa: true,
      orden: SEDES.indexOf(sede),
    })
    for (let i = 1; i <= sede.canchas; i += 1) {
      await setDoc(`${tenant}/sedes/${sede.id}/canchas/c${i}`, {
        nombre: `Cancha ${i}`,
        numero: i,
        tipo: i % 2 === 0 ? 'outdoor' : 'indoor',
        activa: true,
      })
    }
  }
  console.log(`· ${SEDES.length} sedes y sus canchas`)

  await setDoc(`${tenant}/profesores/p1`, {
    nombre: 'Pablo Profesor',
    email: 'profe@ensayo.test',
    telefono: '+58 412 000 0001',
    tarifaHoraCentavos: 1500,
    sedes: ['traki', 'boleita'],
    activo: true,
  })
  await setDoc(`${tenant}/profesores/p2`, {
    nombre: 'Paola Profesora',
    email: 'paola@ensayo.test',
    telefono: '+58 412 000 0002',
    tarifaHoraCentavos: 1500,
    sedes: ['santa-rosa', 'capital'],
    activo: true,
  })

  await setDoc(`${tenant}/alumnos/a1`, {
    tipo: 'adulto',
    nombre: 'Aldo Adulto',
    documento: 'V-10000001',
    email: 'alumno@ensayo.test',
    telefono: '+58 414 000 0001',
    tutor: null,
    sedes: ['traki'],
    nivel: 'intermedio',
    activo: true,
    notas: '',
  })
  await setDoc(`${tenant}/alumnos/a2`, {
    tipo: 'menor',
    nombre: 'Marta Menor',
    documento: 'V-20000002',
    email: 'tutor@ensayo.test',
    telefono: '+58 414 000 0002',
    tutor: {
      nombre: 'Teresa Tutora',
      documento: 'V-30000003',
      telefono: '+58 414 000 0003',
      email: 'tutor@ensayo.test',
      parentesco: 'madre',
    },
    sedes: ['traki', 'boleita'],
    nivel: 'principiante',
    activo: true,
    notas: '',
  })

  await crearClaseEnSeed({
    id: 'c1',
    sedeId: 'traki',
    sedeNombre: 'Traki',
    canchaId: 'c1',
    profesorId: 'p1',
    profesorNombre: 'Pablo Profesor',
    fecha: diaRelativo(1),
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 4,
    categoria: '6a',
    alumnos: ['a1'],
    alumnoNombres: ['Aldo Adulto'],
    estado: 'reservada',
  })

  // Antes era "fija" (serieId): las series recurrentes están fuera de alcance,
  // así que pasa a ser una clase "variable" más, creada con sus bloques.
  await crearClaseEnSeed({
    id: 'c2',
    sedeId: 'traki',
    sedeNombre: 'Traki',
    canchaId: 'c1',
    profesorId: 'p1',
    profesorNombre: 'Pablo Profesor',
    fecha: diaRelativo(-1),
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 4,
    categoria: '7a',
    alumnos: ['a1', 'a2'],
    alumnoNombres: ['Aldo Adulto', 'Marta Menor'],
    asistencias: [
      { alumnoId: 'a1', estado: 'presente', motivo: null, registradoPor: 'seed', registradoEn: new Date() },
      { alumnoId: 'a2', estado: 'ausente', motivo: 'enfermedad', registradoPor: 'seed', registradoEn: new Date() },
    ],
    estado: 'pendiente_cobro',
  })

  const periodo = diaRelativo(0).slice(0, 7)
  await setDoc(`${tenant}/cargos/cg1`, {
    alumnoId: 'a1',
    alumnoNombre: 'Aldo Adulto',
    concepto: 'clase',
    claseId: 'c2',
    planId: null,
    periodo,
    montoCentavos: 1500,
    moneda: 'USD',
    estado: 'pendiente',
    anuladoPor: null,
    creadoEn: new Date(),
  })
  await setDoc(`${tenant}/pagos/pg1`, {
    alumnoId: 'a1',
    cargoIds: ['cg1'],
    montoCentavos: 1500,
    metodo: 'transferencia',
    referencia: 'REF-0001',
    comprobante: null,
    estado: 'en_revision',
    motivoRechazo: null,
    revisadoPor: null,
    creadoEn: new Date(),
    revisadoEn: null,
  })
  console.log('· Profesores, alumnos, clases, cargos y pagos')

  const ids = {}
  for (const usuario of USUARIOS) {
    const uid = await crearUsuario(usuario)
    ids[usuario.email] = uid
    await setDoc(`${tenant}/miembros/${uid}`, {
      uid,
      rol: usuario.rol,
      activo: true,
      nombre: usuario.nombre,
      creadoEn: new Date(),
    })
  }
  console.log(`· ${USUARIOS.length} usuarios y membresías`)

  console.log('\nListo. Usuarios de ensayo (contraseña "ensayo1234"):')
  for (const usuario of USUARIOS) {
    const acceso = usuario.rol === 'administrador' ? 'acceso' : 'sin acceso (ficha)'
    console.log(`  ${usuario.rol.padEnd(14)} ${usuario.email.padEnd(22)} ${acceso}`)
  }
  console.log('\nSolo el administrador opera la agenda. Emulator UI: http://127.0.0.1:4000')
}

main().catch((error) => {
  console.error('\nSeed falló:', error.message)
  process.exit(1)
})
